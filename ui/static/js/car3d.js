// TireTune 3D car: a procedural model of the vehicle being tuned (axle positions, track, wheel radius, springs,
// travel and CoM come from the live setup), animated with the running scenario. Orbit / zoom / pan with the mouse;
// hover a part to see its numbers, click it to adjust it in the inspector (the same controls and graphs as the side
// panel). Coordinates: x = left, y = up, z = forward (Enfusion x is right, so x is mirrored).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UI = globalThis.TireTuneUI;
const host = document.getElementById('car3d');
const panel = document.getElementById('inspector');
const tip = document.getElementById('car3d-tip');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const USE = [[0, 0x4fc3f7], [0.65, 0x5ed6a0], [0.85, 0xf0b35a], [1, 0xef6d78]];
function useColor(u) {
  u = clamp(u, 0, 1.05);
  for (let i = 1; i < USE.length; i++) {
    if (u <= USE[i][0]) {
      const t = (u - USE[i - 1][0]) / (USE[i][0] - USE[i - 1][0]);
      return new THREE.Color(USE[i - 1][1]).lerp(new THREE.Color(USE[i][1]), t);
    }
  }
  return new THREE.Color(0xef6d78);
}

// ---- renderer, scene, camera ---------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1420);
scene.fog = new THREE.Fog(0x0b1420, 18, 60);
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
camera.position.set(4.8, 2.6, -5.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.495;
controls.target.set(0, 0.6, 0);

scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x1a2230, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(-6, 10, -4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0x4fb3ff, 0.9);
rim.position.set(5, 3, 8);
scene.add(rim);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x0f1a27, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(120, 120, 0x2d4460, 0x172434);
grid.position.y = 0.002;
scene.add(grid);

// ---- materials -----------------------------------------------------------------------------------------------
const M = {
  body: new THREE.MeshPhysicalMaterial({ color: 0x2a4766, metalness: 0.3, roughness: 0.35, transparent: true, opacity: 0.42, clearcoat: 0.6, depthWrite: false }),
  cabin: new THREE.MeshPhysicalMaterial({ color: 0x9fc6ec, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.85 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb7c5d5, metalness: 0.85, roughness: 0.25 }),
  spring: new THREE.MeshStandardMaterial({ color: 0xf0b35a, metalness: 0.6, roughness: 0.3 }),
  damper: new THREE.MeshStandardMaterial({ color: 0x93a4ba, metalness: 0.8, roughness: 0.3 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x5b6b80, metalness: 0.7, roughness: 0.4 }),
  comA: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
  comB: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }),
};

class Helix extends THREE.Curve {
  constructor(r, turns) { super(); this.r = r; this.turns = turns; }
  getPoint(t, target = new THREE.Vector3()) {
    const a = t * this.turns * Math.PI * 2;
    return target.set(this.r * Math.cos(a), t, this.r * Math.sin(a));
  }
}

// ---- model ---------------------------------------------------------------------------------------------------
let car = null, model = null, parts = [], wheels = [], springs = [], body = null, bodyPivot = null, comMesh = null;
let selected = null, hovered = null, spin = 0, exaggerate = 3, autoRotate = false, framed = false;

function tag(obj, part) { obj.traverse(o => { o.userData.part = part; if (o.isMesh) { o.castShadow = true; parts.push(o); } }); }

