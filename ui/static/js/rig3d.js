// TireTune corner rig: one wheel corner on a suspension test rig, built from the live setup and driven by drag
// handles on the parts themselves.
//   wheel centre   bump / droop through the travel (preview), spring force and bump stop live
//   red / amber    bump stop and droop limit          -> Suspension.MaxTravelUp / MaxTravelDown
//   spring top     stiffer (up) / softer (down)       -> Suspension.SpringRate
//   tie rod        steer (preview, up to the lock) to see caster / SAI change camber while steering
//   tyre top       camber, tyre front  toe            -> wheel hub Angles (alignment, convention kept)
//   axis top       caster (fore / aft), SAI (in / out) -> kingpin Angles
// Click any part to edit it in the inspector next to the rig. Coordinates: x outward, y up, z forward.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UI = globalThis.TireTuneUI, P = globalThis.TireLabPhysics;
const DEG = Math.PI / 180;
const EXA = 3;   // alignment angles are drawn x3 so a degree is visible; handles move on the drawn geometry
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let host = null, inspector = null, hud = null;
let axle = 0, travel = 0, steer = 0, slipDeg = 4, roll = 0, selected = null, hoverPart = null, drag = null, framed = false;
// tyre squish is a preview: Reforger has no tyre pressure or vertical stiffness field (the wheel is a rigid radius)
let pressure = 2.3, squishEx = 3;

