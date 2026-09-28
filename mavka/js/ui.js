/* Мавка — панель інструмента: ручки, перемикачі, екран, клавіатура. */
(function () {
  'use strict';

  const M = window.Mavka;
  const { PARAMS, META, PRESETS, WAVE_NAMES, TARGET_NAMES, MODE_NAMES, toNorm, fromNorm } = M;
  const $ = (s, el = document) => el.querySelector(s);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engine = new M.Engine();
  // на сторінці claude.ai файли не завантажуються, MIDI недоступний, а стан у посиланні не передається
  const ARTIFACT = !!window.ARTIFACT;
  // на claude.ai файл зберігається через можливість downloads — із підтвердженням глядача
  let downloads = null;
  if (ARTIFACT && window.claude && window.claude.use) {
    window.claude
      .use('downloads')
      .then((d) => (downloads = d))
      .catch(() => {});
  }

  const MODULES = [
    { id: 'osc', title: 'генератори', controls: [{ k: 'wave1' }, { k: 'wave2' }, { k: 'semi' }, { k: 'detune' }, { k: 'mix' }, { k: 'noise' }] },
    { id: 'filter', title: 'фільтр', controls: [{ k: 'cutoff', size: 'l' }, { k: 'reso' }, { k: 'envAmt' }] },
    { id: 'env', title: 'обвідна', controls: [{ k: 'attack' }, { k: 'decay' }, { k: 'sustain' }, { k: 'release' }] },
    { id: 'lfo', title: 'рух', controls: [{ k: 'lfoRate' }, { k: 'lfoDepth' }, { k: 'lfoTarget' }] },
    { id: 'space', title: 'простір', controls: [{ k: 'delayMix' }, { k: 'delayTime' }, { k: 'feedback' }, { k: 'reverb', size: 'l' }] },
    { id: 'out', title: 'вихід', controls: [{ k: 'drive' }, { k: 'volume' }, { k: 'glide' }, { k: 'mode' }] },
  ];

  const WAVE_PATHS = {
    sine: 'M2 12 C6 2, 10 2, 12 12 S18 22, 22 12',
    triangle: 'M2 12 L7 4 L17 20 L22 12',
    sawtooth: 'M2 18 L12 5 L12 18 L22 5 L22 18',
    square: 'M2 18 L2 6 L12 6 L12 18 L22 18 L22 6',
  };

  const state = {
    preset: 0,
    dirty: false,
    base: 60,
    controls: new Map(),
    readoutTimer: 0,
  };

  /* ================= Ручки ================= */
  const ARC = 'M12.2 51.8 A28 28 0 1 1 51.8 51.8';

  class Knob {
    constructor(key, size = 'm') {
      this.key = key;
      const meta = META[key];
      this.el = document.createElement('div');
      this.el.className = `control knob-wrap size-${size}`;
      this.el.innerHTML = `
        <div class="knob" role="slider" tabindex="0" aria-label="${meta.label}" aria-valuemin="0" aria-valuemax="100">
          <svg class="knob-arc" viewBox="0 0 64 64" aria-hidden="true">
            <path class="track" d="${ARC}" pathLength="270"/>
            <path class="val" d="${ARC}" pathLength="270"/>
          </svg>
          <div class="knob-cap"><i></i></div>
        </div>
        <span class="control-label">${meta.label}</span>`;
      this.knob = $('.knob', this.el);
      this.val = $('.val', this.el);
      this.cap = $('.knob-cap', this.el);
      this.v = toNorm(key, engine.p[key]);
      this.render();
      this.bind();
    }

    render() {
      const v = this.v;
      this.cap.style.transform = `rotate(${-135 + 270 * v}deg)`;
      this.val.style.strokeDasharray = `${Math.max(0.001, v * 270)} 400`;
      const value = fromNorm(this.key, v);
      this.knob.setAttribute('aria-valuenow', String(Math.round(v * 100)));
      this.knob.setAttribute('aria-valuetext', META[this.key].fmt(value));
    }

    setNorm(v, { silent = false } = {}) {
      this.v = Math.min(1, Math.max(0, v));
      this.render();
      const value = fromNorm(this.key, this.v);
      if (value !== engine.p[this.key]) engine.set(this.key, value);
      if (!silent) {
        readout(`${META[this.key].label} ${META[this.key].fmt(value)}`);
        markDirty();
      }
    }

    sync() {
      this.v = toNorm(this.key, engine.p[this.key]);
      this.render();
    }

    bind() {
      const k = this.knob;
      let start = null;
      let lastTap = 0;
      k.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        k.setPointerCapture(e.pointerId);
        k.focus({ preventScroll: true });
        // подвійний дотик на сенсорних екранах
        if (e.pointerType === 'touch' && performance.now() - lastTap < 320) {
          this.setNorm(toNorm(this.key, PARAMS[this.key].def));
          lastTap = 0;
          return;
        }
        lastTap = performance.now();
        start = { x: e.clientX, y: e.clientY, v: this.v };
        k.classList.add('turning');
        powerOn();
      });
      k.addEventListener('pointermove', (e) => {
        if (!start) return;
        const fine = e.shiftKey ? 0.25 : 1;
        const dv = ((start.y - e.clientY) / 180 + (e.clientX - start.x) / 360) * fine;
        this.setNorm(start.v + dv);
      });
      const end = () => {
        start = null;
        k.classList.remove('turning');
      };
      k.addEventListener('pointerup', end);
      k.addEventListener('pointercancel', end);
      k.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          this.setNorm(this.v - e.deltaY * (e.deltaMode === 1 ? 0.02 : 0.0012));
        },
        { passive: false }
      );
      k.addEventListener('keydown', (e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        const map = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: 0.1, PageDown: -0.1 };
        if (e.key in map) {
          e.preventDefault();
          e.stopPropagation();
          this.setNorm(this.v + map[e.key]);
        } else if (e.key === 'Home') {
          e.preventDefault();
          this.setNorm(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          this.setNorm(1);
        }
      });
      k.addEventListener('dblclick', () => this.setNorm(toNorm(this.key, PARAMS[this.key].def)));
    }
  }

  /* ================= Перемикачі ================= */
  class Switch {
    constructor(key) {
      this.key = key;
      const opts = PARAMS[key].options;
      const meta = META[key];
      const isWave = key === 'wave1' || key === 'wave2';
      const names = isWave ? WAVE_NAMES : key === 'lfoTarget' ? TARGET_NAMES : MODE_NAMES;
      this.el = document.createElement('div');
      this.el.className = `control switch-wrap ${isWave ? 'is-wave' : 'is-list'}`;
      this.el.innerHTML = `
        <div class="switch" role="radiogroup" aria-label="${meta.label}">
          ${opts
            .map(
              (o) => `<button type="button" role="radio" data-v="${o}" aria-label="${names[o]}" title="${names[o]}">
                <span class="led" aria-hidden="true"></span>
                ${isWave ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${WAVE_PATHS[o]}"/></svg>` : `<span class="opt">${names[o]}</span>`}
              </button>`
            )
            .join('')}
        </div>
        <span class="control-label">${meta.label}</span>`;
      this.buttons = [...this.el.querySelectorAll('button')];
      this.sync();
      this.el.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        powerOn();
        engine.set(key, b.dataset.v);
        this.sync();
        readout(`${meta.label}: ${names[b.dataset.v]}`);
        markDirty();
      });
      this.el.addEventListener('keydown', (e) => {
        const i = opts.indexOf(engine.p[key]);
        let j = i;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % opts.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + opts.length) % opts.length;
        else return;
        e.preventDefault();
        engine.set(key, opts[j]);
        this.sync();
        this.buttons[j].focus();
        readout(`${meta.label}: ${names[opts[j]]}`);
        markDirty();
      });
    }

    sync() {
      const cur = engine.p[this.key];
      for (const b of this.buttons) {
        const on = b.dataset.v === cur;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    }
  }

  /* ================= Складання панелі ================= */
  function buildPanel() {
    for (const mod of MODULES) {
      const host = document.querySelector(`[data-module="${mod.id}"] .controls`);
      if (!host) continue;
      for (const c of mod.controls) {
        const def = PARAMS[c.k];
        const ctl = def.type === 'enum' ? new Switch(c.k) : new Knob(c.k, c.size);
        host.appendChild(ctl.el);
        state.controls.set(c.k, ctl);
      }
    }
  }

  function syncAll() {
    for (const c of state.controls.values()) c.sync();
  }

  // плавний перехід ручок до нового голосу
  function morphTo(p, ms = 520) {
    const from = {};
    const to = {};
    for (const [k, v] of Object.entries(p)) {
      if (PARAMS[k].type === 'enum') {
        engine.set(k, v);
      } else {
        from[k] = toNorm(k, engine.p[k]);
        to[k] = toNorm(k, v);
      }
    }
    for (const c of state.controls.values()) if (c instanceof Switch) c.sync();
    if (reduceMotion || ms === 0) {
      for (const k of Object.keys(to)) state.controls.get(k).setNorm(to[k], { silent: true });
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      for (const k of Object.keys(to)) state.controls.get(k).setNorm(from[k] + (to[k] - from[k]) * e, { silent: true });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function loadPreset(i, { animate = true } = {}) {
    state.preset = (i + PRESETS.length) % PRESETS.length;
    state.dirty = false;
    const pr = PRESETS[state.preset];
    morphTo(pr.p, animate ? 520 : 0);
    updateScreenTitle();
    document.dispatchEvent(new CustomEvent('mavka:preset', { detail: state.preset }));
  }

  function markDirty() {
    if (!state.dirty) {
      state.dirty = true;
      updateScreenTitle();
    }
  }

  /* ================= Екран ================= */
  const screenMain = $('#screen-main');
  const screenSub = $('#screen-sub');
  let subDefault = 'натисніть будь-яку клавішу';

  function updateScreenTitle() {
    const n = String(state.preset + 1).padStart(2, '0');
    screenMain.textContent = `${n} ${PRESETS[state.preset].name.toLowerCase()}${state.dirty ? '*' : ''}`;
  }

  function readout(text, ms = 1400) {
    screenSub.textContent = text;
    screenSub.classList.add('hot');
    clearTimeout(state.readoutTimer);
    state.readoutTimer = setTimeout(() => {
      screenSub.textContent = subDefault;
      screenSub.classList.remove('hot');
    }, ms);
  }

  function setSubDefault(t) {
    subDefault = t;
    if (!screenSub.classList.contains('hot')) screenSub.textContent = t;
  }

  const scope = $('#scope');
  const sctx = scope.getContext('2d');

  function drawScope() {
    const r = scope.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (scope.width !== W || scope.height !== H) {
      scope.width = W;
      scope.height = H;
    }
    sctx.clearRect(0, 0, W, H);
    // сітка
    sctx.strokeStyle = 'rgba(255, 178, 62, 0.07)';
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const x = Math.round((W * i) / 8) + 0.5;
      sctx.moveTo(x, 0);
      sctx.lineTo(x, H);
    }
    for (let i = 1; i < 4; i++) {
      const y = Math.round((H * i) / 4) + 0.5;
      sctx.moveTo(0, y);
      sctx.lineTo(W, y);
    }
    sctx.stroke();

    const data = engine.running ? engine.waveform() : null;
    const mid = H * 0.62;
    const amp = H * 0.34;
    sctx.lineJoin = 'round';
    const trace = (lw, color) => {
      sctx.strokeStyle = color;
      sctx.lineWidth = lw * dpr;
      sctx.beginPath();
      if (!data) {
        sctx.moveTo(0, mid);
        sctx.lineTo(W, mid);
      } else {
        // синхронізація по переходу через нуль — картинка стоїть на місці
        let start = 0;
        for (let i = 1; i < data.length / 2; i++) {
          if (data[i - 1] < 0 && data[i] >= 0) {
            start = i;
            break;
          }
        }
        const span = Math.min(data.length - start, 900);
        for (let i = 0; i < span; i++) {
          const x = (i / (span - 1)) * W;
          const y = mid - Math.max(-1.2, Math.min(1.2, data[start + i] * 2.2)) * amp;
          if (i === 0) sctx.moveTo(x, y);
          else sctx.lineTo(x, y);
        }
      }
      sctx.stroke();
    };
    trace(5, 'rgba(255, 170, 50, 0.16)');
    trace(1.6, 'rgba(255, 196, 102, 0.95)');
  }

  /* ================= Живлення ================= */
  const powerBtn = $('#power');
  let powering = null;

  function powerOn() {
    if (engine.running) return Promise.resolve();
    if (!powering) {
      powering = engine
        .start()
        .catch((err) => {
          console.error(err);
          readout('звук недоступний у цьому браузері', 4000);
        })
        .finally(() => {
          powering = null;
        });
    }
    return powering;
  }

  engine.on((type, d) => {
    if (type === 'power') {
      powerBtn.setAttribute('aria-checked', String(d));
      document.documentElement.classList.toggle('powered', d);
      setSubDefault(d ? 'грайте: клавіші a–k або мишею' : 'натисніть будь-яку клавішу');
    }
  });

  powerBtn.addEventListener('click', () => {
    if (engine.running) engine.stop();
    else powerOn();
  });

  /* ================= Клавіатура ================= */
  const keysEl = $('#keys');
  const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };
  const CODEMAP = {
    KeyA: 'a', KeyW: 'w', KeyS: 's', KeyE: 'e', KeyD: 'd', KeyF: 'f', KeyT: 't', KeyG: 'g', KeyY: 'y', KeyH: 'h',
    KeyU: 'u', KeyJ: 'j', KeyK: 'k', KeyO: 'o', KeyL: 'l', KeyP: 'p', Semicolon: ';', Quote: "'", KeyZ: 'z', KeyX: 'x',
  };
  const LETTER_OF = Object.fromEntries(Object.entries(KEYMAP).map(([l, o]) => [o, l]));
  const NOTE_NAMES = ['до', 'до♯', 'ре', 'ре♯', 'мі', 'фа', 'фа♯', 'соль', 'соль♯', 'ля', 'ля♯', 'сі'];
  const isBlack = (n) => [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12);
  let keyCount = 25;

  function buildKeys() {
    const w = keysEl.clientWidth || 800;
    const whites = w < 420 ? 10 : w < 640 ? 12 : 15;
    // скільки півтонів уміщується
    let n = 0;
    let wc = 0;
    while (wc < whites) {
      if (!isBlack(n)) wc++;
      n++;
    }
    keyCount = n;
    const html = [];
    let whiteIndex = 0;
    for (let i = 0; i < n; i++) {
      const note = state.base + i;
      const black = isBlack(note);
      const letter = LETTER_OF[i] ? LETTER_OF[i].toUpperCase() : '';
      const name = `${NOTE_NAMES[note % 12]} ${Math.floor(note / 12) - 1}`;
      if (black) {
        html.push(
          `<button type="button" class="key black" data-i="${i}" style="--x:${whiteIndex}" aria-label="${name}" tabindex="-1"><span>${letter}</span></button>`
        );
      } else {
        html.push(
          `<button type="button" class="key white" data-i="${i}" aria-label="${name}" tabindex="-1"><span>${letter}</span></button>`
        );
        whiteIndex++;
      }
    }
    keysEl.style.setProperty('--whites', String(whites));
    keysEl.innerHTML = html.join('');
  }

  function keyEl(note) {
    return keysEl.querySelector(`[data-i="${note - state.base}"]`);
  }

  function lightKey(note, on) {
    const el = keyEl(note);
    if (el) el.classList.toggle('down', on);
  }

  // підсвітка нот із секвенсора — за розкладом аудіо-часу
  const scheduled = [];
  engine.on((type, d) => {
    if (type === 'note') {
      if (!engine.ctx || d.when <= engine.now + 0.02) lightKey(d.note, d.on);
      else scheduled.push(d);
    } else if (type === 'alloff') {
      scheduled.length = 0;
      keysEl.querySelectorAll('.down').forEach((k) => k.classList.remove('down'));
    }
  });

  function flushScheduled() {
    if (!engine.ctx) return;
    const now = engine.now;
    for (let i = scheduled.length - 1; i >= 0; i--) {
      if (scheduled[i].when <= now) {
        lightKey(scheduled[i].note, scheduled[i].on);
        scheduled.splice(i, 1);
      }
    }
  }

  const pointerNotes = new Map();
  keysEl.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('.key');
    if (!k) return;
    e.preventDefault();
    try {
      keysEl.setPointerCapture(e.pointerId);
    } catch (err) {
      /* вказівник уже відпущено */
    }
    const note = state.base + +k.dataset.i;
    powerOn().then(() => {
      if (!pointerNotes.has(e.pointerId)) return;
      engine.noteOn(note, 0.6 + 0.35 * Math.min(1, (e.pressure || 0.5) * 1.4));
    });
    pointerNotes.set(e.pointerId, note);
    monoHint();
  });
  keysEl.addEventListener('pointermove', (e) => {
    if (!pointerNotes.has(e.pointerId)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el && el.closest && el.closest('.key');
    if (!k) return;
    const note = state.base + +k.dataset.i;
    const prev = pointerNotes.get(e.pointerId);
    if (note !== prev) {
      engine.noteOff(prev);
      engine.noteOn(note, 0.75);
      pointerNotes.set(e.pointerId, note);
    }
  });
  const releasePointer = (e) => {
    if (!pointerNotes.has(e.pointerId)) return;
    engine.noteOff(pointerNotes.get(e.pointerId));
    pointerNotes.delete(e.pointerId);
  };
  keysEl.addEventListener('pointerup', releasePointer);
  keysEl.addEventListener('pointercancel', releasePointer);

  const downKeys = new Map();
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    const l = CODEMAP[e.code];
    if (!l) return;
    e.preventDefault();
    if (e.repeat) return;
    if (l === 'z' || l === 'x') {
      shiftOctave(l === 'z' ? -1 : 1);
      return;
    }
    const note = state.base + KEYMAP[l];
    downKeys.set(e.code, note);
    monoHint();
    powerOn().then(() => {
      if (downKeys.get(e.code) === note) engine.noteOn(note, 0.85);
    });
  });
  window.addEventListener('keyup', (e) => {
    const note = downKeys.get(e.code);
    if (note === undefined) return;
    downKeys.delete(e.code);
    engine.noteOff(note);
  });
  window.addEventListener('blur', () => {
    for (const note of downKeys.values()) engine.noteOff(note);
    downKeys.clear();
  });

  // в одноголосому режимі звучить лише остання нота — підказуємо, як грати акорди
  function monoHint() {
    if (engine.p.mode === 'mono' && downKeys.size + pointerNotes.size > 1) {
      readout('одна нота: для акордів перемкніть «голоси»', 2600);
    }
  }

  function shiftOctave(d) {
    const next = Math.max(24, Math.min(96, state.base + d * 12));
    if (next === state.base) return;
    engine.allOff();
    state.base = next;
    buildKeys();
    readout(`октава ${Math.floor(state.base / 12) - 1}`);
    document.dispatchEvent(new CustomEvent('mavka:octave', { detail: state.base }));
  }

  $('#oct-down').addEventListener('click', () => shiftOctave(-1));
  $('#oct-up').addEventListener('click', () => shiftOctave(1));
  $('#preset-prev').addEventListener('click', () => {
    powerOn();
    loadPreset(state.preset - 1);
  });
  $('#preset-next').addEventListener('click', () => {
    powerOn();
    loadPreset(state.preset + 1);
  });

  /* ================= Посилання на звук ================= */
  const ORDER = Object.keys(PARAMS);

  function encodePatch() {
    return ORDER.map((k) => {
      const d = PARAMS[k];
      if (d.type === 'enum') return d.options.indexOf(engine.p[k]);
      return Math.round(toNorm(k, engine.p[k]) * 1000);
    }).join('.');
  }

  function decodePatch(str) {
    const parts = str.split('.').map(Number);
    if (parts.length !== ORDER.length || parts.some((x) => !Number.isFinite(x))) return null;
    const p = {};
    ORDER.forEach((k, i) => {
      const d = PARAMS[k];
      p[k] = d.type === 'enum' ? d.options[Math.max(0, Math.min(d.options.length - 1, parts[i]))] : fromNorm(k, parts[i] / 1000);
    });
    return p;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  $('#share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#p=${encodePatch()}&n=${state.preset}`;
    history.replaceState(null, '', url);
    const ok = await copyText(url);
    readout(ok ? 'посилання скопійовано' : 'посилання в адресному рядку', 2200);
    toast(ok ? 'Посилання на цей звук скопійовано. Надішліть його друзям — у них відкриється такий самий.' : 'Посилання на цей звук — в адресному рядку браузера.');
  });

  function loadFromHash() {
    const m = location.hash.match(/p=([\d.]+)/);
    if (!m) return false;
    const p = decodePatch(m[1]);
    if (!p) return false;
    const n = location.hash.match(/n=(\d+)/);
    state.preset = n ? Math.min(PRESETS.length - 1, +n[1]) : 0;
    morphTo(p, 0);
    // якщо посилання веде на незмінений голос, зірочку не показуємо
    const pr = PRESETS[state.preset].p;
    state.dirty = ORDER.some((k) =>
      PARAMS[k].type === 'enum' ? pr[k] !== p[k] : Math.abs(toNorm(k, pr[k]) - toNorm(k, p[k])) > 0.002
    );
    updateScreenTitle();
    toast('Відкрито звук із посилання. Натисніть будь-яку клавішу, щоб послухати.');
    return true;
  }

  /* ================= Запис ================= */
  const recBtn = $('#record');
  let recTimer = 0;

  recBtn.addEventListener('click', async () => {
    if (!engine.canRecord()) {
      toast('Цей браузер не вміє записувати звук зі сторінки.');
      return;
    }
    if (engine.recording) {
      clearInterval(recTimer);
      recBtn.setAttribute('aria-pressed', 'false');
      setSubDefault('грайте: клавіші a–k або мишею');
      const res = await engine.stopRecording();
      if (!res || res.seconds < 0.3) return;
      const ext = res.type.includes('mp4') ? 'm4a' : res.type.includes('ogg') ? 'ogg' : 'webm';
      const url = URL.createObjectURL(res.blob);
      const d = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      const name = `mavka-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
      if (ARTIFACT) {
        const fname = name.replace(/\.\w+$/, res.type.includes('mp4') ? '.mp4' : '.webm');
        const save = downloads ? '<button type="button" class="toast-save">Зберегти файл</button>' : '';
        toast(`Запис готовий: ${Math.round(res.seconds)} с.<audio controls src="${url}"></audio>${save}`, 30000, true);
        const btn = toastEl.querySelector('.toast-save');
        if (btn) {
          btn.addEventListener('click', async () => {
            try {
              await downloads.save({ filename: fname, data: res.blob });
              btn.textContent = 'Збережено';
              btn.disabled = true;
            } catch (err) {
              if (!err || err.code !== 'declined') btn.hidden = true;
            }
          });
        }
      } else toast(`Запис готовий: ${Math.round(res.seconds)} с. <a href="${url}" download="${name}">Зберегти файл</a>`, 12000, true);
      return;
    }
    await powerOn();
    if (engine.startRecording()) {
      recBtn.setAttribute('aria-pressed', 'true');
      const t0 = performance.now();
      const tick = () => {
        const s = Math.floor((performance.now() - t0) / 1000);
        setSubDefault(`запис ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      };
      tick();
      recTimer = setInterval(tick, 500);
    }
  });

  /* ================= MIDI ================= */
  const midiBtn = $('#midi');
  let sustain = false;
  const sustained = new Set();

  midiBtn.addEventListener('click', async () => {
    if (!navigator.requestMIDIAccess) {
      toast('Цей браузер не підтримує MIDI. Спробуйте Chrome або Edge.');
      return;
    }
    try {
      await powerOn();
      const access = await navigator.requestMIDIAccess();
      const inputs = [...access.inputs.values()];
      const attach = () => {
        const list = [...access.inputs.values()];
        list.forEach((inp) => (inp.onmidimessage = onMidi));
        midiBtn.setAttribute('aria-pressed', String(list.length > 0));
        readout(list.length ? `midi: ${list[0].name.toLowerCase()}` : 'midi: пристроїв немає', 2600);
      };
      access.onstatechange = attach;
      attach();
      if (!inputs.length) toast('MIDI увімкнено, але пристроїв не знайдено. Під’єднайте клавіатуру — вона підхопиться сама.');
    } catch (e) {
      toast('Доступ до MIDI не надано.');
    }
  });

  function onMidi(msg) {
    const [st, a, b] = msg.data;
    const cmd = st & 0xf0;
    if (cmd === 0x90 && b > 0) {
      sustained.delete(a);
      engine.noteOn(a, 0.35 + (b / 127) * 0.65);
    } else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) {
      if (sustain) sustained.add(a);
      else engine.noteOff(a);
    } else if (cmd === 0xb0) {
      if (a === 64) {
        sustain = b >= 64;
        if (!sustain) {
          for (const n of sustained) engine.noteOff(n);
          sustained.clear();
        }
      } else if (a === 1) {
        state.controls.get('lfoDepth').setNorm(b / 127);
      } else if (a === 74) {
        state.controls.get('cutoff').setNorm(b / 127);
      }
    }
  }

  /* ================= Сповіщення ================= */
  const toastEl = $('#toast');
  let toastTimer = 0;
  function toast(text, ms = 4200, html = false) {
    if (html) toastEl.innerHTML = text;
    else toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  /* ================= Заголовок, що слухає ================= */
  const letters = [...document.querySelectorAll('.word span')];
  const EDGES = [40, 140, 400, 1100, 2800, 8000];
  const levels = letters.map(() => 0);

  function animateWord() {
    if (!letters.length || reduceMotion) return;
    const b = engine.running ? engine.bands(EDGES) : EDGES.slice(1).map(() => 0);
    letters.forEach((el, i) => {
      const target = Math.min(1, Math.max(0, (b[i] - 0.18) * 1.8));
      const cur = levels[i];
      levels[i] = cur + (target - cur) * (target > cur ? 0.5 : 0.08);
      el.style.setProperty('--e', levels[i].toFixed(3));
    });
  }

  /* ================= Цикл ================= */
  function loop() {
    drawScope();
    flushScheduled();
    animateWord();
    requestAnimationFrame(loop);
  }

  /* ================= Старт ================= */
  if (ARTIFACT) {
    for (const id of ['#midi', '#share']) $(id).closest('.deck-group').hidden = true;
  }
  buildPanel();
  buildKeys();
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(buildKeys, 120);
  });
  if (!loadFromHash()) loadPreset(0, { animate: false });
  updateScreenTitle();
  requestAnimationFrame(loop);

  Object.assign(M, {
    engine,
    ui: {
      state,
      loadPreset,
      powerOn,
      toast,
      readout,
      get base() {
        return state.base;
      },
    },
  });
})();
