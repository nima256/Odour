/*
 * Odour hero — lightweight WebGL renderer for the hero GLB model.
 *
 * The hero model is a single untextured mesh (POSITION + indices), so a full
 * 3D engine would be overkill. This file parses the GLB, computes smooth
 * normals and renders it with a soft "porcelain" studio material in the brand
 * palette. It is progressive enhancement only: the static hero image stays
 * visible until the first frame is drawn, and nothing runs on devices that
 * can't (or shouldn't) render it.
 */
(function () {
  "use strict";

  var stage = document.querySelector("[data-hero-3d]");
  if (!stage) return;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var conn = navigator.connection || {};
  var lowPower =
    conn.saveData === true ||
    /(^|-)2g$/.test(conn.effectiveType || "") ||
    (navigator.deviceMemory && navigator.deviceMemory < 2);
  if (lowPower) return;

  var canvas = document.createElement("canvas");
  canvas.className = "hero-3d__canvas";
  canvas.setAttribute("aria-hidden", "true");
  var gl =
    canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" }) ||
    canvas.getContext("experimental-webgl");
  if (!gl) return;

  var src = stage.getAttribute("data-hero-3d");

  // ---------- GLB parsing ----------
  function parseGlb(buffer) {
    var dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
    var jsonLen = dv.getUint32(12, true);
    var json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
    var binStart = 20 + jsonLen + 8;
    var prim = json.meshes[0].primitives[0];

    function read(accIndex) {
      var acc = json.accessors[accIndex];
      var view = json.bufferViews[acc.bufferView];
      var offset = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
      var size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
      var Ctor = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[acc.componentType];
      return new Ctor(buffer.slice(offset, offset + acc.count * size * Ctor.BYTES_PER_ELEMENT));
    }

    var positions = read(prim.attributes.POSITION);
    var indices = prim.indices !== undefined ? read(prim.indices) : null;
    return { positions: positions, indices: indices };
  }

  function prepare(mesh) {
    var p = mesh.positions;
    var vCount = p.length / 3;
    var idx = mesh.indices;
    if (!idx) {
      idx = new Uint32Array(vCount);
      for (var k = 0; k < vCount; k++) idx[k] = k;
    }

    // Center on the bounding box and scale to a unit radius.
    var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (var i = 0; i < p.length; i += 3) {
      for (var a = 0; a < 3; a++) {
        if (p[i + a] < min[a]) min[a] = p[i + a];
        if (p[i + a] > max[a]) max[a] = p[i + a];
      }
    }
    var c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var r = 0;
    for (i = 0; i < p.length; i += 3) {
      var dx = p[i] - c[0], dy = p[i + 1] - c[1], dz = p[i + 2] - c[2];
      r = Math.max(r, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    var pos = new Float32Array(p.length);
    for (i = 0; i < p.length; i += 3) {
      pos[i] = (p[i] - c[0]) / r;
      pos[i + 1] = (p[i + 1] - c[1]) / r;
      pos[i + 2] = (p[i + 2] - c[2]) / r;
    }

    // Smooth (area-weighted) vertex normals.
    var nrm = new Float32Array(p.length);
    for (i = 0; i < idx.length; i += 3) {
      var ia = idx[i] * 3, ib = idx[i + 1] * 3, ic = idx[i + 2] * 3;
      var ux = pos[ib] - pos[ia], uy = pos[ib + 1] - pos[ia + 1], uz = pos[ib + 2] - pos[ia + 2];
      var vx = pos[ic] - pos[ia], vy = pos[ic + 1] - pos[ia + 1], vz = pos[ic + 2] - pos[ia + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      [ia, ib, ic].forEach(function (o) {
        nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz;
      });
    }
    for (i = 0; i < nrm.length; i += 3) {
      var l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
      nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
    }

    var needs32 = vCount > 65535;
    if (needs32 && !gl.getExtension("OES_element_index_uint")) throw new Error("uint32 indices unsupported");
    return { pos: pos, nrm: nrm, idx: needs32 ? new Uint32Array(idx) : new Uint16Array(idx), type: needs32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  // ---------- Shaders ----------
  var VS = [
    "attribute vec3 aPos; attribute vec3 aNrm;",
    "uniform mat4 uModel; uniform mat4 uProj;",
    "varying vec3 vN; varying vec3 vP;",
    "void main(){ vec4 wp = uModel * vec4(aPos,1.0); vP = wp.xyz;",
    " vN = normalize((uModel * vec4(aNrm,0.0)).xyz); gl_Position = uProj * wp; }",
  ].join("\n");

  // Porcelain/ivory material: cream base, olive-tinted shadows, warm rim light.
  var FS = [
    "precision mediump float;",
    "varying vec3 vN; varying vec3 vP;",
    "uniform vec3 uBase; uniform vec3 uShade; uniform vec3 uRim;",
    "void main(){",
    " vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n;",
    " vec3 v = normalize(vec3(0.0,0.0,3.2) - vP);",
    " vec3 key = normalize(vec3(-0.55,0.75,0.65));",
    " vec3 fill = normalize(vec3(0.7,0.1,0.5));",
    " float dk = max(dot(n,key),0.0); float df = max(dot(n,fill),0.0)*0.35;",
    " float hemi = 0.5 + 0.5*n.y;",
    " float cav = smoothstep(-0.2, 0.9, dot(n, v));",
    " vec3 col = mix(uShade, uBase, clamp(0.06 + 0.78*dk + df + 0.10*hemi, 0.0, 1.0));",
    " col = mix(col * 0.82, col, cav);",
    " vec3 h = normalize(key + v); float spec = pow(max(dot(n,h),0.0), 48.0) * 0.35;",
    " float fres = pow(1.0 - max(dot(n,v),0.0), 3.0);",
    " col += spec + uRim * fres * 0.55;",
    " gl_FragColor = vec4(col, 1.0);",
    "}",
  ].join("\n");

  function shader(type, srcText) {
    var s = gl.createShader(type);
    gl.shaderSource(s, srcText);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  // ---------- Minimal matrix helpers (column-major) ----------
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function model(rx, ry, ty, scale) {
    var cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    // R = Rx * Ry, then scale, then translate (0, ty, -3.2)
    return [
      cy * scale, sx * sy * scale, -cx * sy * scale, 0,
      0, cx * scale, sx * scale, 0,
      sy * scale, -sx * cy * scale, cx * cy * scale, 0,
      0, ty, -3.2, 1,
    ];
  }

  function hexToVec(hex) {
    var n = parseInt(hex.replace("#", ""), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function start(mesh) {
    var prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    function buffer(target, data) {
      var b = gl.createBuffer();
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return b;
    }
    buffer(gl.ARRAY_BUFFER, mesh.pos);
    var aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    buffer(gl.ARRAY_BUFFER, mesh.nrm);
    var aNrm = gl.getAttribLocation(prog, "aNrm");
    gl.enableVertexAttribArray(aNrm);
    gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
    buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);

    var css = getComputedStyle(document.documentElement);
    function token(name, fallback) {
      return (css.getPropertyValue(name) || fallback).trim() || fallback;
    }
    gl.uniform3fv(gl.getUniformLocation(prog, "uBase"), hexToVec(token("--od-hero-model", "#fbf5e9")));
    gl.uniform3fv(gl.getUniformLocation(prog, "uShade"), hexToVec(token("--od-hero-shade", "#8c8a63")));
    gl.uniform3fv(gl.getUniformLocation(prog, "uRim"), hexToVec(token("--od-hero-rim", "#fff1db")));
    var uModel = gl.getUniformLocation(prog, "uModel");
    var uProj = gl.getUniformLocation(prog, "uProj");

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    var pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
    var visible = true, raf = 0, t0 = performance.now();
    var baseYaw = parseFloat(stage.getAttribute("data-hero-yaw") || "0");

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniformMatrix4fv(uProj, false, perspective(0.62, w / h, 0.1, 20));
    }

    function draw(now) {
      var t = (now - t0) / 1000;
      eased.x += (pointer.x - eased.x) * 0.05;
      eased.y += (pointer.y - eased.y) * 0.05;
      // A slow sway around the front view: the sculpture is composed to be seen from the front.
      var yaw = reduceMotion ? baseYaw : baseYaw + Math.sin(t * 0.22) * 0.32 + eased.x * 0.3;
      var pitch = reduceMotion ? 0.08 : 0.08 + eased.y * 0.12;
      var lift = reduceMotion ? 0 : Math.sin(t * 0.7) * 0.03;
      gl.uniformMatrix4fv(uModel, false, model(pitch, yaw, lift, 0.98));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, mesh.idx.length, mesh.type, 0);
    }

    function loop(now) {
      draw(now);
      if (!reduceMotion && visible && !document.hidden) raf = requestAnimationFrame(loop);
      else raf = 0;
    }
    function kick() {
      if (!raf && !reduceMotion && visible && !document.hidden) raf = requestAnimationFrame(loop);
    }

    stage.appendChild(canvas);
    resize();
    draw(performance.now());
    stage.classList.add("is-3d-ready");
    kick();

    if ("ResizeObserver" in window) {
      new ResizeObserver(function () { resize(); draw(performance.now()); }).observe(stage);
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        kick();
      }).observe(stage);
    }
    document.addEventListener("visibilitychange", kick);
    if (!reduceMotion && window.matchMedia("(hover: hover)").matches) {
      window.addEventListener("pointermove", function (e) {
        pointer.x = e.clientX / window.innerWidth - 0.5;
        pointer.y = e.clientY / window.innerHeight - 0.5;
      }, { passive: true });
    }
    canvas.addEventListener("webglcontextlost", function (e) {
      e.preventDefault();
      cancelAnimationFrame(raf);
      stage.classList.remove("is-3d-ready");
      canvas.remove();
    });
  }

  function load() {
    fetch(src, { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("model " + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { start(prepare(parseGlb(buf))); })
      .catch(function (err) {
        // The static fallback simply stays in place.
        if (window.console) console.warn("[hero-3d]", err.message);
      });
  }

  // Don't compete with critical content: load after the page is idle.
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 2500 });
  else window.addEventListener("load", function () { setTimeout(load, 300); });
})();
