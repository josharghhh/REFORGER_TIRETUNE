// TireTune auto walkthrough: a filmable demo that drives the real UI.
// A visible cursor glides to each control, a spotlight frames it, clicks ripple, sliders drag smoothly and a
// caption card explains the step. Real edits, so the preview reacts; nothing is written (Review is opened and
// closed, never applied) and everything is reverted at the end.
// Start: the Demo button, or open the page with ?demo=1 (&speed=0.8 slower, 1.3 faster, &from=N start at step N).
// Keys while running: Space pause / resume, Right arrow next step, Esc stop.
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const params = new URLSearchParams(location.search);
  let speed = Math.max(0.3, Math.min(3, +params.get('speed') || 1));

  // ---- overlay (a manual popover: top layer, so it stays above the Review dialog when re-raised) ------------
  const root = document.createElement('div');
  root.id = 'tt-demo';
  root.setAttribute('popover', 'manual');
  root.innerHTML = `
    <div class="d-spot"></div>
    <div class="d-cursor"><svg viewBox="0 0 28 28" width="28" height="28"><path d="M5 3l17 10.5-7.6 1.6 4.6 8.4-3.4 1.8-4.6-8.5L5 22z" fill="#fff" stroke="#0a1018" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="d-ripple"></span></div>
    <div class="d-card" role="status" aria-live="polite">
      <div class="d-bar"><i></i></div>
      <div class="d-head"><span class="d-count"></span><span class="d-title"></span></div>
      <p class="d-text"></p>
      <div class="d-ctrl">
        <button type="button" data-a="pause" title="Pause (Space)">Pause</button>
        <button type="button" data-a="next" title="Next step (Right arrow)">Next</button>
        <button type="button" data-a="stop" title="Stop (Esc)">Stop</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const spot = root.querySelector('.d-spot'), cursor = root.querySelector('.d-cursor'), card = root.querySelector('.d-card');
  const ripple = root.querySelector('.d-ripple');

  let running = false, paused = false, skip = false, stopped = false;
  let cx = innerWidth * 0.5, cy = innerHeight * 0.6;

  function raise() { try { if (root.matches(':popover-open')) root.hidePopover(); root.showPopover(); } catch (e) { /* no popover API */ } }

  // waits that honour pause / skip / stop
  async function wait(ms) {
    const end = performance.now() + ms / speed;
    while (performance.now() < end || paused) {
      if (stopped) throw new Error('stop');
      if (skip) return;
      await sleep(40);
    }
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  async function reveal(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 70 || r.bottom > innerHeight - 170) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); await wait(550); }
  }

  function spotlight(el, pad = 8) {
    if (!el) { spot.style.opacity = '0'; return; }
    const r = rectOf(el);
    Object.assign(spot.style, { opacity: '1', left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.w + pad * 2 + 'px', height: r.h + pad * 2 + 'px' });
    placeCard(r);
  }

  // caption: bottom centre, or top when the spotlight sits low on the screen
  function placeCard(r) {
    const low = r && r.y + r.h > innerHeight - 230;
    card.classList.toggle('top', !!low);
  }

  async function moveTo(x, y, ms = 750) {
    cursor.style.transitionDuration = Math.round(ms / speed) + 'ms';
    cursor.style.transform = `translate(${x}px, ${y}px)`;
    cx = x; cy = y;
    await wait(ms + 60);
  }

  async function press() {
    cursor.classList.remove('click');
    void cursor.offsetWidth;          // restart the click animation
    cursor.classList.add('click');
    await wait(220);
  }

  async function click(sel, opts = {}) {
    const el = typeof sel === 'string' ? $(sel) : sel;
    if (!el) return;
    await reveal(el);
    if (opts.spot !== false) spotlight(el);
    const r = rectOf(el);
    await moveTo(r.cx, r.cy);
    await press();
    el.click();
    await wait(opts.after ?? 450);
  }

  // drag a range input from its value to `to`, the cursor riding the thumb
  async function drag(sel, to, ms = 1600) {
    const el = $(sel);
    if (!el) return;
    await reveal(el);
    spotlight(el.closest('.ctl') || el.closest('label') || el);
    const min = +el.min, max = +el.max, from = +el.value;
    const thumb = v => { const r = rectOf(el); return [r.x + (v - min) / ((max - min) || 1) * r.w, r.cy]; };
    await moveTo(...thumb(from));
    await press();
    const steps = Math.max(12, Math.round(ms / 33));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // ease in-out
      el.value = from + (to - from) * e;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const [x, y] = thumb(+el.value);
      cursor.style.transitionDuration = '0ms';
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cx = x; cy = y;
      await wait(ms / steps);
    }
    await wait(300);
  }

  async function choose(sel, value) {
    const el = $(sel);
    if (!el) return;
    await click(el, { after: 250 });
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(400);
  }

  function say(n, total, title, text) {
    root.querySelector('.d-count').textContent = `${n} / ${total}`;
    root.querySelector('.d-title').textContent = title;
    root.querySelector('.d-text').textContent = text;
    root.querySelector('.d-bar i').style.width = (n / total * 100) + '%';
    card.classList.remove('in'); void card.offsetWidth; card.classList.add('in');
  }

  // reading time for the caption, at the chosen speed
  const read = text => 1400 + text.length * 38;

  // ---- the walkthrough ---------------------------------------------------------------------------------------
  // Each step: title, text, run (async, may use click / drag / choose / spotlight). Selectors that are missing on
  // a given vehicle (no Tyre model, one axle...) are skipped quietly.
  function steps() {
    const preset = [...document.querySelectorAll('#preset-sel option')].map(o => o.value).find(v => v && /car/i.test(v))
      || [...document.querySelectorAll('#preset-sel option')].map(o => o.value).find(Boolean);
    const com = $('#c_rigidBody_CenterOfMass_2');
    const comTo = com ? +com.value - 0.55 : 0;
    const axleCount = document.querySelectorAll('#tab-axles .axle-seg button').length;
    return [
      { title: 'TireTune Workbench', text: 'Tune the 1.9 Pacejka2002 tyres and the chassis of any wheeled vehicle prefab, and see what every change does before you drive it.',
        run: async () => { spotlight(null); await moveTo(innerWidth * 0.5, innerHeight * 0.45, 900); } },
      { title: 'Your vehicle', text: 'The prefab picked in Workbench, with its parent chain. Every value knows whether it comes from this prefab, a config, or the engine default.',
        run: async () => { spotlight($('.vehicle-pick')); await moveTo(rectOf($('#breadcrumb')).cx, rectOf($('#breadcrumb')).cy); } },
      { title: 'Live preview', text: 'Top and side view of your vehicle. Colour shows how much grip each tyre is using, rings are the friction circles, arrows the tyre forces, numbers the wheel loads. The dashed line is your original setup.',
        run: async () => { spotlight($('.stage-wrap'), 4); await moveTo(rectOf($('#stage')).cx, rectOf($('#stage')).y + 150); } },
      { title: 'Handling readouts', text: 'Balance, grip limit on the bend, stopping distance and per-axle ride, each compared with the original setup.',
        run: async () => { spotlight($('#balance')); await moveTo(rectOf($('#balance')).cx, rectOf($('#balance')).cy); } },
      { title: 'Move the weight back', text: 'Shift the centre of mass rearward and watch the weight move: rear tyres load up, the balance changes and the grip limit follows.',
        run: async () => { await click('[data-tab=chassis]'); if (com) await drag('#c_rigidBody_CenterOfMass_2', comTo, 2200); } },
      { title: 'See the effect', text: 'Readouts show the change against the original in green or red, and the axle cards show the new static loads, sag and ride frequency.',
        run: async () => { spotlight($('#axle-metrics')); await moveTo(rectOf($('#axle-metrics')).cx, rectOf($('#axle-metrics')).y + 40); } },
      { title: 'Per-axle setup', text: 'Suspension, wheel, tyre and steering for each axle. Stiffen the rear springs and watch the sag, ride frequency and roll split update.',
        run: async () => {
          await click('[data-tab=axles]');
          if (axleCount > 1) await click('#tab-axles .axle-seg button:nth-child(2)');
          const s = $('#tab-axles input[id$="_Suspension_SpringRate"]');
          if (s) await drag('#' + s.id, Math.min(+s.max, +s.value * 1.6), 1800);
        } },
      { title: 'Tyre model', text: 'The shared Pacejka2002 model with plain-language labels. Compare against a stock BI tyre: its curves appear dotted on the charts.',
        run: async () => { await click('[data-tab=tyre]'); if (preset) await choose('#preset-sel', preset); spotlight($('.charts'), 4); await moveTo(rectOf($('#chart-lat')).cx, rectOf($('#chart-lat')).cy); } },
      { title: 'More grip', text: 'Raise peak lateral grip: the cornering curves grow past the dashed original, and the grip limit on the bend goes up.',
        run: async () => { const p = $('#c_pacejka_groups_Lateral_PDY1'); if (p) await drag('#c_pacejka_groups_Lateral_PDY1', Math.min(+p.max, +p.value + 0.2), 1800); } },
      { title: 'Braking', text: 'Full brakes from speed: wheels that brake harder than the tyre can hold turn red and lock, and the nose dives in the side view.',
        run: async () => { await click('[data-s=brake]'); await drag('#in-speed', 90, 1300); spotlight($('.stage-wrap'), 4); } },
      { title: 'Launch and corner', text: 'Launch shows traction on the driven axles; Corner holds a speed on a bend and shows understeer or oversteer as it builds.',
        run: async () => { await click('[data-s=launch]', { after: 1600 }); await click('[data-s=corner]'); await drag('#in-speed', 60, 900); } },
      { title: 'Tire Lab', text: 'The original Tire Lab tool, loaded with this vehicle: 3D tyre, suspension rig and the full force response. Its edits flow back into TireTune.',
        run: async () => { await click('[data-view=tirelab]', { after: 2600 }); await click('[data-view=vehicle]', { spot: false }); } },
      { title: 'Review before writing', text: 'Review shows the exact text change for every file. Nothing is written until you press Write files (this demo never does).',
        run: async () => { await click('#btn-review', { after: 900 }); raise(); const d = $('#review'); if (d && d.open) { spotlight($('#review-files'), 4); await moveTo(rectOf($('#review-files')).cx, rectOf($('#review-files')).y + 60); } } },
      { title: 'Into Workbench', text: 'Write files backs up, edits your .et and configs as plain text, and Workbench reimports them. Reopen the world and drive.',
        run: async () => { const d = $('#review'); if (d && d.open) { await click('#review button[value=cancel]'); } spotlight($('#wb-info')); await moveTo(rectOf($('#wb-info')).cx, rectOf($('#wb-info')).cy); } },
      { title: 'Checks', text: 'Setup checks flag things like springs too soft for their travel, torque shares that do not add up, or an axle running on engine-default tyres.',
        run: async () => { spotlight($('#lint')); await moveTo(rectOf($('#lint')).cx, rectOf($('#lint')).cy); } },
      { title: 'And for fun: templates', text: 'One-click wild setups built from this vehicle\'s own values. Drift King loosens the rear and sends all the power back: watch the line swing away from the dashed original.',
        run: async () => {
          await click('[data-tab=fun]');
          if (!$('[data-s=corner]').matches('[aria-checked=true]')) await click('[data-s=corner]', { spot: false });
          await click('.tpl[data-tpl=drift]', { after: 2200 });
          spotlight($('.stage-wrap'), 4); await moveTo(rectOf($('#stage')).cx, rectOf($('#stage')).y + 120);
        } },
      { title: 'Moon Buggy, Ice Rink, Monster Truck...', text: 'Featherweight with pillow springs, a quarter of the grip, or heavy with huge travel. Each one switches cleanly, and Review writes the one you love.',
        run: async () => {
          await click('.tpl[data-tpl=moon]', { after: 2000 });
          await click('.tpl[data-tpl=ice]', { after: 2000 });
          await click('.tpl[data-tpl=monster]', { after: 1600 });
          spotlight($('#balance')); await moveTo(rectOf($('#balance')).cx, rectOf($('#balance')).cy);
        } },
      { title: 'Back to the original', text: 'Revert all returns every value to what is in the files. Tune, review, write, drive.',
        run: async () => { await click('#btn-reset-all'); spotlight($('.stage-wrap'), 4); await moveTo(rectOf($('#stage')).cx, rectOf($('#stage')).cy); } },
    ];
  }

  async function start() {
    if (running) return;
    if (!document.querySelector('#tab-chassis .ctl')) { alert('Load a vehicle first.'); return; }
    running = true; paused = false; stopped = false;
    document.body.classList.add('demo-on');
    const play = $('#btn-play');                 // the demo always animates, even under reduced motion
    if (play && play.getAttribute('aria-label') === 'Play') play.click();
    if (!$('#review').open) raise();
    cursor.style.transitionDuration = '0ms';
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;
    const list = steps();
    const from = Math.max(1, Math.min(list.length, +params.get('from') || 1));   // ?from=N: re-film one segment
    try {
      for (let i = from - 1; i < list.length; i++) {
        skip = false;
        const s = list[i];
        say(i + 1, list.length, s.title, s.text);
        const t0 = performance.now();
        try { await s.run(); } catch (e) { if (e.message === 'stop') throw e; console.warn('[demo]', s.title, e); }
        skip = false;
        const left = read(s.text) - (performance.now() - t0) * speed;
        if (left > 0) await wait(left);
      }
      await wait(800);
    } catch (e) { /* stopped */ }
    finish();
  }

  function finish() {
    running = false;
    document.body.classList.remove('demo-on');
    const d = $('#review');
    if (d && d.open) d.close();
    const revert = $('#btn-reset-all');
    if (revert && !revert.disabled) revert.click();
    try { root.hidePopover(); } catch (e) { /* ignore */ }
  }

  root.querySelector('.d-ctrl').addEventListener('click', e => {
    const a = e.target.dataset.a;
    if (a === 'pause') { paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; }
    if (a === 'next') skip = true;
    if (a === 'stop') stopped = true;
  });
  addEventListener('keydown', e => {
    if (!running) return;
    if (e.key === 'Escape') { stopped = true; e.preventDefault(); }
    else if (e.key === ' ') { paused = !paused; root.querySelector('[data-a=pause]').textContent = paused ? 'Resume' : 'Pause'; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { skip = true; e.preventDefault(); }
  }, true);

  globalThis.TireTuneDemo = { start, setSpeed: v => { speed = v; } };
  const btn = $('#btn-demo');
  if (btn) btn.addEventListener('click', start);
  if (params.get('demo') === '1') {
    // wait for the vehicle to load, then go
    const t = setInterval(() => { if (document.querySelector('#tab-chassis .ctl')) { clearInterval(t); setTimeout(start, 1200); } }, 300);
  }
})();
