/* Мавка — голоси, названі на честь дійових осіб «Лісової пісні» Лесі Українки. */
(function () {
  'use strict';

  const PRESETS = [
    {
      id: 'mavka',
      name: 'Мавка',
      role: 'лісова дівчина',
      text: 'Повітряний звук, що розквітає повільно, як ліс після зими. Два злегка розлаштовані генератори й багато «лісу».',
      p: {
        wave1: 'sawtooth', wave2: 'sawtooth', semi: 0, detune: 16, mix: 0.5, noise: 0.12,
        cutoff: 1500, reso: 1.6, envAmt: 0.28, attack: 0.7, decay: 1.4, sustain: 0.72, release: 2.4,
        lfoRate: 0.22, lfoDepth: 0.38, lfoTarget: 'filter', drive: 0.08,
        delayMix: 0.24, delayTime: 0.42, feedback: 0.38, reverb: 0.62, glide: 0, volume: 0.75, mode: 'poly',
      },
      demo: { tempo: 72, notes: [[57, 0, 6], [64, 0, 6], [69, 0, 6], [72, 0, 6], [55, 6, 6], [62, 6, 6], [67, 6, 6], [71, 6, 6]] },
    },
    {
      id: 'sopilka',
      name: 'Сопілка Лукаша',
      role: 'парубок, що грає на сопілці',
      text: 'Дерев’яний духовий тембр із подихом і легким вібрато. Саме його гра навесні розбудила Мавку.',
      p: {
        wave1: 'triangle', wave2: 'sine', semi: 12, detune: 3, mix: 0.28, noise: 0.34,
        cutoff: 3400, reso: 1, envAmt: 0.14, attack: 0.07, decay: 0.3, sustain: 0.86, release: 0.32,
        lfoRate: 5.2, lfoDepth: 0.42, lfoTarget: 'pitch', drive: 0.05,
        delayMix: 0.2, delayTime: 0.33, feedback: 0.24, reverb: 0.42, glide: 0.07, volume: 0.78, mode: 'poly',
      },
      demo: { tempo: 96, notes: [[69, 0, 2], [72, 2, 1], [74, 3, 1], [76, 4, 3], [74, 7, 1], [72, 8, 2], [74, 10, 1], [72, 11, 1], [69, 12, 4]] },
    },
    {
      id: 'perelesnyk',
      name: 'Перелесник',
      role: 'вогняний дух',
      text: 'Гарячий, трохи перегрітий провідний голос. Різкий фільтр з резонансом спалахує на кожній ноті.',
      p: {
        wave1: 'sawtooth', wave2: 'square', semi: 7, detune: 9, mix: 0.32, noise: 0,
        cutoff: 820, reso: 9, envAmt: 0.66, attack: 0.004, decay: 0.34, sustain: 0.42, release: 0.26,
        lfoRate: 6, lfoDepth: 0.2, lfoTarget: 'pitch', drive: 0.62,
        delayMix: 0.3, delayTime: 0.28, feedback: 0.42, reverb: 0.26, glide: 0.05, volume: 0.66, mode: 'poly',
      },
      demo: { tempo: 124, notes: [[64, 0, 1], [67, 1, 1], [69, 2, 2], [72, 4, 1], [71, 5, 1], [69, 6, 2], [67, 8, 1], [64, 9, 1], [62, 10, 1], [64, 11, 5]] },
    },
    {
      id: 'skelia',
      name: 'Той, що в скалі сидить',
      role: 'темна сила забуття',
      text: 'Низький гул, що повільно дихає і тягне на дно. Генератор на октаву нижче, закритий фільтр, довге згасання.',
      p: {
        wave1: 'sawtooth', wave2: 'square', semi: -12, detune: 7, mix: 0.52, noise: 0.06,
        cutoff: 230, reso: 6.5, envAmt: 0.34, attack: 0.5, decay: 2.2, sustain: 0.8, release: 2.2,
        lfoRate: 0.12, lfoDepth: 0.55, lfoTarget: 'filter', drive: 0.48,
        delayMix: 0.1, delayTime: 0.6, feedback: 0.3, reverb: 0.5, glide: 0, volume: 0.82, mode: 'poly',
      },
      demo: { tempo: 60, notes: [[33, 0, 8], [40, 0, 8], [31, 8, 8], [38, 8, 8]] },
    },
    {
      id: 'poterchata',
      name: 'Потерчата',
      role: 'маленькі болотяні духи',
      text: 'Тендітні скляні дзвіночки, що довго відлунюють над водою. Другий генератор на дуодециму вище дає дзвін.',
      p: {
        wave1: 'sine', wave2: 'triangle', semi: 19, detune: 4, mix: 0.3, noise: 0,
        cutoff: 5600, reso: 2.6, envAmt: 0.4, attack: 0.002, decay: 0.5, sustain: 0, release: 0.7,
        lfoRate: 0.3, lfoDepth: 0.08, lfoTarget: 'pitch', drive: 0,
        delayMix: 0.46, delayTime: 0.36, feedback: 0.56, reverb: 0.5, glide: 0, volume: 0.75, mode: 'poly',
      },
      demo: { tempo: 110, notes: [[81, 0, 1], [76, 1, 1], [79, 2, 1], [84, 3, 1], [81, 4, 1], [76, 6, 1], [74, 7, 1], [72, 8, 2]] },
    },
    {
      id: 'vodianyk',
      name: 'Водяник',
      role: 'старий господар озера',
      text: 'Хвилястий, булькотливий звук: фільтр гойдається, наче вода в очереті.',
      p: {
        wave1: 'square', wave2: 'sawtooth', semi: -12, detune: 22, mix: 0.45, noise: 0.1,
        cutoff: 640, reso: 12, envAmt: 0.3, attack: 0.25, decay: 1, sustain: 0.62, release: 1.5,
        lfoRate: 1.7, lfoDepth: 0.62, lfoTarget: 'filter', drive: 0.16,
        delayMix: 0.34, delayTime: 0.5, feedback: 0.46, reverb: 0.58, glide: 0, volume: 0.74, mode: 'poly',
      },
      demo: { tempo: 80, notes: [[45, 0, 8], [57, 0, 8], [60, 0, 8], [64, 0, 8], [43, 8, 8], [55, 8, 8], [59, 8, 8], [62, 8, 8]] },
    },
    {
      id: 'lisovyk',
      name: 'Лісовик',
      role: 'старий опікун лісу',
      text: 'Теплий органний звук, лагідний і трохи старомодний. Легке тремоло — як голос діда, що давно все бачив.',
      p: {
        wave1: 'square', wave2: 'sine', semi: 12, detune: 2, mix: 0.42, noise: 0,
        cutoff: 2300, reso: 0.7, envAmt: 0.05, attack: 0.012, decay: 0.2, sustain: 0.92, release: 0.16,
        lfoRate: 6.4, lfoDepth: 0.22, lfoTarget: 'amp', drive: 0.3,
        delayMix: 0.08, delayTime: 0.3, feedback: 0.2, reverb: 0.36, glide: 0, volume: 0.72, mode: 'poly',
      },
      demo: { tempo: 84, notes: [[57, 0, 4], [60, 0, 4], [64, 0, 4], [55, 4, 4], [59, 4, 4], [62, 4, 4], [53, 8, 4], [57, 8, 4], [60, 8, 4], [52, 12, 4], [56, 12, 4], [59, 12, 4]] },
    },
    {
      id: 'kuts',
      name: 'Куць',
      role: 'молодий чортик-пустун',
      text: 'Пружний бас із різким резонансним фільтром, що підстрибує на кожній ноті. Перемкніть «голоси» на «одну ноту» — і він почне ковзати з ноти на ноту.',
      p: {
        wave1: 'square', wave2: 'sawtooth', semi: -12, detune: 10, mix: 0.5, noise: 0,
        cutoff: 480, reso: 11, envAmt: 0.78, attack: 0.002, decay: 0.22, sustain: 0.14, release: 0.12,
        lfoRate: 1, lfoDepth: 0, lfoTarget: 'filter', drive: 0.5,
        delayMix: 0.18, delayTime: 0.18, feedback: 0.3, reverb: 0.14, glide: 0.1, volume: 0.76, mode: 'poly',
      },
      demo: { tempo: 116, notes: [[45, 0, 1], [45, 2, 1], [57, 3, 1], [45, 4, 1], [48, 6, 1], [50, 7, 1], [52, 8, 1], [45, 10, 1], [55, 11, 1], [57, 12, 2], [52, 14, 2]] },
    },
  ];

  // підписи й формат значень для панелі
  const fmtHz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',')} кГц` : `${Math.round(v)} Гц`);
  const fmtSec = (v) => (v < 1 ? `${Math.round(v * 1000)} мс` : `${v.toFixed(1).replace('.', ',')} с`);
  const fmtPct = (v) => `${Math.round(v * 100)} %`;
  const INTERVALS = { 0: 'унісон', 3: 'мала терція', 4: 'велика терція', 5: 'кварта', 7: 'квінта', 12: 'октава', 19: 'дуодецима', 24: 'дві октави' };

  const META = {
    wave1: { label: 'форма 1' },
    wave2: { label: 'форма 2' },
    semi: { label: 'інтервал', fmt: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} пт${INTERVALS[Math.abs(v)] ? ', ' + INTERVALS[Math.abs(v)] : ''}` },
    detune: { label: 'розлад', fmt: (v) => `${Math.round(v)} центів` },
    mix: { label: 'баланс', fmt: (v) => `${Math.round((1 - v) * 100)} / ${Math.round(v * 100)}` },
    noise: { label: 'подих', fmt: fmtPct },
    cutoff: { label: 'зріз', fmt: fmtHz },
    reso: { label: 'резонанс', fmt: (v) => `Q ${v.toFixed(1).replace('.', ',')}` },
    envAmt: { label: 'розкриття', fmt: fmtPct },
    attack: { label: 'атака', fmt: fmtSec },
    decay: { label: 'спад', fmt: fmtSec },
    sustain: { label: 'рівень', fmt: fmtPct },
    release: { label: 'згасання', fmt: fmtSec },
    lfoRate: { label: 'швидкість', fmt: (v) => `${v < 1 ? v.toFixed(2).replace('.', ',') : v.toFixed(1).replace('.', ',')} Гц` },
    lfoDepth: { label: 'глибина', fmt: fmtPct },
    lfoTarget: { label: 'що гойдати' },
    drive: { label: 'тепло', fmt: fmtPct },
    delayMix: { label: 'відлуння', fmt: fmtPct },
    delayTime: { label: 'час', fmt: fmtSec },
    feedback: { label: 'повтори', fmt: fmtPct },
    reverb: { label: 'ліс', fmt: fmtPct },
    glide: { label: 'ковзання', fmt: (v) => (v < 0.005 ? 'вимк.' : fmtSec(v)) },
    volume: { label: 'гучність', fmt: fmtPct },
    mode: { label: 'голоси' },
  };

  const WAVE_NAMES = { sine: 'синус', triangle: 'трикутник', sawtooth: 'пилка', square: 'меандр' };
  const TARGET_NAMES = { pitch: 'тон', filter: 'фільтр', amp: 'гучність' };
  const MODE_NAMES = { poly: 'акорди', mono: 'одна нота' };

  window.Mavka = window.Mavka || {};
  Object.assign(window.Mavka, { PRESETS, META, WAVE_NAMES, TARGET_NAMES, MODE_NAMES });
})();
