// SURVIVAL QUEST — THE COVE. Spec §5, "early-2000s low-poly tropical".
//
// Everything here is cosmetic. The sim does not know this file exists, and this
// file never writes to the sim. It reads state and draws the in-between.
//
// Rules of the look (§5):
//   proudly low-poly, flat-shaded, NO PBR and NO normal maps
//   one directional sun + hemisphere ambient, BLOB SHADOWS ONLY (no shadow maps)
//   painted gradient sky dome; water = a plane with scrolling UVs + vertex bob
//   white foam where the tide breaks; distance fog tinted the colour of the sky
//   oversaturated postcard palette; classic-RTS tilted top-down camera (~55 deg)

import * as THREE from 'three';
import { STALLS } from './data.js';

// ---------------------------------------------------------------------------
// ONE PALETTE. Every material in the game picks from this list and nothing
// else — it is what will make mixed CC0 packs read as one game when they land
// (§5, §10 risk 3). The same colours bake into the shared gradient texture.
// ---------------------------------------------------------------------------
export const PAL = {
  skyTop:    0x1D7FC6,
  skyMid:    0x63C4E8,
  skyHaze:   0xBFEAF0,
  seaDeep:   0x0A6E8C,
  seaMid:    0x12A5B8,
  seaShallow:0x59DCD2,
  foam:      0xF2FEFF,
  sandWet:   0xC9A46A,
  sand:      0xF7D98A,
  sandLit:   0xFFE9A8,
  rock:      0x93805F,
  rockDark:  0x6A5946,
  jungle:    0x2E8B3D,
  jungleDeep:0x1B6330,
  jungleLit: 0x6FC24A,
  trunk:     0x8A5A32,
  rope:      0xE0C583,
  post:      0xA6764A,
  hibiscus:  0xF0455C,
  gold:      0xF5C542,
  hero:      0x2FA9E8,
  heroSkin:  0xE8B98C,
  heroTrim:  0xFFD94A,
  crab:      0xF06A3C,
  jelly:     0xC77BE8,
  monkey:    0x9A6B3F,
  volcano:   0x5A4A52,
};

const C = hex => new THREE.Color(hex);

// The shared gradient-palette texture (§5). Column of vertical ramps: sky, sea,
// sand, jungle. Sampling one texture for all of them is how a scene made of
// half a dozen sources ends up looking like it came out of one art bible.
function makePaletteTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const g = cv.getContext('2d');
  const ramp = (x, w, stops) => {
    const lg = g.createLinearGradient(0, 0, 0, 256);
    stops.forEach(([p, c]) => lg.addColorStop(p, c));
    g.fillStyle = lg; g.fillRect(x, 0, w, 256);
  };
  const h = n => '#' + n.toString(16).padStart(6, '0');
  ramp(0, 16, [[0, h(PAL.skyTop)], [0.55, h(PAL.skyMid)], [1, h(PAL.skyHaze)]]);
  ramp(16, 16, [[0, h(PAL.seaDeep)], [0.6, h(PAL.seaMid)], [1, h(PAL.seaShallow)]]);
  ramp(32, 16, [[0, h(PAL.sandWet)], [0.45, h(PAL.sand)], [1, h(PAL.sandLit)]]);
  ramp(48, 16, [[0, h(PAL.jungleDeep)], [0.5, h(PAL.jungle)], [1, h(PAL.jungleLit)]]);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;   // canvas textures are sRGB; forgetting this lifts every colour
  return tex;
}

