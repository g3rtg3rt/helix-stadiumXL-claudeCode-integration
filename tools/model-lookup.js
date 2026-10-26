#!/usr/bin/env node
/*
 * What real-world gear is a model based on? -- answered from Line 6's own
 * published model list rather than from the model's name.
 *
 * WHY THIS EXISTS
 * Choosing a model by its NAME is how you end up with the wrong pedal. Three
 * real cases:
 *
 *   Ballistic Fuzz   sounds like a Fuzz Face.    It is a Euthymia ICBM.
 *                    The Fuzz Face is "Arbitrator Fuzz".
 *   Brit Jujube      sounds like nothing.        It is a Marshall Silver Jubilee.
 *   Brit MegaBass    sounds like a bass rig.     It is a Marshall Super Bass 1992,
 *                    which plenty of guitarists ran as a guitar head.
 *
 * Line 6 publishes a "Based on" column for all ~490 models. That column is the
 * authoritative mapping from a model to the hardware it models, and it is the
 * only way to answer "which model is the pedal on that record?" without
 * guessing. This tool parses it and searches both directions.
 *
 * WHAT IT IS NOT
 * The published list gives DISPLAY names. The ids written into a .hsp are a
 * separate namespace and do not always derive from the display name -- see
 * docs/MODEL-NAME-MAP.md. Use this tool to pick the model, then confirm the id
 * against your own corpus (tools/mine-catalogue.js) before building with it.
 *
 * Usage:
 *   node tools/model-lookup.js fuzz face        search names and "based on" text
 *   node tools/model-lookup.js --list           every row, as TSV
 *   node tools/model-lookup.js --refresh fuzz   re-download first
 *
 * The page is cached under .cache/ so repeat lookups need no network. With no
 * network at all, save the page yourself to .cache/helix-stadium-models.html
 * and this works offline.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const URL = 'https://line6.com/helix-stadium-models/';
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE = path.join(CACHE_DIR, 'helix-stadium-models.html');

/* ---- fetch ---------------------------------------------------------- */

function download() {
  return new Promise((resolve, reject) => {
    https.get(URL, { headers: { 'User-Agent': 'helix-stadiumXL-model-lookup' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return reject(new Error(`redirected to ${res.headers.location} -- fetch it manually`));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function html(refresh) {
  if (!refresh && fs.existsSync(CACHE)) return fs.readFileSync(CACHE, 'utf8');
  let body;
  try {
    body = await download();
  } catch (e) {
    if (fs.existsSync(CACHE)) {
      console.error(`could not refresh (${e.message}); using the cached copy`);
      return fs.readFileSync(CACHE, 'utf8');
    }
    console.error(`could not fetch the model list: ${e.message}`);
    console.error(`\nSave the page yourself and this works offline:`);
    console.error(`  1. open ${URL}`);
    console.error(`  2. save it as ${CACHE}`);
    process.exit(1);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE, body, 'utf8');
  return body;
}

/* ---- parse ---------------------------------------------------------- */

const strip = (s) => s.replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/&reg;|&trade;/g, '')
  .replace(/\s+/g, ' ').trim();

/* Each data row nests a <table> inside its first <td> (the model's image and
 * display name), then three plain <td>: category, "based on", and the firmware
 * the model was introduced in. A non-greedy <tr>...</tr> match stops at the
 * INNER table's </tr>, so match the row's shape instead of matching rows
 * generically. */
const ROW = /<tr[^>]*>\s*<td[^>]*>\s*<table[\s\S]*?<\/table>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
const NAME = /<tr[^>]*>\s*<td[^>]*>\s*(<table[\s\S]*?<\/table>)/;

function parse(src) {
  const rows = [];
  let m;
  while ((m = ROW.exec(src))) {
    const nm = m[0].match(NAME);
    rows.push({
      name: nm ? strip(nm[1]) : '?',
      category: strip(m[1]),
      basedOn: strip(m[2]),
      firmware: strip(m[3]),
    });
  }
  return rows;
}

/* ---- main ----------------------------------------------------------- */

(async () => {
  const argv = process.argv.slice(2);
  const refresh = argv.includes('--refresh');
  const list = argv.includes('--list');
  const terms = argv.filter((a) => !a.startsWith('--'));

  const rows = parse(await html(refresh));
  if (!rows.length) {
    console.error('parsed 0 rows -- the page layout has changed; see the ROW regex above');
    process.exit(1);
  }

  if (list) {
    console.log('name\tcategory\tbased on\tfirmware');
    for (const r of rows) console.log(`${r.name}\t${r.category}\t${r.basedOn}\t${r.firmware}`);
    return;
  }

  if (!terms.length) {
    console.log(`${rows.length} models in the list.\n`);
    console.log('Search them:   node tools/model-lookup.js <words>');
    console.log('Dump as TSV:   node tools/model-lookup.js --list');
    return;
  }

  /* every term must appear somewhere in the row, so "fuzz face" narrows rather
   * than widens; a match in "based on" is what you usually want, so it sorts
   * first */
  const needles = terms.map((t) => t.toLowerCase());
  const hits = rows.filter((r) => {
    const hay = `${r.name} ${r.category} ${r.basedOn}`.toLowerCase();
    return needles.every((n) => hay.includes(n));
  }).sort((a, b) => {
    const score = (r) => needles.every((n) => r.basedOn.toLowerCase().includes(n)) ? 0 : 1;
    return score(a) - score(b) || a.name.localeCompare(b.name);
  });

  if (!hits.length) {
    console.log(`no model matches ${terms.map((t) => `"${t}"`).join(' + ')}.`);
    console.log('That often means the gear is not modelled at all -- there is no Marshall');
    console.log('Major, no Fender Vibroverb, no Marshall ShredMaster and no Ibanez WH-10,');
    console.log('for instance. Pick the nearest relative and say in the builder that you did.');
    return;
  }

  const w = Math.max(...hits.map((h) => h.name.length));
  for (const h of hits) {
    console.log(`${h.name.padEnd(w)}  ${h.basedOn}`);
    console.log(`${''.padEnd(w)}  ${h.category}, since firmware ${h.firmware || '?'}`);
  }
  console.log(`\n${hits.length} of ${rows.length} models. These are DISPLAY names --`);
  console.log('confirm the model id against your corpus before building (docs/MODEL-NAME-MAP.md).');
})();
