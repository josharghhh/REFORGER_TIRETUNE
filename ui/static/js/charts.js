// TireTune force-curve chart (SVG): current curves per axle, the original setup as a ghost, an optional stock
// preset overlay, hover readout and a live operating-point marker driven by the animation.
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const W = 520, H = 250, M = { l: 52, r: 14, t: 16, b: 34 };

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  class Chart {
    constructor(svg, opts) {
      this.svg = svg; this.opts = opts;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      svg.innerHTML = '';
      this.gAxes = el('g', { class: 'ch-axes' }, svg);
      this.gSeries = el('g', {}, svg);
      this.marker = el('g', { class: 'ch-marker' }, svg);
      this.hover = el('g', { class: 'ch-hover', visibility: 'hidden' }, svg);
      this.hoverLine = el('line', { y1: M.t, y2: H - M.b }, this.hover);
      this.hoverText = el('text', { y: M.t + 12 }, this.hover);
      svg.addEventListener('pointermove', e => this.onHover(e));
      svg.addEventListener('pointerleave', () => this.hover.setAttribute('visibility', 'hidden'));
      this.series = [];
    }

    x(v) { return M.l + (v - this.x0) / (this.x1 - this.x0) * (W - M.l - M.r); }
    y(v) { return H - M.b - (v / this.yMax) * (H - M.t - M.b); }

    // series: [{name, color, pts:[[x,y]], ghost?, dash?}]
    set(series, x0, x1) {
      this.series = series; this.x0 = x0; this.x1 = x1;
      const ymax = Math.max(1, ...series.flatMap(s => s.pts.map(p => Math.abs(p[1]))));
      const target = niceMax(ymax * 1.08);
      // ease the axis scale so curves glide instead of jumping when values change
      this.yMax = this.yMax ? this.yMax + (target - this.yMax) * 0.5 : target;
      if (Math.abs(this.yMax - target) / target < 0.02) this.yMax = target;
      this.drawAxes();
      const g = this.gSeries;
      while (g.childNodes.length < series.length) el('path', {}, g);
      while (g.childNodes.length > series.length) g.removeChild(g.lastChild);
      series.forEach((s, i) => {
        const p = g.childNodes[i];
        p.setAttribute('d', s.pts.map((q, k) => (k ? 'L' : 'M') + this.x(q[0]).toFixed(1) + ',' + this.y(Math.abs(q[1])).toFixed(1)).join(''));
        p.setAttribute('class', 'ch-line' + (s.ghost ? ' ghost' : '') + (s.preset ? ' preset' : ''));
        p.setAttribute('stroke', s.color);
      });
      if (Math.abs(this.yMax - target) > 1e-6) requestAnimationFrame(() => this.set(this.series, this.x0, this.x1));
    }

    drawAxes() {
      const g = this.gAxes, o = this.opts;
      g.innerHTML = '';
      for (let i = 0; i <= 4; i++) {
        const v = this.yMax * i / 4, y = this.y(v);
        el('line', { x1: M.l, x2: W - M.r, y1: y, y2: y, class: 'ch-grid' }, g);
        el('text', { x: M.l - 8, y: y + 4, 'text-anchor': 'end' }, g).textContent = (v / 1000).toFixed(v / 1000 >= 10 ? 0 : 1);
      }
      const steps = 7;
      for (let i = 0; i <= steps; i++) {
        const v = this.x0 + (this.x1 - this.x0) * i / steps, x = this.x(v);
        el('text', { x, y: H - M.b + 16, 'text-anchor': 'middle' }, g).textContent = v.toFixed(o.xDigits ?? 0);
      }
      el('text', { x: W - M.r, y: H - 4, 'text-anchor': 'end', class: 'ch-title' }, g).textContent = o.xLabel;
      el('text', { x: 12, y: M.t + 2, class: 'ch-title' }, g).textContent = o.yLabel;
    }

    // live operating point(s): [{x, color}] placed on the matching current series
    mark(points) {
      const g = this.marker;
      while (g.childNodes.length < points.length) el('circle', { r: 5 }, g);
      while (g.childNodes.length > points.length) g.removeChild(g.lastChild);
      points.forEach((p, i) => {
        const s = this.series.find(q => q.name === p.series);
        const c = g.childNodes[i];
        if (!s || p.x == null) { c.setAttribute('visibility', 'hidden'); return; }
        const yv = interp(s.pts, clampX(p.x, this.x0, this.x1));
        c.setAttribute('visibility', 'visible');
        c.setAttribute('cx', this.x(clampX(p.x, this.x0, this.x1)));
        c.setAttribute('cy', this.y(Math.abs(yv)));
        c.setAttribute('fill', s.color);
      });
    }

    onHover(e) {
      if (!this.series.length) return;
      const r = this.svg.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width * W;
      const v = this.x0 + (px - M.l) / (W - M.l - M.r) * (this.x1 - this.x0);
      if (v < this.x0 || v > this.x1) { this.hover.setAttribute('visibility', 'hidden'); return; }
      this.hover.setAttribute('visibility', 'visible');
      const x = this.x(v);
      this.hoverLine.setAttribute('x1', x); this.hoverLine.setAttribute('x2', x);
      const parts = this.series.filter(s => !s.ghost && !s.preset).map(s => `${s.name} ${(Math.abs(interp(s.pts, v)) / 1000).toFixed(2)} kN`);
      this.hoverText.textContent = `${v.toFixed(this.opts.xDigits ?? 1)}${this.opts.xUnit}  ${parts.join('   ')}`;
      const tw = Math.min(W - M.r - 4, x + 8);
      this.hoverText.setAttribute('x', x > W * 0.6 ? x - 8 : tw);
      this.hoverText.setAttribute('text-anchor', x > W * 0.6 ? 'end' : 'start');
    }
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

  globalThis.TireTuneChart = { Chart };
})();