function build() {
  if (model) { scene.remove(model); model.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  parts = []; wheels = []; springs = [];
  model = new THREE.Group();
  scene.add(model);
  if (!car) return;
  const com = car.com, zs = car.axles.map(a => a.z - com[2]);
  const maxR = Math.max(...car.axles.map(a => a.radius));
  const front = Math.max(...zs) + maxR + 0.55, rear = Math.min(...zs) - maxR - 0.6;
  const halfW = Math.max(...car.axles.map(a => a.track)) / 2 + 0.12;
  const bottom = maxR * 0.85, height = Math.max(0.45, car.h * 1.55 + 0.2 - bottom);

  // body pivots about the CoM so pitch / roll look right
  bodyPivot = new THREE.Group();
  bodyPivot.position.set(-com[0], car.h, 0);
  model.add(bodyPivot);
  body = new THREE.Group();
  body.position.set(0, -car.h, 0);
  bodyPivot.add(body);
  const shell = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, height * 0.62, front - rear), M.body);
  shell.position.set(0, bottom + height * 0.31, (front + rear) / 2);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.7, height * 0.4, (front - rear) * 0.48), M.cabin);
  cabin.position.set(0, bottom + height * 0.62 + height * 0.2, (front + rear) / 2 - (front - rear) * 0.06);
  const chassis = new THREE.Group();
  chassis.add(shell, cabin);
  tag(chassis, { kind: 'body', label: 'Body', axle: -1 });
  body.add(chassis);
  for (const r of [-1, 1]) {   // frame rails, visible through the shell
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, front - rear - 0.3), M.steel);
    rail.position.set(r * (halfW - 0.35), bottom + 0.04, (front + rear) / 2);
    tag(rail, { kind: 'body', label: 'Body', axle: -1 });
    body.add(rail);
  }

  // centre of mass marker + drop line
  const comG = new THREE.Group();
  const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 12, 0, Math.PI), M.comA);
  const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 12, Math.PI, Math.PI), M.comB);
  comG.add(s1, s2);
  const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, car.h, 6), new THREE.MeshBasicMaterial({ color: 0xe3ebf5, transparent: true, opacity: 0.5 }));
  drop.position.y = -car.h / 2;
  comG.add(drop);
  comG.position.set(0, car.h, 0);
  tag(comG, { kind: 'com', label: 'Centre of mass', axle: -1 });
  body.add(comG);
  comMesh = comG;

  car.axles.forEach((a, i) => {
    const z = a.z - com[2];
    // axle beam (drive)
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, a.track - 0.3, 10), M.steel);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0, a.radius, z);
    tag(beam, { kind: 'drive', label: `Axle ${i + 1} drive`, axle: i });
    model.add(beam);
    if (Math.abs(a.steerMax) > 0.01) {   // steering rack
      const rack = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, a.track - 0.5, 8), M.damper);
      rack.rotation.z = Math.PI / 2;
      rack.position.set(0, a.radius + 0.06, z + 0.22);
      tag(rack, { kind: 'steering', label: `Axle ${i + 1} steering`, axle: i });
      model.add(rack);
    }
    [1, -1].forEach(side => {   // +1 = left wheel
      const x = side * a.track / 2;
      const steer = new THREE.Group();
      steer.position.set(x, a.radius, z);
      model.add(steer);
      const spinG = new THREE.Group();
      steer.add(spinG);
      const w = 0.26;
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(a.radius, a.radius, w, 40, 1, false), M.rubber.clone());
      tyre.rotation.z = Math.PI / 2;
      const tread = new THREE.Mesh(new THREE.TorusGeometry(a.radius - 0.02, 0.025, 8, 40), M.rubber.clone());
      tread.rotation.y = Math.PI / 2;
      const tyreG = new THREE.Group();
      tyreG.add(tyre, tread);
      tag(tyreG, { kind: 'tyre', label: `Axle ${i + 1} tyre`, axle: i, side });
      const rimM = new THREE.Mesh(new THREE.CylinderGeometry(a.radius * 0.62, a.radius * 0.62, w + 0.02, 24), M.rim);
      rimM.rotation.z = Math.PI / 2;
      const spokes = new THREE.Group();
      for (let k = 0; k < 5; k++) {
        const sp = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, a.radius * 0.1, a.radius * 1.15), M.steel);
        sp.rotation.x = k * Math.PI / 5;
        spokes.add(sp);
      }
      const rimG = new THREE.Group();
      rimG.add(rimM, spokes);
      tag(rimG, { kind: 'wheel', label: `Axle ${i + 1} wheel`, axle: i, side });
      spinG.add(tyreG, rimG);
      // contact patch and force arrow
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.55 }));
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, 0.006, z);
      model.add(patch);
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(x, 0.03, z), 0.5, 0x4fc3f7, 0.16, 0.1);
      model.add(arrow);
      // spring + damper (inboard of the wheel, between hub and body)
      const sx = x - side * 0.32;
      const coil = new THREE.Mesh(new THREE.TubeGeometry(new Helix(0.075, 7), 160, 0.012, 6, false), M.spring);
      const damp = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1, 10), M.damper);
      damp.position.y = 0.5;
      const sg = new THREE.Group();
      sg.add(coil, damp);
      sg.position.set(sx, a.radius, z);
      tag(sg, { kind: 'spring', label: `Axle ${i + 1} suspension`, axle: i, side });
      model.add(sg);
      // alignment, drawn x2 so a degree reads: camber leans the wheel top in, toe turns its front in
      const al = a.align || {}, AX = 2 * Math.PI / 180;
      const hub = new THREE.Group();
      spinG.parent.add(hub);
      hub.add(spinG);
      hub.rotation.z = side * Math.abs(al.camber || 0) * AX;
      if (al.hasKingpin || Math.abs(a.steerMax) > 0.01) {
        const kp = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, a.radius * 2.3, 6), new THREE.MeshBasicMaterial({ color: 0x5ed6a0 }));
        kp.position.x = -side * 0.05;
        kp.rotation.set(-Math.abs(al.caster || 0) * AX, 0, side * Math.abs(al.sai || 0) * AX);   // top leans back (caster) and in (SAI)
        steer.add(kp);
        tag(kp, { kind: 'align', label: `Axle ${i + 1} alignment`, axle: i, side });
      }
      wheels.push({ i, side, a, steer, spinG, tyre, tread, patch, arrow, toe: -side * Math.abs(al.toe || 0) * AX });   // toe-in: fronts turn inward
      springs.push({ i, side, a, sg, top: new THREE.Vector3(sx, bottom, z) });
    });
  });
  if (!framed) frame();
}

