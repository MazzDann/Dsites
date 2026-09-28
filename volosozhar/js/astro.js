/*
 * Волосожар — астрономічні обчислення.
 * Сонце, Місяць і планети — за методом Пола Шлітера («How to compute planetary positions»),
 * прецесія — IAU 1976, зоряний час — IAU 1982. Точність — кілька кутових хвилин,
 * для неба «на око» і бінокля цього з запасом.
 *
 * Системи координат:
 *   екваторіальна (x — до точки весняного рівнодення, z — до північного полюса світу);
 *   горизонтальна (x — схід, y — північ, z — зеніт).
 */
(function () {
  'use strict';

  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const rev = (x) => x - Math.floor(x / 360) * 360;
  const sin = (x) => Math.sin(x * RAD);
  const cos = (x) => Math.cos(x * RAD);
  const atan2 = (y, x) => Math.atan2(y, x) * DEG;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  const julian = (date) => date.getTime() / 86400000 + 2440587.5;
  // день за Шлітером: 0.0 = 31.12.1999, 0h UT
  const dayNumber = (date) => julian(date) - 2451543.5;

  function gmst(date) {
    const d = julian(date) - 2451545.0;
    const T = d / 36525;
    return rev(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000);
  }

  const lst = (date, lonEast) => rev(gmst(date) + lonEast);
  const obliquity = (d) => 23.4393 - 3.563e-7 * d;

  function kepler(M, e) {
    let E = M + e * DEG * sin(M) * (1 + e * cos(M));
    for (let k = 0; k < 12; k++) {
      const dE = (E - e * DEG * sin(E) - M) / (1 - e * cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-7) break;
    }
    return E;
  }

  function eclToEq(x, y, z, ecl) {
    const c = cos(ecl);
    const s = sin(ecl);
    return [x, y * c - z * s, y * s + z * c];
  }

  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  function raDecToVec(raDeg, decDeg) {
    const cd = cos(decDeg);
    return [cd * cos(raDeg), cd * sin(raDeg), sin(decDeg)];
  }

  function vecToRaDec(v) {
    return { ra: rev(atan2(v[1], v[0])), dec: Math.asin(clamp(v[2], -1, 1)) * DEG };
  }

  /* ---------- Сонце ---------- */
  function sun(d) {
    const w = 282.9404 + 4.70935e-5 * d;
    const e = 0.016709 - 1.151e-9 * d;
    const M = rev(356.047 + 0.9856002585 * d);
    const E = kepler(M, e);
    const xv = cos(E) - e;
    const yv = Math.sqrt(1 - e * e) * sin(E);
    const v = atan2(yv, xv);
    const r = Math.hypot(xv, yv);
    const lon = rev(v + w);
    return { lon, r, M, w, x: r * cos(lon), y: r * sin(lon) };
  }

  /* ---------- Місяць ---------- */
  function moonEcliptic(d, s) {
    const N = rev(125.1228 - 0.0529538083 * d);
    const i = 5.1454;
    const w = rev(318.0634 + 0.1643573223 * d);
    const a = 60.2666;
    const e = 0.0549;
    const M = rev(115.3654 + 13.0649929509 * d);
    const E = kepler(M, e);
    const xv = a * (cos(E) - e);
    const yv = a * Math.sqrt(1 - e * e) * sin(E);
    const v = atan2(yv, xv);
    let r = Math.hypot(xv, yv);
    const vw = v + w;
    const xh = r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i));
    const yh = r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i));
    const zh = r * sin(vw) * sin(i);
    let lon = atan2(yh, xh);
    let lat = atan2(zh, Math.hypot(xh, yh));

    const Ms = s.M;
    const Mm = M;
    const Ls = rev(s.M + s.w);
    const Lm = rev(M + w + N);
    const D = Lm - Ls;
    const F = Lm - N;

    lon +=
      -1.274 * sin(Mm - 2 * D) +
      0.658 * sin(2 * D) -
      0.186 * sin(Ms) -
      0.059 * sin(2 * Mm - 2 * D) -
      0.057 * sin(Mm - 2 * D + Ms) +
      0.053 * sin(Mm + 2 * D) +
      0.046 * sin(2 * D - Ms) +
      0.041 * sin(Mm - Ms) -
      0.035 * sin(D) -
      0.031 * sin(Mm + Ms) -
      0.015 * sin(2 * F - 2 * D) +
      0.011 * sin(Mm - 4 * D);
    lat +=
      -0.173 * sin(F - 2 * D) -
      0.055 * sin(Mm - F - 2 * D) -
      0.046 * sin(Mm + F - 2 * D) +
      0.033 * sin(F + 2 * D) +
      0.017 * sin(2 * Mm + F);
    r += -0.58 * cos(Mm - 2 * D) - 0.46 * cos(2 * D);

    return { lon: rev(lon), lat, r };
  }

  /* ---------- Планети ---------- */
  // [N0, N1, i0, i1, w0, w1, a0, a1, e0, e1, M0, M1]
  const ELEMENTS = {
    mercury: [48.3313, 3.24587e-5, 7.0047, 5.0e-8, 29.1241, 1.01444e-5, 0.387098, 0, 0.205635, 5.59e-10, 168.6562, 4.0923344368],
    venus: [76.6799, 2.4659e-5, 3.3946, 2.75e-8, 54.891, 1.38374e-5, 0.72333, 0, 0.006773, -1.302e-9, 48.0052, 1.6021302244],
    mars: [49.5574, 2.11081e-5, 1.8497, -1.78e-8, 286.5016, 2.92961e-5, 1.523688, 0, 0.093405, 2.516e-9, 18.6021, 0.5240207766],
    jupiter: [100.4542, 2.76854e-5, 1.303, -1.557e-7, 273.8777, 1.64505e-5, 5.20256, 0, 0.048498, 4.469e-9, 19.895, 0.0830853001],
    saturn: [113.6634, 2.3898e-5, 2.4886, -1.081e-7, 339.3939, 2.97661e-5, 9.55475, 0, 0.055546, -9.499e-9, 316.967, 0.0334442282],
    uranus: [74.0005, 1.3978e-5, 0.7733, 1.9e-8, 96.6612, 3.0565e-5, 19.18171, -1.55e-8, 0.047318, 7.45e-9, 142.5905, 0.011725806],
    neptune: [131.7806, 3.0173e-5, 1.77, -2.55e-7, 272.8461, -6.027e-6, 30.05826, 3.313e-8, 0.008606, 2.15e-9, 260.2471, 0.005995147],
  };

  const meanAnomaly = (name, d) => rev(ELEMENTS[name][10] + ELEMENTS[name][11] * d);

  function heliocentric(name, d) {
    const p = ELEMENTS[name];
    const N = p[0] + p[1] * d;
    const i = p[2] + p[3] * d;
    const w = p[4] + p[5] * d;
    const a = p[6] + p[7] * d;
    const e = p[8] + p[9] * d;
    const M = rev(p[10] + p[11] * d);
    const E = kepler(M, e);
    const xv = a * (cos(E) - e);
    const yv = a * Math.sqrt(1 - e * e) * sin(E);
    const v = atan2(yv, xv);
    const r = Math.hypot(xv, yv);
    const vw = v + w;
    let x = r * (cos(N) * cos(vw) - sin(N) * sin(vw) * cos(i));
    let y = r * (sin(N) * cos(vw) + cos(N) * sin(vw) * cos(i));
    let z = r * sin(vw) * sin(i);

    if (name === 'jupiter' || name === 'saturn' || name === 'uranus') {
      const Mj = meanAnomaly('jupiter', d);
      const Ms = meanAnomaly('saturn', d);
      const Mu = meanAnomaly('uranus', d);
      let lon = atan2(y, x);
      let lat = atan2(z, Math.hypot(x, y));
      if (name === 'jupiter') {
        lon +=
          -0.332 * sin(2 * Mj - 5 * Ms - 67.6) -
          0.056 * sin(2 * Mj - 2 * Ms + 21) +
          0.042 * sin(3 * Mj - 5 * Ms + 21) -
          0.036 * sin(Mj - 2 * Ms) +
          0.022 * cos(Mj - Ms) +
          0.023 * sin(2 * Mj - 3 * Ms + 52) -
          0.016 * sin(Mj - 5 * Ms - 69);
      } else if (name === 'saturn') {
        lon +=
          0.812 * sin(2 * Mj - 5 * Ms - 67.6) -
          0.229 * cos(2 * Mj - 4 * Ms - 2) +
          0.119 * sin(Mj - 2 * Ms - 3) +
          0.046 * sin(2 * Mj - 6 * Ms - 69) +
          0.014 * sin(Mj - 3 * Ms + 32);
        lat += -0.02 * cos(2 * Mj - 4 * Ms - 2) + 0.018 * sin(2 * Mj - 6 * Ms - 49);
      } else {
        lon += 0.04 * sin(Ms - 2 * Mu + 6) + 0.035 * sin(Ms - 3 * Mu + 33) - 0.015 * sin(Mj - Mu + 20);
      }
      x = r * cos(lon) * cos(lat);
      y = r * sin(lon) * cos(lat);
      z = r * sin(lat);
    }
    return { x, y, z, r };
  }

  const MAGNITUDE = {
    mercury: (r, R, fv) => -0.36 + 5 * Math.log10(r * R) + 0.027 * fv + 2.2e-13 * fv ** 6,
    venus: (r, R, fv) => -4.34 + 5 * Math.log10(r * R) + 0.013 * fv + 4.2e-7 * fv ** 3,
    mars: (r, R, fv) => -1.51 + 5 * Math.log10(r * R) + 0.016 * fv,
    jupiter: (r, R, fv) => -9.25 + 5 * Math.log10(r * R) + 0.014 * fv,
    saturn: (r, R, fv) => -9.0 + 5 * Math.log10(r * R) + 0.044 * fv,
    uranus: (r, R, fv) => -7.15 + 5 * Math.log10(r * R) + 0.001 * fv,
    neptune: (r, R, fv) => -6.9 + 5 * Math.log10(r * R) + 0.001 * fv,
  };

  const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

  /* ---------- Матриці ---------- */

  // J2000 → екваторіальні координати дати (IAU 1976)
  function precessionMatrix(date) {
    const T = (julian(date) - 2451545.0) / 36525;
    const as = 1 / 3600;
    const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * as;
    const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * as;
    const th = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * as;
    const cz = cos(zeta), sz = sin(zeta);
    const cZ = cos(z), sZ = sin(z);
    const ct = cos(th), st = sin(th);
    return [
      cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ,
      cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ,
      cz * st, -sz * st, ct,
    ];
  }

  // екваторіальні (дата) → горизонтальні (схід, північ, зеніт)
  function horizonMatrix(lstDeg, latDeg) {
    const sl = sin(lstDeg), cl = cos(lstDeg);
    const sp = sin(latDeg), cp = cos(latDeg);
    return [
      -sl, cl, 0,
      -sp * cl, -sp * sl, cp,
      cp * cl, cp * sl, sp,
    ];
  }

  // J2000 → галактичні
  const GALACTIC = [
    -0.0548755604, -0.8734370902, -0.4838350155,
    0.4941094279, -0.44482963, 0.7469822445,
    -0.867666149, -0.1980763734, 0.4559837762,
  ];

  function mul(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
      }
    }
    return r;
  }

  function transpose(m) {
    return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  }

  function apply(m, v) {
    return [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
  }

  function altAz(h) {
    return {
      alt: Math.asin(clamp(h[2], -1, 1)) * DEG,
      az: rev(atan2(h[0], h[1])),
    };
  }

  function observerVector(latDeg, lstDeg) {
    // геоцентричні координати спостерігача в радіусах Землі
    const gclat = latDeg - 0.1924 * sin(2 * latDeg);
    const rho = 0.99833 + 0.00167 * cos(2 * latDeg);
    return [rho * cos(gclat) * cos(lstDeg), rho * cos(gclat) * sin(lstDeg), rho * sin(gclat)];
  }

  // топоцентричний Місяць: одиничний вектор (екваторіальні координати дати) і відстань
  function moonTopo(d, s, ecl, lat, L) {
    const m = moonEcliptic(d, s);
    const mg = eclToEq(m.r * cos(m.lon) * cos(m.lat), m.r * sin(m.lon) * cos(m.lat), m.r * sin(m.lat), ecl);
    const obs = observerVector(lat, L);
    const mt = [mg[0] - obs[0], mg[1] - obs[1], mg[2] - obs[2]];
    const dist = Math.hypot(mt[0], mt[1], mt[2]);
    return { m, dist, eq: [mt[0] / dist, mt[1] / dist, mt[2] / dist] };
  }

  // геоцентрична планета
  function planetGeo(name, d, s, ecl) {
    const h = heliocentric(name, d);
    const xg = h.x + s.x;
    const yg = h.y + s.y;
    const zg = h.z;
    return { h, xg, yg, zg, R: Math.hypot(xg, yg, zg), eq: norm(eclToEq(xg, yg, zg, ecl)) };
  }

  /*
   * Повний «знімок» неба на момент часу для точки спостереження.
   * Повертає матриці та положення Сонця, Місяця й планет.
   */
  function snapshot(date, lat, lon) {
    const d = dayNumber(date);
    const ecl = obliquity(d);
    const L = lst(date, lon);
    const H = horizonMatrix(L, lat);
    const P = precessionMatrix(date);
    const starMatrix = mul(H, P); // J2000 → горизонт
    const s = sun(d);

    const sunEq = norm(eclToEq(s.x, s.y, 0, ecl));
    const sunHor = apply(H, sunEq);

    // Місяць (топоцентричний)
    const mtopo = moonTopo(d, s, ecl, lat, L);
    const m = mtopo.m;
    const moonDistER = mtopo.dist;
    const moonEq = mtopo.eq;
    const moonHor = apply(H, moonEq);
    const elong = Math.acos(clamp(cos(m.lat) * cos(m.lon - s.lon), -1, 1)) * DEG;
    const moonAU = (m.r * 6378.14) / 149597870.7;
    const phaseAngle = atan2(s.r * sin(elong), moonAU - s.r * cos(elong));
    const illum = (1 + cos(phaseAngle)) / 2;
    const age = rev(m.lon - s.lon); // 0 — молодик, 180 — повня
    const moonMag = 0.23 + 5 * Math.log10(s.r * moonAU) + 0.026 * phaseAngle + 4e-9 * phaseAngle ** 4;

    const planets = {};
    for (const name of PLANETS) {
      const { h, xg, yg, zg, R, eq } = planetGeo(name, d, s, ecl);
      const fv = Math.acos(clamp((h.r * h.r + R * R - s.r * s.r) / (2 * h.r * R), -1, 1)) * DEG;
      let mag = MAGNITUDE[name](h.r, R, fv);
      if (name === 'saturn') {
        const los = atan2(yg, xg);
        const las = atan2(zg, Math.hypot(xg, yg));
        const ir = 28.06;
        const Nr = 169.51 + 3.82e-5 * d;
        const B = Math.asin(clamp(sin(las) * cos(ir) - cos(las) * sin(ir) * sin(los - Nr), -1, 1));
        mag += -2.6 * Math.sin(Math.abs(B)) + 1.2 * Math.sin(B) ** 2;
      }
      const hor = apply(H, eq);
      const elongation = Math.acos(clamp(eq[0] * sunEq[0] + eq[1] * sunEq[1] + eq[2] * sunEq[2], -1, 1)) * DEG;
      const east = rev(atan2(yg, xg) - s.lon) < 180; // на схід від Сонця — видно ввечері
      planets[name] = {
        name,
        eq,
        hor,
        dist: R,
        helio: h.r,
        mag,
        phase: (1 + cos(fv)) / 2,
        elongation,
        evening: east,
      };
    }

    return {
      date,
      d,
      lat,
      lon,
      lst: L,
      H,
      P,
      starMatrix,
      sun: { eq: sunEq, hor: sunHor, dist: s.r, lon: s.lon, ...altAz(sunHor) },
      moon: {
        eq: moonEq,
        hor: moonHor,
        distKm: moonDistER * 6378.14,
        illum,
        age,
        waxing: age < 180,
        mag: moonMag,
        lon: m.lon,
        ...altAz(moonHor),
      },
      planets,
    };
  }

  /* ---------- Швидкі функції висоти для пошуку сходу/заходу ---------- */

  function sunAltitude(date, lat, lon) {
    const d = dayNumber(date);
    const s = sun(d);
    const eq = norm(eclToEq(s.x, s.y, 0, obliquity(d)));
    const H = horizonMatrix(lst(date, lon), lat);
    return Math.asin(clamp(H[6] * eq[0] + H[7] * eq[1] + H[8] * eq[2], -1, 1)) * DEG;
  }

  function bodyHorizontal(name, date, lat, lon) {
    const snap = snapshot(date, lat, lon);
    if (name === 'sun') return snap.sun;
    if (name === 'moon') return snap.moon;
    const p = snap.planets[name];
    return { ...p, ...altAz(p.hor) };
  }

  // висота одного тіла без обчислення всієї Сонячної системи — для пошуку сходу й заходу
  function bodyAltitude(name, date, lat, lon) {
    if (name === 'sun') return sunAltitude(date, lat, lon);
    const d = dayNumber(date);
    const ecl = obliquity(d);
    const L = lst(date, lon);
    const s = sun(d);
    const eq = name === 'moon' ? moonTopo(d, s, ecl, lat, L).eq : planetGeo(name, d, s, ecl).eq;
    const H = horizonMatrix(L, lat);
    return Math.asin(clamp(H[6] * eq[0] + H[7] * eq[1] + H[8] * eq[2], -1, 1)) * DEG;
  }

  function fixedAltitude(vecJ2000, date, lat, lon) {
    const M = mul(horizonMatrix(lst(date, lon), lat), precessionMatrix(date));
    return Math.asin(clamp(M[6] * vecJ2000[0] + M[7] * vecJ2000[1] + M[8] * vecJ2000[2], -1, 1)) * DEG;
  }

  /*
   * Шукає моменти, коли висота f(t) перетинає рівень h0 між start і end.
   * Повертає { rise: [], set: [], max: {time, alt} }.
   */
  function crossings(f, start, end, h0, stepMin = 10) {
    const step = stepMin * 60000;
    const res = { rise: [], set: [], max: null };
    let t0 = start.getTime();
    let a0 = f(new Date(t0)) - h0;
    let best = { time: new Date(t0), alt: a0 + h0 };
    for (let t = t0 + step; t <= end.getTime() + 1; t += step) {
      const a1 = f(new Date(t)) - h0;
      if (a1 + h0 > best.alt) best = { time: new Date(t), alt: a1 + h0 };
      if ((a0 < 0 && a1 >= 0) || (a0 >= 0 && a1 < 0)) {
        let lo = t - step;
        let hi = t;
        let flo = a0;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          const fm = f(new Date(mid)) - h0;
          if ((flo < 0) === (fm < 0)) {
            lo = mid;
            flo = fm;
          } else {
            hi = mid;
          }
        }
        (a0 < 0 ? res.rise : res.set).push(new Date((lo + hi) / 2));
      }
      a0 = a1;
    }
    // уточнення максимуму золотим перетином
    let lo = Math.max(start.getTime(), best.time.getTime() - step);
    let hi = Math.min(end.getTime(), best.time.getTime() + step);
    const g = 0.381966;
    for (let k = 0; k < 25; k++) {
      const m1 = lo + (hi - lo) * g;
      const m2 = hi - (hi - lo) * g;
      if (f(new Date(m1)) < f(new Date(m2))) lo = m1;
      else hi = m2;
    }
    const tm = new Date((lo + hi) / 2);
    const am = f(tm);
    res.max = am > best.alt ? { time: tm, alt: am } : best;
    return res;
  }

  /* ---------- Фази Місяця та сезони ---------- */

  function elongationLon(date) {
    const d = dayNumber(date);
    const s = sun(d);
    const m = moonEcliptic(d, s);
    return rev(m.lon - s.lon);
  }

  function findAngleEvents(fn, target, from, days, stepHours) {
    const out = [];
    const step = stepHours * 3600000;
    const diff = (t) => {
      const x = rev(fn(new Date(t)) - target + 180) - 180;
      return x;
    };
    let t = from.getTime();
    let a = diff(t);
    const end = t + days * 86400000;
    while (t < end) {
      const t1 = t + step;
      const b = diff(t1);
      if (a < 0 && b >= 0 && b - a < 90) {
        let lo = t;
        let hi = t1;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          if (diff(mid) < 0) lo = mid;
          else hi = mid;
        }
        out.push(new Date((lo + hi) / 2));
      }
      t = t1;
      a = b;
    }
    return out;
  }

  function moonPhases(from, days) {
    const list = [];
    const kinds = [
      [0, 'new'],
      [90, 'first'],
      [180, 'full'],
      [270, 'last'],
    ];
    for (const [angle, kind] of kinds) {
      for (const date of findAngleEvents(elongationLon, angle, from, days, 6)) list.push({ date, kind });
    }
    return list.sort((a, b) => a.date - b.date);
  }

  function seasons(from, days) {
    const list = [];
    const sunLon = (date) => sun(dayNumber(date)).lon;
    const kinds = [
      [0, 'march'],
      [90, 'june'],
      [180, 'september'],
      [270, 'december'],
    ];
    for (const [angle, kind] of kinds) {
      for (const date of findAngleEvents(sunLon, angle, from, days, 24)) list.push({ date, kind });
    }
    return list.sort((a, b) => a.date - b.date);
  }

  function moonIllumination(date) {
    const d = dayNumber(date);
    const s = sun(d);
    const m = moonEcliptic(d, s);
    const elong = Math.acos(clamp(cos(m.lat) * cos(m.lon - s.lon), -1, 1)) * DEG;
    return (1 - cos(elong)) / 2;
  }

  /* ---------- Дрібниці ---------- */

  // атмосферне поглинання: на скільки зоряних величин тьмяніє об'єкт на висоті alt
  function extinction(altDeg) {
    const s = Math.sin(Math.max(altDeg, -1) * RAD);
    const X = 1 / (Math.max(s, 0) + 0.025 * Math.exp(-11 * Math.max(s, 0)));
    return 0.22 * (Math.min(X, 40) - 1);
  }

  // колір-індекс B–V → температура поверхні (формула Баллестероса)
  function bvToKelvin(bv) {
    return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  }

  window.Astro = {
    RAD,
    DEG,
    rev,
    clamp,
    julian,
    dayNumber,
    gmst,
    lst,
    raDecToVec,
    vecToRaDec,
    snapshot,
    horizonMatrix,
    precessionMatrix,
    GALACTIC,
    mul,
    transpose,
    apply,
    altAz,
    sunAltitude,
    bodyAltitude,
    bodyHorizontal,
    fixedAltitude,
    crossings,
    moonPhases,
    seasons,
    moonIllumination,
    extinction,
    bvToKelvin,
    PLANETS,
  };
})();
