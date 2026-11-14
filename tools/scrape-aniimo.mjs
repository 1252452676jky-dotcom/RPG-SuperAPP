// tools/scrape-aniimo.mjs — polite, cached download of Aniimo data from the OFFICIAL wiki (wiki.aniimo.com)
// Run from the project root (Node 18+, no packages):
//   node tools/scrape-aniimo.mjs --probe        1 request: saves tools/aniimo/probe.json so we can confirm the data shape
//   node tools/scrape-aniimo.mjs --limit=5      first 5 pages (test run)
//   node tools/scrape-aniimo.mjs                everything (~15–20 min, one request every 3–4.5 s)
//   node tools/scrape-aniimo.mjs --refresh      ignore the cache and download again (only after a game update)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools', '.cache', 'aniimo');   // raw downloads (don't commit)
const OUT   = path.join(ROOT, 'tools', 'aniimo');             // tidy output (commit this)
const BASE  = 'https://wiki.aniimo.com';
const SITEMAP = BASE + '/__sitemap__/en-US.xml';
const UA = 'MonsterLab-fan-project/1.0 (personal, non-commercial; contact: YOUR_EMAIL)';
const DELAY = 3000, JITTER = 1500, MAX_RETRY = 5;

const argv = process.argv.slice(2);
const PROBE = argv.includes('--probe'), REFRESH = argv.includes('--refresh');
const LIMIT = +((argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- polite cached fetch ---------- */
let last = 0;
async function polite(url, json = false) {
  const file = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 180));
  if (!REFRESH && existsSync(file)) { const t = await readFile(file, 'utf8'); return json ? JSON.parse(t) : t; }
  for (let i = 0; ; i++) {
    const wait = last + DELAY + Math.random() * JITTER - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    let res = null;
    try { res = await fetch(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : 'text/html,application/xml' } }); } catch { /* network error → retry */ }
    if (res && res.ok) { const t = await res.text(); await writeFile(file, t); return json ? JSON.parse(t) : t; }
    if (res && res.status === 404) return null;
    if (res && (res.status === 401 || res.status === 403)) {
      const e = new Error(`${res.status} from ${url} — the site is refusing us. Stopping (no hammering).`); e.stop = true; throw e;
    }
    if (i >= MAX_RETRY) throw new Error(`gave up after ${i} retries (${res ? res.status : 'network'}) ${url}`);
    const ra = res && +res.headers.get('retry-after');
    const back = ra ? ra * 1000 : Math.min(120000, 5000 * 2 ** i);   // 5 s, 10 s, 20 s, 40 s, 80 s
    console.warn(`  ${res ? res.status : 'network error'} — waiting ${Math.round(back / 1000)} s, then retrying`);
    await sleep(back);
  }
}

/* ---------- Nuxt payloads are "devalue" flat arrays → turn them back into normal objects ---------- */
const WRAP = new Set(['ShallowReactive', 'Reactive', 'Ref', 'ShallowRef', 'Object']);
function hydrate(flat) {
  const memo = new Map();
  const h = i => {
    if (i === -1) return undefined;
    if (typeof i !== 'number' || i < -1) return null;
    if (memo.has(i)) return memo.get(i);
    const v = flat[i];
    if (v === null || typeof v !== 'object') { memo.set(i, v); return v; }
    if (Array.isArray(v)) {
      if (typeof v[0] === 'string') {                       // tagged value
        const tag = v[0];
        if (WRAP.has(tag)) { const r = h(v[1]); memo.set(i, r); return r; }
        if (tag === 'Date') return v[1];
        if (tag === 'EmptyRef' || tag === 'EmptyShallowRef') { try { return JSON.parse(v[1]); } catch { return null; } }
        if (tag === 'Set') { const r = []; memo.set(i, r); for (let k = 1; k < v.length; k++) r.push(h(v[k])); return r; }
        if (tag === 'Map') { const r = {}; memo.set(i, r); for (let k = 1; k < v.length; k += 2) r[String(h(v[k]))] = h(v[k + 1]); return r; }
        if (tag === 'null') { const r = {}; memo.set(i, r); for (let k = 1; k < v.length; k += 2) r[v[k]] = h(v[k + 1]); return r; }
        return null;
      }
      const r = []; memo.set(i, r); for (const x of v) r.push(h(x)); return r;
    }
    const r = {}; memo.set(i, r); for (const k of Object.keys(v)) r[k] = h(v[k]); return r;
  };
  return h(0);
}

