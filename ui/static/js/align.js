// TireTune alignment: camber / toe (wheel hub, WheelPosition Angles) and caster / SAI (KingpinAxes Angles).
// The Angles are relative to each model's pivot bone, so the same number means different things on different models.
// Each value is decoded with the convention the vehicle already uses (see BI's 1.9 vehicle notes: the hub X axis
// faces outward, the kingpin Y axis points up and is tilted a few degrees; set the left side, the game mirrors it):
//   wheel   "x  c  180-t"   roll-flipped hub: camber c, toe t
//   wheel   "x  180+c  t"   yaw-flipped hub:  camber c, toe t
//   kingpin "c  y  s"       upright bone:     caster c, SAI s
//   kingpin "x  c  90+-s"   rolled 90 bone:   caster c, SAI s
//   kingpin "-90+-c  y  s"  pitched 90 bone:  caster c, SAI s
// Edits change only those components and keep BI's sign; anything else is shown read-only.
(() => {
  'use strict';
  const near = (v, t, tol = 12) => Math.abs(v - t) <= tol;
  const wrap = v => { let x = v % 360; if (x > 180) x -= 360; if (x <= -180) x += 360; return x; };
  const sgn = (v, d = 1) => (v < 0 ? -1 : v > 0 ? 1 : d);
  const r2 = v => Math.round(v * 100) / 100;

  function decodeWheel(a) {
    if (!Array.isArray(a)) return { family: 'none' };
    const [x, y, z] = a, yw = wrap(y), zw = wrap(z);
    if (Math.abs(x) < 10 && near(Math.abs(zw), 180) && Math.abs(yw) < 20) return { family: 'roll', camber: yw, toe: 180 - Math.abs(zw), a };
    if (Math.abs(x) < 10 && near(Math.abs(yw), 180) && Math.abs(zw) < 20) return { family: 'yaw', camber: Math.abs(yw) - 180, toe: zw, a };
    return { family: 'other', a };
  }
  // encode by nudging the original number: the component that carries a value moves by however much changes that
  // value (measured), so 182 stays written as 182-ish and -178 as -178-ish, and untouched values keep their text
  const COMP = { roll: { camber: 1, toe: 2 }, yaw: { camber: 1, toe: 2 }, upright: { caster: 0, sai: 2 }, z90: { caster: 1, sai: 2 }, x90: { caster: 0, sai: 2 } };
  function nudge(decode, a, family, key, target) {
    const comp = COMP[family][key], old = decode(a)[key];
    if (Math.abs(target - old) < 1e-9) return a;
    const probe = a.slice(); probe[comp] += 0.01;
    const rate = (decode(probe)[key] - old) / 0.01;
    if (!rate) return a;
    const out = a.slice(); out[comp] = r2(a[comp] + (target - old) / rate);
    return out;
  }
  function encodeWheel(d, camber, toe) {
    if (!COMP[d.family]) return d.a;
    return nudge(decodeWheel, nudge(decodeWheel, d.a, d.family, 'camber', camber), d.family, 'toe', toe);
  }

  function decodeKingpin(a) {
    if (!Array.isArray(a)) return { family: 'none' };
    const [x, y, z] = a.map(wrap);
    if (Math.abs(x) < 25 && Math.abs(y) < 25 && Math.abs(z) < 25) return { family: 'upright', caster: x, sai: z, a };
    if (near(Math.abs(z), 90, 25) && Math.abs(x) < 25) return { family: 'z90', caster: y, sai: Math.abs(z) - 90, a };
    if (near(Math.abs(x), 90, 25) && Math.abs(y) < 25) return { family: 'x90', caster: Math.abs(x) - 90, sai: z, a };
    return { family: 'other', a };
  }
  function encodeKingpin(d, caster, sai) {
    if (!COMP[d.family]) return d.a;
    return nudge(decodeKingpin, nudge(decodeKingpin, d.a, d.family, 'caster', caster), d.family, 'sai', sai);
  }

  // magnitudes for display: the sign is BI's convention for this model, not a left/right direction
  const show = v => `${Math.abs(v).toFixed(2).replace(/0$/, '')}°`;

  // ---- one drag-able diagram -------------------------------------------------------------------------------
  // kind: camber (front view, wheel tilts), toe (top view, wheel turns), caster (side view, axis tilts), sai (front view)
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const INFO = {
    camber: { title: 'Camber', view: 'front view', band: [0.1, 1.5], range: 6, hint: 'Tilt of the wheel. BI: most good setups sit at 0.1-1.5°.' },
    toe: { title: 'Toe', view: 'top view', band: [0, 0.5], range: 4, hint: 'Wheels pointing in or out. Toe-out front = sharper turn-in, toe-in rear = stability.' },
    caster: { title: 'Caster', view: 'side view', band: [3, 6], range: 12, hint: 'Steering axis leaning back: self-centring and steering weight. BI: 3-6°.' },
    sai: { title: 'SAI', view: 'front view', band: [2, 10], range: 15, hint: 'Steering axis leaning in: less scrub, more return-to-centre.' },
  };
  const EX = 4;   // drawn exaggerated so a few degrees read on screen

  function diagram(kind, getValue, setValue, enabled) {
    const info = INFO[kind];
    const wrapEl = document.createElement('div');
    wrapEl.className = 'align-card' + (enabled ? '' : ' disabled');
    wrapEl.innerHTML = `<div class="align-head"><b>${info.title}</b><span>${info.view}</span></div>`;
    const svg = el('svg', { viewBox: '0 0 160 120', class: 'align-svg' }, wrapEl);
    const out = document.createElement('div');
    out.className = 'align-val';
    wrapEl.appendChild(out);
    wrapEl.title = info.hint + (enabled ? ' Drag the dot.' : '');
    el('line', { x1: 10, x2: 150, y1: 104, y2: 104, class: 'al-ground' }, svg);
    el('line', { x1: 80, x2: 80, y1: 8, y2: 104, class: 'al-ref' }, svg);
    const g = el('g', {}, svg);
    if (kind === 'camber') { el('rect', { x: 66, y: 24, width: 28, height: 80, rx: 6, class: 'al-tyre' }, g); el('line', { x1: 80, x2: 80, y1: 30, y2: 98, class: 'al-hub' }, g); }
    if (kind === 'toe') { el('rect', { x: 66, y: 20, width: 28, height: 76, rx: 6, class: 'al-tyre' }, g); el('path', { d: 'M80 26 l-7 10 h14 z', class: 'al-arrow' }, g); }
    if (kind === 'caster' || kind === 'sai') { el('circle', { cx: 80, cy: 70, r: 32, class: 'al-tyre-side' }, svg); el('line', { x1: 80, x2: 80, y1: 14, y2: 104, class: 'al-axis' }, g); }
    const band = el('path', { class: 'al-band' }, svg);
    const dot = el('circle', { r: 7, class: 'al-dot', tabindex: enabled ? 0 : -1 }, svg);
    const pivot = kind === 'camber' ? [80, 104] : kind === 'toe' ? [80, 58] : [80, 70];
    const len = kind === 'toe' ? 38 : kind === 'camber' ? 80 : 56;
    // a sector showing the typical range
    const sector = (a0, a1) => {
      const p = a => [pivot[0] + Math.sin(a * EX * Math.PI / 180) * len, pivot[1] - Math.cos(a * EX * Math.PI / 180) * len];
      const [x0, y0] = p(a0), [x1, y1] = p(a1);
      return `M${pivot[0]} ${pivot[1]} L${x0} ${y0} A${len} ${len} 0 0 1 ${x1} ${y1} Z`;
    };
    band.setAttribute('d', sector(info.band[0], info.band[1]));
    function draw() {
      const v = getValue();
      if (v == null || Number.isNaN(v)) { out.textContent = '-'; dot.setAttribute('visibility', 'hidden'); return; }
      const a = Math.abs(v);
      g.setAttribute('transform', `rotate(${a * EX} ${pivot[0]} ${pivot[1]})`);
      const rad = a * EX * Math.PI / 180;
      dot.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', pivot[0] + Math.sin(rad) * len);
      dot.setAttribute('cy', pivot[1] - Math.cos(rad) * len);
      const inBand = a >= info.band[0] - 1e-6 && a <= info.band[1] + 1e-6;
      out.innerHTML = `<b>${show(v)}</b> <span class="${inBand ? 'ok' : 'warn'}">${inBand ? 'typical' : a < info.band[0] ? 'below typical' : 'above typical'}</span>`;
    }
    if (enabled) {
      let drag = false;
      const at = e => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 160, (e.clientY - r.top) / r.height * 120]; };
      const apply = e => {
        const [x, y] = at(e);
        const ang = Math.atan2(x - pivot[0], pivot[1] - y) * 180 / Math.PI / EX;
        const v = Math.max(0, Math.min(info.range, ang));
        setValue(Math.round(v * 20) / 20);
      };
      dot.addEventListener('pointerdown', e => { drag = true; try { svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } e.preventDefault(); });
      svg.addEventListener('pointermove', e => { if (drag) apply(e); });
      svg.addEventListener('pointerup', () => { if (drag) { drag = false; if (wrapEl.onDragEnd) wrapEl.onDragEnd(); } });
      dot.addEventListener('keydown', e => {
        const d = { ArrowUp: 0.1, ArrowRight: 0.1, ArrowDown: -0.1, ArrowLeft: -0.1 }[e.key];
        if (d == null) return;
        e.preventDefault();
        setValue(Math.max(0, Math.min(info.range, Math.abs(getValue() || 0) + d)));
        if (wrapEl.onDragEnd) wrapEl.onDragEnd();
      });
    }
    wrapEl.draw = draw;
    draw();
    return wrapEl;
  }

  globalThis.TireTuneAlign = { decodeWheel, encodeWheel, decodeKingpin, encodeKingpin, diagram, INFO };
})();
