// TireTune vehicle stage: animated SVG top view (wheels, friction circles, force vectors, trail vs original) and
// side view (springs, travel, pitch / roll). Car-centred camera: the world scrolls under the car.
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = 1000, TOP_H = 430, SIDE_Y = 440, SIDE_H = 170;
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // utilisation 0..1+ -> colour (calm teal -> amber -> red)
  function useColor(u) {
    const stops = [[0, [79, 195, 247]], [0.65, [94, 214, 160]], [0.85, [240, 179, 90]], [1, [239, 109, 120]]];
    u = clamp(u, 0, 1.05);
    for (let i = 1; i < stops.length; i++) {
      if (u <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (u - a) / (b - a);
        return `rgb(${ca.map((c, k) => Math.round(lerp(c, cb[k], t))).join(',')})`;
      }
    }
    return 'rgb(239,109,120)';
  }

  class Stage {
    constructor(svg) {
      this.svg = svg;
      svg.setAttribute('viewBox', `0 0 ${W} ${SIDE_Y + SIDE_H}`);
      this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.frames = []; this.ghost = []; this.t = 0; this.playing = !this.reduced; this.speed = 1;
      this.onFrame = null;           // (phase 0..1, frame) after every draw
      this.last = performance.now();
      this.build();
      requestAnimationFrame(now => this.tick(now));
    }

    build() {
      const s = this.svg;
      s.innerHTML = '';
      const defs = el('defs', {}, s);
      const mk = el('marker', { id: 'tt-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
      el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'currentColor' }, mk);
      const clipTop = el('clipPath', { id: 'tt-clip-top' }, defs);
      el('rect', { x: 0, y: 0, width: W, height: TOP_H, rx: 14 }, clipTop);

      el('rect', { x: 0, y: 0, width: W, height: TOP_H, rx: 14, class: 'stage-bg' }, s);
      this.top = el('g', { 'clip-path': 'url(#tt-clip-top)' }, s);
      this.grid = el('g', { class: 'stage-grid' }, this.top);
      this.ghostPath = el('path', { class: 'trail ghost' }, this.top);
      this.trailPath = el('path', { class: 'trail' }, this.top);
      this.car = el('g', { class: 'car' }, this.top);
      this.hud = el('g', { class: 'hud' }, s);

      el('rect', { x: 0, y: SIDE_Y, width: W, height: SIDE_H, rx: 14, class: 'stage-bg' }, s);
      this.side = el('g', {}, s);
      el('text', { x: 18, y: 26, class: 'stage-label' }, s).textContent = 'TOP';
      el('text', { x: 18, y: SIDE_Y + 24, class: 'stage-label' }, s).textContent = 'SIDE';
    }

    // car: TireTuneSim car; frames: scenario frames; ghost: frames of the original setup (corner only)
    setScene(car, frames, ghost, kind) {
      // keep the playback phase across edits so the picture morphs instead of restarting; with reduced motion (or
      // first load while paused) park on a representative moment: the settled corner, mid-stop, mid-launch
      const first = !this.frames.length || kind !== this.kind;
      const keepPhase = !first ? this.t / this.duration() : (this.playing ? 0 : (kind === 'corner' ? 0.92 : 0.45));
      this.carDef = car; this.frames = frames || []; this.ghost = ghost || []; this.kind = kind;
      this.t = clamp(keepPhase, 0, 1) * this.duration();
      this.layoutCar();
      if (!this.playing) this.draw(this.frameAt(this.t));
    }

    duration() { return this.frames.length ? this.frames[this.frames.length - 1].t + (this.kind === 'corner' ? 0 : 1.0) : 1; }

    frameAt(t) {
      const f = this.frames;
      if (!f.length) return null;
      if (t >= f[f.length - 1].t) return f[f.length - 1];
      let lo = 0, hi = f.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m].t <= t) lo = m; else hi = m; }
      return f[lo];
    }

    play(on) { this.playing = on; this.last = performance.now(); }
    seek(p) { this.t = clamp(p, 0, 1) * this.duration(); this.draw(this.frameAt(this.t)); }

    tick(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.playing && this.frames.length) {
        this.t += dt * this.speed;
        if (this.t > this.duration()) this.t = 0;
        this.draw(this.frameAt(this.t));
      }
      requestAnimationFrame(n => this.tick(n));
    }

    // ---- static car geometry ------------------------------------------------------------------------------------
    layoutCar() {
      const c = this.carDef;
      if (!c) return;
      const zs = c.axles.map(a => a.z), maxR = Math.max(...c.axles.map(a => a.radius));
      this.front = Math.max(...zs) + maxR + 0.55;
      this.rear = Math.min(...zs) - maxR - 0.6;
      this.halfW = Math.max(...c.axles.map(a => a.track)) / 2 + 0.16;
      const len = this.front - this.rear;
      this.scale = Math.min(620 / len, 300 / (this.halfW * 2 + 1.1));
      this.cx = W * 0.47; this.cy = TOP_H * 0.53;
      this.sideScale = Math.min(700 / len, 128 / (c.h * 2 + 0.35));
      this.buildCarShapes();
      this.buildSide();
    }

    // car frame (fwd metres, left metres, relative to CoM) -> screen
    toScreen(fwd, left) { return [this.cx + fwd * this.scale, this.cy - left * this.scale]; }

    buildCarShapes() {
      const c = this.carDef, g = this.car, s = this.scale, com = c.com;
      g.innerHTML = '';
      const [x0, y0] = this.toScreen(this.front - com[2], this.halfW);
      const [x1, y1] = this.toScreen(this.rear - com[2], -this.halfW);
      el('rect', { x: x1, y: y0, width: x0 - x1, height: y1 - y0, rx: 0.32 * s, class: 'body' }, g);
      const cab = (this.front - this.rear) * 0.28;
      const [wx] = this.toScreen(this.front - com[2] - cab, 0);
      el('path', { d: `M${wx},${y0 + 0.16 * s} Q${wx + 0.18 * s},${this.cy} ${wx},${y1 - 0.16 * s}`, class: 'body-line' }, g);
      el('path', { d: `M${x0 - 0.35 * s},${this.cy - 0.18 * s} L${x0 - 0.12 * s},${this.cy} L${x0 - 0.35 * s},${this.cy + 0.18 * s}`, class: 'body-chevron' }, g);
      this.wheelEls = c.axles.map(a => {
        const [ax] = this.toScreen(a.z - com[2], 0);
        el('line', { x1: ax, x2: ax, y1: this.cy - a.track / 2 * s, y2: this.cy + a.track / 2 * s, class: 'axle-line' }, g);
        return [1, -1].map(side => {
          const [wx2, wy] = this.toScreen(a.z - com[2], side * a.track / 2);
          const grp = el('g', { transform: `translate(${wx2},${wy})` }, g);
          const ring = el('circle', { r: 0.62 * s, class: 'fric-ring' }, grp);
          const spin = el('g', {}, grp);
          const tyre = el('rect', { x: -a.radius * s, y: -0.13 * s, width: a.radius * 2 * s, height: 0.26 * s, rx: 0.06 * s, class: 'tyre' }, spin);
          const vec = el('line', { x1: 0, y1: 0, x2: 0, y2: 0, class: 'force', 'marker-end': 'url(#tt-arrow)' }, grp);
          const label = el('text', { x: 0, y: side > 0 ? -0.75 * s : 0.75 * s + 10, class: 'wheel-label', 'text-anchor': 'middle' }, grp);
          return { grp, ring, spin, tyre, vec, label, side };
        });
      });
      const [cx, cy] = this.toScreen(0, 0);
      const comG = el('g', { transform: `translate(${cx},${cy})`, class: 'com' }, g);
      el('circle', { r: 9 }, comG);
      el('path', { d: 'M0,-9 A9,9 0 0 1 9,0 L0,0 Z M0,9 A9,9 0 0 1 -9,0 L0,0 Z', class: 'com-fill' }, comG);
      this.velVec = el('line', { x1: cx, y1: cy, x2: cx, y2: cy, class: 'vel', 'marker-end': 'url(#tt-arrow)' }, g);
    }

    buildSide() {
      const c = this.carDef, g = this.side, s = this.sideScale;
      g.innerHTML = '';
      const groundY = SIDE_Y + SIDE_H - 26;
      this.sideGround = groundY;
      this.sx = z => W * 0.47 + (z - c.com[2]) * s;
      el('line', { x1: 40, x2: W - 40, y1: groundY, y2: groundY, class: 'ground' }, g);
      this.sideBody = el('g', {}, g);
      const bodyBottom = c.axles.reduce((m, a) => Math.max(m, a.radius), 0) * 1.05;
      this.bodyBottom = bodyBottom;
      const top = c.h * 2 + 0.25;
      el('rect', { x: this.sx(this.rear), y: groundY - top * s, width: (this.front - this.rear) * s,
                   height: (top - bodyBottom) * s, rx: 0.2 * s, class: 'side-body' }, this.sideBody);
      el('circle', { cx: this.sx(c.com[2]), cy: groundY - c.h * s, r: 6, class: 'com-dot' }, this.sideBody);
      this.sideAxles = c.axles.map(a => {
        const x = this.sx(a.z);
        const spring = el('path', { class: 'spring' }, g);
        const travel = el('path', { class: 'travel' }, g);
        const wheel = el('circle', { cx: x, cy: groundY - a.radius * s, r: a.radius * s, class: 'tyre-side' }, g);
        const hub = el('circle', { cx: x, cy: groundY - a.radius * s, r: 3.5, class: 'hub' }, g);
        const label = el('text', { x, y: groundY + 18, class: 'wheel-label', 'text-anchor': 'middle' }, g);
        return { spring, travel, wheel, hub, label, x };
      });
    }

    // ---- per frame ----------------------------------------------------------------------------------------------
    draw(fr) {
      const c = this.carDef;
      if (!c || !fr) return;
      const s = this.scale;
      // world grid scrolls under the car
      const psi = fr.psi || 0, px = fr.x || 0, py = fr.y || 0;
      this.drawGrid(px, py, psi);
      if (this.kind === 'corner') {
        this.trailPath.setAttribute('d', this.pathFor(this.frames, fr, px, py, psi));
        this.ghostPath.setAttribute('d', this.ghost.length ? this.pathFor(this.ghost, fr, px, py, psi) : '');
      } else {
        this.trailPath.setAttribute('d', ''); this.ghostPath.setAttribute('d', '');
      }
      const axles = fr.axles || [];
      this.wheelEls.forEach((pair, i) => {
        const af = axles[i] || {};
        pair.forEach((w, k) => {
          const use = af.use ? af.use[k] : 0;
          const load = af.loads ? af.loads[k] : 0;
          const col = useColor(use);
          w.tyre.setAttribute('fill', col);
          w.ring.setAttribute('stroke', col);
          w.ring.setAttribute('r', (0.36 + 0.28 * clamp(load / (c.static[i] / 2 || 1), 0, 2) / 2) * s * 1.2);
          const steerDeg = (af.steer || 0) * 180 / Math.PI;
          w.spin.setAttribute('transform', `rotate(${-steerDeg})`);
          // force vector: lateral (corner) or longitudinal (brake / launch), length = utilisation of the circle
          let fx = 0, fy = 0;
          const R = 0.62 * s * clamp(use, 0, 1.1);
          if (this.kind === 'corner') fy = -Math.sign(af.Fy || 0) * R;
          else if (this.kind === 'brake') fx = -R;
          else fx = R;
          w.vec.setAttribute('x2', fx); w.vec.setAttribute('y2', fy);
          w.vec.setAttribute('stroke', col); w.vec.style.color = col;
          const locked = af.wheels && af.wheels[k] && af.wheels[k].locked;
          w.label.textContent = `${(load / 1000).toFixed(1)} kN${locked ? '  LOCK' : ''}`;
          w.label.classList.toggle('lock', !!locked);
        });
      });
      // velocity vector at the CoM (shows body slip angle in corners)
      const [cx, cy] = this.toScreen(0, 0);
      const U = fr.U || 0, v = fr.v || 0, vs = 4.2;
      this.velVec.setAttribute('x2', cx + U * vs); this.velVec.setAttribute('y2', cy - v * vs);
      this.drawSide(fr);
      if (this.onFrame) this.onFrame(this.t / this.duration(), fr);
    }

    drawGrid(px, py, psi) {
      const g = this.grid, s = this.scale, step = 2;
      if (!this.gridLines) {
        this.gridLines = [];
        for (let i = 0; i < 60; i++) this.gridLines.push(el('line', { class: i % 5 ? 'gl' : 'gl major' }, g));
      }
      const span = 30, cos = Math.cos(-psi), sin = Math.sin(-psi);
      const ox = Math.floor(px / step) * step, oy = Math.floor(py / step) * step;
      let n = 0;
      const toCar = (wx, wy) => { const dx = wx - px, dy = wy - py; return this.toScreen(dx * cos - dy * sin, dx * sin + dy * cos); };
      for (let k = -15; k < 15 && n < 60; k++) {
        const a = toCar(ox + k * step, oy - span), b = toCar(ox + k * step, oy + span);
        const l = this.gridLines[n++];
        l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]);
        l.setAttribute('class', Math.round((ox + k * step) / step) % 5 ? 'gl' : 'gl major');
      }
      for (let k = -15; k < 15 && n < 60; k++) {
        const a = toCar(ox - span, oy + k * step), b = toCar(ox + span, oy + k * step);
        const l = this.gridLines[n++];
        l.setAttribute('x1', a[0]); l.setAttribute('y1', a[1]); l.setAttribute('x2', b[0]); l.setAttribute('y2', b[1]);
        l.setAttribute('class', Math.round((oy + k * step) / step) % 5 ? 'gl' : 'gl major');
      }
    }

    pathFor(frames, cur, px, py, psi) {
      const cos = Math.cos(-psi), sin = Math.sin(-psi);
      let d = '';
      const upto = frames === this.frames ? cur.t : frames[frames.length - 1].t;
      for (const f of frames) {
        if (f.t > upto + 1e-6) break;
        const dx = f.x - px, dy = f.y - py;
        const [sx, sy] = this.toScreen(dx * cos - dy * sin, dx * sin + dy * cos);
        d += (d ? 'L' : 'M') + sx.toFixed(1) + ',' + sy.toFixed(1);
      }
      return d;
    }

    drawSide(fr) {
      const c = this.carDef, s = this.sideScale, gy = this.sideGround, axles = fr.axles || [];
      // suspension compression per axle from load change (springs in parallel, clamped to travel)
      const comp = c.axles.map((a, i) => {
        const L = axles[i] && axles[i].loads ? axles[i].loads[0] + axles[i].loads[1] : c.static[i];
        return clamp((L - c.static[i]) / (2 * a.spring), -a.travelDown, a.travelUp);
      });
      const zs = c.axles.map(a => a.z);
      let pitch = 0;
      if (c.axles.length > 1) {
        const i0 = zs.indexOf(Math.max(...zs)), i1 = zs.indexOf(Math.min(...zs));
        pitch = Math.atan2(comp[i0] - comp[i1], zs[i0] - zs[i1]);   // + nose down
      }
      const exaggerate = 3;
      const deg = pitch * 180 / Math.PI * exaggerate;
      const meanComp = comp.reduce((a, b) => a + b, 0) / comp.length;
      this.sideBody.setAttribute('transform', `translate(0 ${meanComp * s * exaggerate}) rotate(${deg} ${this.sx(c.com[2])} ${gy - c.h * s})`);
      c.axles.forEach((a, i) => {
        const e = this.sideAxles[i], hubY = gy - a.radius * s;
        // body underside above this axle, following the body group's translate + rotate
        const bodyY = gy - this.bodyBottom * s + meanComp * exaggerate * s
          + (this.sx(a.z) - this.sx(c.com[2])) * Math.tan(deg * Math.PI / 180);
        const top = Math.min(bodyY, hubY - 6), len = hubY - top, coils = 7, w = 7;
        let d = `M${e.x},${top}`;
        for (let k = 1; k <= coils * 2; k++) d += `L${e.x + (k % 2 ? w : -w)},${top + len * k / (coils * 2 + 1)}`;
        d += `L${e.x},${hubY}`;
        e.spring.setAttribute('d', d);
        const up = a.travelUp * s * exaggerate, dn = a.travelDown * s * exaggerate, tx = e.x + a.radius * s + 10;
        e.travel.setAttribute('d', `M${tx},${hubY - up}h6M${tx + 3},${hubY - up}V${hubY + dn}M${tx},${hubY + dn}h6M${tx - 2},${hubY - comp[i] * s * exaggerate}h10`);
        const u = axles[i] && axles[i].use ? Math.max(...axles[i].use) : 0;
        e.wheel.setAttribute('stroke', useColor(u));
        e.label.textContent = `${(comp[i] * 1000).toFixed(0)} mm`;
      });
    }
  }

  globalThis.TireTuneStage = { Stage, useColor };
})();
