/*
 * Мавка — звуковий рушій на Web Audio API.
 * Два генератори й шум → 24-дБ фільтр → підсилювач з обвідною → тепло (сатурація)
 * → пінг-понг відлуння й «ліс» (згенерована реверберація) → лімітер.
 */
(function () {
  'use strict';

  const PARAMS = {
    wave1: { type: 'enum', options: ['sine', 'triangle', 'sawtooth', 'square'], def: 'sawtooth' },
    wave2: { type: 'enum', options: ['sine', 'triangle', 'sawtooth', 'square'], def: 'sawtooth' },
    semi: { min: -24, max: 24, def: 0, step: 1 },
    detune: { min: 0, max: 50, def: 10 },
    mix: { min: 0, max: 1, def: 0.5 },
    noise: { min: 0, max: 1, def: 0 },
    cutoff: { min: 40, max: 16000, def: 2000, curve: 'exp' },
    reso: { min: 0.5, max: 22, def: 2, curve: 'exp' },
    envAmt: { min: 0, max: 1, def: 0.3 },
    attack: { min: 0.002, max: 4, def: 0.01, curve: 'exp' },
    decay: { min: 0.02, max: 4, def: 0.4, curve: 'exp' },
    sustain: { min: 0, max: 1, def: 0.6 },
    release: { min: 0.02, max: 6, def: 0.5, curve: 'exp' },
    lfoRate: { min: 0.05, max: 14, def: 1, curve: 'exp' },
    lfoDepth: { min: 0, max: 1, def: 0 },
    lfoTarget: { type: 'enum', options: ['pitch', 'filter', 'amp'], def: 'filter' },
    drive: { min: 0, max: 1, def: 0.1 },
    delayMix: { min: 0, max: 1, def: 0.2 },
    delayTime: { min: 0.05, max: 1.2, def: 0.35, curve: 'exp' },
    feedback: { min: 0, max: 0.9, def: 0.35 },
    reverb: { min: 0, max: 1, def: 0.35 },
    glide: { min: 0, max: 0.6, def: 0 },
    volume: { min: 0, max: 1, def: 0.75 },
    mode: { type: 'enum', options: ['poly', 'mono'], def: 'poly' },
  };

  const WAVE_GAIN = { sine: 1, triangle: 0.85, sawtooth: 0.5, square: 0.42 };
  const MAX_VOICES = 12;
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

  function defaults() {
    const p = {};
    for (const [k, d] of Object.entries(PARAMS)) p[k] = d.def;
    return p;
  }

  // значення ↔ положення ручки 0..1
  function toNorm(key, value) {
    const d = PARAMS[key];
    if (d.type === 'enum') return d.options.indexOf(value) / (d.options.length - 1);
    if (d.curve === 'exp') return Math.log(value / d.min) / Math.log(d.max / d.min);
    return (value - d.min) / (d.max - d.min);
  }

  function fromNorm(key, v) {
    const d = PARAMS[key];
    v = Math.min(1, Math.max(0, v));
    if (d.type === 'enum') return d.options[Math.round(v * (d.options.length - 1))];
    let x = d.curve === 'exp' ? d.min * Math.pow(d.max / d.min, v) : d.min + (d.max - d.min) * v;
    if (d.step) x = Math.round(x / d.step) * d.step;
    return x;
  }

  function holdAt(param, t) {
    if (param.cancelAndHoldAtTime) {
      param.cancelAndHoldAtTime(t);
    } else {
      const v = param.value;
      param.cancelScheduledValues(t);
      param.setValueAtTime(v, t);
    }
  }

  // «Ліс»: дифузна реверберація з темним хвостом
  function makeImpulse(ctx, seconds) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const white = Math.random() * 2 - 1;
        // хвіст темнішає з часом, як звук серед дерев
        const k = 0.55 - 0.45 * t;
        lp += (white - lp) * k;
        const env = Math.pow(1 - t, 2.4) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
        d[i] = lp * env;
      }
      // ранні відбиття від стовбурів
      const taps = [0.017, 0.029, 0.041, 0.056, 0.071, 0.093];
      taps.forEach((tt, j) => {
        const idx = Math.floor((tt + ch * 0.004) * rate);
        if (idx < len) d[idx] += (0.6 - j * 0.08) * (j % 2 ? -1 : 1);
      });
    }
    return buf;
  }

  function driveCurve(amount) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = amount * 24;
    const norm = (1 + k) / (1 + k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = (((1 + k) * x) / (1 + k * Math.abs(x))) * norm;
    }
    return curve;
  }

  class Voice {
    constructor(engine, note, when, vel) {
      const ctx = engine.ctx;
      const p = engine.p;
      this.engine = engine;
      this.note = note;
      this.released = false;
      this.start = when;
      const f = mtof(note);

      this.o1 = ctx.createOscillator();
      this.o1.type = p.wave1;
      this.o1.frequency.setValueAtTime(f, when);
      this.o1.detune.value = -p.detune / 2;

      this.o2 = ctx.createOscillator();
      this.o2.type = p.wave2;
      this.o2.frequency.setValueAtTime(f, when);
      this.o2.detune.value = p.semi * 100 + p.detune / 2;

      this.g1 = ctx.createGain();
      this.g2 = ctx.createGain();
      this.gn = ctx.createGain();
      this.updateMix();

      this.noise = ctx.createBufferSource();
      this.noise.buffer = engine.noiseBuf;
      this.noise.loop = true;

      this.f1 = ctx.createBiquadFilter();
      this.f2 = ctx.createBiquadFilter();
      this.f1.type = this.f2.type = 'lowpass';
      this.updateFilter(when, true);

      this.vca = ctx.createGain();
      this.vca.gain.value = 0;
      this.trem = ctx.createGain();
      this.trem.gain.value = 1;

      this.o1.connect(this.g1).connect(this.f1);
      this.o2.connect(this.g2).connect(this.f1);
      this.noise.connect(this.gn).connect(this.f1);
      this.f1.connect(this.f2).connect(this.vca).connect(this.trem).connect(engine.bus);

      engine.lfoPitch.connect(this.o1.detune);
      engine.lfoPitch.connect(this.o2.detune);
      engine.lfoFilter.connect(this.f1.detune);
      engine.lfoFilter.connect(this.f2.detune);
      engine.lfoAmp.connect(this.trem.gain);

      // обвідні
      const A = p.attack;
      const D = p.decay;
      const S = p.sustain;
      const peak = 0.3 * vel;
      this.env = { A, D, S, peak, amt: p.envAmt * 4800 };
      this.vca.gain.setValueAtTime(0, when);
      this.vca.gain.linearRampToValueAtTime(peak, when + A);
      this.vca.gain.setTargetAtTime(peak * S, when + A, D / 3 + 0.001);
      const amt = p.envAmt * 4800;
      for (const f of [this.f1, this.f2]) {
        f.detune.setValueAtTime(0, when);
        f.detune.linearRampToValueAtTime(amt, when + A);
        f.detune.setTargetAtTime(amt * S, when + A, D / 3 + 0.001);
      }

      this.o1.start(when);
      this.o2.start(when);
      this.noise.start(when, Math.random() * 1.5);
      this.o1.onended = () => this.dispose();
    }

    updateMix() {
      const p = this.engine.p;
      this.g1.gain.value = (1 - p.mix) * WAVE_GAIN[p.wave1];
      this.g2.gain.value = p.mix * WAVE_GAIN[p.wave2];
      this.gn.gain.value = p.noise * p.noise * 0.5;
    }

    updateFilter(t, immediate) {
      const p = this.engine.p;
      const freq = Math.min(p.cutoff, this.engine.ctx.sampleRate / 2.2);
      if (immediate) {
        this.f1.frequency.setValueAtTime(freq, t);
        this.f2.frequency.setValueAtTime(freq, t);
      } else {
        this.f1.frequency.setTargetAtTime(freq, t, 0.015);
        this.f2.frequency.setTargetAtTime(freq, t, 0.015);
      }
      this.f1.Q.setTargetAtTime(p.reso, t, 0.02);
      this.f2.Q.setTargetAtTime(Math.max(0.5, p.reso * 0.3), t, 0.02);
    }

    glideTo(note, when, glide) {
      this.note = note;
      const f = mtof(note);
      for (const o of [this.o1, this.o2]) {
        holdAt(o.frequency, when);
        if (glide > 0.001) o.frequency.setTargetAtTime(f, when, glide / 3);
        else o.frequency.setValueAtTime(f, when);
      }
    }

    // значення обвідної в момент t (для браузерів без cancelAndHoldAtTime)
    envAt(t, peak) {
      const { A, D, S } = this.env;
      const dt = t - this.start;
      if (dt <= 0) return 0;
      if (dt < A) return (peak * dt) / A;
      return peak * S + (peak - peak * S) * Math.exp(-(dt - A) / (D / 3 + 0.001));
    }

    hold(param, t, peak) {
      if (param.cancelAndHoldAtTime) {
        param.cancelAndHoldAtTime(t);
      } else {
        param.cancelScheduledValues(t);
        param.setValueAtTime(this.envAt(t, peak), t);
      }
    }

    release(when) {
      if (this.released) return;
      this.released = true;
      const R = this.engine.p.release;
      this.hold(this.vca.gain, when, this.env.peak);
      this.vca.gain.setTargetAtTime(0, when, R / 4 + 0.001);
      for (const f of [this.f1, this.f2]) {
        this.hold(f.detune, when, this.env.amt);
        f.detune.setTargetAtTime(0, when, R / 4 + 0.001);
      }
      const end = when + R * 1.6 + 0.08;
      this.o1.stop(end);
      this.o2.stop(end);
      this.noise.stop(end);
      this.end = end;
    }

    kill(when) {
      this.released = true;
      this.hold(this.vca.gain, when, this.env.peak);
      this.vca.gain.setTargetAtTime(0, when, 0.008);
      const end = when + 0.06;
      try {
        this.o1.stop(end);
        this.o2.stop(end);
        this.noise.stop(end);
      } catch (e) {
        /* вже зупинено */
      }
      this.end = end;
    }

    dispose() {
      const e = this.engine;
      try {
        e.lfoPitch.disconnect(this.o1.detune);
        e.lfoPitch.disconnect(this.o2.detune);
        e.lfoFilter.disconnect(this.f1.detune);
        e.lfoFilter.disconnect(this.f2.detune);
        e.lfoAmp.disconnect(this.trem.gain);
      } catch (err) {
        /* уже від'єднано */
      }
      this.trem.disconnect();
      const i = e.voices.indexOf(this);
      if (i >= 0) e.voices.splice(i, 1);
    }
  }

  class Engine {
    constructor() {
      this.p = defaults();
      this.ctx = null;
      this.voices = [];
      this.held = new Map();
      this.monoStack = [];
      this.monoVoice = null;
      this.listeners = new Set();
    }

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    emit(type, detail) {
      for (const fn of this.listeners) fn(type, detail);
    }

    get running() {
      return !!this.ctx && this.ctx.state === 'running';
    }

    get now() {
      return this.ctx ? this.ctx.currentTime : 0;
    }

    async start() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('Web Audio не підтримується');
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      this.applyGlobal('volume');
      this.emit('power', true);
    }

    // вимкнення без клацання: короткий спад гучності, потім пауза контексту
    async stop() {
      if (!this.ctx) return;
      this.allOff();
      const g = this.out.gain;
      const t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + 0.04);
      await new Promise((r) => setTimeout(r, 90));
      await this.ctx.suspend();
      this.emit('power', false);
    }

    build() {
      const ctx = this.ctx;
      const g = (v = 1) => {
        const n = ctx.createGain();
        n.gain.value = v;
        return n;
      };
      this.bus = g(1);
      this.driveIn = g(1);
      this.shaper = ctx.createWaveShaper();
      this.shaper.oversample = '2x';
      this.driveOut = g(1);
      this.bus.connect(this.driveIn).connect(this.shaper).connect(this.driveOut);

      this.master = g(1);
      this.dry = g(1);
      this.driveOut.connect(this.dry).connect(this.master);

      // пінг-понг відлуння
      this.delaySend = g(0);
      this.delayTone = ctx.createBiquadFilter();
      this.delayTone.type = 'lowpass';
      this.delayTone.frequency.value = 3600;
      this.dl = ctx.createDelay(2);
      this.dr = ctx.createDelay(2);
      this.fb = g(0.35);
      const merger = ctx.createChannelMerger(2);
      this.delayWet = g(0.9);
      this.driveOut.connect(this.delaySend).connect(this.delayTone).connect(this.dl);
      this.dl.connect(this.dr);
      this.dr.connect(this.fb).connect(this.dl);
      this.dl.connect(merger, 0, 0);
      this.dr.connect(merger, 0, 1);
      merger.connect(this.delayWet).connect(this.master);

      // «ліс»
      this.reverbSend = g(0);
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = makeImpulse(ctx, 3.6);
      this.reverbWet = g(0.8);
      this.driveOut.connect(this.reverbSend);
      this.delayWet.connect(this.reverbSend);
      this.reverbSend.connect(this.convolver).connect(this.reverbWet).connect(this.master);

      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -12;
      this.comp.knee.value = 10;
      this.comp.ratio.value = 8;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.22;
      this.out = g(0.8);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.72;
      this.master.connect(this.comp).connect(this.out).connect(this.analyser).connect(ctx.destination);

      // генератор руху
      this.lfo = ctx.createOscillator();
      this.lfo.type = 'sine';
      this.lfoPitch = g(0);
      this.lfoFilter = g(0);
      this.lfoAmp = g(0);
      this.lfo.connect(this.lfoPitch);
      this.lfo.connect(this.lfoFilter);
      this.lfo.connect(this.lfoAmp);
      this.lfo.start();

      // шум
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      this.timeData = new Float32Array(this.analyser.fftSize);
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

      for (const k of Object.keys(this.p)) this.applyGlobal(k);
    }

    set(key, value) {
      this.p[key] = value;
      if (this.ctx) {
        this.applyGlobal(key);
        this.applyVoices(key);
      }
      this.emit('param', { key, value });
    }

    setMany(obj) {
      for (const [k, v] of Object.entries(obj)) {
        if (k in PARAMS) this.set(k, v);
      }
    }

    applyGlobal(key) {
      const p = this.p;
      const t = this.ctx.currentTime;
      switch (key) {
        case 'drive':
          this.shaper.curve = driveCurve(p.drive);
          this.driveIn.gain.setTargetAtTime(1 + p.drive * 1.6, t, 0.02);
          this.driveOut.gain.setTargetAtTime(1 / (1 + p.drive * 1.1), t, 0.02);
          break;
        case 'delayMix':
          this.delaySend.gain.setTargetAtTime(p.delayMix * 0.8, t, 0.03);
          break;
        case 'delayTime':
          this.dl.delayTime.setTargetAtTime(p.delayTime, t, 0.05);
          this.dr.delayTime.setTargetAtTime(p.delayTime, t, 0.05);
          break;
        case 'feedback':
          this.fb.gain.setTargetAtTime(p.feedback, t, 0.03);
          break;
        case 'reverb':
          this.reverbSend.gain.setTargetAtTime(p.reverb * 0.9, t, 0.03);
          this.dry.gain.setTargetAtTime(1 - p.reverb * 0.35, t, 0.03);
          break;
        case 'volume':
          this.out.gain.setTargetAtTime(p.volume * p.volume * 1.1, t, 0.02);
          break;
        case 'lfoRate':
          this.lfo.frequency.setTargetAtTime(p.lfoRate, t, 0.02);
          break;
        case 'lfoDepth':
        case 'lfoTarget': {
          const dep = p.lfoDepth;
          this.lfoPitch.gain.setTargetAtTime(p.lfoTarget === 'pitch' ? dep * dep * 120 : 0, t, 0.02);
          this.lfoFilter.gain.setTargetAtTime(p.lfoTarget === 'filter' ? dep * 3000 : 0, t, 0.02);
          this.lfoAmp.gain.setTargetAtTime(p.lfoTarget === 'amp' ? dep * 0.6 : 0, t, 0.02);
          break;
        }
        case 'mode':
          this.allOff();
          break;
        default:
          break;
      }
    }

    applyVoices(key) {
      const t = this.ctx.currentTime;
      for (const v of this.voices) {
        if (key === 'cutoff' || key === 'reso') v.updateFilter(t, false);
        else if (key === 'mix' || key === 'noise') v.updateMix();
        else if (key === 'wave1') {
          v.o1.type = this.p.wave1;
          v.updateMix();
        } else if (key === 'wave2') {
          v.o2.type = this.p.wave2;
          v.updateMix();
        } else if (key === 'semi' || key === 'detune') {
          v.o1.detune.setTargetAtTime(-this.p.detune / 2, t, 0.01);
          v.o2.detune.setTargetAtTime(this.p.semi * 100 + this.p.detune / 2, t, 0.01);
        }
      }
    }

    // крадіжка голосу: рахуємо лише ті, що звучать саме в момент when
    steal(when) {
      const active = this.voices.filter((v) => v.start <= when + 0.001 && (!v.released || v.end > when));
      if (active.length < MAX_VOICES) return;
      const victim = active.find((v) => v.released) || active[0];
      victim.kill(when);
    }

    newVoice(note, when, vel) {
      this.steal(when);
      const v = new Voice(this, note, when, vel);
      this.voices.push(v);
      return v;
    }

    noteOn(note, vel = 0.85) {
      if (!this.running) return;
      const t = this.ctx.currentTime + 0.005;
      if (this.p.mode === 'mono') {
        this.monoStack = this.monoStack.filter((n) => n !== note);
        this.monoStack.push(note);
        if (this.monoVoice && !this.monoVoice.released) {
          this.monoVoice.glideTo(note, t, this.p.glide);
        } else {
          this.monoVoice = this.newVoice(note, t, vel);
        }
        this.emit('note', { note, on: true, when: t });
        return;
      }
      if (this.held.has(note)) return;
      this.held.set(note, this.newVoice(note, t, vel));
      this.emit('note', { note, on: true, when: t });
    }

    noteOff(note) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.005;
      if (this.p.mode === 'mono') {
        this.monoStack = this.monoStack.filter((n) => n !== note);
        if (this.monoVoice && !this.monoVoice.released) {
          if (this.monoStack.length) this.monoVoice.glideTo(this.monoStack[this.monoStack.length - 1], t, this.p.glide);
          else this.monoVoice.release(t);
        }
        this.emit('note', { note, on: false, when: t });
        return;
      }
      const v = this.held.get(note);
      if (!v) return;
      this.held.delete(note);
      v.release(t);
      this.emit('note', { note, on: false, when: t });
    }

    // нота за розкладом — для секвенсора й демо
    play(note, when, dur, vel = 0.8) {
      if (!this.running) return;
      const t = Math.max(when, this.ctx.currentTime + 0.002);
      const v = this.newVoice(note, t, vel);
      v.release(t + dur);
      this.emit('note', { note, on: true, when: t });
      this.emit('note', { note, on: false, when: t + dur });
    }

    allOff() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      for (const v of this.voices) v.release(t);
      this.held.clear();
      this.monoStack = [];
      this.monoVoice = null;
      this.emit('alloff');
    }

    /* ---------- Аналіз ---------- */
    waveform() {
      if (!this.analyser) return null;
      this.analyser.getFloatTimeDomainData(this.timeData);
      return this.timeData;
    }

    spectrum() {
      if (!this.analyser) return null;
      this.analyser.getByteFrequencyData(this.freqData);
      return this.freqData;
    }

    // енергія в смугах частот (Гц) → 0..1
    bands(edges) {
      const data = this.spectrum();
      if (!data) return edges.slice(1).map(() => 0);
      const binHz = this.ctx.sampleRate / this.analyser.fftSize;
      const out = [];
      for (let i = 0; i < edges.length - 1; i++) {
        const a = Math.max(1, Math.floor(edges[i] / binHz));
        const b = Math.max(a + 1, Math.floor(edges[i + 1] / binHz));
        let s = 0;
        for (let k = a; k < b; k++) s += data[k];
        out.push(s / (b - a) / 255);
      }
      return out;
    }

    /* ---------- Запис ---------- */
    canRecord() {
      return typeof window.MediaRecorder !== 'undefined';
    }

    startRecording() {
      if (!this.ctx || !this.canRecord()) return false;
      if (!this.recDest) {
        this.recDest = this.ctx.createMediaStreamDestination();
        this.out.connect(this.recDest);
      }
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const mimeType = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
      this.chunks = [];
      this.recorder = new MediaRecorder(this.recDest.stream, mimeType ? { mimeType } : undefined);
      this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
      this.recorder.start();
      this.recStart = performance.now();
      return true;
    }

    stopRecording() {
      return new Promise((resolve) => {
        if (!this.recorder || this.recorder.state === 'inactive') {
          resolve(null);
          return;
        }
        this.recorder.onstop = () => {
          const type = this.recorder.mimeType || 'audio/webm';
          const blob = new Blob(this.chunks, { type });
          resolve({ blob, type, seconds: (performance.now() - this.recStart) / 1000 });
        };
        this.recorder.stop();
      });
    }

    get recording() {
      return !!this.recorder && this.recorder.state === 'recording';
    }
  }

  window.Mavka = window.Mavka || {};
  Object.assign(window.Mavka, { Engine, PARAMS, defaults, toNorm, fromNorm, mtof });
})();