// a tyre you can squash: a rounded cross-section swept around the axle (x); base positions kept for deformation
function makeTyreGeo(R, w, side) {
  const rimR = R - side, c = Math.min(w, side) * 0.38, prof = [];
  const arc = (cx, cr, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; prof.push([cx + c * Math.cos(a), cr + c * Math.sin(a)]); } };
  prof.push([-w / 2, rimR]);
  arc(-w / 2 + c, R - c, Math.PI, Math.PI / 2, 6);
  arc(w / 2 - c, R - c, Math.PI / 2, 0, 6);
  prof.push([w / 2, rimR]);
  const segs = 72, pos = [], idx = [];
  for (let j = 0; j <= segs; j++) {
    const t = j / segs * Math.PI * 2;
    for (const [x, r] of prof) pos.push(x, -r * Math.cos(t), r * Math.sin(t));
  }
  const np = prof.length;
  for (let j = 0; j < segs; j++) for (let i = 0; i < np - 1; i++) {
    const a = j * np + i, b = a + np;
    idx.push(a, a + 1, b, a + 1, b + 1, b);   // outward normals: profile direction x sweep direction
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.base = Float32Array.from(pos);
  g.userData.dims = { R, w, side };
  return g;
}
// flatten against the ground by d (metres) and bulge the sidewalls near the bottom
function squash(g, d) {
  const base = g.userData.base, p = g.attributes.position.array, { R, w } = g.userData.dims, floorY = -(R - d);
  for (let i = 0; i < base.length; i += 3) {
    let x = base[i], y = base[i + 1];
    const z = base[i + 2];
    if (y < floorY) y = floorY;
    const low = Math.max(0, -y / R);
    if (low > 0.55 && Math.abs(x) > w * 0.3) x += Math.sign(x) * d * 0.55 * Math.pow((low - 0.55) / 0.45, 2);
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
  g.attributes.position.needsUpdate = true;
  g.computeVertexNormals();
}

// ---- renderer / scene -------------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1420);
const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 60);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.09; controls.minDistance = 0.8; controls.maxDistance = 8;
scene.add(new THREE.HemisphereLight(0xc4dcff, 0x1a2230, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(3, 5, 2.5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5 });
scene.add(sun);
const rimLight = new THREE.DirectionalLight(0x4fb3ff, 1.0); rimLight.position.set(-3, 2, -4); scene.add(rimLight);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshStandardMaterial({ color: 0x0e1825, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(6, 30, 0x2d4460, 0x172434); scene.add(grid);

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.5, ...o });
const M = {
  rubber: mat(0x1b1f26, { roughness: 0.85, metalness: 0 }), rim: mat(0xb7c5d5, { metalness: 0.85, roughness: 0.25 }),
  arm: mat(0x5b6b80), upright: mat(0x7d8ea5), spring: mat(0xf0b35a, { metalness: 0.6, roughness: 0.3 }), damper: mat(0x93a4ba, { metalness: 0.8 }),
  body: new THREE.MeshPhysicalMaterial({ color: 0x2a4766, transparent: true, opacity: 0.55, roughness: 0.4, metalness: 0.2 }),
  axis: new THREE.MeshBasicMaterial({ color: 0x5ed6a0 }), rod: mat(0xb7c5d5, { metalness: 0.9 }), pad: new THREE.MeshStandardMaterial({ color: 0x1d3048, roughness: 0.6, metalness: 0.2 }),
};

// ---- parts (built once per axle / wheel size; posed every frame) --------------------------------------------------
const parts = [], handles = [];
const root = new THREE.Group(); scene.add(root);
let built = null, R = 0.35;

// each part gets its own material copy so highlighting one part never lights up another that shares a look
function tag(obj, part) { obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.userData.part = part; o.castShadow = true; parts.push(o); } }); return obj; }
function rod(r, m) { const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 10), m); return g; }
// place a unit cylinder between two points
function span(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.scale.set(1, Math.max(1e-3, len), 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
}
class Helix extends THREE.Curve {
  constructor(r, turns) { super(); this.r = r; this.turns = turns; }
  getPoint(t, out = new THREE.Vector3()) { const a = t * this.turns * Math.PI * 2; return out.set(this.r * Math.cos(a), t, this.r * Math.sin(a)); }
}

const S = {};   // scene objects
function build() {
  root.clear(); parts.length = 0; handles.length = 0;
  const car = UI.car(); if (!car) return;
  const a = car.axles[axle]; R = a.radius;
  const lab = n => ({ label: `Axle ${axle + 1} ${n}`, axle });
  // chassis stub and frame rail (fixed)
  S.body = tag(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 1.1), M.body), { kind: 'body', ...lab('body') });
  S.body.position.set(0.05, R + 0.55, 0); root.add(S.body);
  S.rail = tag(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.3), M.arm), { kind: 'body', ...lab('body') }); S.rail.position.set(0.18, R - 0.12, 0); root.add(S.rail);
  // wishbones: two tubes each
  S.arms = ['lf', 'lr', 'uf', 'ur'].map(() => { const m = rod(0.018, M.arm); root.add(m); return tag(m, { kind: 'spring', ...lab('suspension') }); });
  S.upright = tag(rod(0.03, M.upright), { kind: 'align', ...lab('alignment') }); root.add(S.upright);
  S.axis = tag(rod(0.008, M.axis), { kind: 'align', ...lab('alignment') }); root.add(S.axis);
  // coil-over
  S.coil = tag(new THREE.Mesh(new THREE.TubeGeometry(new Helix(0.055, 8), 200, 0.009, 6, false), M.spring), { kind: 'spring', ...lab('suspension') });
  S.coilG = new THREE.Group(); S.coilG.add(S.coil); root.add(S.coilG);
  S.damper = tag(rod(0.02, M.damper), { kind: 'spring', ...lab('suspension') }); root.add(S.damper);
  // steering
  S.rack = tag(rod(0.02, M.damper), { kind: 'steering', ...lab('steering') }); root.add(S.rack);
  S.tie = tag(rod(0.012, M.rod), { kind: 'steering', ...lab('steering') }); root.add(S.tie);
  // wheel
  S.wheel = new THREE.Group(); root.add(S.wheel);
  S.spin = new THREE.Group(); S.wheel.add(S.spin);
  const size = UI.tyreSize && UI.tyreSize();
  const tw = size ? size.width : 0.24, side = size ? Math.min(R * 0.7, R * size.sidewall / size.radius) : R * 0.38;
  S.tyreGeo = makeTyreGeo(R, tw, side);
  const tyre = new THREE.Mesh(S.tyreGeo, mat(0x23272e, { roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  tyre.receiveShadow = true;
  const tg = new THREE.Group(); tg.add(tyre); tag(tg, { kind: 'tyre', ...lab('tyre') }); S.wheel.add(tg); S.tread = tyre;
  const rimM = new THREE.Mesh(new THREE.CylinderGeometry((R - side) * 0.98, (R - side) * 0.98, tw * 0.92, 32), M.rim); rimM.rotation.z = Math.PI / 2;
  const rg = new THREE.Group(); rg.add(rimM);
  for (let k = 0; k < 5; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.27, R * 0.1, R * 1.15), mat(0x8fa0b4)); sp.rotation.x = k * Math.PI / 5; rg.add(sp); }
  tag(rg, { kind: 'wheel', ...lab('wheel') }); S.spin.add(rg);
  // contact pad, force arrow, travel rail
  S.pad = tag(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.035, 0.62), M.pad), { kind: 'tyre', ...lab('tyre') }); S.pad.receiveShadow = true; root.add(S.pad);
  S.patch = new THREE.Mesh(new THREE.CircleGeometry(0.12, 32), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.7 }));   // scaled to the patch width x length
  S.patch.rotation.x = -Math.PI / 2; root.add(S.patch);
  S.arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.4, 0x4fc3f7, 0.1, 0.07); root.add(S.arrow);
  S.rail2 = rod(0.006, new THREE.MeshBasicMaterial({ color: 0x3a5878 })); root.add(S.rail2);
  // handles
  const hmat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, depthTest: false });
  const mk = (id, color, label, axes, apply) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 12), hmat(color));
    m.renderOrder = 10;
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthTest: false }));
    halo.renderOrder = 9; m.add(halo);
    m.userData.handle = { id, color, label, axes, apply };
    root.add(m); handles.push(m);
    return m;
  };
  const sus = k => ['axles', axle, 'Suspension', k];
  S.hTravel = mk('travel', 0xe3ebf5, 'bump / droop', [[0, 1, 0]], (d, s0) => { travel = clamp(s0.travel + d[0], -cur().down, cur().up); });
  S.hBump = mk('bump', 0xef6d78, 'bump stop', [[0, 1, 0]], (d, s0) => UI.set(sus('MaxTravelUp'), +Math.max(0.005, s0.up + d[0]).toFixed(3)));
  S.hDroop = mk('droop', 0xf0b35a, 'droop limit', [[0, 1, 0]], (d, s0) => UI.set(sus('MaxTravelDown'), +Math.max(0.005, s0.down - d[0]).toFixed(3)));
  S.hSpring = mk('spring', 0xf0b35a, 'spring rate', [[0, 1, 0]], (d, s0) => UI.set(sus('SpringRate'), Math.max(1, Math.round(s0.rate * Math.exp(d[0] * 5)))));
  S.hSteer = mk('steer', 0x4fb3ff, 'steer', [[0, 0, 1]], (d, s0) => { steer = clamp(s0.steer + d[0] / 0.24, -cur().lock, cur().lock); });
  S.hCamber = mk('camber', 0x7fd3ff, 'camber', [[1, 0, 0]], (d, s0) => UI.setAlign(axle, 'camber', +clamp(Math.abs(s0.camber) - Math.atan2(d[0], R) / DEG / EXA, 0, 8).toFixed(2)));
  S.hToe = mk('toe', 0x7fd3ff, 'toe', [[1, 0, 0]], (d, s0) => UI.setAlign(axle, 'toe', +clamp(Math.abs(s0.toe) - Math.atan2(d[0], R) / DEG / EXA, 0, 6).toFixed(2)));
  S.hKing = mk('kingpin', 0x5ed6a0, 'caster / SAI', [[0, 0, 1], [1, 0, 0]], (d, s0) => {
    UI.setAlign(axle, 'caster', +clamp(Math.abs(s0.caster) - Math.atan2(d[0], R) / DEG / EXA, 0, 15).toFixed(2));
    UI.setAlign(axle, 'sai', +clamp(Math.abs(s0.sai) - Math.atan2(d[1], R) / DEG / EXA, 0, 18).toFixed(2));
  });
  built = { axle, R, size: size ? `${size.width}/${size.sidewall}` : '' };
  if (!framed) frame();
}