/* ---------- print the shape of an object (for --probe) ---------- */
function shape(o, depth = 0, max = 4) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(o)) return o.length ? `[${o.length}] ` + (typeof o[0] === 'object' && depth < max ? '\n' + pad + '  ' + shape(o[0], depth + 1, max) : JSON.stringify(o[0]).slice(0, 60)) : '[]';
  if (o && typeof o === 'object') {
    if (depth >= max) return '{…}';
    return '{\n' + Object.entries(o).slice(0, 40).map(([k, v]) => `${pad}  ${k}: ${typeof v === 'object' && v ? shape(v, depth + 1, max) : JSON.stringify(v)?.slice(0, 70)}`).join('\n') + `\n${pad}}`;
  }
  return JSON.stringify(o)?.slice(0, 70);
}

const formName = slug => slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');   // 'basic-form' → 'Basic Form'

async function main() {
  await mkdir(CACHE, { recursive: true }); await mkdir(path.join(OUT, 'raw'), { recursive: true });

  const xml = await polite(SITEMAP);
  let pages = [...xml.matchAll(/<loc>(https:\/\/wiki\.aniimo\.com\/item\/(\d+)\/([a-z0-9-]+))<\/loc>/g)]
    .map(m => ({ url: m[1], no: m[2], slug: m[3] }));
  console.log(`sitemap: ${pages.length} Aniimo form pages`);
  if (PROBE) pages = pages.filter(p => p.no === '001' && p.slug === 'basic-form');
  pages = pages.slice(0, LIMIT);
  const mins = Math.ceil(pages.length * (DELAY + JITTER / 2) / 60000);
  if (pages.length > 1) console.log(`about ${mins} min if nothing is cached yet — leave it running\n`);

  let list = null; const details = []; let failed = 0;
  for (const [n, p] of pages.entries()) {
    process.stdout.write(`[${n + 1}/${pages.length}] #${p.no} ${p.slug} … `);
    let data;
    try {
      const flat = await polite(p.url + '/_payload.json', true);
      if (!flat) { console.log('404, skipped'); failed++; continue; }
      data = (hydrate(flat) || {}).data || {};
    } catch (e) { if (e.stop) throw e; console.log('FAILED: ' + e.message); failed++; continue; }

    const lk = Object.keys(data).find(k => k.startsWith('header-aniimo-list'));
    const dk = Object.keys(data).find(k => k.startsWith('aniimo-detail'));
    if (!list && lk) list = data[lk];
    const detail = dk ? data[dk] : null;
    await writeFile(path.join(OUT, 'raw', `${p.no}-${p.slug}.json`), JSON.stringify(detail, null, 1));
    details.push({ no: p.no, form: formName(p.slug), slug: p.slug, url: p.url, detail });
    console.log(detail ? 'ok' : 'no detail block (saved anyway)');

    if (PROBE) {
      await writeFile(path.join(OUT, 'probe.json'), JSON.stringify(data, null, 1));
      console.log('\nPayload keys:', Object.keys(data));
      console.log('\nDetail shape:\n' + shape(detail));
      console.log(`\nSaved ${path.relative(ROOT, path.join(OUT, 'probe.json'))} — commit it (or paste the "Detail shape" above) so the extractor can be written exactly.`);
    }
  }

  // the Aniimo list (fields confirmed): name, game id, picture link, elements, stage, role, description
  const STAGE = { 1: 'Lumin', 2: 'Gamma', 3: 'Nova', 4: 'Legendary' };
  const rows = (list || []).filter(x => x && x.type === 'ANIIMO').map(x => ({
    no: x.entryId, id: x.sortOrder, name: x.name, form: x.currentMorphology || 'Basic Form',
    img: x.imageUrl, desc: x.description || '', stage: +x.currentStage || null, stageName: STAGE[+x.currentStage] || null,
    roles: (x.position || []).map(s => String(s).replace('position-', '')),
    elements: (x.attributes || []).map(s => String(s).replace('attributes-', '')),
    region: x.countryId
  }));
  if (rows.length) await writeFile(path.join(OUT, 'aniimo.list.json'), JSON.stringify(rows, null, 1));
  if (!PROBE) await writeFile(path.join(OUT, 'aniimo.raw.json'), JSON.stringify({ source: BASE, fetched: new Date().toISOString(), pages: details }));

  const els = [...new Set(rows.flatMap(r => r.elements))].sort();
  console.log(`\nDone. ${details.length} pages saved, ${failed} failed. List: ${rows.length} entries.`);
  console.log('Element keys found:', els.join(', ') || '(none)');
  console.log('Re-running is free: everything is cached in tools/.cache/aniimo.');
}
main().catch(e => { console.error('\nSTOPPED:', e.message); process.exit(1); });
