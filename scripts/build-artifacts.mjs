// Збирає кожен сайт в один HTML-файл для публікації на claude.ai: dist/<сайт>.html
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function build(site, { title, links = {} }) {
  const dir = join(root, site);
  const html = await readFile(join(dir, 'index.html'), 'utf8');
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  let body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const fonts = [...head.matchAll(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/g)].map((m) => m[1]);
  const cssFiles = [...head.matchAll(/<link rel="stylesheet" href="((?:css\/)[^"]+)">/g)].map((m) => m[1]);
  const scripts = [...body.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  body = body.replace(/\s*<script src="[^"]+"><\/script>/g, '');
  // посилання між сайтами: відносні шляхи не працюють між окремими сторінками
  for (const [from, to] of Object.entries(links)) {
    body = to ? body.replaceAll(`href="${from}"`, `href="${to}"`) : body.replace(new RegExp(`\\s*<a href="${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[^<]*</a>`, 'g'), '');
  }
  const css = (await Promise.all(cssFiles.map((f) => readFile(join(dir, f), 'utf8')))).join('\n');
  const js = (await Promise.all(scripts.map((f) => readFile(join(dir, f), 'utf8')))).join('\n;\n');
  const out = [
    `<title>${title}</title>`,
    '<script>document.documentElement.lang = "uk"; window.ARTIFACT = true;</script>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ...fonts.map((f) => `<link rel="stylesheet" href="${f}">`),
    `<style>\n${css}\n</style>`,
    body.trim(),
    `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
    '',
  ].join('\n');
  await mkdir(join(root, 'dist'), { recursive: true });
  const file = join(root, 'dist', `${site}.html`);
  await writeFile(file, out);
  console.log(`${file}  ${(out.length / 1024).toFixed(0)} КБ`);
}

// адреси опублікованих сторінок на claude.ai
const URLS = {
  hub: process.env.HUB_URL || 'https://claude.ai/artifact/8WNbLrvBvRkJhAimtqhzib',
  sky: process.env.SKY_URL || 'https://claude.ai/artifact/Xwee8vn882PPuZnxhiFNbn',
  synth: process.env.SYNTH_URL || 'https://claude.ai/artifact/1zpvV5kEFmgbdgUGDUxCcc',
};
const hub = URLS.hub;
await build('mavka', { title: 'Мавка', links: { '../': hub } });
if (process.argv.includes('--all')) {
  await build('volosozhar', { title: 'Волосожар', links: { '../': hub } });
  // каталог зір публікується поруч зі сторінкою: files {"data/catalog.json": "volosozhar/data/catalog.json"}
  await mkdir(join(root, 'dist', 'data'), { recursive: true });
  await copyFile(join(root, 'volosozhar', 'data', 'catalog.json'), join(root, 'dist', 'data', 'catalog.json'));
}

// стартова сторінка: посилання ведуть на опубліковані сайти
if (process.argv.includes('--all')) {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  let body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  const links = [...head.matchAll(/<link rel="(?:stylesheet|preconnect)"[^>]*>/g)].map((m) => m[0]);
  const style = head.match(/<style>[\s\S]*?<\/style>/)[0];
  body = body.replace('href="volosozhar/"', `href="${URLS.sky}"`).replace('href="mavka/"', `href="${URLS.synth}"`);
  const out = ['<title>Волосожар і Мавка</title>', '<script>document.documentElement.lang = "uk";</script>', ...links, style, body.trim(), ''].join('\n');
  await writeFile(join(root, 'dist', 'hub.html'), out);
  console.log(`${join(root, 'dist', 'hub.html')}  ${(out.length / 1024).toFixed(0)} КБ`);
}