// current numbers from the setup
function cur() {
  const car = UI.car(), a = car.axles[axle], al = UI.align(axle);
  return { a, car, up: a.travelUp, down: a.travelDown, k: a.spring, lock: Math.abs(a.steerMax) * DEG, Fz0: car.static[axle] / 2,
           rate: UI.value(['axles', axle, 'Suspension', 'SpringRate']) ?? UI.engineDefault(['axles', axle, 'Suspension', 'SpringRate']) ?? a.spring / 1000,
           camber: Math.abs(al.camber), toe: Math.abs(al.toe), caster: Math.abs(al.caster), sai: Math.abs(al.sai), al };
}

function frame() {
  // the wheel and its flat spot sit above the readout bar
  controls.target.set(0.68, R - 0.18, 0);
  camera.position.set(2.15, R + 0.55, 2.0);
  controls.update(); framed = true;
}

// ---- pose every frame -----------------------------------------------------------------------------------------
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function pose(dt) {
  const c = cur(); travel = clamp(travel, -c.down, c.up);
  const s = travel, xW = 0.95;
  const hub0 = V(xW, R + s, 0);
  // steering axis: top leans in (SAI) and back (caster)
  const k = V(-Math.tan(c.sai * EXA * DEG), 1, -Math.tan(c.caster * EXA * DEG)).normalize();
  const kTrue = V(-Math.tan(c.sai * DEG), 1, -Math.tan(c.caster * DEG)).normalize();
  const P0 = hub0.clone().add(V(-0.1, 0, 0));
  const qSteer = new THREE.Quaternion().setFromAxisAngle(k, steer);
  const lbj = P0.clone().addScaledVector(k, -R * 0.55), ubj = P0.clone().addScaledVector(k, R * 0.62);
  // wishbones from fixed inner pivots
  const LF = V(0.22, R - 0.12, 0.22), LR = V(0.22, R - 0.12, -0.22), UF = V(0.36, R + 0.3, 0.17), UR = V(0.36, R + 0.3, -0.17);
  span(S.arms[0], LF, lbj); span(S.arms[1], LR, lbj); span(S.arms[2], UF, ubj); span(S.arms[3], UR, ubj);
  span(S.upright, lbj, ubj);
  span(S.axis, P0.clone().addScaledVector(k, -R * 1.05), P0.clone().addScaledVector(k, R * 1.05));
  // coil-over from the lower arm to the body
  const bottom = LF.clone().lerp(LR, 0.5).lerp(lbj, 0.72), top = V(0.62, R + 0.82, 0);
  const d = top.clone().sub(bottom), len = d.length();
  S.coilG.position.copy(bottom); S.coilG.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize()); S.coilG.scale.set(1, len, 1);
  span(S.damper, bottom, bottom.clone().addScaledVector(d, 0.62));
  // steering: rack end to the knuckle arm (rotates with the steer)
  const armTip = P0.clone().add(V(-0.03, 0.02, 0.24).applyQuaternion(qSteer));
  const rackEnd = V(0.26, R + 0.04, 0.26 + 0.0);
  span(S.rack, V(-0.2, R + 0.04, 0.26), rackEnd); span(S.tie, rackEnd, armTip);
  // wheel: steer about the axis, then toe (front in) and camber (top in)
  const hub = P0.clone().add(hub0.clone().sub(P0).applyQuaternion(qSteer));
  const wheelQ = (q, ex) => q.clone()
    .multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -c.toe * ex * DEG))
    .multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), c.camber * ex * DEG));
  const qWheel = wheelQ(qSteer, EXA);
  const qTrue = wheelQ(new THREE.Quaternion().setFromAxisAngle(kTrue, steer), 1);   // the real geometry, for the readout
  S.wheel.position.copy(hub); S.wheel.quaternion.copy(qWheel);
  roll += dt * 0.6; S.spin.rotation.x = roll;
  // pad under the tyre, load and lateral force at the preview slip angle
  const Fz = Math.max(0, c.Fz0 + c.k * s);
  // assumed vertical tyre stiffness: about 200 N/mm for a car tyre at 2.3 bar, scaling with pressure and size
  const kz = 200000 * (pressure / 2.3) * Math.sqrt(R / 0.31);
  const defl = Fz / kz, dVis = Math.min(defl * squishEx, R * 0.3);
  squash(S.tyreGeo, dVis);
  const patchLen = 2 * Math.sqrt(Math.max(0, 2 * R * defl - defl * defl)), patchW = S.tyreGeo.userData.dims.w * 0.85;
  // the wheel sits lower by its squash: the pad stays under the flattened tyre
  S.pad.position.set(hub.x, hub.y - R + dVis - 0.018, hub.z);
  S.patch.position.set(hub.x, hub.y - R + dVis + 0.002, hub.z);
  const lenVis = 2 * Math.sqrt(Math.max(0, 2 * R * dVis - dVis * dVis));
  S.patch.scale.set(patchW / 0.24, Math.max(0.05, lenVis) / 0.24, 1);
  const coeff = UI.pacejka();
  let Fy = 0, use = 0;
  if (coeff) { Fy = Math.abs(P.forces(coeff, Fz, 0, -slipDeg * DEG, 0).Fy); const pk = Math.max(1, ...[2, 4, 6, 8, 10, 12].map(a => Math.abs(P.forces(coeff, Fz, 0, -a * DEG, 0).Fy))); use = Fy / pk; }
  const col = new THREE.Color().setHSL(0.55 - 0.55 * clamp(use, 0, 1), 0.75, 0.6);
  S.patch.material.color.copy(col);
  S.arrow.position.set(hub.x, hub.y - R + dVis + 0.03, hub.z);
  S.arrow.setDirection(V(-1, 0, 0)); S.arrow.setLength(Math.max(0.05, Fy / 9000), 0.1, 0.07); S.arrow.setColor(col);
  // travel rail beside the wheel: droop .. bump with the hub marker
  const rx = xW + R * 0.0 + 0.36, base = R;
  span(S.rail2, V(rx, base - c.down, 0), V(rx, base + c.up, 0));
  const atStop = s >= c.up - 1e-4 || s <= -c.down + 1e-4;
  // handles
  const wheelUp = V(0, 1, 0).applyQuaternion(qWheel), wheelFwd = V(0, 0, 1).applyQuaternion(qWheel);
  S.hTravel.position.copy(hub).add(V(0.17, 0, 0).applyQuaternion(qWheel));
  S.hBump.position.set(rx, base + c.up, 0);
  S.hDroop.position.set(rx, base - c.down, 0);
  S.hSpring.position.copy(top);
  S.hSteer.position.copy(rackEnd.clone().lerp(armTip, 0.5));
  S.hCamber.position.copy(hub).addScaledVector(wheelUp, R + 0.03);
  S.hToe.position.copy(hub).addScaledVector(wheelFwd, R + 0.03);
  S.hKing.position.copy(P0).addScaledVector(k, R * 1.1);
  S.hCamber.visible = S.hToe.visible = c.al.wEdit;
  S.hKing.visible = c.al.kEdit;
  S.hTravel.children[0].material.color.set(atStop ? 0xef6d78 : 0xe3ebf5);
  // HUD
  if (hud) {
    const axisNow = V(1, 0, 0).applyQuaternion(qTrue);
    const camberNow = Math.asin(clamp(axisNow.y, -1, 1)) / DEG;
    const springF = c.k * (c.Fz0 / c.k + s);
    hud.innerHTML = `<div><span>travel</span><b class="${atStop ? 'bad' : ''}">${s >= 0 ? '+' : ''}${Math.round(s * 1000)} mm</b><em>${atStop ? (s > 0 ? 'on the bump stop' : 'fully drooped') : `-${Math.round(c.down * 1000)} .. +${Math.round(c.up * 1000)}`}</em></div>
      <div><span>spring</span><b>${(springF / 1000).toFixed(2)} kN</b><em>${Math.round(c.k / 1000)} N/mm, static ${(c.Fz0 / 1000).toFixed(2)}</em></div>
      <div><span>steer</span><b>${(steer / DEG).toFixed(1)}°</b><em>lock ${(c.lock / DEG).toFixed(0)}°</em></div>
      <div><span>camber now</span><b>${Math.abs(camberNow).toFixed(2)}°</b><em>${Math.abs(steer) > 0.01 ? 'caster / SAI change it as you steer' : 'static'}</em></div>
      <div><span>tyre squash</span><b>${Math.round(defl * 1000)} mm</b><em>patch ${Math.round(patchLen * patchW * 1e4)} cm² at ${pressure.toFixed(1)} bar (preview)</em></div>
      <div><span>grip at ${slipDeg}° slip</span><b>${(Fy / 1000).toFixed(2)} kN</b><em>${Math.round(use * 100)} % of peak at ${(Fz / 1000).toFixed(1)} kN load</em></div>`;
  }
}

