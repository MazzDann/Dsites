/* Волосожар — розділи під небом: ця ніч, народне небо, календар. */
(function () {
  'use strict';

  const A = window.Astro;
  const D = window.SkyData;
  const F = window.Fmt;
  const V = window.Volosozhar;
  const RAD = A.RAD;
  const DEG = A.DEG;
  const $ = (s, el = document) => el.querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  const BODIES = ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

  /* ================= Ця ніч ================= */
  let night = null;
  let nightKey = '';

  function computeNight() {
    const p = V.state.place;
    const ref = V.state.time;
    const sunF = (t) => A.sunAltitude(t, p.lat, p.lon);
    const around = A.crossings(sunF, new Date(ref.getTime() - 30 * 3600000), new Date(ref.getTime() + 36 * 3600000), -0.833, 15);
    let set;
    let rise;
    const nowAlt = sunF(ref);
    if (nowAlt < -0.833) {
      set = [...around.set].reverse().find((d) => d <= ref);
      rise = around.rise.find((d) => d > ref);
    } else {
      set = around.set.find((d) => d > ref);
      rise = set && around.rise.find((d) => d > set);
    }
    if (!set || !rise) return null;
    const key = `${p.lat}|${p.lon}|${Math.round(set.getTime() / 60000)}`;
    if (key === nightKey) return night;
    nightKey = key;

    const start = new Date(set.getTime() - 40 * 60000);
    const end = new Date(rise.getTime() + 40 * 60000);
    const step = 6 * 60000;
    const samples = [];
    for (let t = start.getTime(); t <= end.getTime(); t += step) {
      const snap = A.snapshot(new Date(t), p.lat, p.lon);
      const row = { t, sun: snap.sun.alt, moon: snap.moon.alt, moonIllum: snap.moon.illum };
      for (const b of BODIES) {
        if (b === 'moon') continue;
        row[b] = A.altAz(snap.planets[b].hor).alt;
        row[b + 'Mag'] = snap.planets[b].mag;
      }
      samples.push(row);
    }
    const twilight = (lvl) => A.crossings(sunF, start, end, lvl, 10);
    const astro = twilight(-18);
    const res = {
      set,
      rise,
      start,
      end,
      samples,
      darkStart: astro.set[0] || null,
      darkEnd: astro.rise[astro.rise.length - 1] || null,
      bodies: [],
    };

    for (const b of BODIES) {
      const alts = samples.map((s) => s[b]);
      let best = -90;
      let bestT = null;
      samples.forEach((s, i) => {
        if (s.sun < -6 && alts[i] > best) {
          best = alts[i];
          bestT = s.t;
        }
      });
      if (best < 5) continue;
      const f = (t) => A.bodyAltitude(b, t, p.lat, p.lon);
      const h0 = b === 'moon' ? 0.125 : -0.567;
      const c = A.crossings(f, new Date(start.getTime() - 14 * 3600000), new Date(end.getTime() + 14 * 3600000), h0, 12);
      const riseT = [...c.rise].reverse().find((d) => d <= new Date(bestT)) || null;
      const setT = c.set.find((d) => d >= new Date(bestT)) || null;
      const snapBest = A.snapshot(new Date(bestT), p.lat, p.lon);
      const hor = b === 'moon' ? snapBest.moon : { ...A.altAz(snapBest.planets[b].hor), mag: snapBest.planets[b].mag };
      res.bodies.push({
        id: b,
        name: D.PLANET_NAMES[b],
        color: D.PLANET_COLORS[b],
        rise: riseT,
        set: setT,
        bestT: new Date(bestT),
        bestAlt: best,
        az: hor.az,
        mag: b === 'moon' ? snapBest.moon.mag : hor.mag,
      });
    }
    res.moonIllum = A.snapshot(new Date((set.getTime() + rise.getTime()) / 2), p.lat, p.lon).moon;
    night = res;
    return res;
  }

  function renderTonight() {
    const n = computeNight();
    if (!n) return;
    const p = V.state.place;
    const tz = p.tz;
    const title = $('#tonight-title');
    const now = new Date();
    const isTonight = now >= new Date(n.set.getTime() - 14 * 3600000) && now <= n.rise;
    const over = p.id === 'geo' ? 'над вами' : `над ${p.over}`;
    title.textContent = isTonight ? `Цієї ночі ${over}` : `Ніч на ${F.dayMonth(n.rise, tz)} ${over}`;

    const m = n.moonIllum;
    let lead = `Сонце сідає о ${F.hm(n.set, tz)} і сходить о ${F.hm(n.rise, tz)}.`;
    if (n.darkStart && n.darkEnd) lead += ` Повна темрява — з ${F.hm(n.darkStart, tz)} до ${F.hm(n.darkEnd, tz)}.`;
    else lead += ' Цієї ночі небо не стає зовсім темним: Сонце неглибоко під обрієм.';
    if (m.illum < 0.03) lead += ' Молодик: Місяця не буде видно всю ніч.';
    else lead += ` Місяць ${m.waxing ? 'росте' : 'спадає'}, освітлений на ${F.num(m.illum * 100)} %.`;
    const planets = n.bodies.filter((b) => b.id !== 'moon');
    if (planets.length) lead += ` З планет видно ${F.listJoin(planets.map((b) => F.accusative(b.name)))}.`;
    else lead += ' Яскравих планет цієї ночі не видно.';
    $('#tonight-lead').textContent = lead;

    const tbody = $('#bodies tbody');
    tbody.innerHTML = n.bodies
      .map((b) => {
        const t = (d) => (d ? F.hm(d, tz) : '—');
        const dir = F.direction(b.az)[1];
        return `<tr>
          <th scope="row"><span class="dot" style="background:${b.color}"></span>${b.name}</th>
          <td>${t(b.rise)}</td>
          <td>${t(b.bestT)}<span class="alt">${F.num(b.bestAlt)}°</span></td>
          <td>${t(b.set)}</td>
          <td>${dir}</td>
          <td class="num">${F.signed(b.mag, 1)}</td>
        </tr>`;
      })
      .join('');
    drawChart();
  }

  const chart = $('#night-chart');
  const chartBox = $('#chart-box');
  const tip = $('#chart-tip');
  let chartGeom = null;

  function drawChart(hoverX) {
    const n = night;
    if (!n) return;
    const r = chartBox.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (chart.width !== W || chart.height !== H) {
      chart.width = W;
      chart.height = H;
    }
    const ctx = chart.getContext('2d');
    const padL = 36 * dpr;
    const padR = 10 * dpr;
    const padT = 14 * dpr;
    const padB = 28 * dpr;
    const x0 = padL;
    const x1 = W - padR;
    const y0 = padT;
    const y1 = H - padB;
    const t0 = n.start.getTime();
    const t1 = n.end.getTime();
    const X = (t) => x0 + ((t - t0) / (t1 - t0)) * (x1 - x0);
    const Y = (alt) => y1 - (clamp(alt, 0, 90) / 90) * (y1 - y0);
    chartGeom = { x0, x1, t0, t1, dpr };

    ctx.clearRect(0, 0, W, H);
    // тло: сутінки й ніч
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    n.samples.forEach((s) => {
      const k = (s.t - t0) / (t1 - t0);
      const sa = s.sun;
      const night = clamp((-sa - 0.8) / 17.2, 0, 1);
      const r1 = Math.round(52 - 42 * night);
      const g1 = Math.round(60 - 46 * night);
      const b1 = Math.round(118 - 78 * night);
      g.addColorStop(clamp(k, 0, 1), `rgb(${r1},${g1},${b1})`);
    });
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    // сітка
    ctx.font = `${Math.round(11 * dpr)}px Arsenal, sans-serif`;
    ctx.fillStyle = 'rgba(162, 170, 203, 0.8)';
    ctx.strokeStyle = 'rgba(162, 170, 203, 0.14)';
    ctx.lineWidth = dpr;
    ctx.textAlign = 'right';
    for (const a of [0, 30, 60, 90]) {
      const y = Math.round(Y(a)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillText(`${a}°`, x0 - 6 * dpr, y + 4 * dpr);
    }
    ctx.textAlign = 'center';
    const tz = V.state.place.tz;
    const firstHour = Math.ceil(t0 / 3600000) * 3600000;
    const every = W / dpr < 520 ? 2 : 1;
    for (let t = firstHour; t <= t1; t += 3600000) {
      const hh = F.parts(new Date(t), tz).h;
      if (hh % every) continue;
      const x = X(t);
      ctx.fillStyle = 'rgba(162, 170, 203, 0.8)';
      ctx.fillText(String(hh), x, y1 + 18 * dpr);
      ctx.fillStyle = 'rgba(162, 170, 203, 0.3)';
      ctx.fillRect(Math.round(x), y1, dpr, 4 * dpr);
    }

    // криві
    ctx.lineJoin = 'round';
    for (const b of n.bodies) {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = (b.id === 'moon' ? 2.4 : 2) * dpr;
      ctx.setLineDash(b.id === 'moon' ? [] : []);
      ctx.beginPath();
      let pen = false;
      n.samples.forEach((s) => {
        const a = s[b.id];
        if (a < 0) {
          pen = false;
          return;
        }
        const x = X(s.t);
        const y = Y(a);
        if (!pen) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        pen = true;
      });
      ctx.stroke();
      // підпис біля максимуму
      const bx = X(b.bestT.getTime());
      const by = Y(b.bestAlt);
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(bx, by, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${Math.round(12.5 * dpr)}px Arsenal, sans-serif`;
      ctx.textAlign = bx > x1 - 60 * dpr ? 'right' : bx < x0 + 60 * dpr ? 'left' : 'center';
      ctx.fillText(b.name, bx, by - 9 * dpr);
    }

    // «зараз» і час на небі
    const skyT = V.state.time.getTime();
    if (skyT >= t0 && skyT <= t1) {
      const x = Math.round(X(skyT)) + 0.5;
      ctx.strokeStyle = 'rgba(242, 184, 92, 0.9)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(242, 184, 92, 0.95)';
      ctx.font = `700 ${Math.round(11 * dpr)}px Arsenal, sans-serif`;
      ctx.textAlign = x > x1 - 50 * dpr ? 'right' : 'left';
      ctx.fillText(V.state.live ? 'зараз' : 'на карті', x + (ctx.textAlign === 'right' ? -5 : 5) * dpr, y0 + 13 * dpr);
    }

    if (hoverX !== undefined) {
      const x = hoverX * dpr;
      ctx.strokeStyle = 'rgba(232, 234, 246, 0.55)';
      ctx.lineWidth = dpr;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }
  }

  function chartTime(clientX) {
    const r = chart.getBoundingClientRect();
    const g = chartGeom;
    if (!g) return null;
    const x = (clientX - r.left) * g.dpr;
    const k = (x - g.x0) / (g.x1 - g.x0);
    if (k < 0 || k > 1) return null;
    return { t: g.t0 + k * (g.t1 - g.t0), x: clientX - r.left };
  }

  chart.addEventListener('pointermove', (e) => {
    const h = chartTime(e.clientX);
    if (!h || !night) {
      tip.hidden = true;
      drawChart();
      return;
    }
    drawChart(h.x);
    const s = night.samples.reduce((a, b) => (Math.abs(b.t - h.t) < Math.abs(a.t - h.t) ? b : a));
    const tz = V.state.place.tz;
    const rows = night.bodies
      .filter((b) => s[b.id] > 0)
      .map((b) => `<span><i style="background:${b.color}"></i>${b.name} ${F.num(s[b.id])}°</span>`)
      .join('');
    tip.innerHTML = `<b>${F.hm(new Date(h.t), tz)}</b>${rows || '<span>над обрієм нічого яскравого</span>'}`;
    tip.hidden = false;
    const bw = chartBox.clientWidth;
    tip.style.left = `${clamp(h.x + 14, 8, bw - tip.offsetWidth - 8)}px`;
  });
  chart.addEventListener('pointerleave', () => {
    tip.hidden = true;
    drawChart();
  });
  chart.addEventListener('click', (e) => {
    const h = chartTime(e.clientX);
    if (!h) return;
    V.setTime(h.t);
    V.scrollToSky();
  });

  /* ================= Народне небо ================= */
  const folkList = $('#folk-list');

  function folkHTML() {
    folkList.innerHTML = D.FOLK.map(
      (f) => `
      <article class="folk-item" id="folk-${f.id}">
        <canvas class="folk-map" data-folk="${f.id}" role="img" aria-label="Схема: ${F.escapeHtml(f.name)}"></canvas>
        <div class="folk-text">
          <h3>${f.name}</h3>
          <p class="folk-sci">${f.sci}</p>
          <p>${f.text}</p>
          <p class="folk-now" data-now="${f.id}"></p>
          <button class="chip show-btn" type="button" data-show="${f.id}">Показати на небі</button>
        </div>
      </article>`
    ).join('');
  }
  folkHTML();

  folkList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-show]');
    if (!b) return;
    showFolk(b.dataset.show);
  });

  function showFolk(id) {
    const f = D.FOLK.find((x) => x.id === id);
    const cat = V.sky.cat;
    V.scrollToSky();
    if (f.planet) {
      setTimeout(() => V.showOnSky({ type: 'planet', ref: f.planet }, 'Венера', { minAlt: 4, fov: 70 }), 350);
      return;
    }
    if (!cat) {
      V.toast('Зоряний каталог ще завантажується. Спробуйте за мить.');
      return;
    }
    const cf = cat.folk.find((x) => x.id === id);
    const ref = V.folkRef(cf);
    if (f.milkyway) {
      V.setLayer('mw', true);
      if (V.state.level.lp > 0.3) {
        V.setLevel('dark');
        V.toast('З міста Чумацького Шляху не видно, тому перемкнули засвітку на «Темне небо».');
      }
    }
    V.setLayer('folk', true);
    const fov = f.view ? clamp(f.view.field * 2, 30, 110) : 70;
    setTimeout(() => V.showOnSky({ type: 'folk', ref }, f.name, { fov, minAlt: f.milkyway ? 25 : 12 }), 350);
  }

  function drawFolkMaps() {
    const cat = V.sky.cat;
    if (!cat) return;
    for (const canvas of folkList.querySelectorAll('canvas[data-folk]')) {
      const f = cat.folk.find((x) => x.id === canvas.dataset.folk);
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      const ctx = canvas.getContext('2d');
      if (f.planet) drawVenus(ctx, canvas.width, canvas.height, dpr);
      else drawField(ctx, canvas.width, canvas.height, dpr, cat, f);
    }
  }

  function drawField(ctx, W, H, dpr, cat, f) {
    const [ra0, dec0] = f.view.center;
    const c0 = A.raDecToVec(ra0, dec0);
    // дотична площина: схід ліворуч, північ угорі
    const east = [-Math.sin(ra0 * RAD), Math.cos(ra0 * RAD), 0];
    const north = [-Math.sin(dec0 * RAD) * Math.cos(ra0 * RAD), -Math.sin(dec0 * RAD) * Math.sin(ra0 * RAD), Math.cos(dec0 * RAD)];
    const half = Math.tan(((f.view.field / 2) * RAD));
    const scale = Math.min(W, H) / 2 / half;
    const proj = (v) => {
      const z = v[0] * c0[0] + v[1] * c0[1] + v[2] * c0[2];
      if (z <= 0.2) return null;
      const x = (v[0] * east[0] + v[1] * east[1] + v[2] * east[2]) / z;
      const y = (v[0] * north[0] + v[1] * north[1] + v[2] * north[2]) / z;
      return [W / 2 - x * scale, H / 2 - y * scale];
    };
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
    bg.addColorStop(0, '#111845');
    bg.addColorStop(1, '#070a1e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (f.milkyway) {
      // смуга Галактики: точки галактичного екватора
      const G = A.transpose(A.GALACTIC);
      ctx.save();
      ctx.filter = `blur(${Math.round(18 * dpr)}px)`;
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        let first = true;
        for (let l = -40; l <= 200; l += 2) {
          const b = pass ? 0.02 : 0;
          const gv = [Math.cos(l * RAD) * Math.cos(b), Math.sin(l * RAD) * Math.cos(b), Math.sin(b)];
          const eq = A.apply(G, gv);
          const p = proj(eq);
          if (!p) {
            first = true;
            continue;
          }
          if (first) ctx.moveTo(p[0], p[1]);
          else ctx.lineTo(p[0], p[1]);
          first = false;
        }
        ctx.strokeStyle = pass ? 'rgba(10, 12, 30, 0.55)' : 'rgba(170, 180, 225, 0.32)';
        ctx.lineWidth = (pass ? 12 : 70) * dpr;
        ctx.stroke();
      }
      ctx.restore();
    }

    // зорі
    const limit = f.view.field < 6 ? 7 : f.view.field > 50 ? 5 : 6;
    for (let i = 0; i < cat.n; i++) {
      if (cat.mag[i] > limit) break;
      const p = proj([cat.x[i], cat.y[i], cat.z[i]]);
      if (!p || p[0] < -5 || p[1] < -5 || p[0] > W + 5 || p[1] > H + 5) continue;
      const r = Math.max(0.6, (limit + 0.8 - cat.mag[i]) * 0.55) * dpr;
      ctx.fillStyle = cat.mag[i] < 2 ? '#fff7e8' : 'rgba(225, 230, 250, 0.9)';
      ctx.globalAlpha = Math.min(1, 0.35 + (limit - cat.mag[i]) * 0.18);
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // контекст — лінії наукового сузір'я
    if (f.context) {
      const c = cat.lines.find((x) => x.id === f.context);
      if (c) {
        ctx.strokeStyle = 'rgba(128, 150, 222, 0.45)';
        ctx.lineWidth = dpr;
        ctx.beginPath();
        for (const poly of c.polys) {
          let first = true;
          for (const v of poly) {
            const p = proj(v);
            if (!p) {
              first = true;
              continue;
            }
            if (first) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
            first = false;
          }
        }
        ctx.stroke();
      }
    }

    // народний візерунок
    ctx.strokeStyle = 'rgba(242, 184, 92, 0.9)';
    ctx.lineWidth = 1.6 * dpr;
    ctx.shadowColor = 'rgba(242, 184, 92, 0.7)';
    ctx.shadowBlur = 6 * dpr;
    ctx.beginPath();
    for (const line of f.lines) {
      line.forEach((idx, k) => {
        const p = proj(f.vecs[idx].v);
        if (!p) return;
        if (k === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      });
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (const s of f.vecs) {
      const p = proj(s.v);
      if (!p) continue;
      ctx.fillStyle = '#fff3dc';
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    // сторони світу
    ctx.font = `${Math.round(10.5 * dpr)}px Arsenal, sans-serif`;
    ctx.fillStyle = 'rgba(162, 170, 203, 0.55)';
    ctx.textAlign = 'center';
    ctx.fillText('пн', W / 2, 14 * dpr);
    ctx.textAlign = 'left';
    ctx.fillText('сх', 6 * dpr, H / 2 + 4 * dpr);
  }

  function drawVenus(ctx, W, H, dpr) {
    const p = V.state.place;
    const snap = A.snapshot(new Date(), p.lat, p.lon);
    const v = snap.planets.venus;
    const ground = H * 0.72;
    const g = ctx.createLinearGradient(0, 0, 0, ground);
    g.addColorStop(0, '#0d1336');
    g.addColorStop(0.7, '#3a3769');
    g.addColorStop(1, v.evening ? '#d9825a' : '#c07a86');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, ground);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, ground, W, H - ground);
    // Сонце під обрієм і Венера над ним — за справжньою елонгацією
    const sunX = v.evening ? W * 0.72 : W * 0.28;
    const k = Math.min(1, v.elongation / 47);
    const dx = (v.evening ? -1 : 1) * W * 0.3 * k;
    const vx = sunX + dx * 0.55;
    const vy = ground - (ground - 20 * dpr) * k * 0.85;
    const sg = ctx.createRadialGradient(sunX, ground + 10 * dpr, 0, sunX, ground + 10 * dpr, 70 * dpr);
    sg.addColorStop(0, 'rgba(255, 200, 140, 0.55)');
    sg.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, W, ground);
    ctx.setLineDash([3 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(242, 184, 92, 0.5)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(sunX, ground);
    ctx.lineTo(vx, vy);
    ctx.stroke();
    ctx.setLineDash([]);
    const vg = ctx.createRadialGradient(vx, vy, 0, vx, vy, 16 * dpr);
    vg.addColorStop(0, 'rgba(255, 250, 235, 1)');
    vg.addColorStop(0.25, 'rgba(255, 244, 215, 0.8)');
    vg.addColorStop(1, 'rgba(255, 244, 215, 0)');
    ctx.fillStyle = vg;
    ctx.beginPath();
    ctx.arc(vx, vy, 16 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `italic 500 ${Math.round(14 * dpr)}px Piazzolla, serif`;
    ctx.fillStyle = 'rgba(242, 184, 92, 0.95)';
    ctx.textAlign = 'center';
    ctx.fillText(v.evening ? 'Вечірня зоря' : 'Ранкова зоря', vx, vy - 18 * dpr);
    ctx.font = `${Math.round(10.5 * dpr)}px Arsenal, sans-serif`;
    ctx.fillStyle = 'rgba(232, 234, 246, 0.6)';
    ctx.fillText(v.evening ? 'захід' : 'схід', W / 2, ground + 18 * dpr);
  }

  function updateFolkNow() {
    const cat = V.sky.cat;
    const p = V.state.place;
    const t = new Date();
    for (const el of folkList.querySelectorAll('[data-now]')) {
      const id = el.dataset.now;
      const f = D.FOLK.find((x) => x.id === id);
      let text = '';
      if (f.planet) {
        const snap = A.snapshot(t, p.lat, p.lon);
        const v = snap.planets.venus;
        if (v.elongation < 10) text = 'Зараз Венера надто близько до Сонця і губиться в його промінні.';
        else text = `Зараз Венера — ${v.evening ? 'Вечірня' : 'Ранкова'} зоря: вона на ${F.num(v.elongation)}° ${v.evening ? 'на схід' : 'на захід'} від Сонця і ${v.evening ? 'світить після заходу' : 'сходить перед світанком'}.`;
      } else if (cat) {
        const cf = cat.folk.find((x) => x.id === id);
        const ref = V.folkRef(cf);
        const alt = A.fixedAltitude(ref.center, t, p.lat, p.lon);
        const lat = p.lat;
        const dec = A.vecToRaDec(ref.center).dec;
        if (dec > 90 - lat) text = 'Звідси не заходить ніколи — видно в будь-яку ясну ніч.';
        else if (alt > 10) text = `Зараз на висоті ${F.num(alt)}° над обрієм.`;
        else text = 'Зараз під обрієм або надто низько. Кнопка нижче перенесе час до найближчої нагоди.';
      }
      el.textContent = text;
    }
  }

  /* ================= Календар ================= */
  function moonGlyph(kind) {
    const r = 11;
    const base = `<circle cx="12" cy="12" r="${r}" fill="#20284f" stroke="rgba(232,234,246,.5)" stroke-width="1"/>`;
    if (kind === 'new') return `<svg viewBox="0 0 24 24" aria-hidden="true">${base}</svg>`;
    if (kind === 'full') return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="#ece8da"/></svg>`;
    const right = kind === 'first';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${base}<path d="M12 1 A11 11 0 0 ${right ? 1 : 0} 12 23 Z" fill="#ece8da"/></svg>`;
  }

  const PHASES = {
    new: ['Молодик', 'Місяця не видно всю ніч — найтемніші ночі місяця, час для Чумацького Шляху й туманностей.'],
    full: ['Повня', 'Місяць світить усю ніч і засвічує слабкі зорі. Зате добре видно пейзаж без ліхтарика.'],
    first: ['Перша чверть', 'Півмісяць увечері. У бінокль уздовж межі світла й тіні видно найбільше кратерів.'],
    last: ['Остання чверть', 'Півмісяць сходить після півночі, вечори темні.'],
  };
  const SEASONS = {
    march: ['Весняне рівнодення', 'День і ніч майже рівні. Далі дні довшають швидше, ніж будь-коли.'],
    june: ['Літнє сонцестояння', 'Найкоротша ніч року. На півночі України небо не стає зовсім темним.'],
    september: ['Осіннє рівнодення', 'День і ніч майже рівні, далі ночі довшають — сезон спостережень відкрито.'],
    december: ['Зимове сонцестояння', 'Найдовша ніч року: до шістнадцяти годин темряви.'],
  };

  function calendarEvents() {
    const p = V.state.place;
    const tz = p.tz;
    const from = new Date();
    const days = 190;
    const list = [];
    for (const ph of A.moonPhases(from, days)) {
      if (ph.kind !== 'new' && ph.kind !== 'full') continue;
      list.push({ date: ph.date, kind: 'moon', sub: ph.kind, title: PHASES[ph.kind][0], text: PHASES[ph.kind][1] });
    }
    for (const s of A.seasons(from, days)) {
      list.push({ date: s.date, kind: 'season', sub: s.kind, title: SEASONS[s.kind][0], text: SEASONS[s.kind][1] });
    }
    const y0 = F.parts(from, tz).y;
    for (const sh of D.SHOWERS) {
      for (const y of [y0, y0 + 1]) {
        // ніч піку: з day на day+1, беремо 02:00
        const peak = F.zoned(y, sh.month, sh.day + 1, 2, 0, tz);
        if (peak < new Date(from.getTime() - 86400000) || peak > new Date(from.getTime() + days * 86400000)) continue;
        const illum = A.moonIllumination(peak);
        const moonAlt = A.bodyAltitude('moon', peak, p.lat, p.lon);
        let moonNote;
        if (illum < 0.3 || moonAlt < 0) moonNote = 'Місяць не заважатиме.';
        else if (illum < 0.65) moonNote = `Місяць освітлений на ${F.num(illum * 100)} % і трохи заважатиме.`;
        else moonNote = `Яскравий Місяць (${F.num(illum * 100)} %) сховає слабкі метеори.`;
        list.push({
          date: peak,
          kind: 'shower',
          title: sh.name,
          zhr: sh.zhr,
          text: `${sh.text} До ${sh.zhr} метеорів на годину в ідеальних умовах, дивіться ${sh.best}. ${moonNote}`,
          radiant: sh.radiant,
          shower: sh,
        });
      }
    }
    return list.sort((a, b) => a.date - b.date).slice(0, 12);
  }

  function renderCalendar() {
    const p = V.state.place;
    const tz = p.tz;
    const events = calendarEvents();
    $('#calendar-lead').textContent = `Метеорні потоки, фази Місяця й сонцестояння на найближчі півроку. Час — ${p.id === 'geo' ? 'ваш місцевий' : 'київський'}.`;
    $('#events').innerHTML = events
      .map((ev, i) => {
        const pp = F.parts(ev.date, tz);
        const dateLabel = ev.kind === 'shower' ? `ніч на ${pp.d} ${D.MONTHS_GEN[pp.m - 1]}` : `${F.hm(ev.date, tz)}, ${D.WEEKDAYS[pp.wd]}`;
        const glyph =
          ev.kind === 'moon'
            ? moonGlyph(ev.sub)
            : ev.kind === 'season'
              ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="#f2b85c"/><g stroke="#f2b85c" stroke-width="1.6" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g></svg>'
              : `<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="#e8eaf6" stroke-linecap="round"><path d="M20 3L9 14" stroke-width="1.8"/><path d="M16 4l-6 6" stroke-width="1" opacity=".6"/><path d="M21 8l-6 6" stroke-width="1" opacity=".6"/></g><circle cx="8" cy="15" r="2.6" fill="#fff7e2"/></svg>`;
        const zhrBar = ev.zhr
          ? `<span class="zhr" title="Метеорів на годину в ідеальних умовах"><span style="width:${Math.min(100, (ev.zhr / 150) * 100)}%"></span></span>`
          : '';
        const actions =
          ev.kind === 'shower'
            ? `<div class="ev-actions"><button class="chip" type="button" data-ev-sky="${i}">Показати радіант</button>${window.ARTIFACT ? '' : `<button class="linkish" type="button" data-ev-ics="${i}">Додати в календар</button>`}</div>`
            : ev.kind === 'moon'
              ? `<div class="ev-actions"><button class="chip" type="button" data-ev-sky="${i}">Подивитися небо тієї ночі</button></div>`
              : '';
        return `<li class="event ev-${ev.kind}">
          <time datetime="${ev.date.toISOString()}"><span class="ev-day">${pp.d}</span><span class="ev-month">${D.MONTHS_SHORT[pp.m - 1]}</span></time>
          <div class="ev-glyph">${glyph}</div>
          <div class="ev-body">
            <h3>${ev.title}${zhrBar}</h3>
            <p class="ev-when">${dateLabel}</p>
            <p>${ev.text}</p>
            ${actions}
          </div>
        </li>`;
      })
      .join('');
    $('#events').onclick = (e) => {
      const skyBtn = e.target.closest('[data-ev-sky]');
      const icsBtn = e.target.closest('[data-ev-ics]');
      if (skyBtn) {
        const ev = events[+skyBtn.dataset.evSky];
        if (ev.kind === 'shower') {
          const cat = V.sky.cat;
          const con = cat && cat.labels.find((l) => l.name === ev.radiant);
          V.setTime(ev.date.getTime());
          V.scrollToSky();
          if (con) setTimeout(() => V.showOnSky({ type: 'const', ref: con }, ev.radiant, { minAlt: 5, fov: 100 }), 350);
          V.toast(`${ev.title}: метеори летять від сузір’я ${D.CONSTELLATIONS[Object.keys(D.CONSTELLATIONS).find((k) => D.CONSTELLATIONS[k][0] === ev.radiant)]?.[1] || ev.radiant}, але з’являються по всьому небу.`, 6000);
        } else {
          const tzp = F.parts(ev.date, tz);
          V.setTime(F.zoned(tzp.y, tzp.m, tzp.d, 23, 0, tz).getTime());
          V.scrollToSky();
        }
      } else if (icsBtn) {
        downloadICS(events[+icsBtn.dataset.evIcs]);
      }
    };
  }

  function downloadICS(ev) {
    const tz = V.state.place.tz;
    const p = F.parts(ev.date, tz);
    const start = F.zoned(p.y, p.m, p.d - 1, 22, 0, tz);
    const end = F.zoned(p.y, p.m, p.d, 5, 0, tz);
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => s.replace(/[,;\\]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Volosozhar//UK',
      'BEGIN:VEVENT',
      `UID:${stamp(start)}-${ev.title}@volosozhar`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(ev.title + ' — метеорний потік')}`,
      `DESCRIPTION:${esc(ev.text)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT2H',
      'ACTION:DISPLAY',
      `DESCRIPTION:${esc(ev.title + ' сьогодні вночі')}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${ev.title}.ics`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  /* ================= Оновлення ================= */
  function refreshAll() {
    nightKey = '';
    renderTonight();
    renderCalendar();
    updateFolkNow();
    drawFolkMaps();
  }

  window.addEventListener('placechange', refreshAll);
  window.addEventListener('catalog', () => {
    drawFolkMaps();
    updateFolkNow();
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawChart();
      drawFolkMaps();
    }, 150);
  });

  // перераховуємо ніч, коли час на карті переходить в іншу ніч
  setInterval(() => {
    const before = nightKey;
    renderTonightIfChanged(before);
    updateFolkNow();
  }, 1000);

  function renderTonightIfChanged(before) {
    const n = computeNight();
    if (!n) return;
    if (nightKey !== before) renderTonight();
    else drawChart();
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawChart());
  renderTonight();
  renderCalendar();
  updateFolkNow();
})();
