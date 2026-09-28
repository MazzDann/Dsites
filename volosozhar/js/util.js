/* Волосожар — час, числа й слова. */
(function () {
  'use strict';

  const D = window.SkyData;

  let KYIV = 'Europe/Kyiv';
  try {
    new Intl.DateTimeFormat('uk-UA', { timeZone: KYIV }).format(new Date());
  } catch (e) {
    KYIV = 'Europe/Kiev';
  }
  let LOCAL = KYIV;
  try {
    LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone || KYIV;
  } catch (e) {
    /* лишаємо Київ */
  }

  const cache = new Map();
  function formatter(tz) {
    let f = cache.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        weekday: 'short',
      });
      cache.set(tz, f);
    }
    return f;
  }

  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parts(date, tz) {
    const o = {};
    for (const p of formatter(tz).formatToParts(date)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second, wd: WD.indexOf(o.weekday) };
  }

  function offsetMin(date, tz) {
    const p = parts(date, tz);
    return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - date.getTime()) / 60000);
  }

  // місцевий «настінний» час → момент
  function zoned(y, m, d, h, mi, tz) {
    const t = Date.UTC(y, m - 1, d, h, mi);
    const off = offsetMin(new Date(t), tz);
    let res = t - off * 60000;
    const off2 = offsetMin(new Date(res), tz);
    if (off2 !== off) res = t - off2 * 60000;
    return new Date(res);
  }

  const pad = (n) => String(n).padStart(2, '0');

  function hm(date, tz) {
    const p = parts(date, tz);
    return `${p.h}:${pad(p.mi)}`;
  }

  function dayMonth(date, tz) {
    const p = parts(date, tz);
    return `${p.d} ${D.MONTHS_GEN[p.m - 1]}`;
  }

  function weekdayDayMonth(date, tz) {
    const p = parts(date, tz);
    return `${D.WEEKDAYS[p.wd]}, ${p.d} ${D.MONTHS_GEN[p.m - 1]}`;
  }

  function num(x, digits = 0) {
    return x
      .toLocaleString('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
      .replace('-', '−');
  }

  function signed(x, digits = 1) {
    const s = num(Math.abs(x), digits);
    return (x < 0 ? '−' : '+') + s;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function direction(az) {
    return D.DIRECTIONS[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  }

  // знахідний відмінок для «видно …»
  function accusative(name) {
    if (/[^ії]а$/.test(name) || name === 'Полярна') return name.slice(0, -1) + 'у';
    if (/я$/.test(name)) return name.slice(0, -1) + 'ю';
    return name;
  }

  function listJoin(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' і ' + items[items.length - 1];
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  window.Fmt = {
    KYIV,
    LOCAL,
    parts,
    offsetMin,
    zoned,
    hm,
    dayMonth,
    weekdayDayMonth,
    num,
    signed,
    plural,
    direction,
    accusative,
    listJoin,
    escapeHtml,
    pad,
  };
})();
