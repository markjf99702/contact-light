// Bundles the game into one self-contained HTML file, dist/contact-light.html, that plays from anywhere.
// Also writes dist/artifact.html, the same page without the document wrapper, for hosts that supply their own
// <html>/<head>/<body> (the playable copy in Claude's Artifact viewer). The repo itself runs without this step.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

// Each change below must find what it changes: if index.html or the CSS moves on, the build stops and says so
// rather than writing a copy that quietly half works.
function swap(text, from, to, where) {
  const found = typeof from === 'string' ? text.includes(from) : from.test(text);
  if (!found) throw new Error(`${where}: ${from} not found`);
  return text.replace(from, to);
}

const result = await build({
  entryPoints: [new URL('js/main.js', root).pathname],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
});
// data-single tells the page it's the one-file copy, which has no sw.js beside it to register.
const js = `document.documentElement.dataset.single = '';\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}`;

// A single file can't point at other files, so the fonts and the icon go in as data: URIs,
// and the links that only make sense for the hosted site (manifest, home-screen icon, preloads) come out.
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
let css = await read('css/app.css');
// A host with its own light/dark switch puts data-theme on <html>. Contact Light has one palette, the night
// over the Moon, and keeps it whatever the host says. If a light palette is ever added, the dark one follows
// the system setting unless the host says light, and comes on when it says dark.
const dark = css.match(/@media \(prefers-color-scheme: dark\) \{\n  :root \{([^}]*)\}\n\}/);
if (dark) css = css.replace(dark[0], `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {${dark[1]}}\n}\n:root[data-theme="dark"] {${dark[1]}}`);
else if (/prefers-color-scheme/.test(css)) throw new Error('css/app.css: a light/dark rule the build doesn’t know how to guard for data-theme');
for (const [, file] of css.matchAll(/url\(\.\.\/(fonts\/[^)]+\.woff2)\)/g)) css = css.replace(`url(../${file})`, `url(${await dataUri(file, 'font/woff2')})`);
if (/url\(\s*["']?(\.\.?\/|[\w-]+\/)/.test(css)) throw new Error('css/app.css: a file the one-file copy can’t reach');

const icon = await dataUri('icon.svg', 'image/svg+xml');
let html = await read('index.html');
html = swap(html, /\n *<link rel="manifest"[^>]*>/, '', 'index.html');
html = html.replace(/\n *<link rel="(apple-touch-icon|preload)"[^>]*>/g, '');
html = swap(html, '"icon.svg"', () => `"${icon}"`, 'index.html');
html = swap(html, '<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}</style>`, 'index.html');
html = swap(html, /\n *<script type="module" src="js\/main.js"><\/script>/, '', 'index.html');
html = swap(html, '</body>', () => `<script>\n${js}</script>\n</body>`, 'index.html');
if (/(src|href)="(?!https:|data:|#)/.test(html)) throw new Error('index.html: a file the one-file copy can’t reach');

const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/contact-light.html', root), html);
await writeFile(new URL('dist/artifact.html', root), fragment);
console.log(`dist/contact-light.html  ${(html.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html       ${(fragment.length / 1024).toFixed(1)} KB`);