// ---- pointer: handles first, then parts -------------------------------------------------------------------------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function hitAt(e, list) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.intersectObjects(list, false)[0];
}
// screen pixels per metre along a world axis at a point
function screenAxis(p, axis) {
  const r = renderer.domElement.getBoundingClientRect();
  const a = p.clone().project(camera), b = p.clone().add(V(...axis).multiplyScalar(0.1)).project(camera);
  return [(b.x - a.x) / 0.1 * r.width / 2, -(b.y - a.y) / 0.1 * r.height / 2];
}
function solve(deltaPx, cols) {
  if (cols.length === 1) { const [sx, sy] = cols[0], n = sx * sx + sy * sy || 1; return [(deltaPx[0] * sx + deltaPx[1] * sy) / n]; }
  const [[a, c], [b, d]] = cols, det = a * d - b * c;   // [a b; c d] * [u v] = delta
  if (Math.abs(det) < 1e-6) return [0, 0];
  return [(deltaPx[0] * d - b * deltaPx[1]) / det, (a * deltaPx[1] - c * deltaPx[0]) / det];
}
function glow() {
  for (const m of parts) {
    if (!m.material.emissive) continue;
    const p = m.userData.part, on = (selected && p.kind === selected.kind ? 0.35 : 0) + (hoverPart && p.kind === hoverPart.kind ? 0.25 : 0);
    m.material.emissive.setHex(on ? 0x4fb3ff : 0); m.material.emissiveIntensity = on;
  }
}
const el = renderer.domElement;
el.addEventListener('pointerdown', e => {
  const h = hitAt(e, handles.filter(x => x.visible));
  if (h) {
    const hd = h.object.userData.handle, c = cur();
    drag = { hd, x: e.clientX, y: e.clientY, cols: hd.axes.map(ax => screenAxis(h.object.position, ax)),
             s0: { travel, steer, up: c.up, down: c.down, rate: c.rate, camber: c.camber, toe: c.toe, caster: c.caster, sai: c.sai }, moved: false, saved: !['travel', 'steer'].includes(hd.id) };
    controls.enabled = false;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    e.preventDefault();
    return;
  }
  drag = { click: [e.clientX, e.clientY] };
});
el.addEventListener('pointermove', e => {
  if (drag && drag.hd) {
    const d = solve([e.clientX - drag.x, e.clientY - drag.y], drag.cols);
    drag.moved = true;
    drag.hd.apply(d, drag.s0);
    return;
  }
  const h = hitAt(e, handles.filter(x => x.visible));
  const p = h ? null : (hitAt(e, parts) || {}).object;
  hoverPart = p ? p.userData.part : null;
  el.style.cursor = h ? 'grab' : p ? 'pointer' : 'default';
  if (host) {
    const tip = host.querySelector('.rig-tip');
    if (tip) {
      const lab = h ? `<b>${h.object.userData.handle.label}</b> drag` : p ? `<b>${p.userData.part.label}</b> click to edit` : '';
      tip.hidden = !lab; tip.innerHTML = lab;
      const r = host.getBoundingClientRect(); tip.style.left = (e.clientX - r.left + 14) + 'px'; tip.style.top = (e.clientY - r.top + 10) + 'px';
    }
  }
  glow();
});
el.addEventListener('pointerup', e => {
  controls.enabled = true;
  if (drag && drag.hd) { if (drag.moved && drag.hd && drag.saved) UI.done(); drag = null; return; }
  if (drag && drag.click && Math.hypot(e.clientX - drag.click[0], e.clientY - drag.click[1]) < 5) {
    const p = hitAt(e, parts);
    select(p ? p.object.userData.part : null);
  }
  drag = null;
});
el.addEventListener('dblclick', () => { travel = 0; steer = 0; });