function frame() {
  if (!car) return;
  const zs = car.axles.map(a => a.z - car.com[2]), len = Math.max(...zs) - Math.min(...zs) + 2;
  controls.target.set(0, car.h * 0.8, 0);
  camera.position.set(len * 1.05, len * 0.55, -len * 1.2);
  controls.update();
  framed = true;
}

// ---- per frame -------------------------------------------------------------------------------------------------
const tmp = new THREE.Vector3();
function animate(dt) {
  if (!car || !model) return;
  const fr = UI.frame();
  const axles = (fr && fr.axles) || [];
  // per-wheel suspension compression from load change (exaggerated so it reads on screen)
  const comp = car.axles.map((a, i) => [0, 1].map(k => {
    const L = axles[i] && axles[i].loads ? axles[i].loads[k] : car.static[i] / 2;
    return clamp((L - car.static[i] / 2) / a.spring, -a.travelDown, a.travelUp) * exaggerate;
  }));
  const zs = car.axles.map(a => a.z - car.com[2]);
  const iF = zs.indexOf(Math.max(...zs)), iR = zs.indexOf(Math.min(...zs));
  const meanF = (comp[iF][0] + comp[iF][1]) / 2, meanR = (comp[iR][0] + comp[iR][1]) / 2;
  const pitch = car.axles.length > 1 ? Math.atan2(meanF - meanR, zs[iF] - zs[iR]) : 0;
  const track = car.axles[0].track;
  const left = comp.reduce((s, c) => s + c[0], 0) / comp.length, right = comp.reduce((s, c) => s + c[1], 0) / comp.length;
  const roll = Math.atan2(right - left, track);
  const mean = comp.flat().reduce((s, v) => s + v, 0) / (comp.length * 2);
  bodyPivot.position.y = car.h - mean;
  bodyPivot.rotation.set(pitch, 0, roll);
  bodyPivot.updateMatrixWorld(true);

  const U = fr ? fr.U || 0 : 0;
  spin += U * dt;
  wheels.forEach(w => {
    const af = axles[w.i] || {}, k = w.side > 0 ? 0 : 1;
    w.steer.rotation.y = (af.steer || 0) + (w.toe || 0);
    w.spinG.rotation.x = spin / w.a.radius;
    const use = af.use ? af.use[k] || 0 : 0, load = af.loads ? af.loads[k] : car.static[w.i] / 2;
    const col = useColor(use);
    w.patch.material.color.copy(col);
    const sc = clamp(Math.sqrt(load / (car.static[w.i] / 2 || 1)), 0.2, 1.8);
    w.patch.scale.set(sc, sc, sc);
    w.tread.material.color.copy(col).multiplyScalar(0.55);
    let dir = null;
    if (UI.scenario() === 'corner' && af.Fy) dir = new THREE.Vector3(Math.sign(af.Fy), 0, 0);
    else if (UI.scenario() === 'brake') dir = new THREE.Vector3(0, 0, -1);
    else if (UI.scenario() === 'launch' && use > 0) dir = new THREE.Vector3(0, 0, 1);
    w.arrow.visible = !!dir && use > 0.02;
    if (dir) { w.arrow.setDirection(dir); w.arrow.setLength(Math.max(0.05, 0.9 * Math.min(1.1, use)), 0.16, 0.1); w.arrow.setColor(col); }
  });
  springs.forEach(s => {
    // the spring runs from the hub (wheel stays on the ground) to its mount on the moving body
    body.localToWorld(tmp.copy(s.top));
    model.worldToLocal(tmp);
    const len = Math.max(0.05, tmp.y - s.a.radius);
    s.sg.scale.set(1, len, 1);
  });
}

