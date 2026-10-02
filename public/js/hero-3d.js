/*
 * Odour hero — lightweight WebGL renderer for the hero GLB model.
 *
 * The hero model is a single untextured mesh (POSITION + indices). Rather than
 * shipping a 3D engine, this file parses the GLB, computes smooth normals and
 * renders it as a studio-lit porcelain sculpture in the brand palette:
 * orbiting warm key light, olive ground bounce, soft-box reflections, pearl
 * sheen, tone mapping, a contact shadow that follows the float, and gentle
 * pointer / drag interaction. It is progressive enhancement only — the static
 * hero composition stays visible until the first frame, and nothing runs on
 * low-power devices or without WebGL.
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
    (navigator.deviceMemory && navigator.deviceMemory < 2) ||
    (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 3);
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

    return { positions: read(prim.attributes.POSITION), indices: prim.indices !== undefined ? read(prim.indices) : null };
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
    "varying vec3 vN; varying vec3 vP; varying float vH;",
    "void main(){ vec4 wp = uModel * vec4(aPos,1.0); vP = wp.xyz; vH = aPos.y;",
    " vN = normalize((uModel * vec4(aNrm,0.0)).xyz); gl_Position = uProj * wp; }",
  ].join("\n");

  // Porcelain studio material in the brand palette.
  var FS = [
    "precision mediump float;",
    "varying vec3 vN; varying vec3 vP; varying float vH;",
    "uniform vec3 uBase; uniform vec3 uShade; uniform vec3 uRim; uniform vec3 uSheen;",
    "uniform vec3 uKey; uniform float uReveal;",
    "vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }",
    "void main(){",
    " vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n;",
    " vec3 v = normalize(vec3(0.0,0.15,3.4) - vP);",
    " vec3 key = normalize(uKey);",
    " vec3 fill = normalize(vec3(0.75,0.15,0.55));",
    // soft wrap diffuse for a porcelain feel
    " float dk = max((dot(n,key)+0.35)/1.35,0.0);",
    " float df = max((dot(n,fill)+0.5)/1.5,0.0)*0.28;",
    // hemisphere: warm sky above, olive bounce from the floor below
    " vec3 sky = vec3(1.0,0.97,0.9); vec3 ground = uShade;",
    " vec3 amb = mix(ground, sky, 0.5 + 0.5*n.y) * 0.32;",
    " vec3 col = uBase * (amb + vec3(1.0,0.95,0.86)*dk*0.92 + df);",
    // studio soft-box reflection read from the reflected view vector
    " vec3 r = reflect(-v, n);",
    " float box = smoothstep(0.35,0.9,r.y) * (1.0 - smoothstep(0.55,1.0,abs(r.x)));",
    " float fres = pow(1.0 - max(dot(n,v),0.0), 3.0);",
    " col += vec3(1.0,0.98,0.93) * box * (0.06 + 0.45*fres);",
    // glazed specular + pearl sheen shifting cream→gold with the view angle
    " vec3 h = normalize(key + v); float spec = pow(max(dot(n,h),0.0), 90.0);",
    " col += vec3(1.0,0.97,0.9) * spec * 0.55;",
    " col += mix(uRim, uSheen, fres) * fres * 0.5;",
    // gentle occlusion toward the base of the sculpture
    " col *= mix(0.78, 1.0, smoothstep(-0.95, -0.35, vH));",
    " col = aces(col * 1.08);",
    " gl_FragColor = vec4(col * uReveal, uReveal);",
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
    return [
      cy * scale, sx * sy * scale, -cx * sy * scale, 0,
      0, cx * scale, sx * scale, 0,
      sy * scale, -sx * cy * scale, cx * cy * scale, 0,
      0, ty, -3.4, 1,
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
    var token = function (name, fallback) { return (css.getPropertyValue(name) || "").trim() || fallback; };
    gl.uniform3fv(gl.getUniformLocation(prog, "uBase"), hexToVec(token("--od-hero-model", "#fbf5e9")));
    gl.uniform3fv(gl.getUniformLocation(prog, "uShade"), hexToVec(token("--od-hero-shade", "#8d8b66")));
    gl.uniform3fv(gl.getUniformLocation(prog, "uRim"), hexToVec(token("--od-hero-rim", "#fff1db")));
    gl.uniform3fv(gl.getUniformLocation(prog, "uSheen"), hexToVec(token("--od-hero-sheen", "#e8cf9a")));
    var uModel = gl.getUniformLocation(prog, "uModel");
    var uProj = gl.getUniformLocation(prog, "uProj");
    var uKey = gl.getUniformLocation(prog, "uKey");
    var uReveal = gl.getUniformLocation(prog, "uReveal");

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    var pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
    var drag = { active: false, startX: 0, base: 0, offset: 0 };
    var visible = true, raf = 0, t0 = performance.now();
    var baseYaw = parseFloat(stage.getAttribute("data-hero-yaw") || "0.12");

    function resize() {
      var cap = window.matchMedia("(max-width: 767px)").matches ? 1.5 : 1.75;
      var dpr = Math.min(window.devicePixelRatio || 1, cap);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniformMatrix4fv(uProj, false, perspective(0.58, w / h, 0.1, 20));
    }

    function draw(now) {
      var t = (now - t0) / 1000;
      var reveal = reduceMotion ? 1 : Math.min(1, t / 1.1);
      var ease = 1 - Math.pow(1 - reveal, 3);
      eased.x += (pointer.x - eased.x) * 0.05;
      eased.y += (pointer.y - eased.y) * 0.05;
      if (!drag.active) drag.offset *= 0.96; // drift back to the composed front view
      var sway = reduceMotion ? 0 : Math.sin(t * 0.22) * 0.28;
      var yaw = baseYaw + sway + eased.x * 0.28 + drag.offset;
      var pitch = 0.1 + (reduceMotion ? 0 : eased.y * 0.1);
      var lift = reduceMotion ? 0 : Math.sin(t * 0.7) * 0.035;
      var scale = 1.02 * (0.92 + 0.08 * ease);
      // the key light orbits slowly, so highlights travel across the glaze
      var la = reduceMotion ? 0.6 : 0.6 + Math.sin(t * 0.15) * 0.5;
      gl.uniform3f(uKey, -Math.cos(la) * 0.75, 0.8, Math.sin(la) * 0.4 + 0.55);
      gl.uniform1f(uReveal, ease);
      gl.uniformMatrix4fv(uModel, false, model(pitch, yaw, lift - 0.02, scale));
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, mesh.idx.length, mesh.type, 0);
      // the contact shadow tightens as the sculpture rises
      stage.style.setProperty("--hero-lift", (lift / 0.035).toFixed(3));
    }

    function loop(now) {
      draw(now);
      if (!reduceMotion && visible && !document.hidden) raf = requestAnimationFrame(loop);
      else raf = 0;
    }
    function kick() {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(reduceMotion ? draw : loop);
    }

    stage.appendChild(canvas);
    resize();
    draw(performance.now());
    stage.classList.add("is-3d-ready");
    kick();

    if ("ResizeObserver" in window) new ResizeObserver(function () { resize(); draw(performance.now()); }).observe(stage);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; kick(); }).observe(stage);
    }
    document.addEventListener("visibilitychange", kick);

    if (!reduceMotion) {
      if (window.matchMedia("(hover: hover)").matches) {
        window.addEventListener("pointermove", function (e) {
          pointer.x = e.clientX / window.innerWidth - 0.5;
          pointer.y = e.clientY / window.innerHeight - 0.5;
        }, { passive: true });
      }
      // Drag (mouse or horizontal touch) turns the sculpture; vertical swipes still scroll the page.
      canvas.style.touchAction = "pan-y";
      canvas.addEventListener("pointerdown", function (e) {
        drag.active = true; drag.startX = e.clientX; drag.base = drag.offset;
        stage.classList.add("is-dragging");
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!drag.active) return;
        drag.offset = Math.max(-1.1, Math.min(1.1, drag.base + (e.clientX - drag.startX) / 220));
      });
      var end = function () { drag.active = false; stage.classList.remove("is-dragging"); };
      canvas.addEventListener("pointerup", end);
      canvas.addEventListener("pointercancel", end);
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
        // The static fallback composition simply stays in place.
        if (window.console) console.warn("[hero-3d]", err.message);
      });
  }

  // Don't compete with critical content: load after the page is idle.
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 2500 });
  else window.addEventListener("load", function () { setTimeout(load, 300); });
})();
