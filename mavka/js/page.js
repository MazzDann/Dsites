/* Мавка — розділи сторінки: шлях звуку, дійові особи, секвенсор, черга. */
(function () {
  'use strict';

  const M = window.Mavka;
  const { engine, ui, PRESETS, META } = M;
  const $ = (s, el = document) => el.querySelector(s);
  const AMBER = 'rgba(255, 196, 102, 0.95)';
  const AMBER_GLOW = 'rgba(255, 170, 50, 0.16)';
  const AMBER_FILL = 'rgba(255, 178, 62, 0.14)';
  const GRID = 'rgba(255, 178, 62, 0.08)';
  const TEXT = 'rgba(255, 214, 150, 0.55)';

  /* ================= Шлях звуку ================= */
  const flowCanvases = [...document.querySelectorAll('[data-flow]')];

  function setupCanvas(c) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width * dpr));
    const H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    return { ctx, W, H, dpr };
  }

  function grid(ctx, W, H, nx = 8, ny = 4) {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < nx; i++) {
      const x = Math.round((W * i) / nx) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let i = 1; i < ny; i++) {
      const y = Math.round((H * i) / ny) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
  }

  function glowLine(ctx, dpr, pts) {
    for (const [lw, col] of [
      [5, AMBER_GLOW],
      [1.7, AMBER],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw * dpr;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }

  function label(ctx, dpr, text, x, y, align = 'left') {
    ctx.font = `${Math.round(12 * dpr)}px Handjet, monospace`;
    ctx.fillStyle = TEXT;
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  }

  const wave = {
    sine: (ph) => Math.sin(ph * Math.PI * 2),
    triangle: (ph) => 1 - 4 * Math.abs(((ph + 0.25) % 1) - 0.5),
    sawtooth: (ph) => 2 * (ph % 1) - 1,
    square: (ph) => ((ph % 1) < 0.5 ? 1 : -1),
  };
  const WG = { sine: 1, triangle: 0.85, sawtooth: 0.5, square: 0.42 };

  function drawOsc(c) {
    const { ctx, W, H, dpr } = setupCanvas(c);
    grid(ctx, W, H);
    const p = engine.p;
    const ratio = Math.pow(2, p.semi / 12 + p.detune / 1200);
    const pts = [];
    const N = 400;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let maxAbs = 0.001;
    const ys = [];
    for (let i = 0; i < N; i++) {
      const ph = (i / N) * 2;
      const y = (1 - p.mix) * WG[p.wave1] * wave[p.wave1](ph) + p.mix * WG[p.wave2] * wave[p.wave2](ph * ratio) + p.noise * p.noise * 0.5 * rnd();
      ys.push(y);
      maxAbs = Math.max(maxAbs, Math.abs(y));
    }
    ys.forEach((y, i) => pts.push([(i / (N - 1)) * W, H / 2 - (y / maxAbs) * H * 0.36]));
    glowLine(ctx, dpr, pts);
    label(ctx, dpr, `${M.WAVE_NAMES[p.wave1]} + ${M.WAVE_NAMES[p.wave2]}`, 10 * dpr, 18 * dpr);
  }

  function drawFilter(c) {
    const { ctx, W, H, dpr } = setupCanvas(c);
    grid(ctx, W, H);
    const p = engine.p;
    const fMin = 20;
    const fMax = 20000;
    const X = (f) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * W;
    const dbTop = 18;
    const dbBot = -48;
    const Y = (db) => ((dbTop - Math.max(dbBot, Math.min(dbTop, db))) / (dbTop - dbBot)) * H;
    const resp = (fc) => {
      const pts = [];
      for (let i = 0; i <= 200; i++) {
        const f = fMin * Math.pow(fMax / fMin, i / 200);
        const x = f / fc;
        const q1 = p.reso;
        const q2 = Math.max(0.5, p.reso * 0.3);
        const h1 = 1 / Math.sqrt((1 - x * x) ** 2 + (x / q1) ** 2);
        const h2 = 1 / Math.sqrt((1 - x * x) ** 2 + (x / q2) ** 2);
        pts.push([X(f), Y(20 * Math.log10(h1 * h2))]);
      }
      return pts;
    };
    // куди відкривається фільтр обвідною
    if (p.envAmt > 0.02) {
      const open = resp(Math.min(20000, p.cutoff * Math.pow(2, p.envAmt * 4 * p.sustain + 0.001)));
      ctx.fillStyle = AMBER_FILL;
      ctx.beginPath();
      ctx.moveTo(0, H);
      open.forEach(([x, y]) => ctx.lineTo(x, y));
      ctx.lineTo(W, H);
      ctx.fill();
    }
    glowLine(ctx, dpr, resp(p.cutoff));
    const cx = X(p.cutoff);
    ctx.strokeStyle = 'rgba(255, 196, 102, 0.3)';
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, dpr, META.cutoff.fmt(p.cutoff), Math.min(cx + 6 * dpr, W - 80 * dpr), 18 * dpr);
  }

  function drawEnv(c) {
    const { ctx, W, H, dpr } = setupCanvas(c);
    grid(ctx, W, H);
    const p = engine.p;
    const hold = 0.5;
    const total = p.attack + p.decay * 1.4 + hold + p.release * 1.4;
    const sx = (W * 0.94) / total;
    const x0 = W * 0.03;
    const top = H * 0.14;
    const bot = H * 0.88;
    const Y = (v) => bot - (bot - top) * v;
    const pts = [[x0, Y(0)]];
    const steps = 40;
    for (let i = 1; i <= steps; i++) pts.push([x0 + (p.attack * i * sx) / steps, Y(i / steps)]);
    const xa = x0 + p.attack * sx;
    for (let i = 1; i <= steps; i++) {
      const t = (p.decay * 1.4 * i) / steps;
      pts.push([xa + t * sx, Y(p.sustain + (1 - p.sustain) * Math.exp(-t / (p.decay / 3 + 0.001)))]);
    }
    const xd = xa + p.decay * 1.4 * sx;
    const sus = p.sustain + (1 - p.sustain) * Math.exp(-4.2);
    pts.push([xd + hold * sx, Y(sus)]);
    const xr = xd + hold * sx;
    for (let i = 1; i <= steps; i++) {
      const t = (p.release * 1.4 * i) / steps;
      pts.push([xr + t * sx, Y(sus * Math.exp(-t / (p.release / 4 + 0.001)))]);
    }
    ctx.fillStyle = AMBER_FILL;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.lineTo(pts[pts.length - 1][0], bot);
    ctx.lineTo(x0, bot);
    ctx.fill();
    glowLine(ctx, dpr, pts);
    const names = [
      ['атака', x0 + (p.attack * sx) / 2],
      ['спад', xa + (p.decay * 1.4 * sx) / 2],
      ['рівень', xd + (hold * sx) / 2],
      ['згасання', xr + (p.release * 1.4 * sx) / 2],
    ];
    let lastX = -1e9;
    for (const [n, x] of names) {
      if (x - lastX < 54 * dpr) continue;
      label(ctx, dpr, n, x, H - 4 * dpr, 'center');
      lastX = x;
    }
  }

  function drawSpace(c) {
    const { ctx, W, H, dpr } = setupCanvas(c);
    grid(ctx, W, H);
    const p = engine.p;
    const span = 3.2;
    const X = (t) => W * 0.03 + (t / span) * W * 0.94;
    const base = H * 0.86;
    const top = H * 0.12;
    // хвіст «лісу»
    if (p.reverb > 0.01) {
      ctx.fillStyle = AMBER_FILL;
      ctx.beginPath();
      ctx.moveTo(X(0), base);
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i <= 160; i++) {
        const t = (i / 160) * span;
        const env = Math.pow(Math.max(0, 1 - t / 3.6), 2.4) * p.reverb * 0.75;
        ctx.lineTo(X(t), base - (base - top) * env * (0.75 + 0.25 * rnd()));
      }
      ctx.lineTo(X(span), base);
      ctx.fill();
    }
    // пряма нота і відлуння
    const taps = [[0, 1 - p.reverb * 0.35]];
    if (p.delayMix > 0.01) {
      let a = p.delayMix * 0.8;
      for (let k = 1; k < 30; k++) {
        const t = k * p.delayTime;
        if (t > span) break;
        taps.push([t, a]);
        if (k % 2 === 0) a *= p.feedback;
        if (a < 0.02) break;
      }
    }
    for (const [t, a] of taps) {
      const x = X(t);
      const y = base - (base - top) * Math.min(1, a);
      glowLine(ctx, dpr, [
        [x, base],
        [x, y],
      ]);
      ctx.fillStyle = AMBER;
      ctx.beginPath();
      ctx.arc(x, y, 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    label(ctx, dpr, '3 с', W - 8 * dpr, H - 6 * dpr, 'right');
  }

  const DRAW = { osc: drawOsc, filter: drawFilter, env: drawEnv, space: drawSpace };
  let flowPending = false;
  function drawFlow() {
    flowPending = false;
    for (const c of flowCanvases) DRAW[c.dataset.flow](c);
  }
  function requestFlow() {
    if (flowPending) return;
    flowPending = true;
    requestAnimationFrame(drawFlow);
  }
  engine.on((type, on) => {
    if (type === 'param') requestFlow();
    // вимкнули живлення — зупиняємо все, що грало за розкладом
    if (type === 'power' && !on) {
      if (seqState.playing) stopSeq();
      stopDemo();
    }
  });

  /* ================= Дійові особи ================= */
  const castEl = $('#cast-list');
  castEl.innerHTML = PRESETS.map(
    (pr, i) => `
      <li class="cast-row" data-i="${i}">
        <div class="cast-head">
          <h3>${pr.name}</h3>
          <span class="leader" aria-hidden="true"></span>
          <span class="cast-role">${pr.role}</span>
        </div>
        <p>${pr.text}</p>
        <button class="listen" type="button" data-listen="${i}" aria-pressed="false">
          <span class="led" aria-hidden="true"></span><span class="listen-text">Послухати</span>
        </button>
      </li>`
  ).join('');

  let demo = null;

  function stopDemo() {
    if (!demo) return;
    clearTimeout(demo.timer);
    const btn = castEl.querySelector(`[data-listen="${demo.i}"]`);
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.querySelector('.listen-text').textContent = 'Послухати';
    }
    castEl.querySelector(`.cast-row[data-i="${demo.i}"]`)?.classList.remove('playing');
    demo = null;
  }

  castEl.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-listen]');
    if (!b) return;
    const i = +b.dataset.listen;
    const wasThis = demo && demo.i === i;
    if (demo) {
      engine.allOff();
      stopDemo();
    }
    if (seqState.playing) stopSeq();
    if (wasThis) return;
    await ui.powerOn();
    if (!engine.running) return;
    ui.loadPreset(i, { animate: true });
    const pr = PRESETS[i];
    const step = 60 / pr.demo.tempo / 2;
    const t0 = engine.now + 0.25;
    let end = 0;
    for (const [note, at, len] of pr.demo.notes) {
      engine.play(note, t0 + at * step, len * step * 0.92, 0.8);
      end = Math.max(end, at + len);
    }
    b.setAttribute('aria-pressed', 'true');
    b.querySelector('.listen-text').textContent = 'Зупинити';
    castEl.querySelector(`.cast-row[data-i="${i}"]`).classList.add('playing');
    demo = { i, timer: setTimeout(stopDemo, (end * step + pr.p.release + 0.6) * 1000) };
  });

  document.addEventListener('mavka:preset', (e) => {
    castEl.querySelectorAll('.cast-row').forEach((r) => r.classList.toggle('current', +r.dataset.i === e.detail));
    $('#seq-voice').textContent = PRESETS[e.detail].name;
  });

  /* ================= Секвенсор ================= */
  const ROWS = [
    { n: 69, name: 'ля' },
    { n: 67, name: 'соль' },
    { n: 64, name: 'мі' },
    { n: 62, name: 'ре' },
    { n: 60, name: 'до' },
    { n: 57, name: 'ля' },
    { n: 55, name: 'соль' },
    { n: 52, name: 'мі' },
  ];
  const STEPS = 16;
  const DEFAULT = [5, -1, 4, 3, 2, -1, 3, 4, 1, -1, 2, 3, 4, -1, 5, -1];
  const seqState = {
    steps: loadSteps(),
    playing: false,
    bpm: 96,
    step: 0,
    nextTime: 0,
    timer: 0,
    queue: [],
    focus: { r: 0, c: 0 },
  };

  function loadSteps() {
    try {
      const s = JSON.parse(localStorage.getItem('mavka:steps'));
      if (Array.isArray(s) && s.length === STEPS) return s;
    } catch (e) {
      /* немає збереженого */
    }
    return DEFAULT.slice();
  }
  function saveSteps() {
    try {
      localStorage.setItem('mavka:steps', JSON.stringify(seqState.steps));
    } catch (e) {
      /* приватний режим */
    }
  }

  const gridEl = $('#seq-grid');
  function buildGrid() {
    const html = [];
    ROWS.forEach((row, r) => {
      html.push(`<div class="seq-row" role="row"><span class="seq-note" role="rowheader">${row.name}<sub>${Math.floor(row.n / 12) - 1}</sub></span>`);
      for (let c = 0; c < STEPS; c++) {
        const on = seqState.steps[c] === r;
        html.push(
          `<button type="button" class="cell${c % 4 === 0 ? ' beat' : ''}" role="gridcell" data-r="${r}" data-c="${c}" aria-pressed="${on}" aria-label="крок ${c + 1}, ${row.name}" tabindex="${r === 0 && c === 0 ? 0 : -1}"></button>`
        );
      }
      html.push('</div>');
    });
    gridEl.innerHTML = html.join('');
  }

  function renderGrid() {
    gridEl.querySelectorAll('.cell').forEach((cell) => {
      const on = seqState.steps[+cell.dataset.c] === +cell.dataset.r;
      cell.setAttribute('aria-pressed', String(on));
    });
  }

  gridEl.addEventListener('click', async (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const r = +cell.dataset.r;
    const c = +cell.dataset.c;
    seqState.steps[c] = seqState.steps[c] === r ? -1 : r;
    renderGrid();
    saveSteps();
    if (seqState.steps[c] === r && !seqState.playing) {
      await ui.powerOn();
      engine.play(noteFor(r), engine.now + 0.01, 0.22, 0.75);
    }
  });

  gridEl.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    let r = +cell.dataset.r;
    let c = +cell.dataset.c;
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (!(e.key in moves)) return;
    e.preventDefault();
    e.stopPropagation();
    r = (r + moves[e.key][0] + ROWS.length) % ROWS.length;
    c = (c + moves[e.key][1] + STEPS) % STEPS;
    cell.tabIndex = -1;
    const next = gridEl.querySelector(`.cell[data-r="${r}"][data-c="${c}"]`);
    next.tabIndex = 0;
    next.focus();
  });

  const noteFor = (r) => ROWS[r].n + (ui.base - 60);

  function scheduler() {
    const stepDur = 60 / seqState.bpm / 4;
    while (seqState.nextTime < engine.now + 0.12) {
      const c = seqState.step;
      const r = seqState.steps[c];
      if (r >= 0) {
        // довжина ноти: до наступної ноти, але не більше двох кроків
        let len = 1;
        while (len < 2 && seqState.steps[(c + len) % STEPS] === -1) len++;
        engine.play(noteFor(r), seqState.nextTime, stepDur * len * 0.9, c % 4 === 0 ? 0.9 : 0.72);
      }
      seqState.queue.push({ c, t: seqState.nextTime });
      seqState.step = (c + 1) % STEPS;
      seqState.nextTime += stepDur;
    }
  }

  async function startSeq() {
    if (demo) {
      engine.allOff();
      stopDemo();
    }
    await ui.powerOn();
    if (!engine.running) return;
    seqState.playing = true;
    seqState.step = 0;
    seqState.nextTime = engine.now + 0.08;
    seqState.queue = [];
    scheduler();
    seqState.timer = setInterval(scheduler, 25);
    $('#seq-play').setAttribute('aria-pressed', 'true');
    $('#seq-play .t').textContent = 'Зупинити';
  }

  function stopSeq() {
    seqState.playing = false;
    clearInterval(seqState.timer);
    seqState.queue = [];
    gridEl.querySelectorAll('.now').forEach((x) => x.classList.remove('now'));
    gridEl.dataset.col = '';
    $('#seq-play').setAttribute('aria-pressed', 'false');
    $('#seq-play .t').textContent = 'Грати';
  }

  $('#seq-play').addEventListener('click', () => {
    if (seqState.playing) {
      stopSeq();
      engine.allOff();
    } else startSeq();
  });

  const tempo = $('#seq-tempo');
  const tempoOut = $('#seq-tempo-out');
  tempo.addEventListener('input', () => {
    seqState.bpm = +tempo.value;
    tempoOut.textContent = `${seqState.bpm} уд/хв`;
  });

  $('#seq-random').addEventListener('click', () => {
    const s = [];
    let r = 2 + Math.floor(Math.random() * 4);
    for (let c = 0; c < STEPS; c++) {
      if (c > 0 && Math.random() < (c % 2 ? 0.45 : 0.15)) {
        s.push(-1);
        continue;
      }
      r = Math.max(0, Math.min(ROWS.length - 1, r + Math.round((Math.random() - 0.5) * 3.2)));
      s.push(r);
    }
    // закінчуємо на тоніці — ля
    s[STEPS - 2] = Math.random() < 0.5 ? 5 : 0;
    s[STEPS - 1] = -1;
    seqState.steps = s;
    renderGrid();
    saveSteps();
    if (!seqState.playing) startSeq();
  });

  $('#seq-clear').addEventListener('click', () => {
    seqState.steps = Array(STEPS).fill(-1);
    renderGrid();
    saveSteps();
  });

  function seqFrame() {
    if (seqState.playing && engine.ctx) {
      const now = engine.now;
      let col = null;
      while (seqState.queue.length && seqState.queue[0].t <= now) col = seqState.queue.shift().c;
      if (col !== null) {
        gridEl.querySelectorAll('.now').forEach((x) => x.classList.remove('now'));
        gridEl.querySelectorAll(`.cell[data-c="${col}"]`).forEach((x) => x.classList.add('now'));
      }
    }
    requestAnimationFrame(seqFrame);
  }

  /* ================= Черга ================= */
  const form = $('#queue-form');
  const done = $('#queue-done');
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem('mavka:queue'));
    } catch (e) {
      return null;
    }
  })();

  function showDone(data) {
    form.hidden = true;
    done.hidden = false;
    $('#queue-name').textContent = data.name;
  }
  if (saved && saved.name) showDone(saved);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    for (const input of form.querySelectorAll('[required]')) {
      const err = form.querySelector(`#${input.id}-err`);
      let msg = '';
      if (!input.value.trim()) msg = input.type === 'email' ? 'Вкажіть пошту, щоб ми знали, куди писати.' : 'Вкажіть, як до вас звертатися.';
      else if (input.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.value.trim())) msg = 'Схоже, в адресі помилка. Приклад: ivanna@ukr.net';
      input.setAttribute('aria-invalid', String(!!msg));
      if (err) err.textContent = msg;
      if (msg && ok) {
        input.focus();
        ok = false;
      }
    }
    if (!ok) return;
    const data = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      city: form.city.value.trim(),
      use: (form.querySelector('[name="use"]:checked') || {}).value || '',
    };
    try {
      localStorage.setItem('mavka:queue', JSON.stringify(data));
    } catch (err) {
      /* не страшно */
    }
    showDone(data);
    done.focus();
  });

  $('#queue-again').addEventListener('click', () => {
    try {
      localStorage.removeItem('mavka:queue');
    } catch (e) {
      /* нічого */
    }
    done.hidden = true;
    form.hidden = false;
    form.reset();
  });

  /* ================= Навігація ================= */
  const top = $('.top');
  const onScroll = () => top.classList.toggle('scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ================= Старт ================= */
  buildGrid();
  $('#seq-voice').textContent = PRESETS[ui.state.preset].name;
  castEl.querySelector(`.cast-row[data-i="${ui.state.preset}"]`)?.classList.add('current');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawFlow);
  drawFlow();
  requestAnimationFrame(seqFrame);
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(drawFlow, 120);
  });
})();
