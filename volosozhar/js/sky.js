/*
 * Волосожар — рендерер неба.
 * Фон (атмосфера, сутінки, Чумацький Шлях, пейзаж) малює WebGL-шейдер,
 * зорі, лінії й підписи — 2D-канва поверх нього.
 * Проєкція стереографічна: зберігає форму сузір'їв навіть при широкому куті.
 */
(function () {
  'use strict';

  const A = window.Astro;
  const D = window.SkyData;
  const RAD = A.RAD;
  const DEG = A.DEG;

  /* ================= Пейзаж на обрії ================= */
  // Усі розміри — у градусах (азимут, висота).
  const LAND = {
    poplars: [
      [186.6, 0.3, 4.2],
      [188.1, 0.26, 3.5],
      [189.4, 0.32, 4.8],
      [146.5, 0.3, 3.8],
      [147.8, 0.24, 3.0],
      [255.0, 0.32, 4.0],
      [256.2, 0.27, 3.3],
      [331.0, 0.3, 3.6],
    ],
    trees: [
      [196.8, 1.3, 2.3],
      [215.5, 1.1, 1.9],
      [238.0, 1.5, 2.4],
      [131.0, 1.2, 2.0],
      [300.0, 1.4, 2.1],
      [352.0, 1.2, 1.8],
      [22.0, 1.4, 2.2],
    ],
    forest: [58, 114, 1.25],
    house: { az: 206, w: 1.7, wall: 1.15, roof: 2.35, over: 0.4, ridge: 0.35 },
    well: { az: 170 },
  };

  const h0 = (az) => {
    const a = az * RAD;
    return Math.max(
      0.12,
      0.7 + 0.35 * Math.sin(2 * a + 1.3) + 0.25 * Math.sin(5 * a + 0.4) + 0.12 * Math.sin(11 * a + 2.1) + 0.05 * Math.sin(27 * a + 0.7)
    );
  };
  const adiff = (a, b) => ((((a - b + 540) % 360) + 360) % 360) - 180;
  const sdEllipse = (px, py, rx, ry) => (Math.hypot(px / rx, py / ry) - 1) * Math.min(rx, ry);
  const sdBox = (px, py, bx, by) => {
    const dx = Math.abs(px) - bx;
    const dy = Math.abs(py) - by;
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
  };
  const sdSeg = (px, py, ax, ay, bx, by) => {
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
    return Math.hypot(pax - bax * h, pay - bay * h);
  };
  const forestTop = (az) =>
    0.28 * Math.abs(Math.sin(az * 1.7)) + 0.18 * Math.abs(Math.sin(az * 4.3 + 1.0)) + 0.1 * Math.abs(Math.sin(az * 9.1));

  // від'ємне значення — точка всередині землі або предмета
  function terrainSD(az, alt) {
    let d = alt - h0(az);
    for (const [c, hw, h] of LAND.poplars) {
      const x = adiff(az, c);
      if (Math.abs(x) > hw + 0.5) continue;
      d = Math.min(d, sdEllipse(x, alt - h0(c) - h * 0.45, hw, h * 0.55));
    }
    for (const [c, hw, h] of LAND.trees) {
      const x = adiff(az, c);
      if (Math.abs(x) > hw + 0.5) continue;
      const base = h0(c);
      d = Math.min(d, sdEllipse(x, alt - base - h * 0.62, hw, h * 0.4), sdBox(x, alt - base - h * 0.2, hw * 0.1, h * 0.25));
    }
    const [f0, f1, fh] = LAND.forest;
    if (az > f0 && az < f1) {
      const edge = Math.min(1, (az - f0) / 3, (f1 - az) / 3);
      d = Math.min(d, alt - (h0(az) + edge * (fh + forestTop(az))));
    }
    const H = LAND.house;
    let x = adiff(az, H.az);
    if (Math.abs(x) < 3) {
      const y = alt - h0(H.az);
      const yb = H.wall - 0.05;
      const k = (H.w + H.over - H.ridge) / (H.roof - yb);
      const slant = (Math.abs(x) + k * (y - yb) - (H.w + H.over)) / Math.sqrt(1 + k * k);
      d = Math.min(
        d,
        sdBox(x, y - H.wall / 2, H.w, H.wall / 2),
        Math.max(yb - y, y - H.roof, slant),
        sdBox(x - 0.55, y - (H.roof - 0.05), 0.11, 0.3)
      );
    }
    x = adiff(az, LAND.well.az);
    if (Math.abs(x) < 4) {
      const y = alt - h0(LAND.well.az);
      d = Math.min(
        d,
        sdBox(x, y - 1.5, 0.07, 1.5),
        sdSeg(x, y, 1.3, 2.13, -3.0, 5.0) - 0.05,
        sdSeg(x, y, -3.0, 5.0, -3.0, 1.05) - 0.012,
        sdBox(x + 3.0, y - 0.95, 0.1, 0.1),
        sdBox(x + 3.0, y - 0.3, 0.45, 0.3)
      );
    }
    return d;
  }

  /* ================= Шейдер ================= */
  const fl = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

  function terrainGLSL() {
    let s = `
float h0(float az) {
  float a = radians(az);
  return max(0.12, 0.7 + 0.35 * sin(2.0 * a + 1.3) + 0.25 * sin(5.0 * a + 0.4) + 0.12 * sin(11.0 * a + 2.1) + 0.05 * sin(27.0 * a + 0.7));
}
float adiff(float a, float b) { return mod(a - b + 540.0, 360.0) - 180.0; }
float sdEllipse(vec2 p, vec2 r) { return (length(p / r) - 1.0) * min(r.x, r.y); }
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float terrain(float az, float alt, float pix, out float glow) {
  glow = 0.0;
  float d = alt - h0(az);
  float x; float y; float base;
`;
    for (const [c, hw, h] of LAND.poplars) {
      s += `  x = adiff(az, ${fl(c)}); if (abs(x) < ${fl(hw + 0.5)}) { d = min(d, sdEllipse(vec2(x, alt - h0(${fl(c)}) - ${fl(h * 0.45)}), vec2(${fl(hw)}, ${fl(h * 0.55)}))); }\n`;
    }
    for (const [c, hw, h] of LAND.trees) {
      s += `  x = adiff(az, ${fl(c)}); if (abs(x) < ${fl(hw + 0.5)}) { base = h0(${fl(c)}); d = min(d, min(sdEllipse(vec2(x, alt - base - ${fl(h * 0.62)}), vec2(${fl(hw)}, ${fl(h * 0.4)})), sdBox(vec2(x, alt - base - ${fl(h * 0.2)}), vec2(${fl(hw * 0.1)}, ${fl(h * 0.25)})))); }\n`;
    }
    const [f0, f1, fh] = LAND.forest;
    s += `  if (az > ${fl(f0)} && az < ${fl(f1)}) {
    float edge = min(1.0, min((az - ${fl(f0)}) / 3.0, (${fl(f1)} - az) / 3.0));
    float ft = 0.28 * abs(sin(az * 1.7)) + 0.18 * abs(sin(az * 4.3 + 1.0)) + 0.1 * abs(sin(az * 9.1));
    d = min(d, alt - (h0(az) + edge * (${fl(fh)} + ft)));
  }\n`;
    const H = LAND.house;
    const yb = H.wall - 0.05;
    const k = (H.w + H.over - H.ridge) / (H.roof - yb);
    s += `  x = adiff(az, ${fl(H.az)});
  if (abs(x) < 3.0) {
    y = alt - h0(${fl(H.az)});
    float slant = (abs(x) + ${fl(k)} * (y - ${fl(yb)}) - ${fl(H.w + H.over)}) / ${fl(Math.sqrt(1 + k * k))};
    d = min(d, sdBox(vec2(x, y - ${fl(H.wall / 2)}), vec2(${fl(H.w)}, ${fl(H.wall / 2)})));
    d = min(d, max(max(${fl(yb)} - y, y - ${fl(H.roof)}), slant));
    d = min(d, sdBox(vec2(x - 0.55, y - ${fl(H.roof - 0.05)}), vec2(0.11, 0.3)));
    float w1 = sdBox(vec2(x + 0.85, y - 0.55), vec2(0.21, 0.23));
    float w2 = sdBox(vec2(x - 0.6, y - 0.55), vec2(0.21, 0.23));
    glow = 1.0 - smoothstep(-pix, pix, min(w1, w2));
    glow += 0.25 * exp(-min(w1, w2) * min(w1, w2) / 0.02) * step(0.0, -d);
  }\n`;
    s += `  x = adiff(az, ${fl(LAND.well.az)});
  if (abs(x) < 4.0) {
    y = alt - h0(${fl(LAND.well.az)});
    d = min(d, sdBox(vec2(x, y - 1.5), vec2(0.07, 1.5)));
    d = min(d, sdSeg(vec2(x, y), vec2(1.3, 2.13), vec2(-3.0, 5.0)) - 0.05);
    d = min(d, sdSeg(vec2(x, y), vec2(-3.0, 5.0), vec2(-3.0, 1.05)) - 0.012);
    d = min(d, sdBox(vec2(x + 3.0, y - 0.95), vec2(0.1, 0.1)));
    d = min(d, sdBox(vec2(x + 3.0, y - 0.3), vec2(0.45, 0.3)));
  }
  return d;
}
`;
    return s;
  }

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = () => `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform vec3 uR;
uniform vec3 uU;
uniform vec3 uF;
uniform mat3 uGal;
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uMoonLight;
uniform float uLP;
uniform float uMW;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
${terrainGLSL()}

vec3 milkyWay(vec3 d) {
  vec3 g = uGal * d;
  float b = asin(clamp(g.z, -1.0, 1.0));
  float l = atan(g.y, g.x);
  float bulge = exp(-l * l / 0.3);
  float sigma = 0.1 + 0.13 * bulge;
  float band = exp(-b * b / (sigma * sigma));
  float along = 0.42 + 0.58 * exp(-l * l / 1.8);
  float clouds = fbm(g * 6.0);
  float fine = fbm(g * 21.0 + 3.1);
  float dust = smoothstep(0.38, 0.72, fbm(g * 4.5 + vec3(4.2, 1.3, 7.7)));
  float lane = exp(-pow((b - 0.012) / 0.045, 2.0)) * smoothstep(1.9, 0.3, abs(l));
  float mw = band * along * (0.18 + 1.5 * clouds * clouds + 0.35 * fine * fine);
  mw *= 1.0 - 0.8 * lane * (0.35 + 0.65 * dust);
  mw *= 1.0 - 0.4 * dust * band;
  vec3 col = mix(vec3(0.56, 0.63, 0.86), vec3(0.98, 0.84, 0.64), bulge * 0.75);
  return col * mw;
}

void main() {
  vec2 p = (gl_FragCoord.xy - uCenter) / uScale;
  float r2 = dot(p, p);
  float den = 4.0 + r2;
  vec3 c = vec3(4.0 * p.x / den, 4.0 * p.y / den, (4.0 - r2) / den);
  vec3 d = normalize(uR * c.x + uU * c.y + uF * c.z);
  float pixDeg = degrees(1.0 / (uScale * (1.0 + r2 * 0.25)));

  float alt = asin(clamp(d.z, -1.0, 1.0));
  float h = max(alt, 0.0);
  float hz = exp(-h * 3.5);
  float sa = degrees(asin(clamp(uSun.z, -1.0, 1.0)));
  vec2 sh = normalize(uSun.xy + vec2(1e-6));
  vec2 dh = normalize(d.xy + vec2(1e-6));
  float toward = dot(sh, dh) * 0.5 + 0.5;

  float dayF = smoothstep(-4.0, 6.0, sa);
  float civil = smoothstep(-9.0, -1.0, sa) * (1.0 - smoothstep(3.0, 12.0, sa));
  float naut = smoothstep(-15.0, -5.0, sa);
  float astro = smoothstep(-19.5, -11.0, sa);

  // ніч і міське світіння
  vec3 col = mix(vec3(0.010, 0.014, 0.040), vec3(0.030, 0.044, 0.100), exp(-h * 2.2));
  col += vec3(0.21, 0.13, 0.095) * uLP * exp(-h * 4.5) + vec3(0.03, 0.03, 0.045) * uLP;

  // сутінки
  col += vec3(0.025, 0.05, 0.14) * astro * (0.6 + 0.4 * hz);
  col += vec3(0.05, 0.09, 0.21) * naut * (0.5 + 0.5 * hz);
  col += vec3(0.98, 0.43, 0.17) * exp(-h * 7.0) * pow(toward, 2.5) * civil * 0.95;
  col += vec3(0.42, 0.28, 0.55) * exp(-h * 2.6) * pow(toward, 1.4) * naut * (1.0 - dayF) * 0.35;
  float anti = pow(1.0 - toward, 3.0);
  col += vec3(0.55, 0.32, 0.44) * exp(-pow((degrees(h) - 9.0) / 7.0, 2.0)) * anti * civil * (1.0 - dayF) * 0.45;

  // місячне світло
  float ml = uMoonLight * smoothstep(-0.02, 0.06, uMoon.z);
  float mang = acos(clamp(dot(d, uMoon), -1.0, 1.0));
  col += vec3(0.045, 0.065, 0.13) * ml * (1.0 - dayF) * (0.6 + 0.4 * hz);
  col += vec3(0.62, 0.66, 0.76) * uMoonLight * step(-0.01, uMoon.z) * (exp(-mang * mang / 0.0012) * 0.4 + exp(-mang / 0.16) * 0.08) * (1.0 - dayF * 0.85);

  // Чумацький Шлях
  float mwVis = uMW * (1.0 - smoothstep(-17.0, -9.0, sa)) * (1.0 - 0.88 * uLP) * (1.0 - 0.55 * ml) * smoothstep(0.0, 0.3, h);
  if (mwVis > 0.001) col += milkyWay(d) * 0.34 * mwVis;

  // день
  vec3 day = mix(vec3(0.17, 0.37, 0.73), vec3(0.64, 0.78, 0.93), exp(-h * 4.0));
  float cg = max(dot(d, uSun), 0.0);
  day += vec3(1.0, 0.93, 0.8) * (pow(cg, 500.0) * 1.8 + pow(cg, 16.0) * 0.28);
  day = mix(day, day * vec3(1.1, 0.88, 0.74), (1.0 - smoothstep(0.0, 14.0, sa)) * hz * toward);
  col = mix(col, day, dayF);

  // земля і пейзаж
  float altDeg = degrees(alt);
  if (altDeg < 8.0) {
    float az = degrees(atan(d.x, d.y));
    if (az < 0.0) az += 360.0;
    float glow;
    float sd = terrain(az, altDeg, pixDeg, glow);
    float cover = 1.0 - smoothstep(-pixDeg, pixDeg, sd);
    vec3 gcol = mix(vec3(0.006, 0.009, 0.02), vec3(0.045, 0.07, 0.055), dayF);
    gcol += col * 0.05;
    gcol += vec3(1.0, 0.66, 0.3) * glow * (1.0 - dayF) * 0.95;
    col = mix(col, gcol, cover);
    // легка імла над самим обрієм
    col += vec3(0.02, 0.025, 0.05) * exp(-abs(altDeg - 0.5) / 1.2) * (1.0 - cover) * (1.0 - dayF);
  }

  col += (hash(vec3(gl_FragCoord.xy, 1.0)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

  class GLSky {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
      this.ok = !!gl;
      if (!gl) return;
      this.gl = gl;
      const vs = this.shader(gl.VERTEX_SHADER, VERT);
      const fs = this.shader(gl.FRAGMENT_SHADER, FRAG());
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error(gl.getProgramInfoLog(prog));
        this.ok = false;
        return;
      }
      this.prog = prog;
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      for (const n of ['uRes', 'uCenter', 'uScale', 'uR', 'uU', 'uF', 'uGal', 'uSun', 'uMoon', 'uMoonLight', 'uLP', 'uMW']) {
        this.u[n] = gl.getUniformLocation(prog, n);
      }
    }

    shader(type, src) {
      const gl = this.gl;
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    }

    render(p) {
      if (!this.ok) return;
      const gl = this.gl;
      const u = this.u;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform2f(u.uCenter, p.cx, p.cy);
      gl.uniform1f(u.uScale, p.scale);
      gl.uniform3fv(u.uR, p.r);
      gl.uniform3fv(u.uU, p.u);
      gl.uniform3fv(u.uF, p.f);
      gl.uniformMatrix3fv(u.uGal, false, A.transpose(p.gal));
      gl.uniform3fv(u.uSun, p.sun);
      gl.uniform3fv(u.uMoon, p.moon);
      gl.uniform1f(u.uMoonLight, p.moonLight);
      gl.uniform1f(u.uLP, p.lp);
      gl.uniform1f(u.uMW, p.mw);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /* ================= Спрайти зір ================= */
  const BV_EDGES = [-0.2, 0.0, 0.2, 0.4, 0.65, 1.0, 1.4];
  const BV_COLORS = ['#a3b9ff', '#bccbff', '#dbe3ff', '#f7f5ff', '#fff3de', '#ffe2b6', '#ffca8e', '#ffae72'];

  function bvBucket(bv) {
    let i = 0;
    while (i < BV_EDGES.length && bv > BV_EDGES[i]) i++;
    return i;
  }

  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function makeSprite(hex, S = 64) {
    const [r, g, b] = hexRgb(hex);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.12, `rgba(${r},${g},${b},1)`);
    grd.addColorStop(0.25, `rgba(${r},${g},${b},0.42)`);
    grd.addColorStop(0.5, `rgba(${r},${g},${b},0.07)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grd;
    x.fillRect(0, 0, S, S);
    return c;
  }

  /* ================= Каталог ================= */
  function greatCircleSubdivide(a, b, maxDeg) {
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const ang = Math.acos(dot) * DEG;
    const n = Math.max(1, Math.ceil(ang / maxDeg));
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const v = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const l = Math.hypot(v[0], v[1], v[2]);
      out.push([v[0] / l, v[1] / l, v[2] / l]);
    }
    return out;
  }

  function polylineFromCoords(coords) {
    const pts = [];
    let prev = null;
    for (const [lon, lat] of coords) {
      const v = A.raDecToVec(lon, lat);
      if (prev) pts.push(...greatCircleSubdivide(prev, v, 4));
      else pts.push(v);
      prev = v;
    }
    return pts;
  }

  function buildCatalog(json) {
    const feats = json.stars.features.slice().sort((a, b) => a.properties.mag - b.properties.mag);
    const n = feats.length;
    const cat = {
      n,
      x: new Float32Array(n),
      y: new Float32Array(n),
      z: new Float32Array(n),
      mag: new Float32Array(n),
      bv: new Float32Array(n),
      bucket: new Uint8Array(n),
      hip: new Int32Array(n),
      byHip: new Map(),
      names: new Map(),
      lines: [],
      labels: [],
      dsos: [],
      folk: [],
    };
    feats.forEach((f, i) => {
      const [lon, lat] = f.geometry.coordinates;
      const v = A.raDecToVec(lon, lat);
      cat.x[i] = v[0];
      cat.y[i] = v[1];
      cat.z[i] = v[2];
      cat.mag[i] = f.properties.mag;
      const bv = parseFloat(f.properties.bv);
      cat.bv[i] = Number.isFinite(bv) ? bv : 0.6;
      cat.bucket[i] = bvBucket(cat.bv[i]);
      cat.hip[i] = f.id;
      cat.byHip.set(f.id, i);
    });

    for (const f of json.lines.features) {
      const polys = f.geometry.coordinates.map(polylineFromCoords);
      cat.lines.push({ id: f.id, rank: +f.properties.rank || 3, polys });
    }
    for (const f of json.consts.features) {
      const names = D.CONSTELLATIONS[f.id];
      if (!names) continue;
      const [lon, lat] = f.geometry.coordinates;
      cat.labels.push({ id: f.id, name: names[0], rank: +f.properties.rank || 3, v: A.raDecToVec(lon, lat) });
    }
    if (json.dsos) {
      for (const f of json.dsos.features) {
        const [lon, lat] = f.geometry.coordinates;
        const dim = String(f.properties.dim || '5').split('x').map(parseFloat);
        cat.dsos.push({
          id: f.id,
          name: D.DSO_NAMES[f.id] || null,
          type: f.properties.type,
          mag: f.properties.mag,
          dim: dim[0] || 5,
          desig: f.properties.desig,
          v: A.raDecToVec(lon, lat),
        });
      }
    }
    // народні астеризми: прилипаємо до справжніх зір каталогу
    for (const folk of D.FOLK) {
      const vecs = folk.stars.map(([ra, dec]) => {
        const v = A.raDecToVec(ra, dec);
        let best = -1;
        let bestDot = Math.cos(0.4 * RAD);
        for (let i = 0; i < Math.min(n, 3000); i++) {
          const dt = cat.x[i] * v[0] + cat.y[i] * v[1] + cat.z[i] * v[2];
          if (dt > bestDot) {
            bestDot = dt;
            best = i;
          }
        }
        return best >= 0 ? { v: [cat.x[best], cat.y[best], cat.z[best]], idx: best } : { v, idx: -1 };
      });
      cat.folk.push({
        ...folk,
        vecs,
        labelVec: folk.label ? A.raDecToVec(folk.label[0], folk.label[1]) : null,
      });
    }
    return cat;
  }

  function applyNames(cat, starnames) {
    for (const hipKey of Object.keys(starnames)) {
      const idx = cat.byHip.get(+hipKey);
      if (idx === undefined) continue;
      const s = starnames[hipKey];
      const uk = s.name && D.STAR_NAMES[s.name] ? D.STAR_NAMES[s.name] : null;
      const con = D.CONSTELLATIONS[s.c];
      let desig = '';
      if (s.bayer && con) desig = `${s.bayer} ${con[1]}`;
      else if (s.flam && con) desig = `${s.flam} ${con[1]}`;
      cat.names.set(idx, { uk, desig, con: s.c });
    }
  }

  /* ================= Основний рендерер ================= */
  class Sky {
    constructor(glCanvas, canvas) {
      this.glCanvas = glCanvas;
      this.gl = new GLSky(glCanvas);
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.trailCanvas = document.createElement('canvas');
      this.trailCtx = this.trailCanvas.getContext('2d');
      this.trailKey = '';
      this.sprites = BV_COLORS.map((c) => makeSprite(c));
      this.planetSprites = {};
      for (const [k, c] of Object.entries(D.PLANET_COLORS)) this.planetSprites[k] = makeSprite(c);
      this.cat = null;
      this.hits = [];
      this.W = 0;
      this.H = 0;
      this.dpr = 1;
      this.glQuality = 1;
      this.lastGLKey = '';
      this.stats = { visible: 0, brightest: [] };
      this.fonts = {};
    }

    resize(cssW, cssH) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.cssW = cssW;
      this.cssH = cssH;
      this.W = Math.round(cssW * dpr);
      this.H = Math.round(cssH * dpr);
      this.canvas.width = this.W;
      this.canvas.height = this.H;
      this.trailCanvas.width = this.W;
      this.trailCanvas.height = this.H;
      this.trailKey = '';
      const q = this.glQuality;
      this.glCanvas.width = Math.max(1, Math.round(cssW * q));
      this.glCanvas.height = Math.max(1, Math.round(cssH * q));
      this.lastGLKey = '';
      const f = (size, family, weight = 400, style = 'normal') => `${style} ${weight} ${Math.round(size * dpr)}px ${family}`;
      this.fonts = {
        star: f(12.5, 'Arsenal, sans-serif'),
        planet: f(13.5, 'Arsenal, sans-serif', 700),
        con: f(14, 'Piazzolla, serif', 400, 'italic'),
        folk: f(16, 'Piazzolla, serif', 500, 'italic'),
        card: f(13, 'Arsenal, sans-serif', 700),
        cardSmall: f(11, 'Arsenal, sans-serif'),
        dso: f(11.5, 'Arsenal, sans-serif', 400, 'italic'),
      };
    }

    setCatalog(cat) {
      this.cat = cat;
      this.lastGLKey = '';
      this.trailKey = '';
    }

    view(cam) {
      const az = cam.az * RAD;
      const alt = cam.alt * RAD;
      const ca = Math.cos(alt);
      const sa = Math.sin(alt);
      const f = [Math.sin(az) * ca, Math.cos(az) * ca, sa];
      const r = [Math.cos(az), -Math.sin(az), 0];
      const u = [-Math.sin(az) * sa, -Math.cos(az) * sa, ca];
      // у вигляді «усе небо» купол вміщується у вільну від панелей частину екрана
      const ins = this.insets || { top: 0, bottom: 0, portraitBottom: 0, portraitFull: 0 };
      const portrait = this.H > this.W * 1.05;
      const wd = Math.max(0, Math.min(1, (cam.alt - 60) / 30));
      const w = portrait ? 1 : wd;
      const top = ins.top * this.dpr * w;
      const pb = ins.portraitBottom + (ins.portraitFull - ins.portraitBottom) * wd;
      const bottom = (portrait ? pb : ins.bottom) * this.dpr * w;
      const availH = this.H - top - bottom;
      const minDim = Math.min(this.W, availH);
      const scale = minDim / 2 / (2 * Math.tan((cam.fov * RAD) / 4));
      const radius = 2 * scale;
      const wide = Math.max(0, Math.min(1, (this.W / availH - 1.3) / 0.35)) * w;
      const cx = this.W / 2 + (this.W - radius - 40 * this.dpr - this.W / 2) * wide;
      const cy = top + availH / 2;
      return { f, r, u, scale, cx, cy };
    }

    project(v, V, out) {
      const X = v[0] * V.r[0] + v[1] * V.r[1];
      const Y = v[0] * V.u[0] + v[1] * V.u[1] + v[2] * V.u[2];
      const Z = v[0] * V.f[0] + v[1] * V.f[1] + v[2] * V.f[2];
      if (Z < -0.92) return false;
      const k = (2 / (1 + Z)) * V.scale;
      out[0] = V.cx + X * k;
      out[1] = V.cy - Y * k;
      out[2] = k;
      return true;
    }

    unproject(sx, sy, V) {
      const x = (sx - V.cx) / V.scale;
      const y = -(sy - V.cy) / V.scale;
      const r2 = x * x + y * y;
      const den = 4 + r2;
      const X = (4 * x) / den;
      const Y = (4 * y) / den;
      const Z = (4 - r2) / den;
      return [V.r[0] * X + V.u[0] * Y + V.f[0] * Z, V.r[1] * X + V.u[1] * Y + V.f[1] * Z, V.r[2] * X + V.u[2] * Y + V.f[2] * Z];
    }

    // CSS-координати ↔ пристрій
    toDevice(x) {
      return x * this.dpr;
    }

    onScreen(x, y, m = 20) {
      return x > -m && y > -m && x < this.W + m && y < this.H + m;
    }

    /*
     * state: { cam, snap, lim, baseLim, lp, layers, selected, t, trails }
     */
    render(state) {
      const ctx = this.ctx;
      const V = this.view(state.cam);
      const snap = state.snap;
      const layers = state.layers;
      const dpr = this.dpr;
      this.hits = [];
      this.V = V;

      // ---- WebGL-фон ----
      const glKey = [
        state.cam.az.toFixed(3),
        state.cam.alt.toFixed(3),
        state.cam.fov.toFixed(3),
        Math.round(snap.date.getTime() / 4000),
        state.lp,
        layers.mw,
        snap.lat,
        snap.lon,
        this.W,
        this.H,
        V.cx.toFixed(1),
        V.cy.toFixed(1),
      ].join('|');
      if (glKey !== this.lastGLKey) {
        this.lastGLKey = glKey;
        const gal = A.mul(A.GALACTIC, A.mul(A.transpose(snap.P), A.transpose(snap.H)));
        const moonUp = snap.moon.alt > -1;
        const q = this.glCanvas.width / this.W;
        this.gl.render({
          cx: V.cx * q,
          cy: (this.H - V.cy) * q,
          scale: V.scale * q,
          r: V.r,
          u: V.u,
          f: V.f,
          gal,
          sun: snap.sun.hor,
          moon: snap.moon.hor,
          moonLight: moonUp ? snap.moon.illum : 0,
          lp: state.lp,
          mw: layers.mw ? 1 : 0,
        });
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      if (!this.gl.ok) this.fallbackBackground(snap);

      const P = [0, 0, 0];
      const Q = [0, 0, 0];
      const M = snap.starMatrix;
      const H = snap.H;
      const toHor = (v) => [
        M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
        M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
        M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
      ];
      const dayDim = Math.max(0, Math.min(1, (snap.sun.alt + 8) / 10)); // 0 уночі, 1 удень
      const lineAlpha = 1 - dayDim * 0.75;

      // ---- Сітка ----
      if (layers.grid) this.drawGrid(V, lineAlpha);

      // ---- Екліптика ----
      if (layers.ecliptic) {
        const ecl = 23.4393 * RAD;
        const pts = [];
        for (let l = 0; l <= 360; l += 2) {
          const lr = l * RAD;
          const eq = [Math.cos(lr), Math.sin(lr) * Math.cos(ecl), Math.sin(lr) * Math.sin(ecl)];
          pts.push(A.apply(H, eq));
        }
        ctx.setLineDash([4 * dpr, 6 * dpr]);
        this.strokePolyline(pts, V, `rgba(233, 199, 123, ${0.35 * lineAlpha})`, 1 * dpr);
        ctx.setLineDash([]);
      }

      // у режимі слідів лишаємо чисте «фото»: без ліній і підписів зір
      const clean = !!state.trails;

      // ---- Лінії сузір'їв ----
      if (this.cat && layers.lines && !clean) {
        ctx.lineWidth = 1 * dpr;
        ctx.strokeStyle = `rgba(128, 150, 222, ${0.27 * lineAlpha})`;
        ctx.beginPath();
        for (const c of this.cat.lines) {
          for (const poly of c.polys) this.tracePolyline(poly.map(toHor), V);
        }
        ctx.stroke();
      }

      // ---- Народне небо ----
      if (this.cat && layers.folk && !clean) {
        ctx.save();
        ctx.lineWidth = 1.6 * dpr;
        ctx.strokeStyle = `rgba(242, 184, 92, ${0.62 * lineAlpha})`;
        ctx.shadowColor = 'rgba(242, 184, 92, 0.6)';
        ctx.shadowBlur = 6 * dpr;
        ctx.beginPath();
        for (const f of this.cat.folk) {
          for (const line of f.lines) {
            const pts = [];
            for (let i = 0; i < line.length; i++) {
              const hv = toHor(f.vecs[line[i]].v);
              if (i > 0) {
                const prev = pts[pts.length - 1];
                pts.push(...greatCircleSubdivide(prev, hv, 3));
              } else pts.push(hv);
            }
            this.tracePolyline(pts, V);
          }
        }
        ctx.stroke();
        ctx.restore();
      }

      // ---- Туманності й скупчення ----
      if (this.cat && layers.dso && !clean && state.cam.fov < 150) {
        ctx.lineWidth = 1 * dpr;
        for (const o of this.cat.dsos) {
          if (o.mag > 8.5 && !o.name) continue;
          const hv = toHor(o.v);
          if (hv[2] < 0.01) continue;
          if (!this.project(hv, V, P) || !this.onScreen(P[0], P[1])) continue;
          const rad = Math.max(3 * dpr, ((o.dim / 60) * RAD * P[2]) / 2);
          ctx.strokeStyle = `rgba(190, 200, 235, ${0.4 * lineAlpha})`;
          ctx.setLineDash([2 * dpr, 2.5 * dpr]);
          ctx.beginPath();
          if (/g$/.test(o.type)) ctx.ellipse(P[0], P[1], rad, rad * 0.5, -0.5, 0, Math.PI * 2);
          else ctx.arc(P[0], P[1], rad, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          this.hits.push({ type: 'dso', ref: o, x: P[0], y: P[1], r: rad, pri: 1 });
        }
      }

      // ---- Зорі ----
      const lim = state.lim;
      const zoomBoost = 1 + 0.45 * Math.max(0, Math.min(1, (60 - state.cam.fov) / 50));
      const drawLim = lim + 1.3 * Math.max(0, Math.min(2, Math.log2(60 / state.cam.fov)));
      let visible = 0;
      const brightest = [];
      const labelsStars = [];
      if (this.cat) {
        const cat = this.cat;
        const trails = state.trails;
        const tctx = this.trailCtx;
        // сліди: відрізок від минулого положення зорі до теперішнього, згруповані за кольором і яскравістю
        let segs = null;
        if (trails) {
          const key = [state.cam.az, state.cam.alt, state.cam.fov, snap.lat, snap.lon, this.W, this.H, state.lp].join('|');
          if (key !== this.trailKey || !this.prevX || this.prevX.length !== cat.n) {
            this.trailKey = key;
            tctx.clearRect(0, 0, this.W, this.H);
            this.prevX = new Float32Array(cat.n).fill(NaN);
            this.prevY = new Float32Array(cat.n).fill(NaN);
          }
          segs = Array.from({ length: BV_COLORS.length * 3 }, () => []);
        } else if (this.prevX) {
          this.prevX = null;
          this.prevY = null;
        }
        const m0 = M[0], m1 = M[1], m2 = M[2], m3 = M[3], m4 = M[4], m5 = M[5], m6 = M[6], m7 = M[7], m8 = M[8];
        const t = state.t;
        const labelLim = state.cam.fov > 120 ? 1.3 : state.cam.fov > 70 ? 2.1 : state.cam.fov > 35 ? 3.2 : 4.3;
        for (let i = 0; i < cat.n; i++) {
          const x = cat.x[i], y = cat.y[i], z = cat.z[i];
          const hz = m6 * x + m7 * y + m8 * z;
          if (hz < -0.001) {
            if (segs) this.prevX[i] = NaN;
            continue;
          }
          const hx = m0 * x + m1 * y + m2 * z;
          const hy = m3 * x + m4 * y + m5 * z;
          const altDeg = Math.asin(hz) * DEG;
          if (altDeg < 7) {
            const az = ((Math.atan2(hx, hy) * DEG) + 360) % 360;
            if (terrainSD(az, altDeg) < 0) {
              if (segs) this.prevX[i] = NaN;
              continue;
            }
          }
          const magEff = cat.mag[i] + A.extinction(altDeg);
          if (magEff <= lim) {
            visible++;
            if (brightest.length < 6) brightest.push(i);
          }
          const rel = drawLim - magEff;
          if (rel < -0.6) {
            if (segs) this.prevX[i] = NaN;
            continue;
          }
          P[0] = hx;
          P[1] = hy;
          P[2] = hz;
          Q[0] = hx;
          Q[1] = hy;
          Q[2] = hz;
          if (!this.project(Q, V, P) || !this.onScreen(P[0], P[1], 8)) {
            if (segs) this.prevX[i] = NaN;
            continue;
          }
          const lf = Math.log10(1 + Math.pow(10, 0.4 * rel));
          let r = (0.62 + 0.82 * lf) * dpr * zoomBoost;
          let a = Math.min(1, 0.3 + 0.42 * lf);
          if (rel < 0) a *= (rel + 0.6) / 0.6;
          if (cat.mag[i] < 2.6 && altDeg < 45 && !state.reduceMotion) {
            a *= 1 + 0.16 * Math.sin(t * 0.0037 * (1 + (i % 5) * 0.37) + i) * (1 - altDeg / 45);
          }
          const S = r * 8;
          if (segs) {
            const px = this.prevX[i];
            if (px === px && a > 0.33) {
              const tier = a > 0.8 ? 0 : a > 0.55 ? 1 : 2;
              segs[cat.bucket[i] * 3 + tier].push(px, this.prevY[i], P[0], P[1]);
            }
            this.prevX[i] = P[0];
            this.prevY[i] = P[1];
          }
          ctx.globalAlpha = Math.max(0, Math.min(1, a));
          ctx.drawImage(this.sprites[cat.bucket[i]], P[0] - S / 2, P[1] - S / 2, S, S);
          if (cat.mag[i] < 5.2) this.hits.push({ type: 'star', ref: i, x: P[0], y: P[1], r, pri: 2 - cat.mag[i] * 0.2 });
          if (layers.snames && !clean && cat.mag[i] < labelLim) {
            const nm = cat.names.get(i);
            if (nm && nm.uk) labelsStars.push({ text: nm.uk, x: P[0] + r + 4 * dpr, y: P[1] + 4 * dpr, pri: 30 - cat.mag[i] * 4 });
          }
        }
        ctx.globalAlpha = 1;
        if (segs) {
          tctx.globalCompositeOperation = 'lighter';
          tctx.lineCap = 'round';
          const tiers = [
            [0.8, 1.6],
            [0.42, 1.15],
            [0.17, 0.85],
          ];
          segs.forEach((list, k) => {
            if (!list.length) return;
            const [alpha, width] = tiers[k % 3];
            tctx.strokeStyle = BV_COLORS[Math.floor(k / 3)];
            tctx.globalAlpha = alpha;
            tctx.lineWidth = width * dpr;
            tctx.beginPath();
            for (let j = 0; j < list.length; j += 4) {
              tctx.moveTo(list[j], list[j + 1]);
              tctx.lineTo(list[j + 2], list[j + 3]);
            }
            tctx.stroke();
          });
          tctx.globalCompositeOperation = 'source-over';
          tctx.globalAlpha = 1;
        }
      }
      this.stats = { visible, brightest };

      if (state.trails) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(this.trailCanvas, 0, 0);
        ctx.restore();
      }

      // ---- Планети, Місяць, Сонце ----
      const labels = [];
      const planetLabelAlpha = 1;
      for (const name of A.PLANETS) {
        const p = snap.planets[name];
        const hv = p.hor;
        const altDeg = Math.asin(hv[2]) * DEG;
        if (altDeg < -0.5) continue;
        const az = ((Math.atan2(hv[0], hv[1]) * DEG) + 360) % 360;
        if (altDeg < 7 && terrainSD(az, altDeg) < 0) continue;
        const magEff = p.mag + A.extinction(altDeg);
        const rel = drawLim - magEff;
        if (rel < -0.3) continue;
        if (!this.project(hv, V, P) || !this.onScreen(P[0], P[1])) continue;
        const lf = Math.log10(1 + Math.pow(10, 0.4 * rel));
        const r = Math.max(1.6 * dpr, (0.7 + 0.72 * lf) * dpr * zoomBoost);
        ctx.globalAlpha = Math.min(1, 0.45 + 0.3 * lf);
        const S = r * 9;
        ctx.drawImage(this.planetSprites[name], P[0] - S / 2, P[1] - S / 2, S, S);
        ctx.globalAlpha = 1;
        ctx.fillStyle = D.PLANET_COLORS[name];
        ctx.beginPath();
        ctx.arc(P[0], P[1], r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        this.hits.push({ type: 'planet', ref: name, x: P[0], y: P[1], r: r + 3 * dpr, pri: 5 });
        const showLabel = name !== 'uranus' && name !== 'neptune' ? true : state.cam.fov < 60;
        if (showLabel && layers.snames !== undefined) {
          let text = D.PLANET_NAMES[name];
          if (name === 'venus' && layers.folk) text = p.evening ? 'Вечірня зоря' : 'Ранкова зоря';
          labels.push({
            text,
            x: P[0] + r + 5 * dpr,
            y: P[1] + 4 * dpr,
            font: name === 'venus' && layers.folk ? this.fonts.folk : this.fonts.planet,
            color: name === 'venus' && layers.folk ? 'rgba(242, 184, 92, 0.95)' : `rgba(236, 232, 214, ${0.9 * planetLabelAlpha})`,
            pri: 50,
          });
        }
      }

      this.drawMoon(snap, V, P, labels);
      this.drawSun(snap, V, P, labels);

      // ---- Підписи ----
      if (this.cat && layers.folk && !clean) {
        for (const f of this.cat.folk) {
          if (!f.labelVec) continue;
          const hv = toHor(f.labelVec);
          if (hv[2] < 0.02) continue;
          if (f.milkyway && (!layers.mw || snap.sun.alt > -12)) continue;
          if (!this.project(hv, V, P) || !this.onScreen(P[0], P[1])) continue;
          labels.push({ text: f.name, x: P[0], y: P[1], font: this.fonts.folk, color: 'rgba(242, 184, 92, 0.92)', pri: 40, align: 'center' });
        }
      }
      if (this.cat && layers.cnames && !clean) {
        const rankMax = state.cam.fov > 140 ? 1 : state.cam.fov > 80 ? 2 : 3;
        for (const c of this.cat.labels) {
          if (c.rank > rankMax) continue;
          const hv = toHor(c.v);
          if (hv[2] < 0.03) continue;
          if (!this.project(hv, V, P) || !this.onScreen(P[0], P[1])) continue;
          labels.push({
            text: c.name,
            x: P[0],
            y: P[1],
            font: this.fonts.con,
            color: `rgba(150, 170, 230, ${0.62 * lineAlpha})`,
            pri: 20 - c.rank,
            align: 'center',
          });
        }
      }
      for (const l of labelsStars) labels.push({ ...l, font: this.fonts.star, color: `rgba(206, 212, 236, ${0.78 * lineAlpha})` });
      if (this.cat && layers.dso && !clean && state.cam.fov < 90) {
        for (const h of this.hits) {
          if (h.type !== 'dso' || !h.ref.name) continue;
          labels.push({ text: h.ref.name, x: h.x + h.r + 4 * dpr, y: h.y + 4 * dpr, font: this.fonts.dso, color: `rgba(190, 200, 235, ${0.6 * lineAlpha})`, pri: 8 });
        }
      }

      this.drawCardinals(V, labels);
      this.placeLabels(labels);

      // ---- Виділення ----
      if (state.selected) this.drawSelection(state.selected, snap, V, toHor);

      return this.stats;
    }

    fallbackBackground(snap) {
      const ctx = this.ctx;
      const g = ctx.createLinearGradient(0, 0, 0, this.H);
      const day = snap.sun.alt > 0;
      g.addColorStop(0, day ? '#2f5fae' : '#050818');
      g.addColorStop(1, day ? '#9cc0e6' : '#141c40');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.W, this.H);
    }

    tracePolyline(pts, V) {
      const ctx = this.ctx;
      const P = [0, 0, 0];
      let pen = false;
      let prev = null;
      for (let i = 0; i < pts.length; i++) {
        let v = pts[i];
        if (prev) {
          const za = prev[2];
          const zb = v[2];
          if (za < 0 && zb < 0) {
            pen = false;
            prev = v;
            continue;
          }
          let a = prev;
          let b = v;
          if (za < 0 || zb < 0) {
            const t = za / (za - zb);
            const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];
            const l = Math.hypot(c[0], c[1]) || 1;
            c[0] /= l;
            c[1] /= l;
            if (za < 0) a = c;
            else b = c;
            if (za < 0) pen = false;
          }
          if (!pen) {
            if (this.project(a, V, P)) {
              ctx.moveTo(P[0], P[1]);
              pen = true;
            }
          }
          if (pen && this.project(b, V, P)) ctx.lineTo(P[0], P[1]);
          else pen = false;
          if (zb < 0) pen = false;
        }
        prev = v;
      }
    }

    strokePolyline(pts, V, color, width) {
      const ctx = this.ctx;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      this.tracePolyline(pts, V);
      ctx.stroke();
    }

    drawGrid(V, alpha) {
      const ctx = this.ctx;
      const dpr = this.dpr;
      const color = `rgba(150, 165, 215, ${0.16 * alpha})`;
      for (let alt = 15; alt < 90; alt += 15) {
        const pts = [];
        for (let az = 0; az <= 360; az += 3) {
          const a = az * RAD;
          const h = alt * RAD;
          pts.push([Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)]);
        }
        this.strokePolyline(pts, V, color, 1 * dpr);
      }
      for (let az = 0; az < 360; az += 30) {
        const pts = [];
        for (let alt = 0; alt <= 90; alt += 3) {
          const a = az * RAD;
          const h = alt * RAD;
          pts.push([Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)]);
        }
        this.strokePolyline(pts, V, color, 1 * dpr);
      }
      // підписи висот
      const P = [0, 0, 0];
      ctx.font = this.fonts.cardSmall;
      ctx.fillStyle = `rgba(150, 165, 215, ${0.5 * alpha})`;
      for (let alt = 15; alt < 90; alt += 15) {
        const a = Math.atan2(V.f[0], V.f[1]);
        const h = alt * RAD;
        const v = [Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)];
        if (this.project(v, V, P) && this.onScreen(P[0], P[1])) ctx.fillText(`${alt}°`, P[0] + 4 * dpr, P[1] - 3 * dpr);
      }
    }

    drawCardinals(V, labels) {
      const names = ['Пн', 'ПнСх', 'Сх', 'ПдСх', 'Пд', 'ПдЗх', 'Зх', 'ПнЗх'];
      const full = ['Північ', 'Північний схід', 'Схід', 'Південний схід', 'Південь', 'Південний захід', 'Захід', 'Північний захід'];
      const P = [0, 0, 0];
      const wide = this.cssW > 700;
      for (let i = 0; i < 8; i++) {
        const az = i * 45 * RAD;
        const h = -2.2 * RAD;
        const v = [Math.sin(az) * Math.cos(h), Math.cos(az) * Math.cos(h), Math.sin(h)];
        if (!this.project(v, V, P) || !this.onScreen(P[0], P[1], -4)) continue;
        const main = i % 2 === 0;
        labels.push({
          text: wide && V.f[2] < 0.9 ? full[i] : names[i],
          x: P[0],
          y: P[1] + 6 * this.dpr,
          font: main ? this.fonts.card : this.fonts.cardSmall,
          color: main ? 'rgba(200, 208, 236, 0.78)' : 'rgba(160, 170, 205, 0.55)',
          pri: 100,
          align: 'center',
        });
      }
    }

    placeLabels(labels) {
      const ctx = this.ctx;
      const placed = [];
      labels.sort((a, b) => b.pri - a.pri);
      const pad = 3 * this.dpr;
      for (const l of labels) {
        ctx.font = l.font;
        const w = ctx.measureText(l.text).width;
        const h = parseFloat(l.font.match(/(\d+)px/)[1]);
        const x0 = l.align === 'center' ? l.x - w / 2 : l.x;
        const box = [x0 - pad, l.y - h - pad, x0 + w + pad, l.y + pad * 0.6];
        if (box[0] < 0 || box[2] > this.W || box[1] < 0 || box[3] > this.H) {
          if (l.pri < 100) continue;
        }
        let hit = false;
        for (const b of placed) {
          if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) {
            hit = true;
            break;
          }
        }
        if (hit) continue;
        placed.push(box);
        ctx.fillStyle = l.color;
        ctx.textAlign = 'left';
        ctx.shadowColor = 'rgba(2, 4, 16, 0.9)';
        ctx.shadowBlur = 4 * this.dpr;
        ctx.fillText(l.text, x0, l.y);
      }
      ctx.shadowBlur = 0;
    }

    drawMoon(snap, V, P, labels) {
      const ctx = this.ctx;
      const m = snap.moon;
      if (m.alt < -0.5) return;
      if (m.alt < 7 && terrainSD(m.az, m.alt) < -0.3) return;
      if (!this.project(m.hor, V, P) || !this.onScreen(P[0], P[1], 40)) return;
      const r = Math.max(9 * this.dpr, 0.26 * RAD * P[2]);
      // напрям на Сонце на екрані
      const s = snap.sun.hor;
      const dot = s[0] * m.hor[0] + s[1] * m.hor[1] + s[2] * m.hor[2];
      const t = [s[0] - dot * m.hor[0], s[1] - dot * m.hor[1], s[2] - dot * m.hor[2]];
      const tl = Math.hypot(t[0], t[1], t[2]) || 1;
      const q = [m.hor[0] + (0.01 * t[0]) / tl, m.hor[1] + (0.01 * t[1]) / tl, m.hor[2] + (0.01 * t[2]) / tl];
      const Q = [0, 0, 0];
      this.project(q, V, Q);
      const ang = Math.atan2(Q[1] - P[1], Q[0] - P[0]);
      const k = m.illum;
      const p = 2 * k - 1;
      const x = P[0];
      const y = P[1];

      ctx.save();
      // сяйво
      ctx.globalAlpha = 0.35 * k + 0.05;
      const S = r * 7;
      ctx.drawImage(this.planetSprites.moon, x - S / 2, y - S / 2, S, S);
      ctx.globalAlpha = 1;
      // попелясте світло
      ctx.fillStyle = 'rgba(60, 68, 96, 0.55)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      // освітлена частина
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.ellipse(0, 0, Math.abs(p) * r, r, 0, Math.PI / 2, -Math.PI / 2, p < 0);
      ctx.closePath();
      ctx.fillStyle = '#ece8da';
      ctx.fill();
      ctx.clip();
      ctx.rotate(-ang);
      // моря
      ctx.fillStyle = 'rgba(150, 150, 150, 0.28)';
      const blobs = [
        [-0.25, -0.3, 0.28, 0.2],
        [0.2, -0.35, 0.22, 0.18],
        [0.3, 0.05, 0.2, 0.25],
        [-0.35, 0.15, 0.3, 0.22],
        [0.05, 0.4, 0.16, 0.12],
      ];
      for (const [bx, by, rx, ry] of blobs) {
        ctx.beginPath();
        ctx.ellipse(bx * r, by * r, rx * r, ry * r, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      this.hits.push({ type: 'moon', ref: 'moon', x, y, r: r + 4 * this.dpr, pri: 6 });
      labels.push({ text: 'Місяць', x: x + r + 6 * this.dpr, y: y + 4 * this.dpr, font: this.fonts.planet, color: 'rgba(236, 232, 214, 0.9)', pri: 60 });
    }

    drawSun(snap, V, P, labels) {
      const ctx = this.ctx;
      const s = snap.sun;
      if (s.alt < -0.8) return;
      if (s.alt < 7 && terrainSD(s.az, s.alt) < -0.3) return;
      if (!this.project(s.hor, V, P) || !this.onScreen(P[0], P[1], 60)) return;
      const r = Math.max(11 * this.dpr, 0.27 * RAD * P[2]);
      const S = r * 10;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.planetSprites.sun, P[0] - S / 2, P[1] - S / 2, S, S);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff8e2';
      ctx.beginPath();
      ctx.arc(P[0], P[1], r, 0, Math.PI * 2);
      ctx.fill();
      this.hits.push({ type: 'sun', ref: 'sun', x: P[0], y: P[1], r: r + 4 * this.dpr, pri: 6 });
      labels.push({ text: 'Сонце', x: P[0] + r + 6 * this.dpr, y: P[1] + 4 * this.dpr, font: this.fonts.planet, color: 'rgba(40, 40, 60, 0.85)', pri: 60 });
    }

    selectionVector(sel, snap, toHor) {
      if (!sel) return null;
      if (sel.type === 'star') return toHor([this.cat.x[sel.ref], this.cat.y[sel.ref], this.cat.z[sel.ref]]);
      if (sel.type === 'planet') return snap.planets[sel.ref].hor;
      if (sel.type === 'moon') return snap.moon.hor;
      if (sel.type === 'sun') return snap.sun.hor;
      if (sel.type === 'dso') return toHor(sel.ref.v);
      if (sel.type === 'const') return toHor(sel.ref.v);
      if (sel.type === 'folk') return toHor(sel.ref.center);
      return null;
    }

    drawSelection(sel, snap, V, toHor) {
      const v = this.selectionVector(sel, snap, toHor);
      if (!v) return;
      const P = [0, 0, 0];
      if (!this.project(v, V, P) || !this.onScreen(P[0], P[1])) return;
      const ctx = this.ctx;
      const dpr = this.dpr;
      const r = (sel.type === 'moon' || sel.type === 'sun' ? Math.max(14, 0.3 * RAD * P[2] / dpr + 6) : sel.type === 'const' || sel.type === 'folk' ? 0 : 11) * dpr;
      if (!r) return;
      ctx.strokeStyle = 'rgba(242, 184, 92, 0.95)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(P[0], P[1], r, 0, Math.PI * 2);
      ctx.stroke();
      // чотири риски
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.moveTo(P[0] + Math.cos(a) * (r + 3 * dpr), P[1] + Math.sin(a) * (r + 3 * dpr));
        ctx.lineTo(P[0] + Math.cos(a) * (r + 9 * dpr), P[1] + Math.sin(a) * (r + 9 * dpr));
      }
      ctx.stroke();
    }

    pick(cssX, cssY) {
      const x = cssX * this.dpr;
      const y = cssY * this.dpr;
      let best = null;
      let bestScore = Infinity;
      for (const h of this.hits) {
        const d = Math.hypot(h.x - x, h.y - y);
        const reach = h.r + 12 * this.dpr;
        if (d > reach) continue;
        const score = d - h.pri * 2 * this.dpr;
        if (score < bestScore) {
          bestScore = score;
          best = h;
        }
      }
      return best;
    }
  }

  window.SkyRender = { Sky, buildCatalog, applyNames, terrainSD, LAND, h0 };
})();
