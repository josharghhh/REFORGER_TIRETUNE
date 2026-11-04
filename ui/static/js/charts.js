// TireTune chart (SVG): current curves, the original setup as a ghost, optional preset overlay, shaded bands,
// labelled marker lines, hover readout and a live operating-point marker. Used full size (force curves) and small
// inside every setup card (spring, damper, brake, steering, each Pacejka group).
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  const clampX = (v, a, b) => Math.max(a, Math.min(b, v));
  function interp(pts, x) {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= x) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], t = (x - x0) / ((x1 - x0) || 1);
        return y0 + (y1 - y0) * t;
      }
    }
    return pts.length ? pts[pts.length - 1][1] : 0;
  }

  // opts: xLabel, yLabel, xUnit, xDigits, yDiv (axis numbers = value / yDiv, default 1000 for kN), w, h, small
  class Chart {
    constructor(svg, opts) {
      this.svg = svg; this.opts = opts;
      this.W = opts.w || 520; this.H = opts.h || 250;
      this.M = opts.small ? { l: 46, r: 10, t: 14, b: 30 } : { l: 52, r: 14, t: 16, b: 34 };
      svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
      svg.innerHTML = '';
      if (opts.small) svg.classList.add('chart-small');
      this.gBands = el('g', { class: 'ch-bands' }, svg);
      this.gAxes = el('g', { class: 'ch-axes' }, svg);
      this.gMarks = el('g', { class: 'ch-marks' }, svg);
      this.gSeries = el('g', {}, svg);
      this.marker = el('g', { class: 'ch-marker' }, svg);
      this.gHandles = el('g', { class: 'ch-handles' }, svg);
      this.dragging = null;
      this.hover = el('g', { class: 'ch-hover', visibility: 'hidden' }, svg);
      this.hoverLine = el('line', { y1: this.M.t, y2: this.H - this.M.b }, this.hover);
      this.hoverText = el('text', { y: this.M.t + 12 }, this.hover);
      svg.addEventListener('pointermove', e => { if (this.dragging) this.onDrag(e); else this.onHover(e); });
      svg.addEventListener('pointerup', () => this.endDrag());
      svg.addEventListener('pointercancel', () => this.endDrag());
      svg.addEventListener('pointerleave', () => this.hover.setAttribute('visibility', 'hidden'));
      this.series = [];
    }

    x(v) { return this.M.l + (v - this.x0) / ((this.x1 - this.x0) || 1) * (this.W - this.M.l - this.M.r); }
    y(v) { return this.H - this.M.b - (v / this.yMax) * (this.H - this.M.t - this.M.b); }

    // series: [{name, color, pts:[[x,y]], ghost?, preset?, dash?}]; extra: {bands:[{x0,x1,label}], vlines:[{x,label,color}], hlines:[{y,label,color}]}
    set(series, x0, x1, extra = {}) {
      // while a handle is held the axes stay put, so the value under the pointer is the value you get
      if (this.dragging && this.x1 != null) { x0 = this.x0; x1 = this.x1; }
      this.series = series; this.x0 = x0; this.x1 = x1; this.extra = extra;
      const ys = series.flatMap(s => s.pts.map(p => Math.abs(p[1]))).concat((extra.hlines || []).map(h => Math.abs(h.y)));
      let target = niceMax(Math.max(1e-9, ...ys) * 1.08);
      if (this.dragging && this.yMax) target = Math.max(this.yMax, target);
      // ease the axis scale so curves glide instead of jumping when values change
      this.yMax = this.yMax ? this.yMax + (target - this.yMax) * 0.5 : target;
      if (Math.abs(this.yMax - target) / target < 0.02) this.yMax = target;
      this.drawAxes();
      this.drawExtra();
      this.drawHandles(extra.handles || []);
      const g = this.gSeries;
      while (g.childNodes.length < series.length) el('path', {}, g);
      while (g.childNodes.length > series.length) g.removeChild(g.lastChild);
      series.forEach((s, i) => {
        const p = g.childNodes[i];
        p.setAttribute('d', s.pts.map((q, k) => (k ? 'L' : 'M') + this.x(q[0]).toFixed(1) + ',' + this.y(Math.abs(q[1])).toFixed(1)).join(''));
        p.setAttribute('class', 'ch-line' + (s.ghost ? ' ghost' : '') + (s.preset ? ' preset' : '') + (s.thin ? ' thin' : '') + (s.tangent ? ' ch-tangent' : ''));
        p.setAttribute('stroke', s.color);
      });
      if (Math.abs(this.yMax - target) > 1e-9) requestAnimationFrame(() => this.set(this.series, this.x0, this.x1, this.extra));
    }

    drawAxes() {
      const g = this.gAxes, o = this.opts, M = this.M, div = o.yDiv ?? 1000;
      g.innerHTML = '';
      for (let i = 0; i <= 4; i++) {
        const v = this.yMax * i / 4, y = this.y(v), n = v / div;
        el('line', { x1: M.l, x2: this.W - M.r, y1: y, y2: y, class: 'ch-grid' }, g);
        el('text', { x: M.l - 7, y: y + 4, 'text-anchor': 'end' }, g).textContent = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
      }
      const steps = o.small ? 4 : 7;
      for (let i = 0; i <= steps; i++) {
        const v = this.x0 + (this.x1 - this.x0) * i / steps, x = this.x(v);
        el('text', { x, y: this.H - M.b + 15, 'text-anchor': 'middle' }, g).textContent = v.toFixed(o.xDigits ?? 0);
      }
      el('text', { x: this.W - M.r, y: this.H - 3, 'text-anchor': 'end', class: 'ch-title' }, g).textContent = o.xLabel;
      el('text', { x: 6, y: M.t - 2, class: 'ch-title' }, g).textContent = o.yLabel;
    }

    drawExtra() {
      const e = this.extra || {}, M = this.M;
      this.gBands.innerHTML = '';
      this.gMarks.innerHTML = '';
      for (const b of e.bands || []) {
        const a = this.x(clampX(b.x0, this.x0, this.x1)), c = this.x(clampX(b.x1, this.x0, this.x1));
        if (c - a < 0.5) continue;
        el('rect', { x: a, y: M.t, width: c - a, height: this.H - M.t - M.b, class: 'ch-band' + (b.bad ? ' bad' : '') }, this.gBands);
        if (b.label) el('text', { x: (a + c) / 2, y: M.t + 12, 'text-anchor': 'middle', class: 'ch-band-label' }, this.gBands).textContent = b.label;
      }
      for (const v of e.vlines || []) {
        if (v.x < this.x0 || v.x > this.x1) continue;
        const x = this.x(v.x);
        el('line', { x1: x, x2: x, y1: M.t, y2: this.H - M.b, class: 'ch-vline', stroke: v.color || '#93a4ba' }, this.gMarks);
        if (v.label) el('text', { x: x + 4, y: this.H - M.b - 6, class: 'ch-mark-label', fill: v.color || '#93a4ba' }, this.gMarks).textContent = v.label;
      }
      for (const h of e.hlines || []) {
        const y = this.y(Math.abs(h.y));
        el('line', { x1: M.l, x2: this.W - M.r, y1: y, y2: y, class: 'ch-vline', stroke: h.color || '#93a4ba' }, this.gMarks);
        if (h.label) el('text', { x: this.W - M.r - 4, y: y - 5, 'text-anchor': 'end', class: 'ch-mark-label', fill: h.color || '#93a4ba' }, this.gMarks).textContent = h.label;
      }
    }

    // ---- draggable handles: {id, x, y, label, color, axis: 'x'|'y'|'xy', onDrag(x, y), hint} ----------------
    drawHandles(handles) {
      this.handles = handles;
      const g = this.gHandles;
      while (g.childNodes.length < handles.length) {
        const h = el('g', { class: 'ch-handle', tabindex: 0 }, g);
        el('circle', { r: 15, class: 'halo' }, h);
        el('circle', { r: 7.5, class: 'dot' }, h);
        el('text', { class: 'ch-handle-label', y: -14, 'text-anchor': 'middle' }, h);
        h.addEventListener('pointerdown', e => this.startDrag(e, +h.dataset.i));
        h.addEventListener('keydown', e => this.keyNudge(e, +h.dataset.i));
      }
      while (g.childNodes.length > handles.length) g.removeChild(g.lastChild);
      handles.forEach((h, i) => {
        const n = g.childNodes[i];
        n.dataset.i = i;
        const x = this.x(Math.max(this.x0, Math.min(this.x1, h.x))), y = this.y(Math.abs(h.y));
        n.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        n.style.color = h.color || '#e3ebf5';
        n.classList.toggle('active', !!(this.dragging && this.dragging.id === h.id));
        n.setAttribute('aria-label', `${h.label}: ${h.hint || 'drag'}`);
        n.style.cursor = h.axis === 'x' ? 'ew-resize' : h.axis === 'y' ? 'ns-resize' : 'move';
        const t = n.querySelector('text');
        t.textContent = h.label;
        t.setAttribute('text-anchor', x > this.W * 0.75 ? 'end' : x < this.W * 0.2 ? 'start' : 'middle');
        t.setAttribute('y', y < this.M.t + 26 ? 26 : -14);
      });
    }

    toData(e) {
      const r = this.svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * this.W, py = (e.clientY - r.top) / r.height * this.H;
      const x = this.x0 + (px - this.M.l) / (this.W - this.M.l - this.M.r) * (this.x1 - this.x0);
      const y = (this.H - this.M.b - py) / (this.H - this.M.t - this.M.b) * this.yMax;
      return [Math.max(this.x0, Math.min(this.x1, x)), Math.max(0, y)];
    }

    startDrag(e, i) {
      const h = this.handles[i];
      if (!h) return;
      e.preventDefault(); e.stopPropagation();
      // grab relative to the dot, so picking it up never makes it jump
      const [px, py] = this.toData(e);
      this.dragging = { id: h.id, i, ox: h.x - px, oy: Math.abs(h.y) - py };
      try { this.svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      this.svg.classList.add('dragging-handle');
      this.hover.setAttribute('visibility', 'hidden');
    }

    onDrag(e) {
      const h = this.handles && this.handles.find(q => q.id === this.dragging.id);
      if (!h) return;
      const [px, py] = this.toData(e);
      const x = Math.max(this.x0, Math.min(this.x1, px + this.dragging.ox)), y = Math.max(0, py + this.dragging.oy);
      h.onDrag(h.axis === 'y' ? h.x : x, h.axis === 'x' ? h.y : y);
    }

    endDrag() {
      if (!this.dragging) return;
      this.dragging = null;
      this.svg.classList.remove('dragging-handle');
      if (this.onDragEnd) this.onDragEnd();
    }

    // keyboard: arrows nudge a focused handle by 2 % of the axis
    keyNudge(e, i) {
      const h = this.handles[i];
      if (!h) return;
      const dx = (this.x1 - this.x0) * 0.02, dy = this.yMax * 0.02;
      const map = { ArrowUp: [0, dy], ArrowDown: [0, -dy], ArrowRight: [dx, 0], ArrowLeft: [-dx, 0] };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      h.onDrag(h.axis === 'y' ? h.x : h.x + d[0], h.axis === 'x' ? h.y : Math.abs(h.y) + d[1]);
    }

    // live operating point(s): [{series, x}] placed on the matching series
    mark(points) {
      const g = this.marker;
      while (g.childNodes.length < points.length) el('circle', { r: 5 }, g);
      while (g.childNodes.length > points.length) g.removeChild(g.lastChild);
      points.forEach((p, i) => {
        const s = this.series.find(q => q.name === p.series && !q.ghost);
        const c = g.childNodes[i];
        if (!s || p.x == null) { c.setAttribute('visibility', 'hidden'); return; }
        const xv = clampX(p.x, this.x0, this.x1);
        c.setAttribute('visibility', 'visible');
        c.setAttribute('cx', this.x(xv));
        c.setAttribute('cy', this.y(Math.abs(interp(s.pts, xv))));
        c.setAttribute('fill', s.color);
      });
    }

    onHover(e) {
      if (!this.series.length) return;
      const r = this.svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * this.W;
      const v = this.x0 + (px - this.M.l) / (this.W - this.M.l - this.M.r) * (this.x1 - this.x0);
      if (v < this.x0 || v > this.x1) { this.hover.setAttribute('visibility', 'hidden'); return; }
      this.hover.setAttribute('visibility', 'visible');
      const x = this.x(v), div = this.opts.yDiv ?? 1000, unit = this.opts.yUnit ?? 'kN';
      this.hoverLine.setAttribute('x1', x); this.hoverLine.setAttribute('x2', x);
      const parts = this.series.filter(s => !s.ghost && !s.preset && !s.thin).map(s => `${s.name} ${(Math.abs(interp(s.pts, v)) / div).toFixed(2)}${unit ? ' ' + unit : ''}`);
      this.hoverText.textContent = `${v.toFixed(this.opts.xDigits ?? 1)}${this.opts.xUnit || ''}  ${parts.join('   ')}`;
      this.hoverText.setAttribute('x', x > this.W * 0.55 ? x - 8 : x + 8);
      this.hoverText.setAttribute('text-anchor', x > this.W * 0.55 ? 'end' : 'start');
    }
  }

  globalThis.TireTuneChart = { Chart, interp };
})();
