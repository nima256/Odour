#!/usr/bin/env node
/*
 * Paint the hero 3D model from a reference photo.
 *
 *   node scripts/bake-hero-model.js <photo.png|jpg> [input.glb] [output.glb]
 *   defaults: scripts/assets/hero-white-mesh.glb -> public/models/hero-bottle.glb
 *
 * The hero mesh is an untextured sculpture of the same composition as the photo.
 * This script:
 *  1. fits the photo to the mesh's front silhouette (scale + offset search on IoU);
 *  2. projects the photo onto the mesh from the front (TEXCOORD_0) and embeds it as
 *     the base-colour texture, after extending the object's edge colours over the
 *     backdrop so overhanging geometry never picks up background;
 *  3. finds which vertices the projector actually sees (z-buffer) and how directly
 *     they face it, and stores that weight plus the colour of the nearest
 *     well-projected vertex in a custom _ODOUR_FALLBACK attribute, so hidden and
 *     steep surfaces get a sensible colour instead of a stretched smear.
 * The output is a standard glTF 2.0 GLB (other viewers show the textured model);
 * public/js/hero-3d.js uses the fallback attribute for nicer turned views.
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

function loadGlb (file) {
  const b = fs.readFileSync(file); const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + jl)); const bin = b.slice(20 + jl + 8);
  const rd = (i) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]; const o = (v.byteOffset || 0) + (a.byteOffset || 0);
    const n = a.count * { SCALAR: 1, VEC3: 3 }[a.type]; const C = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    return new C(bin.buffer.slice(bin.byteOffset + o, bin.byteOffset + o + n * C.BYTES_PER_ELEMENT)); };
  const p = j.meshes[0].primitives[0];
  return { pos: rd(p.attributes.POSITION), idx: rd(p.indices) };
}
// Orthographic z-buffer raster of the mesh. map(x,y)->(px,py). Returns depth (larger z = closer) and triangle id buffers.
function raster (pos, idx, W, H, map) {
  const depth = new Float32Array(W * H).fill(-Infinity), tri = new Int32Array(W * H).fill(-1);
  for (let t = 0; t < idx.length; t += 3) {
    const v = [0, 1, 2].map((k) => { const i = idx[t + k] * 3; const [px, py] = map(pos[i], pos[i + 1]); return [px, py, pos[i + 2]]; });
    const minx = Math.max(0, Math.floor(Math.min(v[0][0], v[1][0], v[2][0]))), maxx = Math.min(W - 1, Math.ceil(Math.max(v[0][0], v[1][0], v[2][0])));
    const miny = Math.max(0, Math.floor(Math.min(v[0][1], v[1][1], v[2][1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(v[0][1], v[1][1], v[2][1])));
    const d = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]); if (Math.abs(d) < 1e-9) continue;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const w1 = ((x - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (y - v[0][1])) / d;
      const w2 = ((v[1][0] - v[0][0]) * (y - v[0][1]) - (x - v[0][0]) * (v[1][1] - v[0][1])) / d;
      const w0 = 1 - w1 - w2; if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      const z = w0 * v[0][2] + w1 * v[1][2] + w2 * v[2][2]; const k = y * W + x;
      if (z > depth[k]) { depth[k] = z; tri[k] = t / 3; }
    }
  }
  return { depth, tri };
}

// Fit the photo to the mesh's front silhouette: maximise IoU over scale/offset.
function fitPhoto(pos, idx, px, W, H) {
  const bg = [0, 1, 2].map((c) => Math.round((px[c] + px[(W - 1) * 3 + c] + px[((H - 1) * W) * 3 + c]) / 3));
  const raw = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) raw[k] = Math.hypot(px[k*3]-bg[0], px[k*3+1]-bg[1], px[k*3+2]-bg[2]) > 22 ? 1 : 0;
  const outside = floodOutside(raw, W, H);
  const fg = outside.map((v) => 1 - v);
  let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { mx0 = Math.min(mx0, pos[i]); mx1 = Math.max(mx1, pos[i]); my0 = Math.min(my0, pos[i+1]); my1 = Math.max(my1, pos[i+1]); }
  let fx0 = W, fx1 = 0, fy0 = H, fy1 = 0;
  for (let k = 0; k < W * H; k++) if (fg[k]) { const x = k % W, y = (k / W) | 0; fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
  const score = (p) => { const map = (x, y) => [p.tx + (x - mx0) * p.sx, p.ty + (my1 - y) * p.sy];
    const { tri } = raster(pos, idx, W, H, map); let i = 0, u = 0;
    for (let k = 0; k < W * H; k++) { const m = tri[k] >= 0; if (m && fg[k]) i++; if (m || fg[k]) u++; } return i / u; };
  let p = { sx: (fx1 - fx0) / (mx1 - mx0), sy: (fy1 - fy0) / (my1 - my0), tx: fx0, ty: fy0 }, best = score(p);
  for (const step of [8, 4, 2, 1, 0.5]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [k, d] of [["tx", step], ["tx", -step], ["ty", step], ["ty", -step], ["sx", step], ["sx", -step], ["sy", step], ["sy", -step]]) {
        const q = { ...p, [k]: p[k] + d }; const s = score(q); if (s > best + 1e-5) { best = s; p = q; improved = true; }
      }
    }
  }
  return { ...p, mx0, my1, bg, iou: best };
}

function floodOutside(raw, W, H) {
  const outside = new Uint8Array(W * H); const st = [];
  for (let x = 0; x < W; x++) st.push(x, (H-1)*W + x); for (let y = 0; y < H; y++) st.push(y*W, y*W + W-1);
  while (st.length) { const k = st.pop(); if (outside[k] || raw[k]) continue; outside[k] = 1; const x = k % W, y = (k / W) | 0;
    if (x > 0) st.push(k-1); if (x < W-1) st.push(k+1); if (y > 0) st.push(k-W); if (y < H-1) st.push(k+W); }
  return outside;
}

(async () => {
  const photo = process.argv[2];
  if (!photo) { console.error("usage: node scripts/bake-hero-model.js <photo> [input.glb] [output.glb]"); process.exit(1); }
  const input = process.argv[3] || path.join(__dirname, "assets", "hero-white-mesh.glb");
  const output = process.argv[4] || path.join(__dirname, "..", "public", "models", "hero-bottle.glb");
  const { pos, idx } = loadGlb(input);
  const N = pos.length / 3;
  const img = await sharp(photo).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = img.info; const px = Buffer.from(img.data);
  const fit = fitPhoto(pos, idx, px, W, H);
  const bg = fit.bg;
  console.log("photo fit IoU", fit.iou.toFixed(3));

  // --- 1. object mask (holes filled), eroded 2px to drop anti-aliased edge pixels
  const raw = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) raw[k] = Math.hypot(px[k*3]-bg[0], px[k*3+1]-bg[1], px[k*3+2]-bg[2]) > 22 ? 1 : 0;
  const outside = floodOutside(raw, W, H);
  let fg = outside.map((v) => 1 - v);
  for (let e = 0; e < 2; e++) { const n = fg.slice(); for (let k = 0; k < W*H; k++) { if (!fg[k]) continue; const x = k % W, y = (k / W) | 0;
    if (x === 0 || y === 0 || x === W-1 || y === H-1 || !fg[k-1] || !fg[k+1] || !fg[k-W] || !fg[k+W]) n[k] = 0; } fg = n; }

  // --- 2. extend edge colours outward (multi-source BFS) so overhanging geometry never samples the backdrop
  const src = new Int32Array(W * H).fill(-1); const q = new Int32Array(W * H); let qh = 0, qt = 0;
  for (let k = 0; k < W*H; k++) if (fg[k]) { src[k] = k; q[qt++] = k; }
  while (qh < qt) { const k = q[qh++]; const x = k % W, y = (k / W) | 0;
    for (const nk of [x > 0 ? k-1 : -1, x < W-1 ? k+1 : -1, y > 0 ? k-W : -1, y < H-1 ? k+W : -1]) if (nk >= 0 && src[nk] < 0) { src[nk] = src[k]; q[qt++] = nk; } }
  const filled = Buffer.alloc(W * H * 3);
  for (let k = 0; k < W*H; k++) { const s = src[k]; filled[k*3] = px[s*3]; filled[k*3+1] = px[s*3+1]; filled[k*3+2] = px[s*3+2]; }
  // soften the extension seam slightly, keep the object crisp
  const tex = await sharp(filled, { raw: { width: W, height: H, channels: 3 } })
    .resize(1024, 1024, { fit: 'fill', kernel: 'lanczos3' }).modulate({ saturation: 1.04 }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  const texRaw = await sharp(tex).raw().toBuffer();

  // --- 3. projection UVs (front orthographic, matches fit.json)
  const map = (x, y) => [fit.tx + (x - fit.mx0) * fit.sx, fit.ty + (fit.my1 - y) * fit.sy];
  const uv = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { const [u, v] = map(pos[i*3], pos[i*3+1]); uv[i*2] = Math.min(1, Math.max(0, u / W)); uv[i*2+1] = Math.min(1, Math.max(0, v / H)); }

  // --- 4. smooth normals
  const nrm = new Float32Array(N * 3);
  for (let t = 0; t < idx.length; t += 3) { const a = idx[t]*3, b = idx[t+1]*3, c = idx[t+2]*3;
    const ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2], vx = pos[c]-pos[a], vy = pos[c+1]-pos[a+1], vz = pos[c+2]-pos[a+2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx; for (const o of [a, b, c]) { nrm[o] += nx; nrm[o+1] += ny; nrm[o+2] += nz; } }
  for (let i = 0; i < N*3; i += 3) { const l = Math.hypot(nrm[i], nrm[i+1], nrm[i+2]) || 1; nrm[i] /= l; nrm[i+1] /= l; nrm[i+2] /= l; }

  // --- 5. front visibility (z-buffer at photo resolution, 3x3 max for edge tolerance)
  const { depth } = raster(pos, idx, W, H, map);
  const vis = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const [x, y] = map(pos[i*3], pos[i*3+1]); const cx = Math.round(x), cy = Math.round(y); let dmax = -Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = cx+dx, yy = cy+dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) dmax = Math.max(dmax, depth[yy*W+xx]); }
    vis[i] = pos[i*3+2] >= dmax - 0.035 ? 1 : 0; }

  // --- 6. projection weight: visible and facing the projector
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const weight = new Float32Array(N);
  for (let i = 0; i < N; i++) weight[i] = vis[i] * smooth(0.22, 0.62, nrm[i*3+2]);

  // --- 7. fallback colour = texture colour of the nearest well-projected vertex (sampled with a small blur)
  const sample = (u, v) => { const x = Math.round(u * 1023), y = Math.round(v * 1023); const c = [0, 0, 0]; let n = 0;
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) { const xx = Math.min(1023, Math.max(0, x+dx)), yy = Math.min(1023, Math.max(0, y+dy)); const k = (yy*1024+xx)*3; c[0] += texRaw[k]; c[1] += texRaw[k+1]; c[2] += texRaw[k+2]; n++; }
    return c.map((v) => v / n); };
  const anchors = []; for (let i = 0; i < N; i++) if (weight[i] > 0.75) anchors.push(i);
  const fallback = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) {
    let best = -1, bd = Infinity; const x = pos[i*3], y = pos[i*3+1], z = pos[i*3+2];
    for (const a of anchors) { const d = (pos[a*3]-x)**2 + (pos[a*3+1]-y)**2 + (pos[a*3+2]-z)**2 * 0.6; if (d < bd) { bd = d; best = a; } }
    const c = sample(uv[best*2], uv[best*2+1]);
    fallback[i*4] = c[0]; fallback[i*4+1] = c[1]; fallback[i*4+2] = c[2]; fallback[i*4+3] = Math.round(weight[i] * 255);
  }
  console.log('vertices', N, 'visible', vis.reduce((a, b) => a + b, 0), 'anchors', anchors.length);

  // --- 8. write GLB
  const parts = []; let off = 0; const views = [];
  const add = (buf, target) => { const pad = (4 - (buf.length % 4)) % 4; views.push({ buffer: 0, byteOffset: off, byteLength: buf.length, ...(target ? { target } : {}) });
    parts.push(buf, Buffer.alloc(pad)); off += buf.length + pad; return views.length - 1; };
  const vb = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < N*3; i++) { min[i%3] = Math.min(min[i%3], pos[i]); max[i%3] = Math.max(max[i%3], pos[i]); }
  const vIdx = add(vb(idx), 34963), vPos = add(vb(pos), 34962), vNrm = add(vb(nrm), 34962), vUv = add(vb(uv), 34962), vFb = add(Buffer.from(fallback), 34962), vImg = add(tex);
  const json = {
    asset: { version: '2.0', generator: 'odour hero bake (photo projection)' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'hero', mesh: 0 }],
    meshes: [{ name: 'hero', primitives: [{ attributes: { POSITION: 1, NORMAL: 2, TEXCOORD_0: 3, _ODOUR_FALLBACK: 4 }, indices: 0, material: 0, mode: 4 }] }],
    materials: [{ name: 'painted', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.42 }, doubleSided: true }],
    textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: vImg, mimeType: 'image/jpeg' }],
    accessors: [
      { bufferView: vIdx, componentType: idx instanceof Uint32Array ? 5125 : 5123, count: idx.length, type: 'SCALAR' },
      { bufferView: vPos, componentType: 5126, count: N, type: 'VEC3', min, max },
      { bufferView: vNrm, componentType: 5126, count: N, type: 'VEC3' },
      { bufferView: vUv, componentType: 5126, count: N, type: 'VEC2' },
      { bufferView: vFb, componentType: 5121, normalized: true, count: N, type: 'VEC4' },
    ],
    bufferViews: views, buffers: [{ byteLength: off }],
  };
  const bin = Buffer.concat(parts);
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  fs.writeFileSync(output, Buffer.concat([header, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
  console.log('wrote', output, fs.statSync(output).size, 'bytes');
})();