// ---- picking ---------------------------------------------------------------------------------------------------
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function pick(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  // the body shell is see-through: a component behind it (wheel, spring, CoM...) wins over the shell
  const hits = ray.intersectObjects(parts, false);
  const inner = hits.find(h => h.object.userData.part.kind !== 'body');
  const hit = inner || hits[0];
  return hit ? hit.object.userData.part : null;
}
function samePart(a, b) { return a && b && a.kind === b.kind && a.axle === b.axle; }
function glow(part, amount) {
  parts.forEach(m => {
    if (!m.material.emissive) return;
    const p = m.userData.part;
    const on = (samePart(p, selected) ? 0.35 : 0) + (samePart(p, part) ? amount : 0);
    m.material.emissive.setHex(on ? 0x4fb3ff : 0x000000);
    m.material.emissiveIntensity = on;
  });
}
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; autoRotate = false; });
renderer.domElement.addEventListener('pointermove', e => {
  const p = pick(e);
  if (!samePart(p, hovered)) { hovered = p; glow(p, 0.25); }
  renderer.domElement.style.cursor = p ? 'pointer' : 'grab';
  if (p) {
    const r = host.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = (e.clientX - r.left + 14) + 'px';
    tip.style.top = (e.clientY - r.top + 12) + 'px';
    tip.innerHTML = UI.partSummary(p);
  } else tip.hidden = true;
});
renderer.domElement.addEventListener('pointerleave', () => { tip.hidden = true; hovered = null; glow(null, 0); });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;   // a drag, not a click
  const p = pick(e);
  select(p);
});
function select(p) {
  selected = p;
  glow(hovered, 0.25);
  panel.innerHTML = '';
  panel.hidden = !p;
  if (p) {
    panel.appendChild(UI.partPanel(p));
    UI.refresh();
  }
}

// ---- toolbar ---------------------------------------------------------------------------------------------------
document.getElementById('c3-reset').addEventListener('click', () => { framed = false; frame(); });
document.getElementById('c3-rotate').addEventListener('click', e => { autoRotate = !autoRotate; e.currentTarget.setAttribute('aria-pressed', autoRotate); });
document.getElementById('c3-exag').addEventListener('click', e => { exaggerate = exaggerate === 3 ? 1 : 3; e.currentTarget.setAttribute('aria-pressed', exaggerate === 3); });
for (const id of ['top', 'side', 'front']) {
  document.getElementById('c3-' + id).addEventListener('click', () => {
    if (!car) return;
    const d = camera.position.distanceTo(controls.target);
    const t = controls.target;
    if (id === 'top') camera.position.set(t.x + 0.01, t.y + d, t.z);
    if (id === 'side') camera.position.set(t.x + d, t.y + 0.4, t.z);
    if (id === 'front') camera.position.set(t.x, t.y + 0.5, t.z + d);
    controls.update();
  });
}

// ---- loop ------------------------------------------------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (host.offsetParent !== null) {           // only while the 3D view is showing
    const w = host.clientWidth, h = host.clientHeight;
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    const c = UI.car();
    if (c && c !== car) { car = c; build(); if (selected) glow(hovered, 0.25); }
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.8;
    controls.update();
    animate(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

globalThis.TireTune3D = { select, frame, pickAt: (x, y) => pick({ clientX: x, clientY: y }),
  debug: () => ({ parts: parts.length, inModel: parts.filter(p => { let o = p; while (o.parent) o = o.parent; return o === scene; }).length,
    cam: camera.position.toArray().map(v => +v.toFixed(2)), aspect: camera.aspect, canvas: [renderer.domElement.width, renderer.domElement.height] }) };
