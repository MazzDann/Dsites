// Стискає файли каталогу d3-celestial (BSD-3, Olaf Frohn) у volosozhar/data/catalog.json.
// Використання: node scripts/prepare-catalog.mjs <тека з сирими json>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) throw new Error('Вкажіть теку з stars.6.json, starnames.json, constellations*.json, messier.json');
const read = async (f) => JSON.parse(await readFile(join(src, f), 'utf8'));
const r4 = (x) => Math.round(x * 1e4) / 1e4;

const stars = await read('stars.6.json');
const names = await read('starnames.json');
const consts = await read('constellations.json');
const lines = await read('constellations.lines.json');
const dsos = await read('messier.json');

const hips = new Set(stars.features.map((f) => f.id));
const out = {
  source: 'd3-celestial 0.7.35 (BSD-3, Olaf Frohn): Hipparcos stars to mag 6, IAU constellation lines, Messier objects',
  // [hip, ra, dec, mag, b-v]
  stars: stars.features.map((f) => [f.id, r4(f.geometry.coordinates[0]), r4(f.geometry.coordinates[1]), f.properties.mag, parseFloat(f.properties.bv)]),
  // hip: [англійська назва, Байєр, Флемстід, сузір'я]
  names: Object.fromEntries(
    Object.entries(names)
      .filter(([hip]) => hips.has(+hip))
      .map(([hip, s]) => [hip, [s.name || '', s.bayer || '', s.flam || '', s.c || '']])
      .filter(([, v]) => v[0] || ((v[1] || v[2]) && v[3]))
  ),
  // [id, ранг, ra, dec]
  consts: consts.features.map((f) => [f.id, +f.properties.rank || 3, r4(f.geometry.coordinates[0]), r4(f.geometry.coordinates[1])]),
  // [id, ранг, лінії]
  lines: lines.features.map((f) => [f.id, +f.properties.rank || 3, f.geometry.coordinates.map((l) => l.map(([a, b]) => [r4(a), r4(b)]))]),
  // [id, позначення, тип, блиск, розмір, ra, dec]
  dsos: dsos.features.map((f) => [f.id, f.properties.desig, f.properties.type, f.properties.mag, String(f.properties.dim || ''), r4(f.geometry.coordinates[0]), r4(f.geometry.coordinates[1])]),
};
await mkdir(join(root, 'volosozhar', 'data'), { recursive: true });
const text = JSON.stringify(out);
await writeFile(join(root, 'volosozhar', 'data', 'catalog.json'), text);
console.log(`catalog.json: ${(text.length / 1024).toFixed(0)} КБ, зір ${out.stars.length}, назв ${Object.keys(out.names).length}`);