// A painted sky: one canvas, one gradient, a smear of cloud. PS2 games did not
// have skyboxes made of photographs and neither do we.
function makeSkyTexture() {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 256;
  const g = cv.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0.00, '#0E5FA8');
  lg.addColorStop(0.34, '#2E9AD8');
  lg.addColorStop(0.62, '#7FD3EC');
  lg.addColorStop(0.82, '#C9EFF2');
  lg.addColorStop(1.00, '#F6E9C0');
  g.fillStyle = lg; g.fillRect(0, 0, 16, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Water surface: soft caustic bands. Two of these scroll against each other and
// the eye reads "ocean" for the price of one 128px canvas.
function makeWaterTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#12A5B8'; g.fillRect(0, 0, 128, 128);
  g.globalAlpha = 0.30; g.strokeStyle = '#8CF0E4'; g.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    const y = (i * 128) / 14;
    g.beginPath();
    for (let x = 0; x <= 128; x += 8) {
      const yy = y + Math.sin((x / 128) * Math.PI * 4 + i) * 3.5;
      x === 0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.globalAlpha = 0.16; g.fillStyle = '#59DCD2';
  for (let i = 0; i < 60; i++) g.fillRect((i * 37) % 128, (i * 61) % 128, 9, 3);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A soft white disc — the blob-shadow stamp, and the foam sprite. One texture,
// two jobs, zero shadow maps (§5).
function makeBlobTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, inner);
  rg.addColorStop(0.55, inner);
  rg.addColorStop(1, outer);
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Flat-lit, no PBR anywhere in this file. Lambert is the whole lighting model.
const lam = (color, flat) => new THREE.MeshLambertMaterial({ color: C(color), flatShading: flat !== false });

export function createScene(canvas, COVE, MARKET) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;   // ACES eats saturation; this is a postcard, not a film
  renderer.shadowMap.enabled = false;           // blob shadows only

  const scene = new THREE.Scene();
  const fogColor = C(PAL.skyHaze);
  scene.fog = new THREE.Fog(fogColor, 58, 155);  // sky-tinted distance fog: PS2 charm AND free perf
  scene.background = C(PAL.skyMid);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);

  // --- CAMERA: classic-RTS tilted top-down (§5). The pitch is the whole look:
  // steeper than 55 and the sea vanishes off the top of the frame entirely;
  // shallower and it stops reading as an RTS. 49 keeps a band of surf and
  // horizon in shot while the cove still lies flat enough to fight on.
  // CAM.flip (rev 1): +1 in the square — the camera stands inland and looks
  // OUT TO SEA, the classic postcard. -1 in the market — it swings around and
  // looks INTO the island, so the rack arc and the beacon fill the frame.
  // The swing eases through nearly-overhead during the port glide.
  const CAM = { pitch: THREE.MathUtils.degToRad(49), dist: 56, flip: 1, look: new THREE.Vector3(0, 0, -3) };
  function placeCamera() {
    // never let the offset hit zero mid-swing: a straight-down lookAt rolls
    // the camera on the up-vector singularity
    const f = (CAM.flip < 0 ? -1 : 1) * Math.max(0.12, Math.abs(CAM.flip));
    camera.position.set(
      CAM.look.x,
      CAM.look.y + Math.sin(CAM.pitch) * CAM.dist,
      CAM.look.z + Math.cos(CAM.pitch) * CAM.dist * f
    );
    camera.lookAt(CAM.look);
  }
  placeCamera();

  // --- LIGHT: one sun, one hemisphere. That is the entire rig (§5)... plus a
  // rim light from the sea that stays dark until GOLD HOUR (milestone tides):
  // it back-lights every silhouette in warm gold, which is the whole trick.
  const sun = new THREE.DirectionalLight(0xFFF3D0, 1.55);
  sun.position.set(-24, 40, 18);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xCFEFFF, 0xE8C98E, 0.85);
  scene.add(hemi);
  const rim = new THREE.DirectionalLight(0xFFB05A, 0);
  rim.position.set(6, 9, -70);
  scene.add(rim);

  const paletteTex = makePaletteTexture();

  // --- REV 1 WORLD LAYOUT. YOUR square sits exactly where the cove always
  // was (identity transform — the sim's square frame IS world space, sea at
  // -z), the MARKET plaza sits inland behind the jungle line at MK, and the
  // other fifteen squares run down the shore at SEAT_PITCH intervals. The
  // sim thinks in local frames; this file decides where those frames stand.
  const MK = { x: 0, z: 64 };
  const SEAT_PITCH = 56;      // square centres are 56m apart down the shore

  // --- SKY DOME: painted gradient on the inside of a sphere ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(200, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false })
  );
  scene.add(sky);

  // --- SUN DISC, low and gold-hour ---
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(9, 20),
    new THREE.MeshBasicMaterial({ color: 0xFFF6D2, fog: false, transparent: true, opacity: 0.9, depthWrite: false })
  );
  sunDisc.position.set(-70, 40, -170);
  sunDisc.lookAt(0, 10, 0);
  scene.add(sunDisc);

  // -------------------------------------------------------------------------
  // WATER — a plane, scrolling UVs, vertex bob. No simulation, no reflections.
  // -------------------------------------------------------------------------
  const waterTexA = makeWaterTexture();
  const waterTexB = makeWaterTexture();
  waterTexA.repeat.set(21, 5);
  waterTexB.repeat.set(13, 3);
  const waterGeo = new THREE.PlaneGeometry(1000, 200, 60, 34);   // the sea fronts all sixteen squares
  waterGeo.rotateX(-Math.PI / 2);
  const waterBase = waterGeo.attributes.position.array.slice();
  const water = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({
    map: waterTexA, color: 0xFFFFFF, transparent: true, opacity: 0.94,
  }));
  water.position.set(0, -0.35, COVE.waterline - 96);
  scene.add(water);

  // second layer, scrolling the other way — cheap parallax on the swell
  const water2 = new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({
    map: waterTexB, color: 0x9FE9E4, transparent: true, opacity: 0.42, depthWrite: false,
  }));
  water2.position.set(0, -0.25, COVE.waterline - 96);
  scene.add(water2);

  // -------------------------------------------------------------------------
  // BEACH — warm sand, with a wet band where the sea has just been.
  // -------------------------------------------------------------------------
  // ⚠ The plane's own z is LOCAL (-48..48). Every gameplay landmark — the
  // waterline, the fence line — is WORLD. Mixing the two put the beach eight
  // metres out to sea and stranded the surf line inland of the water. Convert
  // once, up front, and compare in world space only.
  const SAND_CZ = COVE.waterline + 46;
  const sandGeo = new THREE.PlaneGeometry(COVE.halfWidth * 2 + 30, 96, 34, 26);
  sandGeo.rotateX(-Math.PI / 2);
  {
    const p = sandGeo.attributes.position;
    const col = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), wz = p.getZ(i) + SAND_CZ;
      // The beach shelves down into the sea, rises into dunes inland, and is
      // dead flat across the middle where the fight happens. Rev 1: the dunes
      // also flatten inside the MARKET CLEARING — the inland rise otherwise
      // grows unbounded and buries the plaza under nine metres of sand
      // (it did; the beacon tip was the only survivor).
      const shelf = -Math.max(0, (COVE.waterline + 1 - wz)) * 0.22;
      const clear = THREE.MathUtils.smoothstep(Math.hypot(x - MK.x, wz - MK.z), 34, 50);
      const dune = (Math.max(0, (wz - COVE.inland + 5) * 0.19)
                 + Math.sin(x * 0.21) * Math.max(0, (wz - COVE.inland + 9)) * 0.045) * clear;
      p.setY(i, shelf + dune);
      const wet = THREE.MathUtils.smoothstep(wz, COVE.waterline - 1, COVE.waterline + 6);
      const c = C(PAL.sandWet).lerp(C(PAL.sand), wet);
      if (wz > COVE.waterline + 14) c.lerp(C(PAL.sandLit), Math.min(1, (wz - COVE.waterline - 14) / 22));
      // a little grain so 50 metres of beach is not one flat fill
      c.offsetHSL(0, 0, (((x * 7 + wz * 13) % 5) - 2) * 0.006);
      col.push(c.r, c.g, c.b);
    }
    sandGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sandGeo.computeVertexNormals();
  }
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  sand.position.set(0, 0, SAND_CZ);
  scene.add(sand);

  // --- THE LONG SHORE (rev 1): the beach keeps going under the other fifteen
  // squares. Same shelf/dune/wet-band math, coarser mesh, no grain — past the
  // fog line nobody counts vertices.
  for (const [x0, x1] of [[41, 476], [-476, -41]]) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    const g2 = new THREE.PlaneGeometry(w, 96, Math.max(8, Math.round(w / 9)), 12);
    g2.rotateX(-Math.PI / 2);
    const p2 = g2.attributes.position;
    const col2 = [];
    for (let i = 0; i < p2.count; i++) {
      const wx = p2.getX(i) + cx, wz = p2.getZ(i) + SAND_CZ;
      const shelf = -Math.max(0, (COVE.waterline + 1 - wz)) * 0.22;
      const clear = THREE.MathUtils.smoothstep(Math.hypot(wx - MK.x, wz - MK.z), 34, 50);
      const dune = (Math.max(0, (wz - COVE.inland + 5) * 0.19)
                 + Math.sin(wx * 0.21) * Math.max(0, (wz - COVE.inland + 9)) * 0.045) * clear;
      p2.setY(i, shelf + dune);
      const wet = THREE.MathUtils.smoothstep(wz, COVE.waterline - 1, COVE.waterline + 6);
      const c = C(PAL.sandWet).lerp(C(PAL.sand), wet);
      if (wz > COVE.waterline + 14) c.lerp(C(PAL.sandLit), Math.min(1, (wz - COVE.waterline - 14) / 22));
      col2.push(c.r, c.g, c.b);
    }
    g2.setAttribute('color', new THREE.Float32BufferAttribute(col2, 3));
    g2.computeVertexNormals();
    const m2 = new THREE.Mesh(g2, sand.material);
    m2.position.set(cx, -0.01, SAND_CZ);
    scene.add(m2);
  }

  // --- MARKET GROUND (rev 1): a sand apron under the whole clearing, the
  // bright plaza floor on top, and a boardwalk-edge ring.
  {
    const apron = new THREE.Mesh(new THREE.CircleGeometry(46, 24), lam(PAL.sand));
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(MK.x, 0.005, MK.z);
    scene.add(apron);
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(27, 30), lam(PAL.sandLit));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(MK.x, 0.04, MK.z);
    scene.add(plaza);
    const edge = new THREE.Mesh(new THREE.RingGeometry(20.6, 21.7, 34),
      new THREE.MeshBasicMaterial({ color: C(PAL.post), transparent: true, opacity: 0.5, depthWrite: false }));
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(MK.x, 0.07, MK.z);
    scene.add(edge);
  }

  // -------------------------------------------------------------------------
  // FOAM — the white line where the tide breaks, plus the rings a surf-set
  // punches through it as it lands (§5: "white foam where tides spawn").
  // -------------------------------------------------------------------------
  const foamTex = makeBlobTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
  foamTex.wrapS = THREE.RepeatWrapping;
  foamTex.repeat.set(11, 1);            // soft foam dashes down the whole shore
  const foamBand = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 10, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.55, depthWrite: false, map: foamTex })
  );
  foamBand.rotation.x = -Math.PI / 2;
  foamBand.position.set(0, 0.06, COVE.waterline + 0.4);
  scene.add(foamBand);

  const RING_POOL = 8;
  const rings = [];
  for (let i = 0; i < RING_POOL; i++) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 1.0, 22),
      new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.07;
    m.visible = false;
    scene.add(m);
    rings.push({ m, t: 0, live: false });
  }
  // One pool, many jobs: surf foam, spell bursts, cast flashes. Colour and
  // final size ride along per pop.
  function popRing(x, z, color, size) {
    const r = rings.find(r => !r.live) || rings[0];
    r.live = true; r.t = 0;
    r.size = size || 1;
    r.m.visible = true;
    r.m.material.color.set(color === undefined ? 0xFFFFFF : color);
    r.m.position.set(x, 0.07, z);
  }
  function popFoamRing(x, z) { popRing(x, z, 0xFFFFFF, 1); }

  // -------------------------------------------------------------------------
  // SET DRESSING — rope-post fences, palms, rocks, cliffs, a beached rowboat,
  // tiki-torch stalls where the boardwalk shops will stand (link 2), and one
  // ominous volcano on the horizon. All of it merged or instanced, all of it
  // built from primitives (spec §5's MVP asset plan; see README on why).
  // -------------------------------------------------------------------------
  const dressing = new THREE.Group();
  scene.add(dressing);

  // nothing grows through a shop: dressing placement keeps a clear ring
  // around every market stall (stall coords are MARKET-local; compare in world)
  function nearStall(x, z) {
    for (const s of STALLS) {
      const dx = x - (MK.x + s.x), dz = z - (MK.z + s.z);
      if (dx * dx + dz * dz < 4.6 * 4.6) return true;
    }
    return false;
  }

  function palm(x, z, s, lean) {
    if (nearStall(x, z)) return;
    const g = new THREE.Group();
    const seg = 4, h = 5.2 * s;
    for (let i = 0; i < seg; i++) {
      const r0 = 0.30 * s * (1 - i * 0.13);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.86, r0, h / seg, 6), lam(PAL.trunk));
      t.position.set(Math.sin(i * 0.5) * lean * s, h * (i + 0.5) / seg, Math.cos(i * 0.7) * lean * s * 0.5);
      g.add(t);
    }
    const top = h + 0.1 * s;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.72 * s, 3.5 * s, 4), lam(i % 2 ? PAL.jungle : PAL.jungleLit));
      frond.position.set(Math.sin(a) * 1.5 * s + lean * s, top - 0.35 * s, Math.cos(a) * 1.5 * s);
      frond.rotation.set(Math.cos(a) * 0.95, -a, -Math.sin(a) * 0.95);
      g.add(frond);
    }
    const nut = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 * s, 0), lam(0x6B4A28));
    nut.position.set(lean * s, top - 0.6 * s, 0.25 * s);
    g.add(nut);
    g.position.set(x, 0, z);
    dressing.add(g);
  }

  function bush(x, z, s, col) {
    if (nearStall(x, z)) return null;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), lam(col));
    b.position.set(x, s * 0.62, z);
    b.scale.set(1, 0.78, 1);
    b.rotation.y = x * 0.7;
    dressing.add(b);
    return b;
  }

  function rock(x, z, s) {
    if (nearStall(x, z)) return;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), lam(PAL.rock));
    r.position.set(x, s * 0.42, z);
    r.rotation.set(x * 0.3, z * 0.5, x * 0.2);
    r.scale.set(1, 0.7, 1.1);
    dressing.add(r);
  }

  // rope-post fences (§5 — the FFX Besaid tell). Rev 1 generalises the run to
  // any two points: every square is fenced on three sides now (the sea edge
  // stays the open door). segs=3 gives the rope its sag; the vacant squares
  // down the shore run segs=1 — straight rope reads fine past the fog line.
  function fenceRun(x0, z0, x1, z1, posts, segs) {
    const N = segs || 3;
    const tops = [];
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const hh = 1.5 + ((i * 7) % 3) * 0.08;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, hh, 6), lam(PAL.post));
      p.position.set(x, hh / 2, z);
      dressing.add(p);
      tops.push(new THREE.Vector3(x, hh * 0.88, z));
    }
    // the rope sags between posts — short segments per span read as a curve
    for (let i = 0; i < tops.length - 1; i++) {
      const a = tops[i], b = tops[i + 1];
      for (let k = 0; k < N; k++) {
        const t0 = k / N, t1 = (k + 1) / N;
        const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1);
        p0.y -= Math.sin(t0 * Math.PI) * 0.34;
        p1.y -= Math.sin(t1 * Math.PI) * 0.34;
        const len = p0.distanceTo(p1);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 4), lam(PAL.rope, false));
        seg.position.copy(p0).lerp(p1, 0.5);
        seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
        dressing.add(seg);
      }
    }
  }
  fenceRun(-COVE.halfWidth, COVE.waterline + 5, -COVE.halfWidth, COVE.inland - 1, 10);
  fenceRun(COVE.halfWidth, COVE.waterline + 5, COVE.halfWidth, COVE.inland - 1, 10);
  fenceRun(-COVE.halfWidth, COVE.inland + 0.5, COVE.halfWidth, COVE.inland + 0.5, 12);   // the back fence (rev 1)

  // --- THE SHORE OF SIXTEEN (rev 1): the other fifteen squares, fenced and
  // flying seat pennants, waiting for their castaways. Vacant today; P1 seats
  // real rivals in them. Sixteen is the hard cap (RULES.maxPlayers).
  const SEAT_COLORS = [
    0xF5C542, 0x2FA9E8, 0xF0455C, 0x9CFF7A, 0xC77BE8, 0xFF8C5A, 0x7FE7D8, 0xF7FBFF,
    0x59DCD2, 0xFFB347, 0x4FA8E8, 0xFF6B6B, 0x6FC24A, 0xE7C25C, 0x9A6B3F, 0xDFF6FF,
  ];
  function pennant(x, z, color) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 5), lam(PAL.post));
    pole.position.set(x, 2.6, z);
    dressing.add(pole);
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.6, 4), lam(color));
    flag.rotation.z = -Math.PI / 2;
    flag.position.set(x + 0.85, 4.7, z);
    dressing.add(flag);
  }
  function vacantSquare(cx, color) {
    const L = cx - COVE.halfWidth, R = cx + COVE.halfWidth;
    fenceRun(L, COVE.waterline + 4, L, COVE.inland - 1, 7, 1);
    fenceRun(R, COVE.waterline + 4, R, COVE.inland - 1, 7, 1);
    fenceRun(L, COVE.inland + 0.5, R, COVE.inland + 0.5, 8, 1);
    pennant(cx, COVE.inland - 1.5, color);
    // a leaning driftwood claim-plank at the waterline says VACANT without words
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.14), lam(PAL.trunk));
    plank.position.set(cx, 1.05, COVE.waterline + 6);
    plank.rotation.set(0, 0.18, 0.1);
    dressing.add(plank);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 5), lam(PAL.post));
    leg.position.set(cx, 0.5, COVE.waterline + 6.1);
    dressing.add(leg);
  }
  pennant(2.5, COVE.inland + 2, SEAT_COLORS[0]);   // your colours fly at home
  for (let k = 1; k < 16; k++) {
    const cx = (k % 2 ? 1 : -1) * SEAT_PITCH * Math.ceil(k / 2);
    vacantSquare(cx, SEAT_COLORS[k]);
  }

  // jungle wall inland + palms along the flanks
  for (let i = 0; i < 26; i++) {
    const x = -46 + i * 3.7 + ((i * 13) % 5) * 0.7;
    palm(x, COVE.inland + 3 + ((i * 7) % 4) * 1.9, 0.85 + ((i * 11) % 5) * 0.09, 0.28 - ((i * 5) % 3) * 0.2);
  }
  for (let i = 0; i < 22; i++) {
    const s = 1.4 + ((i * 17) % 6) * 0.42;
    bush(-44 + i * 4.2, COVE.inland + 7 + ((i * 23) % 5) * 1.6, s, i % 3 ? PAL.jungle : PAL.jungleDeep);
  }
  // property lines, not jungle: one palm and one rock at each square boundary
  // down the shore (the 4m gaps between fences are the only green on the sand)
  for (let b = 0; b < 8; b++) {
    for (const s of [-1, 1]) {
      const bx = s * (COVE.halfWidth + 2 + SEAT_PITCH * b);
      palm(bx, 12 + (b % 3) * 3, 0.9 + (b % 2) * 0.12, s * 0.35);
      rock(bx, -6 - (b % 4) * 2, 0.7 + (b % 3) * 0.3);
    }
  }
  // the jungle wall keeps going behind the neighbours
  for (let i = 0; i < 14; i++) {
    const jx = 52 + i * 13;
    palm(jx, COVE.inland + 4 + (i % 3) * 2, 0.9, 0.2);
    palm(-jx, COVE.inland + 5 + (i % 4) * 2, 0.95, -0.25);
  }

  // offshore islets: the old headland masses wade out into the surf (rev 1 —
  // the shore belongs to the squares now), still framing the postcard from
  // your square without standing on a neighbour's beach.
  for (const side of [-1, 1]) {
    const base = new THREE.Mesh(new THREE.DodecahedronGeometry(15, 0), lam(PAL.rockDark));
    base.position.set(side * (COVE.halfWidth + 21), 1.0, COVE.waterline - 27);
    base.scale.set(1.55, 0.55, 1.3);
    base.rotation.y = side * 0.6;
    dressing.add(base);
    const shelf = new THREE.Mesh(new THREE.DodecahedronGeometry(12, 0), lam(PAL.rock));
    shelf.position.set(side * (COVE.halfWidth + 24), 6.4, COVE.waterline - 31);
    shelf.scale.set(1.5, 0.5, 1.25);
    shelf.rotation.y = side * -0.4;
    dressing.add(shelf);
    const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 0), lam(PAL.jungle));
    cap.position.set(side * (COVE.halfWidth + 25), 11.2, COVE.waterline - 32);
    cap.scale.set(1.25, 0.42, 1.05);
    dressing.add(cap);
    for (let i = 0; i < 5; i++) {
      palm(side * (COVE.halfWidth + 17 + i * 3.2), COVE.waterline - 34 - i * 2.4, 1.1, side * 0.4);
      bush(side * (COVE.halfWidth + 20 + i * 2.6), COVE.waterline - 37 - i * 1.7, 2.2, i % 2 ? PAL.jungle : PAL.jungleDeep);
    }
  }

  // --- BEACH LITTER -------------------------------------------------------
  // Fifty metres of unbroken sand reads as a loading screen. Shells, driftwood
  // and grass tufts break it up. Deterministic placement (a hash, not
  // Math.random) so the island is the same island in every screenshot.
  {
    let s = 1337;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const shellGeo = new THREE.SphereGeometry(0.3, 6, 4);
    const woodGeo = new THREE.CylinderGeometry(0.16, 0.2, 2.2, 5);
    const tuftGeo = new THREE.ConeGeometry(0.34, 1.15, 4);
    const shellMats = [lam(0xFFF3DC), lam(0xF7C9D2), lam(0xE9DFC0)];
    for (let i = 0; i < 78; i++) {
      const x = (rnd() * 2 - 1) * (COVE.halfWidth + 13);
      const z = COVE.waterline + 1 + rnd() * (COVE.inland - COVE.waterline + 6);
      // keep the fight lane clear: the middle of the cove stays walkable-looking
      if (Math.abs(x) < 13 && z < COVE.inland - 4) continue;
      const r = rnd();
      let m;
      if (r < 0.42) {
        m = new THREE.Mesh(shellGeo, shellMats[i % 3]);
        m.scale.set(1, 0.4, 1.4); m.position.set(x, 0.1, z);
      } else if (r < 0.68) {
        m = new THREE.Mesh(woodGeo, lam(PAL.trunk));
        m.rotation.set(Math.PI / 2, 0, rnd() * 3.14);
        m.position.set(x, 0.19, z);
        m.scale.setScalar(0.7 + rnd() * 0.7);
      } else {
        m = new THREE.Mesh(tuftGeo, lam(rnd() > 0.5 ? PAL.jungleLit : PAL.jungle));
        m.position.set(x, 0.5, z);
        m.rotation.z = (rnd() - 0.5) * 0.4;
        m.scale.setScalar(0.6 + rnd() * 0.8);
      }
      dressing.add(m);
    }
  }

  // beached rowboat (§5 set dressing)
  {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.75, 4.6, 7, 1, false, 0, Math.PI), lam(0xC9552F));
    hull.rotation.set(0, 0, Math.PI / 2);
    hull.position.y = 0.55;
    boat.add(hull);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.09, 4, 10, Math.PI), lam(PAL.rope, false));
    rim.rotation.set(0, Math.PI / 2, 0); rim.position.set(0, 0.55, 0);
    boat.add(rim);
    const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 4), lam(PAL.trunk));
    oar.rotation.set(0.2, 0.4, 1.15); oar.position.set(1.2, 0.5, 0.9);
    boat.add(oar);
    boat.position.set(-COVE.halfWidth - 2, 0.1, COVE.waterline + 8);   // beached in the boundary gap
    boat.rotation.set(0, 0.85, 0.06);
    dressing.add(boat);
  }

  // THE MARKET STALLS (rev 1): all six shops stand together in the central
  // plaza now — the island ports every castaway here between tides. Stall
  // coords in data.js are MARKET-local; this is where the market frame lands
  // in the world. Nothing commercial stands in a fighting square anymore.
  //
  // Stalls live OUTSIDE the baked dressing (below): their gems bob and their
  // torch flames flicker every frame, and baking animated meshes freezes them.
  const stallGroup = new THREE.Group();
  scene.add(stallGroup);
  const torchFlames = [];
  const stallGems = [];
  function stall(def) {
    const g = new THREE.Group();
    g.scale.setScalar(0.86);
    for (const sx of [-1.5, 1.5]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.5, 6), lam(PAL.trunk));
      leg.position.set(sx, 1.25, 0); g.add(leg);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.7, 1.5, 4), lam(def.color));
    roof.position.set(0, 3.1, 0); roof.rotation.y = Math.PI / 4;
    g.add(roof);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.28, 1.2), lam(PAL.post));
    counter.position.set(0, 1.1, 0.2); g.add(counter);
    // goods on the counter: little colour-matched crates read as "stocked"
    for (const gx of [-1.0, -0.1, 0.9]) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.5), lam(gx === -0.1 ? def.color : PAL.rope));
      box.position.set(gx, 1.42, 0.15); box.rotation.y = gx * 1.7;
      g.add(box);
    }
    // the beacon gem: a slow-bobbing marker in the stall's colour, readable
    // from anywhere on the sand — this is how a shop says "I am a shop"
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0),
      new THREE.MeshBasicMaterial({ color: def.color, fog: false }));
    gem.position.set(0, 4.4, 0);
    gem.userData.baseY = 4.4;
    g.add(gem);
    stallGems.push(gem);
    for (const sx of [-2.4, 2.4]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.9, 5), lam(PAL.trunk));
      pole.position.set(sx, 1.45, 0.6); g.add(pole);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 5),
        new THREE.MeshBasicMaterial({ color: 0xFFB33C, fog: false }));
      flame.position.set(sx, 3.2, 0.6); g.add(flame);
      torchFlames.push(flame);
    }
    g.position.set(MK.x + def.x, 0, MK.z + def.z);
    // every counter faces the plaza floor where the castaway ports in
    g.rotation.y = Math.atan2(0 - def.x, -6 - def.z);
    stallGroup.add(g);
  }
  for (const def of STALLS) stall(def);

  // THE BEACON — a striped lighthouse on the market's back edge, tall enough
  // to clear the jungle: from any square, that glow is "the shops are there".
  // The tower is static (baked); the gem rides the stall-gem bob for the pulse.
  {
    const bx = MK.x, bz = MK.z + 23;
    const t1 = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.3, 7, 8), lam(0xF7FBFF));
    t1.position.set(bx, 3.5, bz); dressing.add(t1);
    const t2 = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.7, 6, 8), lam(PAL.hibiscus));
    t2.position.set(bx, 10, bz); dressing.add(t2);
    const t3 = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.35, 5, 8), lam(0xF7FBFF));
    t3.position.set(bx, 15.5, bz); dressing.add(t3);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.4, 8), lam(PAL.gold));
    cap.position.set(bx, 19.4, bz); dressing.add(cap);
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0),
      new THREE.MeshBasicMaterial({ color: 0xFFD24A, fog: false }));
    beacon.position.set(bx, 17.8, bz);
    beacon.userData.baseY = 17.8;
    stallGroup.add(beacon);
    stallGems.push(beacon);
  }

  // market clearing dressing: a jungle ring with a south gap (the beach shows
  // through where you port in) and traded-goods clutter between the stalls
  {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      if (Math.sin(a) < -0.55) continue;
      const r = 30 + ((i * 7) % 4) * 1.6;
      const px = MK.x + Math.cos(a) * r, pz = MK.z + Math.sin(a) * r * 0.82;
      if (i % 3) palm(px, pz, 0.9 + ((i * 5) % 4) * 0.1, ((i % 2) ? 1 : -1) * 0.3);
      else bush(px, pz, 1.8 + ((i * 11) % 4) * 0.5, i % 2 ? PAL.jungle : PAL.jungleDeep);
    }
    for (let i = 0; i < 7; i++) {
      const a = -0.6 + i * 0.9;
      const cx = MK.x + Math.cos(a) * 12.5, cz = MK.z + Math.sin(a) * 10.5;
      if (nearStall(cx, cz)) continue;
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.0), lam(i % 2 ? PAL.rope : PAL.post));
      crate.position.set(cx, 0.45, cz);
      crate.rotation.y = i * 1.3;
      dressing.add(crate);
    }
  }

  // the volcano, watching (§5)
  {
    const v = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(52, 46, 9), lam(PAL.volcano));
    cone.position.y = 12; v.add(cone);
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(66, 20, 9), lam(PAL.jungleDeep));
    skirt.position.y = 2; v.add(skirt);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(11, 7, 8), lam(0xE86A3C));
    cap.position.y = 33; v.add(cap);
    v.position.set(-56, -1, COVE.inland + 108);
    dressing.add(v);
  }

  // --- BAKE THE DRESSING. Several hundred palms, posts, ropes, rocks and
  // shells as individual meshes cost a draw call EACH (the playtest measured
  // 364). None of them ever move, so: bake world transforms into cloned
  // geometry, merge one mesh per material, and the whole island renders in
  // ~a dozen calls. Stalls stay live (animated); units were instanced already.
  {
    dressing.updateMatrixWorld(true);
    const buckets = new Map();
    dressing.traverse(m => {
      if (!m.isMesh) return;
      const key = m.material.color.getHex() * 2 + (m.material.flatShading ? 1 : 0);
      let b = buckets.get(key);
      if (!b) { b = { mat: m.material, geos: [] }; buckets.set(key, b); }
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      b.geos.push(g);
    });
    scene.remove(dressing);
    for (const b of buckets.values()) {
      const mesh = new THREE.Mesh(mergeGeos(b.geos), b.mat);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // UNITS — hero mesh + one InstancedMesh per creep skin (§7).
  // -------------------------------------------------------------------------
  const CREEP_CAP = 64;   // sim cap is 40/cove; headroom for debug spawns

  function creepProto(skin) {
    // Chunky readable silhouettes; the skin is the whole identity at P0.
    if (skin === 'crab') {
      const body = new THREE.SphereGeometry(0.62, 7, 5);
      body.scale(1.25, 0.62, 1);
      const claw = new THREE.BoxGeometry(0.42, 0.3, 0.62);
      claw.translate(0.86, 0.18, 0.45);
      const claw2 = claw.clone(); claw2.translate(-1.72, 0, 0);
      return mergeGeos([body, claw, claw2]);
    }
    if (skin === 'jelly') {
      const bell = new THREE.SphereGeometry(0.6, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.62);
      bell.translate(0, 0.42, 0);
      const t1 = new THREE.ConeGeometry(0.13, 0.9, 4); t1.translate(0.22, 0.0, 0.1);
      const t2 = new THREE.ConeGeometry(0.13, 0.9, 4); t2.translate(-0.24, 0.02, -0.14);
      const t3 = new THREE.ConeGeometry(0.11, 0.7, 4); t3.translate(0.02, 0.05, 0.28);
      return mergeGeos([bell, t1, t2, t3]);
    }
    const torso = new THREE.CapsuleGeometry(0.36, 0.5, 3, 7); torso.translate(0, 0.72, 0);
    const head = new THREE.SphereGeometry(0.33, 7, 5); head.translate(0, 1.32, 0);
    const armL = new THREE.CapsuleGeometry(0.13, 0.5, 2, 5); armL.rotateZ(0.7); armL.translate(0.48, 0.8, 0);
    const armR = new THREE.CapsuleGeometry(0.13, 0.5, 2, 5); armR.rotateZ(-0.7); armR.translate(-0.48, 0.8, 0);
    return mergeGeos([torso, head, armL, armR]);
  }

  function mergeGeos(list) {
    // Tiny hand-rolled merge — keeps the vendor surface to three.module alone.
    // Polyhedron geometries arrive non-indexed; give them a sequential index so
    // the merge below has one shape to walk.
    for (const g of list) {
      if (!g.index) {
        const n = g.attributes.position.count;
        const seq = new Uint16Array(n);
        for (let i = 0; i < n; i++) seq[i] = i;
        g.setIndex(new THREE.BufferAttribute(seq, 1));
      }
    }
    let vcount = 0, icount = 0;
    for (const g of list) { vcount += g.attributes.position.count; icount += g.index.count; }
    const pos = new Float32Array(vcount * 3), nor = new Float32Array(vcount * 3);
    // rev 1's shore of sixteen pushes the big bake buckets past 65,535 verts —
    // a Uint16 index there wraps silently and shreds the mesh. WebGL2 is a
    // boot requirement already, so u32 indices are free.
    const idx = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
    let vo = 0, io = 0;
    for (const g of list) {
      const gp = g.attributes.position.array, gn = g.attributes.normal.array;
      pos.set(gp, vo * 3); nor.set(gn, vo * 3);
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
      vo += g.attributes.position.count; io += gi.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  const creepMeshes = {};
  for (const [skin, col] of [['crab', PAL.crab], ['jelly', PAL.jelly], ['monkey', PAL.monkey]]) {
    const im = new THREE.InstancedMesh(creepProto(skin), lam(col), CREEP_CAP);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false;
    scene.add(im);
    // per-instance colour so a hit can flash white without a second material
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CREEP_CAP * 3), 3);
    for (let i = 0; i < CREEP_CAP; i++) im.setColorAt(i, C(0xFFFFFF));
    creepMeshes[skin] = im;
  }

  // blob shadows — one instanced disc for everything that stands on the sand
  const blobTex = makeBlobTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
  const blobGeo = new THREE.PlaneGeometry(1, 1); blobGeo.rotateX(-Math.PI / 2);
  const blobs = new THREE.InstancedMesh(blobGeo,
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: 0xFFFFFF }), CREEP_CAP + 4);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.count = 0; blobs.frustumCulled = false;
  scene.add(blobs);

  // --- THE CASTAWAYS. One builder per body (§6: model + statline + innate);
  // the FORGE swap is a child-swap, so link 1's swing/flash rig keeps working.
  // Every builder must set userData.torso (hit tint), .armL and .club (swing).
  function buildHeroBody(bodyId) {
    const g = new THREE.Group();
    const add = m => { g.add(m); return m; };
    const skin = PAL.heroSkin;

    if (bodyId === 'diver') {
      // THE PEARL DIVER: slim teal wetsuit, goggles, a reef spear.
      const legs = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.6, 3, 8), lam(0x0E6E80)));
      legs.position.y = 0.52;
      const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.58, 3, 8), lam(PAL.seaShallow)));
      torso.position.y = 1.24;
      g.userData.torso = torso;
      const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.30, 9, 7), lam(skin)));
      head.position.y = 1.88;
      const goggles = add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 5, 10), lam(0x203040)));
      goggles.position.set(0, 1.94, 0.1); goggles.rotation.x = Math.PI / 2.3;
      const armR = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 2, 6), lam(skin)));
      armR.position.set(-0.48, 1.28, 0.05); armR.rotation.z = 0.3;
      const armL = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 2, 6), lam(skin)));
      armL.position.set(0.48, 1.28, 0.05); armL.rotation.z = -0.3;
      g.userData.armL = armL;
      const spear = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.3, 5), lam(PAL.trunk)));
      spear.position.set(0.62, 1.15, 0.3); spear.rotation.set(0.35, 0, -0.2);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), lam(0xD8E8F0));
      tip.position.y = 1.25; spear.add(tip);
      g.userData.club = spear;
      return g;
    }

    if (bodyId === 'magician') {
      // THE RETIRED CRUISE MAGICIAN: violet tux, top hat, working wand.
      const legs = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.58, 3, 8), lam(0x2A2138)));
      legs.position.y = 0.52;
      const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.36, 0.6, 3, 8), lam(0x5B3A8E)));
      torso.position.y = 1.24;
      g.userData.torso = torso;
      const shirt = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.16), lam(0xF7FBFF)));
      shirt.position.set(0, 1.34, 0.3);
      const bow = add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.1), lam(PAL.hibiscus)));
      bow.position.set(0, 1.6, 0.32);
      const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.31, 9, 7), lam(skin)));
      head.position.y = 1.9;
      const brim = add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 10), lam(0x1E1828)));
      brim.position.y = 2.12;
      const hat = add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.55, 10), lam(0x1E1828)));
      hat.position.y = 2.4;
      const band = add(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.1, 10), lam(PAL.gold)));
      band.position.y = 2.2;
      const armR = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 2, 6), lam(0x5B3A8E)));
      armR.position.set(-0.5, 1.28, 0.05); armR.rotation.z = 0.3;
      const armL = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.5, 2, 6), lam(0x5B3A8E)));
      armL.position.set(0.5, 1.28, 0.05); armL.rotation.z = -0.3;
      g.userData.armL = armL;
      const wand = add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 5), lam(0x1E1828)));
      wand.position.set(0.64, 1.35, 0.3); wand.rotation.set(0.4, 0, -0.3);
      const wtip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0xFFF6D2, fog: false }));
      wtip.position.y = 0.55; wand.add(wtip);
      g.userData.club = wand;
      return g;
    }

    // THE WRESTLER (default/castaway): bright trunks, championship belt, and
    // the life ring that makes the silhouette. Went overboard mid-promo.
    const legs = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 3, 8), lam(0x2A3F6B)));
    legs.position.y = 0.5;
    const torso = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.44, 0.6, 3, 8), lam(PAL.hero)));
    torso.position.y = 1.22;
    g.userData.torso = torso;
    const belt = add(new THREE.Mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.14, 10), lam(PAL.gold)));
    belt.position.y = 0.94;
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.16, 5, 12), lam(PAL.heroTrim)));
    ring.rotation.x = Math.PI / 2; ring.position.y = 1.16;
    const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 9, 7), lam(skin)));
    head.position.y = 1.92;
    const hat = add(new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 9), lam(PAL.sandLit)));
    hat.position.y = 2.16;
    const armR = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.55, 2, 6), lam(skin)));
    armR.position.set(-0.56, 1.25, 0.05); armR.rotation.z = 0.28;
    const armL = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.55, 2, 6), lam(skin)));
    armL.position.set(0.56, 1.25, 0.05); armL.rotation.z = -0.28;
    g.userData.armL = armL;
    const club = add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 1.5, 5), lam(PAL.trunk)));
    club.position.set(0.7, 1.05, 0.35); club.rotation.set(0.5, 0, -0.35);
    g.userData.club = club;
    return g;
  }

  const hero = new THREE.Group();
  let heroBody = buildHeroBody(null);
  hero.add(heroBody);
  scene.add(hero);
  function setHeroBody(bodyId) {
    hero.remove(heroBody);
    heroBody = buildHeroBody(bodyId);
    hero.add(heroBody);
    curBodyId = bodyId;
    heroBody.rotation.y = 0;   // the swing twist writes this every frame
  }

  // --- BOSSES: the creep protos scaled up and crowned. One per skin, hidden
  // until a hero-unit boss walks the sand (§6). ---
  const bossMeshes = {};
  for (const [skin, col, tint] of [['crab', PAL.crab, 0xB33E1E], ['jelly', PAL.jelly, 0x7A3EA8]]) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(creepProto(skin), lam(tint));
    g.add(body);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.3, 8), lam(PAL.gold));
    crown.position.y = skin === 'crab' ? 0.75 : 1.05;
    g.add(crown);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), lam(PAL.gold));
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.sin(a) * 0.34, (skin === 'crab' ? 0.75 : 1.05) + 0.22, Math.cos(a) * 0.34);
      g.add(spike);
    }
    g.visible = false;
    g.userData.body = body;
    scene.add(g);
    bossMeshes[skin] = g;
  }

  // --- THE REEF GOLEM: mossy rocks that fight for you. Pool of 2. ---
  const golems = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), lam(PAL.rock));
    body.position.y = 0.85; body.scale.set(1, 1.15, 0.9);
    g.add(body);
    const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), lam(PAL.jungle));
    moss.position.y = 1.42; moss.scale.set(1.1, 0.5, 1.1);
    g.add(moss);
    const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3, 0), lam(PAL.rockDark));
    head.position.y = 1.7;
    g.add(head);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.85, 0.3), lam(PAL.rockDark));
    armR.position.set(-0.75, 0.95, 0); armR.rotation.z = 0.15;
    g.add(armR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.85, 0.3), lam(PAL.rockDark));
    armL.position.set(0.75, 0.95, 0); armL.rotation.z = -0.15;
    g.add(armL);
    g.visible = false;
    g.userData.body = body;
    scene.add(g);
    golems.push(g);
  }

  // --- SPELL PROJECTILES: one glowing instanced batch, coloured by rack. ---
  const PROJ_CAP = 64;
  const projMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.28, 7, 5),
    new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.95, depthWrite: false, fog: false }),
    PROJ_CAP);
  projMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  projMesh.count = 0; projMesh.frustumCulled = false;
  projMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PROJ_CAP * 3), 3);
  scene.add(projMesh);
  const CAT_GLOW = { STRIKE: new THREE.Color(0xFFA24A), GUARD: new THREE.Color(0x7AC8FF), CURRENT: new THREE.Color(0x7FE7D8), DEEP: new THREE.Color(0xFFD24A) };

  // --- METEORS: falling stones for METEOR TIDE, driven by sim warn events. ---
  const meteors = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0),
      new THREE.MeshBasicMaterial({ color: 0xFF9A3C, fog: false }));
    m.visible = false;
    scene.add(m);
    meteors.push({ m, live: false, x: 0, z: 0, t: 0, total: 1 });
  }
  function meteorWarn(x, z, secsToLand) {
    const slot = meteors.find(mm => !mm.live) || meteors[0];
    slot.live = true; slot.x = x; slot.z = z; slot.t = 0; slot.total = Math.max(0.2, secsToLand);
    slot.m.visible = true;
  }

  // the ring under the hero's feet + the click marker (the RTS tell)
  const heroRing = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.95, 20),
    new THREE.MeshBasicMaterial({ color: 0x7FE7FF, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }));
  heroRing.rotation.x = -Math.PI / 2; heroRing.position.y = 0.05;
  scene.add(heroRing);

  const clickMark = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.62, 16),
    new THREE.MeshBasicMaterial({ color: 0x9CFF7A, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  clickMark.rotation.x = -Math.PI / 2; clickMark.position.y = 0.06;
  scene.add(clickMark);
  let clickT = 99;
  function markClick(x, z) { clickMark.position.set(x, 0.06, z); clickT = 0; }

  // -------------------------------------------------------------------------
  // Ground picking + world->screen, both used by the input and HUD layers.
  // -------------------------------------------------------------------------
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPt = new THREE.Vector3();
  function pickGround(ndcX, ndcY) {
    ray.setFromCamera({ x: ndcX, y: ndcY }, camera);
    return ray.ray.intersectPlane(groundPlane, hitPt) ? { x: hitPt.x, z: hitPt.z } : null;
  }

  // -------------------------------------------------------------------------
  // WS1 COMBAT FEEL POOLS — impact sparks, the corpse beat, stun stars, the
  // wand-tip flash. All render-side: the sim never knows a hit sparked.
  // -------------------------------------------------------------------------

  // IMPACT SPARKS: one additive instanced pool for every landed hit (+1 draw
  // call). Shards fly on render-side randomness — legal, the sim never sees
  // them. popSparks DROPS on a full pool rather than queueing: at 40 creeps
  // the cap is the strobe limiter.
  const SPARK_CAP = 96;
  // a drawn streak, NORMAL blending: additive white washes out over sunlit
  // sand (it only pops on dark backgrounds, and this island has none)
  function makeSparkTexture() {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 20;
    const g = cv.getContext('2d');
    const lg = g.createLinearGradient(0, 0, 64, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,1)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = 'rgba(30,22,10,0.55)';
    g.lineWidth = 3;
    g.strokeRect(6, 5, 52, 10);
    g.fillStyle = lg;
    g.fillRect(2, 3, 60, 14);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const sparkMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.46, 0.14),
    new THREE.MeshBasicMaterial({ map: makeSparkTexture(), color: 0xFFFFFF, transparent: true,
      depthWrite: false, side: THREE.DoubleSide, fog: false }),
    SPARK_CAP);
  sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPARK_CAP * 3), 3);
  scene.add(sparkMesh);
  const sparks = [];
  // sizes are tuned for THIS camera: at pitch 49 / dist 56 a metre is ~24px,
  // so a readable shard needs to be over half a metre long. Small was honest;
  // invisible was useless (measured on the postcard rig, not guessed).
  function popSparks(x, y, z, color, n, power) {
    const pw = power || 1;
    // the 2-frame star flash at impact height, then the shards
    if (sparks.length < SPARK_CAP) {
      sparks.push({ x, y, z, vx: 0, vy: 0, vz: 0, t: 0, ttl: 0.07, size: 2.0 * pw, color, star: true });
    }
    for (let i = 0; i < (n || 5) && sparks.length < SPARK_CAP; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.8 + Math.random() * 2.6) * pw;
      // born already spread along their flight line: the first frame reads as
      // a burst, not a dot buried inside the victim's body
      sparks.push({
        x: x + Math.sin(a) * (0.18 + Math.random() * 0.2) * pw,
        y: y + 0.05 + Math.random() * 0.3,
        z: z + Math.cos(a) * (0.18 + Math.random() * 0.2) * pw,
        vx: Math.sin(a) * sp, vy: 1.6 + Math.random() * 2.8 * pw, vz: Math.cos(a) * sp,
        t: 0, ttl: 0.3 + Math.random() * 0.22, size: (1.3 + Math.random() * 0.9) * pw,
        color, star: false,
      });
    }
  }

  // THE CORPSE BEAT: dead creeps ride the SAME per-skin instanced batches in
  // the free slots above the live count — zero extra draw calls (live ≤40 +
  // corpses ≤16 < CREEP_CAP 64). Live creeps always win the slots; the list
  // drops oldest-first under debug-spawn pressure. Bosses latch their own
  // dedicated mesh for a longer keel instead.
  const CORPSE_CAP = 16;
  const CORPSE_SEC = 0.7;
  const corpses = [];               // { skin, x, z, face, mini, t0 } — WORLD coords
  let bossCorpse = null;            // { skin, t0 } — the mesh keeps its last live pose
  function pushCorpse(o) {
    if (o.big) { bossCorpse = { skin: o.skin, t0: null }; return; }
    if (!creepMeshes[o.skin]) return;
    if (corpses.length >= CORPSE_CAP) corpses.shift();
    corpses.push({ skin: o.skin, x: o.x, z: o.z, face: o.face || 0, mini: !!o.mini, t0: null });
  }

  // STUN STARS: the cartoon read over a stunned hero's head (+1 draw call).
  // A drawn star sprite with a dark rim — a bare gold quad vanishes into the
  // sand at the gameplay camera distance.
  function makeStarTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    g.translate(32, 32);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 26;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = '#FFD84A';
    g.strokeStyle = 'rgba(16,24,40,0.9)';
    g.lineWidth = 5;
    g.stroke(); g.fill();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const stunStars = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.62, 0.62),
    new THREE.MeshBasicMaterial({ map: makeStarTexture(), transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    3);
  stunStars.count = 3;
  stunStars.frustumCulled = false;
  stunStars.visible = false;
  scene.add(stunStars);

  // the wand-tip flash, timed to the missile launch (game.js calls this on 'shot')
  let wandFlashT = 99;
  function wandFlash() { wandFlashT = 0; }

  const projV = new THREE.Vector3();
  function worldToScreen(x, y, z, w, h) {
    projV.set(x, y, z).project(camera);
    return { x: (projV.x * 0.5 + 0.5) * w, y: (-projV.y * 0.5 + 0.5) * h, behind: projV.z > 1 };
  }

  function resize(w, h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // DRAW. Called once per animation frame with the sim state and the
  // interpolation alpha (LAW 4). Cosmetic motion may read the wall clock;
  // nothing here is ever allowed to write back into the sim.
  // -------------------------------------------------------------------------
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const vPos = new THREE.Vector3();
  const vScl = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const IDENT_Q = new THREE.Quaternion();
  const white = C(0xFFFFFF);
  const flash = C(0xFFF2C4);
  const heroCol = C(PAL.hero);
  const slowCol = C(0x9FD8FF);     // FROST SNAP's ice
  const rootCol = C(0xB6FF9A);     // ROOT VINE's grip
  const avatarCol = C(0xFF6A3C);   // the volcano, worn
  const BLOB_CAP = CREEP_CAP + 8;
  let camShake = 0;
  const qPitch = new THREE.Quaternion();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const corpseCol = C(0xCFC3A6);   // corpses fade toward the sand that takes them
  const basicGlow = C(0xFFE9A8);   // the wand missile's warm tracer
  const sparkCol = new THREE.Color();
  let curBodyId = null;

  // --- WS1 THE SWING CYCLE — windup / strike / backswing, driven entirely off
  // sim state the renderer already sees. windK rises off the attack COOLDOWN
  // (the sim deals damage exactly when cd hits 0 in reach, so anticipation is
  // free and always lands on the impact tick); the STRIKE snaps through on the
  // atkAnim window with ~12% overshoot; the settle eases back to idle. One
  // scalar comes out: P = -1 full windup → +1.12 overshoot → 0 settled.
  const easeOut3 = k => 1 - Math.pow(1 - k, 3);
  const SNAP_AT = 0.22, OVERSHOOT = 1.12;
  function strikeCurve(u) {
    if (u < SNAP_AT) return -1 + (1 + OVERSHOOT) * easeOut3(u / SNAP_AT);
    return OVERSHOOT * (1 - easeOut3((u - SNAP_AT) / (1 - SNAP_AT)));
  }
  function poseOf(anim, span, windK, alpha) {
    if (anim > 0) {
      const u = 1 - Math.min(1, Math.max(0, (anim - alpha) / span));
      // the next windup blends in as the settle completes (fast attackers
      // re-cock before the follow-through fully lands)
      return strikeCurve(u) - windK * u;
    }
    return -windK;
  }

  // --- zones (rev 1): the camera and every sim-frame entity ride an offset.
  // SQUARE is the identity frame; MARKET translates to the plaza at MK. The
  // port itself is a teleport in the sim — the camera glides the 64m on its
  // usual easing, which reads as the island carrying you to the shops.
  const zoneOff = { x: 0, z: 0 };
  let zoneName = 'SQUARE';
  let flipT = 1;                 // eased camera side: +1 square, -1 market
  function setZone(z) {
    if (z === zoneName) return;
    zoneName = z;
    zoneOff.x = z === 'MARKET' ? MK.x : 0;
    zoneOff.z = z === 'MARKET' ? MK.z : 0;
  }

  // --- moods: the vista pull (death spectacle) and gold hour (milestones).
  // Both are one scalar eased toward a target; every lit thing lerps off it.
  const BASE_CAM = { pitch: CAM.pitch, dist: CAM.dist };
  const VISTA_CAM = { pitch: THREE.MathUtils.degToRad(15), dist: 82, x: 0, z: -18 };
  let vistaOn = false, vistaK = 0;
  let goldOn = false, goldK = 0;
  const sunBase = C(0xFFF3D0), sunGold = C(0xFFBE62);
  const fogBase = C(PAL.skyHaze), fogGold = C(0xF2CD9A);
  const bgBase = C(PAL.skyMid), bgGold = C(0x5FA8CE);
  function setVista(on) { vistaOn = !!on; return vistaOn; }
  function setGoldHour(on) { goldOn = !!on; return goldOn; }

  function draw(S, alpha, tSec, dt) {
    const lerp = (a, b) => a + (b - a) * alpha;

    // --- water: scrolling UVs + vertex bob (§5) ---
    waterTexA.offset.set(tSec * 0.014, tSec * 0.028);
    waterTexB.offset.set(-tSec * 0.021, tSec * 0.011);
    {
      const p = waterGeo.attributes.position;
      const zOff = water.position.z;
      for (let i = 0; i < p.count; i++) {
        const x = waterBase[i * 3], z = waterBase[i * 3 + 2];
        // Damp the swell as it reaches the beach, or the crests poke up
        // through the sand instead of sliding under it.
        const wz = z + zOff;
        const damp = Math.min(1, Math.max(0, (COVE.waterline - 1 - wz) / 14));
        p.array[i * 3 + 1] = damp * (
            Math.sin(x * 0.16 + tSec * 1.15) * 0.30
          + Math.sin(z * 0.21 - tSec * 0.85) * 0.24
          + Math.sin((x + z) * 0.07 + tSec * 0.4) * 0.18);
      }
      p.needsUpdate = true;
    }
    foamBand.material.opacity = 0.42 + Math.sin(tSec * 1.7) * 0.13;
    foamBand.position.z = COVE.waterline + 0.6 + Math.sin(tSec * 0.9) * 0.5;

    for (const r of rings) {
      if (!r.live) continue;
      r.t += dt;
      const k = r.t / 1.5;
      if (k >= 1) { r.live = false; r.m.visible = false; continue; }
      const s = (1 + k * 7) * (r.size || 1);
      r.m.scale.set(s, s, s);
      r.m.material.opacity = 0.8 * (1 - k);
    }

    for (let i = 0; i < torchFlames.length; i++) {
      const f = torchFlames[i];
      const k = 1 + Math.sin(tSec * 7 + i * 1.7) * 0.18;
      f.scale.set(k, 1 / k, k);
    }
    for (let i = 0; i < stallGems.length; i++) {
      const g = stallGems[i];
      g.position.y = (g.userData.baseY || 4.4) + Math.sin(tSec * 2 + i * 1.3) * 0.25;
      g.rotation.y = tSec * 1.2 + i;
    }

    // meteors fall on their own clocks; the sim's impact tick pops the ring
    for (const mm of meteors) {
      if (!mm.live) continue;
      mm.t += dt;
      const k = mm.t / mm.total;
      if (k >= 1) { mm.live = false; mm.m.visible = false; continue; }
      mm.m.position.set(mm.x + (1 - k) * 1.6, 16 * (1 - k) + 0.4, mm.z - (1 - k) * 0.8);
      mm.m.rotation.x = k * 9; mm.m.rotation.z = k * 7;
    }

    // --- hero (sim-local + zone offset) ---
    const h = S.hero;
    const lx = lerp(h.px, h.x), lz = lerp(h.pz, h.z);
    const hx = lx + zoneOff.x, hz = lz + zoneOff.z;
    hero.visible = !h.dead;
    heroRing.visible = !h.dead;
    if (!h.dead) {
      const moving = h.hasOrder || Math.abs(h.x - h.px) + Math.abs(h.z - h.pz) > 0.004;
      const bobA = moving ? 0.1 : 0.035;
      hero.position.set(hx, Math.abs(Math.sin(tSec * (moving ? 9 : 2.2))) * bobA, hz);
      hero.rotation.y = h.facing;
      // WS1 swing cycle: the windup needs a target in reach (a hero does not
      // stand cocked in an empty market); reach matches the sim's own test.
      let heroReach = false;
      for (const c of S.creeps) {
        if (c.dead || c.receding) continue;
        const rdx = c.x - h.x, rdz = c.z - h.z;
        const rr = h.range + c.radius + 0.25;
        if (rdx * rdx + rdz * rdz <= rr * rr) { heroReach = true; break; }
      }
      const hWind = heroReach && h.atkCd <= 4 ? 1 - h.atkCd / 4 : 0;
      const P = poseOf(h.atkAnim, 4, hWind, alpha);
      const wind = Math.max(0, -P), snap = Math.max(0, P);
      const ud = heroBody.userData;
      if (curBodyId === 'diver') {
        // the spear is a straight-line jab: pull back, thrust through
        if (ud.club) {
          const bp = ud.club.userData.basePos || (ud.club.userData.basePos = ud.club.position.clone());
          ud.club.position.z = bp.z - wind * 0.30 + snap * 0.85;
          ud.club.rotation.x = wind * 0.35 - snap * 0.30;
        }
        if (ud.armL) ud.armL.rotation.x = wind * 0.5 - snap * 0.9;
        heroBody.rotation.y = P * -0.10;
      } else if (curBodyId === 'magician') {
        // the wand is a flick; the launch flash rides wandFlashT below
        if (ud.club) ud.club.rotation.x = wind * 0.55 - snap * 0.75;
        if (ud.armL) ud.armL.rotation.x = wind * 0.4 - snap * 0.8;
        heroBody.rotation.y = P * -0.08;
      } else {
        // the wrestler's club takes the big arc, body twisting into it
        if (ud.club) ud.club.rotation.x = wind * 1.25 - snap * 0.9;
        if (ud.armL) ud.armL.rotation.x = wind * 0.7 - snap * 1.05;
        heroBody.rotation.y = P * -0.24;
      }
      // wand-tip flash on missile launch (scaled back down over ~180ms)
      wandFlashT += dt;
      if (curBodyId === 'magician' && ud.club && ud.club.children[0]) {
        const fk = Math.max(0, 1 - wandFlashT / 0.18);
        ud.club.children[0].scale.setScalar(1 + fk * 2.4);
      }
      // AVATAR OF THE VOLCANO wears the hero like a costume
      const avatar = h.buffs && h.buffs.some(b => b.id === 'avatar');
      hero.scale.setScalar(avatar ? 1.24 : 1);
      if (ud.torso) {
        const base = ud.torso.userData.baseCol || (ud.torso.userData.baseCol = ud.torso.material.color.clone());
        ud.torso.material.color.copy(h.hitFlash > 0 ? flash : (avatar ? avatarCol : base));
      }
      // the ring under your feet tells the truth: shielded, erupting, or just you
      heroRing.material.color.set(h.shield > 0 ? 0x7AC8FF : (avatar ? 0xFF7A4A : 0x7FE7FF));
      heroRing.position.set(hx, 0.05, hz);
      const pulse = 1 + Math.sin(tSec * 3) * 0.04;
      heroRing.scale.set(pulse, pulse, pulse);
      if (h.stun > 0) {
        // stunned reads three ways at once (WS1): the hard yellow ring, the
        // orbiting stars overhead, and the grayed QWER bar (game.js side)
        heroRing.material.color.set(0xF5C542);
      }
      stunStars.visible = h.stun > 0;
      if (stunStars.visible) {
        for (let i = 0; i < 3; i++) {
          const a = tSec * 4.4 + i * (Math.PI * 2 / 3);
          q.copy(camera.quaternion).multiply(qPitch.setFromAxisAngle(Z_AXIS, Math.PI / 4 + tSec * 2 + i));
          m4.compose(
            vPos.set(hx + Math.sin(a) * 0.62, 2.66 + Math.sin(tSec * 6 + i * 2) * 0.07, hz + Math.cos(a) * 0.62),
            q, vScl.set(1, 1, 1));
          stunStars.setMatrixAt(i, m4);
        }
        stunStars.instanceMatrix.needsUpdate = true;
      }
    } else stunStars.visible = false;

    // --- click marker ---
    clickT += dt;
    clickMark.material.opacity = Math.max(0, 0.85 - clickT * 1.7);
    const cs = 1 + Math.min(1, clickT * 2) * 0.5;
    clickMark.scale.set(cs, cs, cs);

    // --- creeps, one instanced batch per skin; bosses ride dedicated meshes ---
    const counts = { crab: 0, jelly: 0, monkey: 0 };
    let blobN = 0;
    if (!h.dead) {
      m4.compose(vPos.set(hx, 0.03, hz), IDENT_Q, vScl.set(2.0, 1, 2.0));
      blobs.setMatrixAt(blobN++, m4);
    }
    for (const k in bossMeshes) bossMeshes[k].visible = false;
    for (const c of S.creeps) {
      const cx = lerp(c.px, c.x), cz = lerp(c.pz, c.z);
      const face = Math.atan2(h.x - cx, h.z - cz);

      // WS1 swing cycle for the attackers: windup rises off the cooldown when
      // a defender is in reach; a creep sitting at atkCd 0 mid-charge HOLDS the
      // cocked pose — claws up is the correct, menacing read. Snap on atkAnim.
      let inReach = false;
      if (!h.dead && !c.receding) {
        const rdx = h.x - c.x, rdz = h.z - c.z;
        const rr = c.range + h.radius + 0.25;
        inReach = rdx * rdx + rdz * rdz <= rr * rr;
      }
      if (!inReach && !c.receding) {
        for (const al of S.allies) {
          if (al.dead) continue;
          const rdx = al.x - c.x, rdz = al.z - c.z;
          const rr = c.range + al.radius + 0.25;
          if (rdx * rdx + rdz * rdz <= rr * rr) { inReach = true; break; }
        }
      }
      const windSpan = c.big ? 8 : 5;    // bosses cock a readable haymaker
      const windK = c.receding ? 0
        : (c.atkCd === 0 ? 1 : (inReach && c.atkCd <= windSpan ? 1 - c.atkCd / windSpan : 0));
      const P = poseOf(c.atkAnim, 5, windK, alpha);
      const wind = Math.max(0, -P), snap = Math.max(0, P);
      const punch = Math.max(0, (c.hitFlash - alpha) / 3);   // victim squash on the hit

      if (c.big) {
        const bm = bossMeshes[c.skin];
        if (bm) {
          bm.visible = true;
          const stomp = Math.abs(Math.sin(tSec * 3.2)) * 0.1;
          bm.position.set(cx, stomp, cz);
          bm.rotation.y = face;
          bm.rotation.x = -0.10 * wind + 0.15 * snap;
          bm.rotation.z = 0;
          const s0 = c.scale || 2.6;
          const bs = s0 * (1 + snap * 0.40 - wind * 0.05) * (1 + punch * 0.07);
          const by = s0 * (1 - snap * 0.18 + wind * 0.14) * (1 - punch * 0.07);
          bm.scale.set(bs, by, bs);
          const bb = bm.userData.body;
          const base = bb.userData.baseCol || (bb.userData.baseCol = bb.material.color.clone());
          bb.material.color.copy(c.hitFlash > 0 ? flash : base);
        }
        if (blobN < BLOB_CAP) {
          const s = (c.scale || 2.6) * 1.4;
          m4.compose(vPos.set(cx, 0.02, cz), IDENT_Q, vScl.set(s, 1, s));
          blobs.setMatrixAt(blobN++, m4);
        }
        continue;
      }

      const im = creepMeshes[c.skin];
      if (!im) continue;
      const i = counts[c.skin];
      if (i >= CREEP_CAP) continue;
      const hop = c.skin === 'jelly'
        ? 0.22 + Math.sin(tSec * 3.1 + c.bob) * 0.16
        : Math.abs(Math.sin(tSec * 6 + c.bob)) * 0.12;
      const base = c.mini ? 0.62 : 1;
      // per-skin swing personality: crab claw-snap, jelly rears up, monkey
      // lunges off a crouch — then the victim punch squashes whatever it is
      let sx = 1, sy = 1, sz = 1, pitch = 0;
      if (c.skin === 'jelly') {
        sy = 1 + 0.38 * wind - 0.26 * snap;
        sx = sz = 1 - 0.10 * wind + 0.22 * snap;
        pitch = 0.10 * snap;
      } else if (c.skin === 'monkey') {
        sx = sz = 1 + 0.24 * snap;
        sy = 1 - 0.08 * wind - 0.10 * snap;
        pitch = -0.20 * wind + 0.26 * snap;
      } else {
        sx = 1 - 0.08 * wind + 0.30 * snap;
        sy = 1 + 0.06 * wind - 0.16 * snap;
        sz = 1 + 0.10 * snap;
        pitch = -0.13 * wind + 0.17 * snap;
      }
      sx *= 1 + 0.14 * punch; sz *= 1 + 0.14 * punch; sy *= 1 - 0.12 * punch;
      q.setFromAxisAngle(UP, face);
      if (pitch) q.multiply(qPitch.setFromAxisAngle(X_AXIS, pitch));
      m4.compose(vPos.set(cx, hop * base, cz), q,
        vScl.set(base * sx, base * sy, base * sz));
      im.setMatrixAt(i, m4);
      // status tints: hit flash beats ice beats roots beats plain white
      im.setColorAt(i, c.hitFlash > 0 ? flash
        : c.slowTicks > 0 ? slowCol
        : c.rootTicks > 0 ? rootCol : white);
      counts[c.skin] = i + 1;

      if (blobN < BLOB_CAP) {
        const s = (c.skin === 'jelly' ? 1.3 : 1.5) * base;
        m4.compose(vPos.set(cx, 0.025, cz), IDENT_Q, vScl.set(s, 1, s));
        blobs.setMatrixAt(blobN++, m4);
      }
    }
    // --- the corpse beat (WS1): squash flat, tip along facing, sink into the
    // sand over 0.7s — in the instance slots the live creeps left free.
    for (let ci = corpses.length - 1; ci >= 0; ci--) {
      const co = corpses[ci];
      if (co.t0 === null) co.t0 = tSec;
      const k = (tSec - co.t0) / CORPSE_SEC;
      if (k >= 1) { corpses.splice(ci, 1); continue; }
      const im = creepMeshes[co.skin];
      const i = counts[co.skin];
      if (i >= CREEP_CAP) continue;             // a full square keeps its live slots
      const base = co.mini ? 0.62 : 1;
      const squash = Math.min(1, k * 1.8);
      q.setFromAxisAngle(UP, co.face);
      q.multiply(qPitch.setFromAxisAngle(X_AXIS, 0.35 * squash));
      m4.compose(
        vPos.set(co.x + Math.sin(co.face) * 0.3 * k, -0.62 * k * k, co.z + Math.cos(co.face) * 0.3 * k),
        q,
        vScl.set(base * (1 + 0.2 * squash), base * (1 - 0.75 * squash), base * (1 + 0.2 * squash)));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, corpseCol);
      counts[co.skin] = i + 1;
    }
    for (const k in creepMeshes) {
      const im = creepMeshes[k];
      im.count = counts[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    // a downed boss holds its dedicated mesh for a 1.2s keel-and-sink before
    // it hides; a LIVE boss of the same skin always wins the mesh back
    if (bossCorpse) {
      const bm = bossMeshes[bossCorpse.skin];
      if (!bm || bm.visible) bossCorpse = null;
      else {
        if (bossCorpse.t0 === null) bossCorpse.t0 = tSec;
        const k = (tSec - bossCorpse.t0) / 1.2;
        if (k >= 1) { bm.rotation.z = 0; bossCorpse = null; }
        else {
          bm.visible = true;
          bm.rotation.z = 1.15 * easeOut3(Math.min(1, k * 1.3));
          bm.position.y = -2.3 * k * k;
        }
      }
    }

    // --- allies: the golem pool ---
    for (const g of golems) g.visible = false;
    for (let i = 0; i < S.allies.length && i < golems.length; i++) {
      const a = S.allies[i];
      const g = golems[i];
      g.visible = true;
      const ax = lerp(a.px, a.x) + zoneOff.x, az = lerp(a.pz, a.z) + zoneOff.z;
      const stomp = Math.abs(Math.sin(tSec * 4 + i)) * 0.08;
      g.position.set(ax, stomp, az);
      g.rotation.y = a.facing;
      // WS1: the golem swings on the same windup/strike cycle as the hero
      let gReach = false;
      for (const c of S.creeps) {
        if (c.dead || c.receding) continue;
        const rdx = c.x - a.x, rdz = c.z - a.z;
        const rr = a.range + c.radius + 0.25;
        if (rdx * rdx + rdz * rdz <= rr * rr) { gReach = true; break; }
      }
      const gWind = gReach && a.atkCd <= 4 ? 1 - a.atkCd / 4 : 0;
      const gP = poseOf(a.atkAnim, 5, gWind, alpha);
      const wind = Math.max(0, -gP), snap = Math.max(0, gP);
      const punch = Math.max(0, (a.hitFlash - alpha) / 3);
      g.rotation.x = -0.11 * wind + 0.15 * snap;
      g.scale.set(
        (1 + 0.26 * snap - 0.06 * wind) * (1 + 0.10 * punch),
        (1 - 0.16 * snap + 0.10 * wind) * (1 - 0.10 * punch),
        (1 + 0.26 * snap - 0.06 * wind) * (1 + 0.10 * punch));
      const gb = g.userData.body;
      const base = gb.userData.baseCol || (gb.userData.baseCol = gb.material.color.clone());
      gb.material.color.copy(a.hitFlash > 0 ? flash : base);
      if (blobN < BLOB_CAP) {
        m4.compose(vPos.set(ax, 0.02, az), IDENT_Q, vScl.set(1.8, 1, 1.8));
        blobs.setMatrixAt(blobN++, m4);
      }
    }
    blobs.count = blobN;
    blobs.instanceMatrix.needsUpdate = true;

    // --- projectiles ---
    let pn = 0;
    for (const p of S.projs) {
      if (p.dead || pn >= PROJ_CAP) continue;
      const px = lerp(p.px, p.x) + zoneOff.x, pz2 = lerp(p.pz, p.z) + zoneOff.z;
      const wob = 1 + Math.sin(tSec * 22 + p.id) * 0.18;
      // WS1: the basic missile LOBS — a render-side arc over the sim's flat
      // line — with a warm tracer so the racks keep their spell colours
      let py = 1.15, ps = wob;
      if (p.kind === 'basic') {
        const lk = Math.min(1, (p.traveled || 0) / (p.maxDist || 1));
        py = 1.3 + Math.sin(lk * Math.PI) * 0.9;
        ps = wob * 0.85;
      }
      m4.compose(vPos.set(px, py, pz2), IDENT_Q, vScl.set(ps, ps, ps));
      projMesh.setMatrixAt(pn, m4);
      projMesh.setColorAt(pn, p.kind === 'basic' ? basicGlow : (CAT_GLOW[p.cat] || white));
      pn++;
    }
    projMesh.count = pn;
    projMesh.instanceMatrix.needsUpdate = true;
    if (projMesh.instanceColor) projMesh.instanceColor.needsUpdate = true;

    // --- impact sparks (WS1): shards on gravity + the 2-frame star flash ---
    let sn = 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt;
      if (s.t >= s.ttl) { sparks.splice(i, 1); continue; }
      const k = s.t / s.ttl;
      if (!s.star) {
        s.vy -= 10.5 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      }
      const sc = s.star ? s.size * (1 + k * 1.6) : s.size * (1 - k * 0.8);
      q.copy(camera.quaternion);
      q.multiply(qPitch.setFromAxisAngle(Z_AXIS, s.star ? Math.PI / 4 : s.x * 7 + s.z * 5 + i));
      m4.compose(vPos.set(s.x, Math.max(0.12, s.y), s.z), q, vScl.set(sc, s.star ? sc : sc * 0.5, 1));
      sparkMesh.setMatrixAt(sn, m4);
      sparkMesh.setColorAt(sn, sparkCol.set(s.color === undefined ? 0xFFFFFF : s.color));
      sn++;
    }
    sparkMesh.count = sn;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;

    // --- moods ---
    vistaK += ((vistaOn ? 1 : 0) - vistaK) * Math.min(1, dt * 1.7);
    goldK += ((goldOn ? 1 : 0) - goldK) * Math.min(1, dt * 1.5);
    if (goldK > 0.001 || rim.intensity > 0) {
      sun.color.lerpColors(sunBase, sunGold, goldK);
      sun.intensity = 1.55 + goldK * 0.5;
      hemi.intensity = 0.85 - goldK * 0.16;
      rim.intensity = goldK * 1.7;
      fogColor.lerpColors(fogBase, fogGold, goldK);
      scene.background.lerpColors(bgBase, bgGold, goldK);
      sunDisc.material.opacity = 0.9 + goldK * 0.1;
      sunDisc.scale.setScalar(1 + goldK * 0.35);
    }

    // --- camera: follow the hero loosely, RTS style; kick on a hero hit.
    // On a washout the whole rig eases out to the postcard instead — death is
    // a beauty shot with a countdown on it, never a logout (§3). The follow
    // clamps run in the LOCAL frame, then ride the zone offset — same feel in
    // the square and the market, and the port becomes a 64m glide.
    const wantX = zoneOff.x + THREE.MathUtils.clamp(lx * 0.42, -9, 9);
    const wantZ = zoneOff.z + THREE.MathUtils.clamp(-3 + lz * 0.32, -7, 6);
    CAM.look.x += (wantX + (VISTA_CAM.x - wantX) * vistaK - CAM.look.x) * 0.055;
    CAM.look.z += (wantZ + (VISTA_CAM.z - wantZ) * vistaK - CAM.look.z) * 0.055;
    CAM.pitch = BASE_CAM.pitch + (VISTA_CAM.pitch - BASE_CAM.pitch) * vistaK;
    CAM.dist = BASE_CAM.dist + (VISTA_CAM.dist - BASE_CAM.dist) * vistaK;
    // the market faces the island; the vista always faces the sea, and it wins
    flipT += ((zoneName === 'MARKET' ? -1 : 1) - flipT) * Math.min(1, dt * 2.2);
    CAM.flip = flipT * (1 - vistaK) + vistaK;
    if (camShake > 0) camShake *= 0.86;
    placeCamera();
    if (camShake > 0.01) {
      camera.position.x += Math.sin(tSec * 61) * camShake;
      camera.position.y += Math.cos(tSec * 47) * camShake;
    }

    renderer.render(scene, camera);
  }

  function kick(amount) { camShake = Math.min(0.6, camShake + amount); }

  return {
    renderer, scene, camera, CAM,
    resize, draw, pickGround, worldToScreen, popFoamRing, popRing, markClick, kick,
    setHeroBody, meteorWarn, setVista, setGoldHour, setZone,
    popSparks, pushCorpse, wandFlash,
    marketAnchor: MK,
    get vistaK() { return vistaK; },
    get goldK() { return goldK; },
    get fxCorpses() { return corpses.length + (bossCorpse ? 1 : 0); },
    get fxSparks() { return sparks.length; },
    get fxSparksDrawn() { return sparkMesh.count; },
    paletteTex,
  };
}