function select(p) {
  selected = p;
  glow();
  if (!inspector) return;
  inspector.innerHTML = '';
  if (!p) { inspector.innerHTML = '<p class="help">Click a part of the corner to edit it here. Drag the coloured dots on the rig to move things directly.</p>'; return; }
  inspector.appendChild(UI.partPanel(p));
  UI.refresh();
}

// ---- mount / loop --------------------------------------------------------------------------------------------------
function mount(h, insp, hudEl) {
  host = h; inspector = insp; hud = hudEl;
  host.prepend(el);
  if (!selected) select({ kind: 'spring', label: `Axle ${axle + 1} suspension`, axle });
  else select(selected);
}
function setAxle(i) { axle = i; travel = 0; steer = 0; built = null; framed = false; selected = { kind: 'spring', label: `Axle ${i + 1} suspension`, axle: i }; if (inspector) select(selected); }
function setSlip(v) { slipDeg = v; }
function setPressure(v) { pressure = v; }
function setSquish(v) { squishEx = v; }
function rebuild() { built = null; }

let last = performance.now(), lastCar = null;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (host && host.isConnected && host.offsetParent !== null && UI.ready()) {
    const w = host.clientWidth, h = host.clientHeight;
    if (el.width !== Math.round(w * renderer.getPixelRatio()) || el.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    }
    const car = UI.car();
    if (axle >= car.axles.length) axle = 0;
    if (!built || built.axle !== axle || Math.abs(built.R - car.axles[axle].radius) > 1e-4 || car !== lastCar && !built) build();
    lastCar = car;
    controls.update();
    pose(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handleAt: a handle's position on screen (for tests and the demo)
function handleAt(id) {
  const h = handles.find(x => x.userData.handle.id === id && x.visible);
  if (!h) return null;
  const r = el.getBoundingClientRect(), p = h.position.clone().project(camera);
  return [r.left + (p.x + 1) / 2 * r.width, r.top + (1 - p.y) / 2 * r.height];
}
globalThis.TireTuneRig = { mount, setAxle, setSlip, setPressure, setSquish, rebuild, select, axle: () => axle, handleAt, preview: () => ({ travel, steer }) };
// the studio may have rendered before this module loaded
document.dispatchEvent(new Event('tiretune-rig-ready'));
