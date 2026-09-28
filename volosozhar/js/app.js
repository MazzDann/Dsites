/* Волосожар — головна сцена: небо, керування, пошук, картка об'єкта. */
(function () {
  'use strict';

  const A = window.Astro;
  const D = window.SkyData;
  const F = window.Fmt;
  const R = window.SkyRender;
  const RAD = A.RAD;
  const DEG = A.DEG;

  const $ = (s, el = document) => el.querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem('volosozhar:' + k);
        return v === null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('volosozhar:' + k, JSON.stringify(v));
      } catch (e) {
        /* приватний режим — не страшно */
      }
    },
  };

  const VIEWS = {
    horizon: { alt: 24, fov: 112 },
    dome: { alt: 90, fov: 198 },
  };

  const SPEEDS = [
    { v: 60, label: '1 хв/с' },
    { v: 600, label: '10 хв/с' },
    { v: 3600, label: '1 год/с' },
  ];

  const LAYERS = [
    { id: 'lines', name: 'Лінії сузір’їв' },
    { id: 'cnames', name: 'Назви сузір’їв' },
    { id: 'snames', name: 'Назви зір' },
    { id: 'folk', name: 'Народне небо', note: 'Бурштинові лінії й назви' },
    { id: 'mw', name: 'Чумацький Шлях' },
    { id: 'dso', name: 'Туманності й скупчення' },
    { id: 'grid', name: 'Сітка висот' },
    { id: 'ecliptic', name: 'Екліптика', note: 'Шлях Сонця і планет' },
    { id: 'trails', name: 'Сліди зір', note: 'Довга витримка, як на фото' },
  ];

  function placeFromStore() {
    const saved = store.get('place', null);
    if (saved && saved.geo) {
      return { id: 'geo', name: 'Ваше місце', over: 'вами', lat: saved.lat, lon: saved.lon, tz: F.LOCAL };
    }
    const c = D.CITIES.find((x) => x.id === (saved && saved.id)) || D.CITIES[0];
    return { ...c, tz: F.KYIV };
  }

  const state = {
    time: new Date(),
    live: true,
    playing: false,
    speedIdx: 1,
    place: placeFromStore(),
    level: D.SKY_LEVELS.find((l) => l.id === store.get('level', 'village')) || D.SKY_LEVELS[2],
    layers: Object.assign(
      { lines: true, cnames: true, snames: true, folk: true, mw: true, dso: true, grid: false, ecliptic: false, trails: false },
      store.get('layers', {}),
      { trails: false }
    ),
    view: store.get('view', 'horizon'),
    cam: { az: 180, alt: 2, fov: 112 },
    anim: null,
    inertia: null,
    selected: null,
    follow: false,
    snap: null,
    lim: 5.7,
    baseLim: 5.7,
    stats: { visible: 0, brightest: [] },
    catalogReady: false,
    visible: true,
  };

  const els = {
    sky: $('#sky'),
    gl: $('#sky-gl'),
    c2d: $('#sky-2d'),
    headline: $('#headline'),
    subline: $('#subline'),
    whenDate: $('#when-date'),
    whenTime: $('#when-time'),
    strip: $('#strip'),
    stripCanvas: $('#strip-canvas'),
    thumb: $('#strip-thumb'),
    play: $('#play-btn'),
    speed: $('#speed-btn'),
    now: $('#now-btn'),
    card: $('#card'),
    toast: $('#toast'),
    veil: $('#load-veil'),
  };

  const sky = new R.Sky(els.gl, els.c2d);

  /* ================= Каталог ================= */
  // стиснутий каталог лежить поруч зі сторінкою: data/catalog.json
  async function loadLocal() {
    const r = await fetch('data/catalog.json');
    if (!r.ok) throw new Error('catalog.json ' + r.status);
    const c = await r.json();
    const point = (lon, lat) => ({ coordinates: [lon, lat] });
    return {
      stars: { features: c.stars.map(([id, lon, lat, mag, bv]) => ({ id, properties: { mag, bv }, geometry: point(lon, lat) })) },
      lines: { features: c.lines.map(([id, rank, coordinates]) => ({ id, properties: { rank }, geometry: { coordinates } })) },
      consts: { features: c.consts.map(([id, rank, lon, lat]) => ({ id, properties: { rank }, geometry: point(lon, lat) })) },
      dsos: {
        features: c.dsos.map(([id, desig, type, mag, dim, lon, lat]) => ({ id, properties: { desig, type, mag, dim }, geometry: point(lon, lat) })),
      },
      names: Object.fromEntries(Object.entries(c.names).map(([hip, [name, bayer, flam, con]]) => [hip, { name, bayer, flam, c: con }])),
    };
  }

  // запасний шлях — оригінальні файли з jsDelivr (коли сторінку відкрито просто з диска)
  async function loadRemote() {
    const get = (f) =>
      fetch(D.CATALOG + f).then((r) => {
        if (!r.ok) throw new Error(f + ' ' + r.status);
        return r.json();
      });
    const [stars, lines, consts, dsos] = await Promise.all([
      get('stars.6.json'),
      get('constellations.lines.json'),
      get('constellations.json'),
      get('messier.json').catch(() => null),
    ]);
    return { stars, lines, consts, dsos, names: get('starnames.json') };
  }

  async function loadCatalog() {
    try {
      const json = await loadLocal().catch(loadRemote);
      const { stars, lines, consts, dsos } = json;
      const cat = R.buildCatalog({ stars, lines, consts, dsos });
      sky.setCatalog(cat);
      state.catalogReady = true;
      window.dispatchEvent(new CustomEvent('catalog', { detail: cat }));
      lastHeadline = 0;
      Promise.resolve(json.names)
        .then((names) => {
          R.applyNames(cat, names);
          buildSearchIndex();
          window.dispatchEvent(new CustomEvent('names', { detail: cat }));
          if (state.selected) showCard(state.selected);
        })
        .catch(() => buildSearchIndex());
      buildSearchIndex();
    } catch (err) {
      console.error(err);
      state.catalogError = true;
      lastHeadline = 0;
    }
  }

  /* ================= Розмір ================= */
  function resize() {
    const r = els.sky.getBoundingClientRect();
    sky.resize(r.width, r.height);
    const bar = document.getElementById('bar').getBoundingClientRect();
    const tb = document.getElementById('timebar').getBoundingClientRect();
    const views = document.querySelector('.views').getBoundingClientRect();
    const lede = document.querySelector('.lede').getBoundingClientRect();
    sky.insets = {
      top: bar.height + 8,
      bottom: Math.max(0, r.bottom - Math.min(tb.top, views.top)) + 8,
      portraitBottom: Math.max(0, r.bottom - lede.top - 150),
      portraitFull: Math.max(0, r.bottom - lede.top + 12),
    };
  }
  function measureInsets() {
    const r = els.sky.getBoundingClientRect();
    const lede = document.querySelector('.lede').getBoundingClientRect();
    if (sky.insets) {
      sky.insets.portraitBottom = Math.max(0, r.bottom - lede.top - 150);
      sky.insets.portraitFull = Math.max(0, r.bottom - lede.top + 12);
    }
  }
  new ResizeObserver(resize).observe(els.sky);
  resize();

  new IntersectionObserver((entries) => {
    state.visible = entries[0].isIntersecting;
  }).observe(els.sky);

  /* ================= Граничні зоряні величини ================= */
  function limitingMag(snap) {
    const base = state.level.lim;
    let lim = base;
    const sa = snap.sun.alt;
    if (sa > -18) {
      let tw;
      if (sa >= 0) tw = -3.8;
      else if (sa >= -6) tw = 0.6 + (-sa / 6) * 2.4;
      else if (sa >= -12) tw = 3.0 + ((-sa - 6) / 6) * 1.8;
      else tw = 4.8 + ((-sa - 12) / 6) * 1.7;
      lim = Math.min(lim, tw);
    }
    const m = snap.moon;
    if (m.alt > 0 && sa < -6) lim -= 0.9 * m.illum * Math.min(1, m.alt / 20) * (base > 5 ? 1 : 0.5);
    return lim;
  }

  /* ================= Камера ================= */
  function setView(name, animate = true) {
    state.view = name;
    store.set('view', name);
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
    const target = { az: state.cam.az, ...VIEWS[name] };
    if (name === 'dome') target.az = 180;
    flyTo(target, animate ? 1100 : 0);
    if (name === 'dome') setFollow(false);
  }

  function flyTo(target, ms = 1000) {
    state.inertia = null;
    if (reduceMotion || ms === 0) {
      Object.assign(state.cam, target);
      state.anim = null;
      return;
    }
    const from = { ...state.cam };
    let daz = ((((target.az ?? from.az) - from.az + 540) % 360) + 360) % 360 - 180;
    state.anim = {
      from,
      to: { az: from.az + daz, alt: target.alt ?? from.alt, fov: target.fov ?? from.fov },
      t0: performance.now(),
      dur: ms,
    };
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function stepCamera(now, dt) {
    if (state.anim) {
      const a = state.anim;
      const t = clamp((now - a.t0) / a.dur, 0, 1);
      const e = ease(t);
      state.cam.az = a.from.az + (a.to.az - a.from.az) * e;
      state.cam.alt = a.from.alt + (a.to.alt - a.from.alt) * e;
      state.cam.fov = a.from.fov + (a.to.fov - a.from.fov) * e;
      if (t >= 1) state.anim = null;
    } else if (state.inertia && !dragging) {
      const k = Math.pow(0.9, dt / 16);
      state.inertia.vaz *= k;
      state.inertia.valt *= k;
      state.cam.az += state.inertia.vaz * dt;
      state.cam.alt = clamp(state.cam.alt + state.inertia.valt * dt, -6, 90);
      if (Math.abs(state.inertia.vaz) + Math.abs(state.inertia.valt) < 0.0005) state.inertia = null;
    }
    state.cam.az = ((state.cam.az % 360) + 360) % 360;
  }

  function degPerPx() {
    const V = sky.view(state.cam);
    return (DEG / V.scale) * sky.dpr;
  }

  /* ================= Взаємодія з небом ================= */
  const pointers = new Map();
  let dragging = false;
  let moved = false;
  let pinch = null;
  let lastMove = null;

  els.c2d.addEventListener('pointerdown', (e) => {
    els.c2d.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    state.anim = null;
    state.inertia = null;
    if (pointers.size === 1) {
      dragging = true;
      moved = false;
      lastMove = { x: e.clientX, y: e.clientY, t: performance.now(), vaz: 0, valt: 0 };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: state.cam.fov };
      moved = true;
    }
  });

  els.c2d.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.cam.fov = clamp((pinch.fov * pinch.d) / Math.max(d, 10), 8, 200);
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(e.clientX - lastMove.x) + Math.abs(e.clientY - lastMove.y) > 3) moved = true;
    if (!moved) return;
    if (state.follow) setFollow(false);
    const now = performance.now();
    const dtm = Math.max(1, now - lastMove.t);
    let daz = 0;
    let dalt = 0;
    if (state.cam.alt > 80) {
      const r = els.sky.getBoundingClientRect();
      const Vc = sky.view(state.cam);
      const cx = r.left + Vc.cx / sky.dpr;
      const cy = r.top + Vc.cy / sky.dpr;
      const a0 = Math.atan2(prev.y - cy, prev.x - cx);
      const a1 = Math.atan2(e.clientY - cy, e.clientX - cx);
      let da = (a1 - a0) * DEG;
      if (da > 180) da -= 360;
      if (da < -180) da += 360;
      daz = da;
    } else {
      const k = degPerPx();
      daz = (-dx * k) / Math.max(0.35, Math.cos(state.cam.alt * RAD));
      dalt = dy * k;
    }
    state.cam.az += daz;
    state.cam.alt = clamp(state.cam.alt + dalt, -6, 90);
    lastMove = { x: e.clientX, y: e.clientY, t: now, vaz: daz / dtm, valt: dalt / dtm };
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (!moved && e.type === 'pointerup') {
        const r = els.c2d.getBoundingClientRect();
        handlePick(e.clientX - r.left, e.clientY - r.top);
      } else if (moved && lastMove && performance.now() - lastMove.t < 60 && !reduceMotion) {
        state.inertia = { vaz: lastMove.vaz, valt: lastMove.valt };
      }
      dragging = false;
    }
  }
  els.c2d.addEventListener('pointerup', endPointer);
  els.c2d.addEventListener('pointercancel', endPointer);

  els.c2d.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      const r = els.c2d.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
    },
    { passive: false }
  );

  function zoomAt(cssX, cssY, factor) {
    state.anim = null;
    const V0 = sky.view(state.cam);
    const dir = sky.unproject(cssX * sky.dpr, cssY * sky.dpr, V0);
    state.cam.fov = clamp(state.cam.fov * factor, 8, 200);
    if (state.cam.alt > 80 || state.follow) return;
    for (let k = 0; k < 3; k++) {
      const V = sky.view(state.cam);
      const P = [0, 0, 0];
      if (!sky.project(dir, V, P)) break;
      const dpp = (DEG / V.scale) * 1;
      const ex = P[0] - cssX * sky.dpr;
      const ey = P[1] - cssY * sky.dpr;
      state.cam.az += (ex * dpp) / Math.max(0.35, Math.cos(state.cam.alt * RAD));
      state.cam.alt = clamp(state.cam.alt - ey * dpp, -6, 90);
    }
  }

  els.c2d.addEventListener('dblclick', (e) => {
    const r = els.c2d.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, 0.6);
  });

  els.c2d.addEventListener('keydown', (e) => {
    const step = Math.max(1, state.cam.fov / 20);
    let handled = true;
    if (e.key === 'ArrowLeft') state.cam.az -= step;
    else if (e.key === 'ArrowRight') state.cam.az += step;
    else if (e.key === 'ArrowUp') state.cam.alt = clamp(state.cam.alt + step, -6, 90);
    else if (e.key === 'ArrowDown') state.cam.alt = clamp(state.cam.alt - step, -6, 90);
    else if (e.key === '+' || e.key === '=') state.cam.fov = clamp(state.cam.fov * 0.85, 8, 200);
    else if (e.key === '-' || e.key === '_') state.cam.fov = clamp(state.cam.fov / 0.85, 8, 200);
    else if (e.key === 'Escape') select(null);
    else handled = false;
    if (handled) {
      e.preventDefault();
      state.anim = null;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === ' ' && document.activeElement === els.c2d) {
      e.preventDefault();
      togglePlay();
    }
  });

  function handlePick(x, y) {
    const hit = sky.pick(x, y);
    if (!hit) {
      select(null);
      return;
    }
    select({ type: hit.type, ref: hit.ref });
  }

  /* ================= Виділення й картка ================= */
  function select(sel, opts = {}) {
    state.selected = sel;
    if (!sel) {
      els.card.hidden = true;
      setFollow(false);
      return;
    }
    showCard(sel);
    if (opts.fly) flyToSelected(opts.fov);
  }

  function selectedHorizontal(sel, snap) {
    if (!sel) return null;
    const cat = sky.cat;
    const M = snap.starMatrix;
    const toHor = (v) => A.apply(M, v);
    switch (sel.type) {
      case 'star':
        return toHor([cat.x[sel.ref], cat.y[sel.ref], cat.z[sel.ref]]);
      case 'planet':
        return snap.planets[sel.ref].hor;
      case 'moon':
        return snap.moon.hor;
      case 'sun':
        return snap.sun.hor;
      case 'dso':
      case 'const':
        return toHor(sel.ref.v);
      case 'folk':
        return toHor(sel.ref.center);
      default:
        return null;
    }
  }

  function j2000Of(sel) {
    const cat = sky.cat;
    if (sel.type === 'star') return [cat.x[sel.ref], cat.y[sel.ref], cat.z[sel.ref]];
    if (sel.type === 'dso' || sel.type === 'const') return sel.ref.v;
    if (sel.type === 'folk') return sel.ref.center;
    return null;
  }

  function altitudeFn(sel) {
    const p = state.place;
    if (sel.type === 'planet') return (t) => A.bodyAltitude(sel.ref, t, p.lat, p.lon);
    if (sel.type === 'moon') return (t) => A.bodyAltitude('moon', t, p.lat, p.lon);
    if (sel.type === 'sun') return (t) => A.sunAltitude(t, p.lat, p.lon);
    const v = j2000Of(sel);
    return (t) => A.fixedAltitude(v, t, p.lat, p.lon);
  }

  function flyToSelected(fov) {
    const snap = A.snapshot(state.time, state.place.lat, state.place.lon);
    const v = selectedHorizontal(state.selected, snap);
    if (!v) return;
    const { alt, az } = A.altAz(v);
    if (state.view === 'dome' && !fov) return;
    if (state.view === 'dome') setView('horizon', false);
    flyTo({ az, alt: clamp(alt, 4, 82), fov: fov || Math.min(state.cam.fov, 95) }, 1400);
  }

  function riseSetText(sel) {
    const p = state.place;
    const f = altitudeFn(sel);
    const start = new Date(state.time.getTime() - 12 * 3600000);
    const end = new Date(state.time.getTime() + 12 * 3600000);
    const h0 = sel.type === 'sun' ? -0.833 : sel.type === 'moon' ? 0.125 : -0.567;
    const c = A.crossings(f, start, end, h0, 12);
    if (!c.rise.length && !c.set.length) {
      return c.max.alt > h0 ? 'Ніколи не заходить за обрій' : 'Звідси не сходить';
    }
    const after = (arr) => arr.find((d) => d > state.time) || arr[arr.length - 1];
    const parts = [];
    if (c.rise.length) parts.push(`сходить о ${F.hm(after(c.rise), p.tz)}`);
    if (c.set.length) parts.push(`заходить о ${F.hm(after(c.set), p.tz)}`);
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function colorWord(bv) {
    if (bv < -0.1) return 'блакитна';
    if (bv < 0.25) return 'біло-блакитна';
    if (bv < 0.5) return 'біла';
    if (bv < 0.8) return 'жовтувата';
    if (bv < 1.3) return 'помаранчева';
    return 'червонувата';
  }

  function brightnessNote(mag) {
    if (mag < 0) return 'одна з найяскравіших на небі';
    if (mag < 1.5) return 'видно навіть у місті';
    if (mag < 3) return 'добре помітна';
    if (mag < 4.5) return 'видно подалі від ліхтарів';
    return 'лише на темному небі';
  }

  function folkOf(starIdx) {
    if (!sky.cat) return null;
    for (const f of sky.cat.folk) if (f.vecs.some((v) => v.idx === starIdx)) return f;
    return null;
  }

  function showCard(sel) {
    const snap = A.snapshot(state.time, state.place.lat, state.place.lon);
    const v = selectedHorizontal(sel, snap);
    const aa = v ? A.altAz(v) : { alt: 0, az: 0 };
    const facts = [];
    let kind = '';
    let title = '';
    let sub = '';
    let note = '';
    const dir = F.direction(aa.az);
    const where = aa.alt > 0 ? `${F.num(aa.alt)}° над обрієм, ${dir[1]}` : `під обрієм, ${dir[1]}`;

    if (sel.type === 'star') {
      const cat = sky.cat;
      const i = sel.ref;
      const nm = cat.names.get(i) || {};
      kind = 'Зоря';
      title = nm.uk || nm.desig || `HIP ${cat.hip[i]}`;
      sub = nm.uk && nm.desig ? nm.desig : '';
      facts.push(['Де', where]);
      facts.push(['Блиск', `${F.signed(cat.mag[i], 2)}, ${brightnessNote(cat.mag[i])}`]);
      const k = A.bvToKelvin(cat.bv[i]);
      facts.push(['Колір', `${colorWord(cat.bv[i])}, поверхня близько ${F.num(Math.round(k / 100) * 100)} K`]);
      facts.push(['Сьогодні', riseSetText(sel)]);
      const f = folkOf(i);
      if (f) note = `Входить до народного астеризму «${f.name}».`;
    } else if (sel.type === 'planet') {
      const p = snap.planets[sel.ref];
      kind = 'Планета';
      title = D.PLANET_NAMES[sel.ref];
      if (sel.ref === 'venus') sub = p.evening ? 'зараз вона — Вечірня зоря' : 'зараз вона — Ранкова зоря';
      facts.push(['Де', where]);
      facts.push(['Блиск', `${F.signed(p.mag, 1)}, ${brightnessNote(p.mag)}`]);
      const km = p.dist * 149597870.7;
      facts.push(['Відстань', `${F.num(km / 1e6)} млн км. Світло летить ${lightTime(km)}`]);
      if (sel.ref === 'mercury' || sel.ref === 'venus' || sel.ref === 'mars') facts.push(['Фаза', `освітлено ${F.num(p.phase * 100)} %`]);
      facts.push(['Від Сонця', `${F.num(p.elongation)}° ${p.evening ? 'на схід, видно ввечері' : 'на захід, видно вранці'}`]);
      facts.push(['Сьогодні', riseSetText(sel)]);
      note = PLANET_NOTES[sel.ref] || '';
    } else if (sel.type === 'moon') {
      const m = snap.moon;
      kind = 'Супутник Землі';
      title = 'Місяць';
      sub = moonPhaseName(m);
      facts.push(['Де', where]);
      facts.push(['Освітлено', `${F.num(m.illum * 100)} %`]);
      facts.push(['Відстань', `${F.num(m.distKm)} км`]);
      facts.push(['Сьогодні', riseSetText(sel)]);
      note = 'У бінокль найкраще видно кратери вздовж межі світла й тіні, а не в повню.';
    } else if (sel.type === 'sun') {
      kind = 'Зоря';
      title = 'Сонце';
      facts.push(['Де', where]);
      facts.push(['Сьогодні', riseSetText(sel)]);
      note = 'Ніколи не дивіться на Сонце в бінокль чи телескоп без сертифікованого сонячного фільтра.';
    } else if (sel.type === 'dso') {
      const o = sel.ref;
      kind = D.DSO_TYPES[o.type] || 'Об’єкт глибокого космосу';
      title = o.name || o.id;
      sub = o.name ? `${o.id}, ${o.desig}` : o.desig;
      facts.push(['Де', where]);
      facts.push(['Блиск', `${F.signed(o.mag, 1)}, ${o.mag < 5 ? 'видно оком на темному небі' : o.mag < 8.5 ? 'потрібен бінокль' : 'потрібен телескоп'}`]);
      facts.push(['Розмір', `${F.num(o.dim)}′`]);
      facts.push(['Сьогодні', riseSetText(sel)]);
    } else if (sel.type === 'const') {
      kind = 'Сузір’я';
      title = sel.ref.name;
      facts.push(['Де', where]);
      facts.push(['Сьогодні', riseSetText(sel)]);
    } else if (sel.type === 'folk') {
      kind = 'Народна назва';
      title = sel.ref.name;
      sub = sel.ref.sci;
      facts.push(['Де', where]);
      facts.push(['Сьогодні', riseSetText(sel)]);
      note = sel.ref.text;
    }

    $('#card-kind').textContent = kind;
    $('#card-title').textContent = title;
    $('#card-sub').textContent = sub;
    $('#card-sub').hidden = !sub;
    $('#card-facts').innerHTML = facts.map(([k, v]) => `<dt>${F.escapeHtml(k)}</dt><dd>${F.escapeHtml(v)}</dd>`).join('');
    $('#card-note').textContent = note;
    $('#card-note').hidden = !note;
    els.card.hidden = false;
    cardRefreshAt = performance.now();
  }

  const PLANET_NOTES = {
    mercury: 'Найближча до Сонця планета. Її видно лише низько над обрієм у сутінках, кілька тижнів на рік.',
    venus: 'Густі хмари відбивають 3/4 сонячного світла, тому Венера — найяскравіше після Сонця й Місяця світило.',
    mars: 'Рудий колір дає пил з оксидом заліза. Раз на два роки Марс підходить до Землі й помітно яскравішає.',
    jupiter: 'У бінокль поруч видно до чотирьох супутників, які Галілей помітив ще 1610 року.',
    saturn: 'Кільця видно вже в невеликий телескоп зі збільшенням 30–50 разів.',
    uranus: 'На межі видимості оком. Шукайте в бінокль як ледь зеленкувату «зорю».',
    neptune: 'Оком не видно — потрібен бінокль або телескоп і точна карта.',
  };

  function lightTime(km) {
    const s = km / 299792.458;
    if (s < 90) return `${F.num(s)} с`;
    const min = s / 60;
    if (min < 90) return `${F.num(min)} хв`;
    const h = Math.floor(min / 60);
    return `${h} год ${Math.round(min - h * 60)} хв`;
  }

  function moonPhaseName(m) {
    const a = m.age;
    if (a < 12 || a > 348) return 'молодик';
    if (a < 80) return 'молодий місяць, росте';
    if (a < 100) return 'перша чверть';
    if (a < 168) return 'росте до повні';
    if (a < 192) return 'повня';
    if (a < 260) return 'спадає після повні';
    if (a < 280) return 'остання чверть';
    return 'старий місяць, спадає';
  }

  $('#card-close').addEventListener('click', () => select(null));
  $('#follow-btn').addEventListener('click', () => setFollow(!state.follow));

  function setFollow(on) {
    state.follow = on && !!state.selected;
    $('#follow-btn').setAttribute('aria-pressed', String(state.follow));
    if (state.follow && state.view === 'dome') setView('horizon', false);
  }

  let cardRefreshAt = 0;

  /* ================= Шари ================= */
  const layersEl = $('#layers');
  layersEl.innerHTML = LAYERS.map(
    (l) => `
      <label class="toggle">
        <input type="checkbox" data-layer="${l.id}" ${state.layers[l.id] ? 'checked' : ''}>
        <span class="toggle-ui" aria-hidden="true"></span>
        <span class="toggle-text">${l.name}${l.note ? `<small>${l.note}</small>` : ''}</span>
      </label>`
  ).join('');
  layersEl.addEventListener('change', (e) => {
    const id = e.target.dataset.layer;
    if (!id) return;
    setLayer(id, e.target.checked);
  });

  function setLayer(id, on) {
    state.layers[id] = on;
    const input = layersEl.querySelector(`[data-layer="${id}"]`);
    if (input) input.checked = on;
    if (id === 'trails') {
      if (on) {
        setFollow(false);
        state.inertia = null;
        if (!state.playing) {
          state.speedIdx = 2;
          setPlaying(true);
        }
      }
    } else {
      const { trails, ...rest } = state.layers;
      store.set('layers', rest);
    }
  }

  /* ================= Спливні панелі ================= */
  function bindPop(btn, pop) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      closePops();
      if (open) {
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        positionPop(btn, pop);
        const first = pop.querySelector('input:checked, button, input');
        if (first) first.focus({ preventScroll: true });
      }
    });
  }
  function positionPop(btn, pop) {
    if (window.innerWidth < 640) {
      pop.style.left = '';
      pop.style.top = '';
      pop.style.right = '';
      pop.style.bottom = '';
      return;
    }
    const b = btn.getBoundingClientRect();
    const parent = pop.offsetParent ? pop.offsetParent.getBoundingClientRect() : { left: 0, top: 0 };
    const w = pop.offsetWidth;
    let left = Math.min(b.right - w, window.innerWidth - w - 12);
    left = Math.max(12, left);
    if (pop.id === 'layers-pop') {
      pop.style.left = `${left - parent.left}px`;
      pop.style.top = '';
      pop.style.bottom = `${parent.bottom - b.top + 10}px`;
    } else {
      pop.style.left = `${left - parent.left}px`;
      pop.style.top = `${b.bottom - parent.top + 10}px`;
    }
  }
  function closePops() {
    document.querySelectorAll('.pop').forEach((p) => (p.hidden = true));
    document.querySelectorAll('[aria-haspopup]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  bindPop($('#layers-btn'), $('#layers-pop'));
  bindPop($('#place-btn'), $('#place-pop'));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop')) closePops();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePops();
  });

  /* ================= Місце й засвітка ================= */
  const citiesEl = $('#cities');
  function renderCities() {
    citiesEl.innerHTML = D.CITIES.map(
      (c) => `<button type="button" role="radio" data-city="${c.id}" aria-checked="${state.place.id === c.id}">${c.name}</button>`
    ).join('');
  }
  renderCities();
  citiesEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-city]');
    if (!b) return;
    const c = D.CITIES.find((x) => x.id === b.dataset.city);
    setPlace({ ...c, tz: F.KYIV });
    store.set('place', { id: c.id });
    closePops();
  });

  const levelsEl = $('#levels');
  function renderLevels() {
    levelsEl.innerHTML = D.SKY_LEVELS.map(
      (l) => `<button type="button" role="radio" data-level="${l.id}" aria-checked="${state.level.id === l.id}">${l.name}</button>`
    ).join('');
    $('#level-note').textContent = state.level.note;
  }
  renderLevels();
  levelsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    setLevel(b.dataset.level);
  });

  function setLevel(id) {
    state.level = D.SKY_LEVELS.find((l) => l.id === id) || state.level;
    store.set('level', state.level.id);
    renderLevels();
    lastHeadline = 0;
  }

  function setPlace(p) {
    state.place = p;
    $('#place-name').textContent = p.id === 'geo' ? 'Ваше місце' : p.name;
    renderCities();
    lastHeadline = 0;
    stripKey = '';
    window.dispatchEvent(new CustomEvent('placechange'));
  }
  $('#place-name').textContent = state.place.id === 'geo' ? 'Ваше місце' : state.place.name;

  // на claude.ai браузер не дає сторінці доступу до геолокації
  if (window.ARTIFACT) {
    $('#geo-btn').hidden = true;
    $('#geo-status').hidden = true;
  }
  $('#geo-btn').addEventListener('click', () => {
    const status = $('#geo-status');
    if (!navigator.geolocation) {
      status.textContent = 'Браузер не вміє визначати місце. Оберіть найближче місто зі списку.';
      return;
    }
    status.textContent = 'Визначаємо…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = +pos.coords.latitude.toFixed(3);
        const lon = +pos.coords.longitude.toFixed(3);
        setPlace({ id: 'geo', name: 'Ваше місце', over: 'вами', lat, lon, tz: F.LOCAL });
        store.set('place', { geo: true, lat, lon });
        status.textContent = `Готово: ${F.num(Math.abs(lat), 2)}° ${lat >= 0 ? 'пн. ш.' : 'пд. ш.'}, ${F.num(Math.abs(lon), 2)}° ${lon >= 0 ? 'сх. д.' : 'зх. д.'}`;
      },
      (err) => {
        status.textContent =
          err.code === 1 ? 'Доступ до місця заборонено в браузері. Оберіть місто зі списку.' : 'Не вдалося визначити місце. Оберіть місто зі списку.';
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
    );
  });

  /* ================= Нічний зір ================= */
  const nvBtn = $('#nv-btn');
  function setNight(on) {
    state.nightVision = on;
    document.documentElement.classList.toggle('nv', on);
    nvBtn.setAttribute('aria-pressed', String(on));
    store.set('nv', on);
  }
  nvBtn.addEventListener('click', () => setNight(!state.nightVision));
  setNight(store.get('nv', false));

  /* ================= Вигляд ================= */
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === state.view));
    b.addEventListener('click', () => setView(b.dataset.view));
  });

  /* ================= Час ================= */
  function setLive() {
    state.live = true;
    state.playing = false;
    state.time = new Date();
    updatePlayUI();
  }

  function setTime(t) {
    state.live = false;
    state.time = new Date(t);
    updatePlayUI();
  }

  function setPlaying(on) {
    state.playing = on;
    if (on) state.live = false;
    updatePlayUI();
  }

  function togglePlay() {
    setPlaying(!state.playing);
  }

  function updatePlayUI() {
    els.play.setAttribute('aria-pressed', String(state.playing));
    els.play.setAttribute('aria-label', state.playing ? 'Зупинити час' : 'Прискорити час');
    els.now.setAttribute('aria-pressed', String(state.live));
    els.speed.textContent = SPEEDS[state.speedIdx].label;
    if (!state.playing && state.layers.trails) setLayer('trails', false);
  }

  els.play.addEventListener('click', togglePlay);
  els.speed.addEventListener('click', () => {
    state.speedIdx = (state.speedIdx + 1) % SPEEDS.length;
    updatePlayUI();
    if (!state.playing) setPlaying(true);
  });
  els.now.addEventListener('click', setLive);
  $('#day-prev').addEventListener('click', () => setTime(state.time.getTime() - 86400000));
  $('#day-next').addEventListener('click', () => setTime(state.time.getTime() + 86400000));

  // Смуга доби: від полудня до полудня
  let stripKey = '';
  let stripStart = 0;

  function nightStart(t) {
    const tz = state.place.tz;
    const p = F.parts(t, tz);
    let noon = F.zoned(p.y, p.m, p.d, 12, 0, tz);
    if (p.h < 12) noon = F.zoned(p.y, p.m, p.d - 1, 12, 0, tz);
    return noon.getTime();
  }

  function skyColorAt(sa) {
    // день → сутінки → ніч
    const stops = [
      [8, [79, 121, 183]],
      [0, [226, 142, 96]],
      [-3, [120, 86, 120]],
      [-6, [58, 58, 118]],
      [-12, [28, 34, 82]],
      [-18, [12, 16, 44]],
      [-90, [8, 11, 30]],
    ];
    if (sa >= stops[0][0]) return stops[0][1];
    for (let i = 0; i < stops.length - 1; i++) {
      const [a, ca] = stops[i];
      const [b, cb] = stops[i + 1];
      if (sa <= a && sa >= b) {
        const t = (a - sa) / (a - b);
        return ca.map((c, k) => Math.round(c + (cb[k] - c) * t));
      }
    }
    return stops[stops.length - 1][1];
  }

  function drawStrip() {
    const start = nightStart(state.time);
    const r = els.strip.getBoundingClientRect();
    const key = `${start}|${state.place.lat}|${state.place.lon}|${Math.round(r.width)}`;
    if (key === stripKey) return;
    stripKey = key;
    stripStart = start;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const c = els.stripCanvas;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = c.getContext('2d');
    const N = 144;
    const g = ctx.createLinearGradient(0, 0, c.width, 0);
    for (let i = 0; i <= N; i++) {
      const t = new Date(start + (i / N) * 86400000);
      const sa = A.sunAltitude(t, state.place.lat, state.place.lon);
      const [cr, cg, cb] = skyColorAt(sa);
      g.addColorStop(i / N, `rgb(${cr},${cg},${cb})`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    // позначки годин
    ctx.font = `${Math.round(10.5 * dpr)}px Arsenal, sans-serif`;
    ctx.textAlign = 'center';
    for (let h = 0; h <= 24; h += 1) {
      const x = (h / 24) * c.width;
      const labelHour = (12 + h) % 24;
      const major = labelHour % 3 === 0;
      ctx.fillStyle = 'rgba(232, 234, 246, 0.35)';
      ctx.fillRect(Math.round(x), c.height - (major ? 7 : 4) * dpr, Math.max(1, dpr), (major ? 7 : 4) * dpr);
      if (major && h > 0 && h < 24) {
        ctx.fillStyle = 'rgba(232, 234, 246, 0.72)';
        ctx.fillText(String(labelHour), x, c.height - 10 * dpr);
      }
    }
  }

  function updateTimebar() {
    const tz = state.place.tz;
    const wd = F.weekdayDayMonth(state.time, tz);
    const cut = wd.indexOf(', ');
    const html = `<span class="wd">${wd.slice(0, cut + 2)}</span>${wd.slice(cut + 2)}`;
    if (els.whenDate.innerHTML !== html) els.whenDate.innerHTML = html;
    els.whenTime.textContent = F.hm(state.time, tz);
    drawStrip();
    const frac = clamp((state.time.getTime() - stripStart) / 86400000, 0, 1);
    els.thumb.style.left = `${frac * 100}%`;
    const p = F.parts(state.time, tz);
    els.thumb.setAttribute('aria-valuenow', String(p.h * 60 + p.mi));
    els.thumb.setAttribute('aria-valuetext', F.hm(state.time, tz));
  }

  let stripDrag = false;
  function stripSet(clientX) {
    const r = els.strip.getBoundingClientRect();
    const frac = clamp((clientX - r.left) / r.width, 0, 0.9999);
    setPlaying(false);
    setTime(stripStart + frac * 86400000);
  }
  els.strip.addEventListener('pointerdown', (e) => {
    stripDrag = true;
    els.strip.setPointerCapture(e.pointerId);
    stripSet(e.clientX);
  });
  els.strip.addEventListener('pointermove', (e) => {
    if (stripDrag) stripSet(e.clientX);
  });
  els.strip.addEventListener('pointerup', () => (stripDrag = false));
  els.strip.addEventListener('pointercancel', () => (stripDrag = false));
  els.thumb.addEventListener('keydown', (e) => {
    const m = { ArrowLeft: -10, ArrowRight: 10, ArrowDown: -10, ArrowUp: 10, PageDown: -60, PageUp: 60 }[e.key];
    if (m === undefined) return;
    e.preventDefault();
    setPlaying(false);
    setTime(state.time.getTime() + m * 60000);
  });

  /* ================= Заголовок ================= */
  let lastHeadline = 0;

  function objectNamesVisible(snap, max) {
    const items = [];
    for (const name of A.PLANETS) {
      const p = snap.planets[name];
      const alt = A.altAz(p.hor).alt;
      if (alt > 2 && p.mag + A.extinction(alt) < state.lim) items.push({ mag: p.mag, name: D.PLANET_NAMES[name] });
    }
    if (sky.cat) {
      for (const i of state.stats.brightest) {
        const nm = sky.cat.names.get(i);
        if (nm && nm.uk) items.push({ mag: sky.cat.mag[i], name: nm.uk });
      }
    }
    items.sort((a, b) => a.mag - b.mag);
    return items.slice(0, max).map((x) => x.name);
  }

  function findSunEvent(level, from, dir) {
    const p = state.place;
    const start = dir > 0 ? from : new Date(from.getTime() - 26 * 3600000);
    const end = dir > 0 ? new Date(from.getTime() + 26 * 3600000) : from;
    const c = A.crossings((t) => A.sunAltitude(t, p.lat, p.lon), start, end, level, 15);
    return c;
  }

  function updateHeadline(snap) {
    const p = state.place;
    const tz = p.tz;
    const sa = snap.sun.alt;
    const lead = state.live ? `Над ${p.over} зараз` : `О ${F.hm(state.time, tz)} над ${p.over}`;
    let h1 = '';
    let sub = '';

    if (state.catalogError) {
      h1 = `${lead} ${sa > -6 ? 'світло' : 'темно'}`;
      sub = 'Не вдалося завантажити зоряний каталог. Перевірте з’єднання й оновіть сторінку — Місяць і планети вже на місці.';
    } else if (sa > -0.833) {
      const c = findSunEvent(-0.833, state.time, 1);
      const set = c.set.find((d) => d > state.time);
      const dusk = findSunEvent(-6, state.time, 1).set.find((d) => d > state.time);
      h1 = `${lead} день`;
      if (set) sub = `Сонце зайде о ${F.hm(set, tz)}, перші зорі з’являться близько ${F.hm(dusk || set, tz)}.`;
      if (snap.moon.alt > 5 && snap.moon.illum > 0.08) sub += ` Місяць уже на небі — пошукайте його ${F.direction(snap.moon.az)[1]}.`;
    } else if (sa > -12) {
      const evening = snap.sun.az > 180;
      const names = objectNamesVisible(snap, 3).map(F.accusative);
      if (evening) {
        h1 = `${lead} сутеніє`;
        const dark = findSunEvent(-18, state.time, 1).set.find((d) => d > state.time);
        sub = names.length ? `Уже видно ${F.listJoin(names)}.` : 'Перші зорі от-от з’являться.';
        if (dark) sub += ` Повна темрява настане о ${F.hm(dark, tz)}.`;
      } else {
        h1 = `${lead} світає`;
        const rise = findSunEvent(-0.833, state.time, 1).rise.find((d) => d > state.time);
        sub = rise ? `Сонце зійде о ${F.hm(rise, tz)}.` : '';
        if (names.length) sub += ` Останніми згаснуть ${F.listJoin(objectNamesVisible(snap, 2))}.`;
      }
    } else {
      const n = state.stats.visible;
      const planets = [];
      for (const name of A.PLANETS) {
        const pl = snap.planets[name];
        const alt = A.altAz(pl.hor).alt;
        if (alt > 1 && pl.mag + A.extinction(alt) < state.lim && pl.mag < 3) planets.push(F.accusative(D.PLANET_NAMES[name]));
      }
      if (snap.moon.alt > 0) planets.push('Місяць');
      const count = state.catalogReady ? `близько ${F.num(Math.round(n / 10) * 10 || n)} зір` : 'зорі';
      h1 = `${lead} видно ${planets.length ? count + (planets.length > 1 ? ', ' : ' і ') + F.listJoin(planets) : count}`;
      const lvl = state.level.id;
      const m = snap.moon;
      if (lvl === 'city') sub = 'Міське світло ховає більшість зір. Перемкніть засвітку вгорі на «Темне небо», щоб побачити, скільки їх насправді.';
      else if (m.alt > 0 && m.illum > 0.6) sub = `Яскравий Місяць (${F.num(m.illum * 100)} %) приглушує слабкі зорі й Чумацький Шлях.`;
      else if (m.alt > 0) sub = `Місяць освітлений на ${F.num(m.illum * 100)} % і майже не заважає.`;
      else sub = 'Місяць під обрієм — найкращий час для слабких зір і Чумацького Шляху.';
    }
    if (!state.catalogReady && !state.catalogError) sub = 'Завантажуємо зоряний каталог…';
    let changed = false;
    if (els.headline.textContent !== h1) {
      els.headline.textContent = h1;
      changed = true;
    }
    if (els.subline.textContent !== sub) {
      els.subline.textContent = sub;
      changed = true;
    }
    if (changed) measureInsets();
  }

  /* ================= Тост ================= */
  let toastTimer = 0;
  function toast(text, ms = 4200) {
    els.toast.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  /* ================= Пошук ================= */
  const findInput = $('#find');
  const findList = $('#find-list');
  let index = [];
  let results = [];
  let active = -1;

  function buildSearchIndex() {
    index = [];
    const add = (label, sub, sel, weight) => index.push({ label, sub, sel, weight, key: label.toLowerCase() });
    add('Місяць', 'супутник Землі', { type: 'moon', ref: 'moon' }, 100);
    add('Сонце', 'наша зоря', { type: 'sun', ref: 'sun' }, 60);
    for (const p of A.PLANETS) add(D.PLANET_NAMES[p], 'планета', { type: 'planet', ref: p }, 90);
    add('Вечірня зоря', 'Венера', { type: 'planet', ref: 'venus' }, 50);
    add('Ранкова зоря', 'Венера', { type: 'planet', ref: 'venus' }, 50);
    add('Денниця', 'Венера', { type: 'planet', ref: 'venus' }, 40);
    const cat = sky.cat;
    if (cat) {
      for (const f of cat.folk) {
        if (!f.vecs.length) continue;
        add(f.name, 'народна назва', { type: 'folk', ref: folkRef(f) }, 80);
      }
      for (const l of cat.labels) add(l.name, 'сузір’я', { type: 'const', ref: l }, 70);
      const seen = new Set();
      cat.names.forEach((nm, i) => {
        if (!nm.uk || seen.has(nm.uk)) return;
        seen.add(nm.uk);
        add(nm.uk, nm.desig ? `зоря, ${nm.desig}` : 'зоря', { type: 'star', ref: i }, 60 - cat.mag[i]);
      });
      for (const o of cat.dsos) {
        if (o.name) add(o.name, `${o.id}`, { type: 'dso', ref: o }, 45);
        add(o.id, o.name || D.DSO_TYPES[o.type] || '', { type: 'dso', ref: o }, 20);
      }
    }
  }

  function folkRef(f) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    if (f.vecs.length) {
      for (const v of f.vecs) {
        cx += v.v[0];
        cy += v.v[1];
        cz += v.v[2];
      }
    } else if (f.view) {
      [cx, cy, cz] = A.raDecToVec(f.view.center[0], f.view.center[1]);
    }
    const l = Math.hypot(cx, cy, cz);
    return { ...f, center: [cx / l, cy / l, cz / l], v: [cx / l, cy / l, cz / l] };
  }

  function renderResults() {
    if (!results.length) {
      findList.hidden = true;
      findInput.setAttribute('aria-expanded', 'false');
      return;
    }
    findList.innerHTML = results
      .map(
        (r, i) =>
          `<li role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}"><span>${F.escapeHtml(r.label)}</span><small>${F.escapeHtml(r.sub)}</small></li>`
      )
      .join('');
    findList.hidden = false;
    findInput.setAttribute('aria-expanded', 'true');
    findInput.setAttribute('aria-activedescendant', active >= 0 ? `opt-${active}` : '');
  }

  findInput.addEventListener('input', () => {
    const q = findInput.value.trim().toLowerCase();
    active = -1;
    if (!q) {
      results = [];
      renderResults();
      return;
    }
    results = index
      .filter((x) => x.key.includes(q))
      .sort((a, b) => (b.key.startsWith(q) - a.key.startsWith(q)) || b.weight - a.weight)
      .slice(0, 8);
    renderResults();
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      active = Math.min(results.length - 1, active + 1);
      renderResults();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(0, active - 1);
      renderResults();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      const r = results[active >= 0 ? active : 0];
      if (r) choose(r);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      results = [];
      renderResults();
    }
  });

  findList.addEventListener('mousedown', (e) => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(results[+li.dataset.i]);
  });

  findInput.addEventListener('blur', () =>
    setTimeout(() => {
      results = [];
      renderResults();
    }, 120)
  );

  function choose(r) {
    findInput.value = '';
    results = [];
    renderResults();
    findInput.blur();
    showOnSky(r.sel, r.label);
  }

  /*
   * Показати об'єкт на небі: якщо він під обрієм — перемотати час
   * до найближчого моменту, коли він добре видно.
   */
  function showOnSky(sel, label, opts = {}) {
    const f = altitudeFn(sel);
    const alt = f(state.time);
    const minAlt = opts.minAlt ?? 12;
    const needDark = sel.type !== 'sun';
    const p = state.place;
    const isDark = (t) => A.sunAltitude(t, p.lat, p.lon) < (sel.type === 'moon' || sel.type === 'planet' ? -4 : -10);
    if (alt < minAlt || (needDark && !isDark(state.time))) {
      const t0 = state.time.getTime();
      let found = null;
      for (let k = 1; k <= 72 * 6; k++) {
        const t = new Date(t0 + k * 10 * 60000);
        if (f(t) > minAlt + 6 && (!needDark || isDark(t))) {
          found = t;
          break;
        }
      }
      if (found) {
        setPlaying(false);
        setTime(found);
        toast(`${label}: найближче добре видно ${F.dayMonth(found, p.tz) === F.dayMonth(new Date(t0), p.tz) ? 'сьогодні' : F.dayMonth(found, p.tz)} о ${F.hm(found, p.tz)}. Переносимо час туди.`);
      } else if (alt < 0) {
        toast(`${label} найближчими днями не піднімається над обрієм ${state.place.id === 'geo' ? 'у вас' : 'тут'}.`);
      }
    }
    if (opts.layer) setLayer(opts.layer, true);
    select(sel);
    if (state.view === 'dome') setView('horizon', false);
    const snap = A.snapshot(state.time, p.lat, p.lon);
    const v = selectedHorizontal(sel, snap);
    if (v) {
      const aa = A.altAz(v);
      flyTo({ az: aa.az, alt: clamp(aa.alt, 6, 80), fov: opts.fov || clamp(state.cam.fov, 40, 95) }, reduceMotion ? 0 : 1500);
    }
  }

  /* ================= Головний цикл ================= */
  let lastFrame = performance.now();
  let lastTimebar = 0;
  const intro = { t0: 0, done: reduceMotion };
  const bootTime = performance.now();
  if (reduceMotion) els.veil.classList.add('gone');

  const bar = $('#bar');
  const onScroll = () => bar.classList.toggle('solid', window.scrollY > els.sky.offsetHeight - 80);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  if (reduceMotion) Object.assign(state.cam, { az: 180, ...VIEWS[state.view] });

  function frame(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    if (state.live) state.time = new Date();
    else if (state.playing) state.time = new Date(state.time.getTime() + dt * SPEEDS[state.speedIdx].v);

    if (!intro.done && state.catalogReady) {
      intro.done = true;
      els.veil.classList.add('gone');
      const target = { az: 180, ...VIEWS[state.view] };
      state.cam.alt = state.view === 'dome' ? 90 : -2;
      state.cam.fov = state.view === 'dome' ? 150 : VIEWS.horizon.fov;
      flyTo(target, 3200);
    } else if (!intro.done && (state.catalogError || now - bootTime > 9000)) {
      intro.done = true;
      els.veil.classList.add('gone');
      flyTo({ az: 180, ...VIEWS[state.view] }, 1200);
    }

    stepCamera(now, dt);

    if (state.visible) {
      const p = state.place;
      const snap = A.snapshot(state.time, p.lat, p.lon);
      state.snap = snap;
      state.lim = limitingMag(snap);
      if (state.follow && state.selected && !state.anim) {
        const v = selectedHorizontal(state.selected, snap);
        if (v) {
          const aa = A.altAz(v);
          state.cam.az = aa.az;
          state.cam.alt = clamp(aa.alt, -6, 85);
        }
      }
      state.stats = sky.render({
        cam: state.cam,
        snap,
        lim: state.lim,
        lp: state.level.lp,
        layers: state.layers,
        selected: state.selected,
        t: now,
        trails: state.layers.trails,
        reduceMotion,
      });
      if (now - lastHeadline > 700) {
        lastHeadline = now;
        updateHeadline(snap);
      }
      if (now - lastTimebar > 200) {
        lastTimebar = now;
        updateTimebar();
      }
      if (state.selected && !els.card.hidden && now - cardRefreshAt > 1500) showCard(state.selected);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    stripKey = '';
    closePops();
  });

  loadCatalog();
  updatePlayUI();
  requestAnimationFrame(frame);

  // Публічний інтерфейс для розділів сторінки
  window.Volosozhar = {
    state,
    sky,
    setTime,
    setLive,
    setLevel,
    setLayer,
    showOnSky,
    select,
    toast,
    folkRef,
    scrollToSky() {
      els.sky.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    },
  };
})();
