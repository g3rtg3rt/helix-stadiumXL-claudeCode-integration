#!/usr/bin/env node
/*
 * Value-range check.
 *
 * validate-presets.js checks parameter NAMES. This checks parameter VALUES
 * against the envelope the corpus actually uses, which is the gap that lets a
 * structurally valid preset still be one the device chokes on.
 *
 * Two classes of finding:
 *
 *   ENUM   -- the corpus only ever shows a small set of integers for this
 *             param, so it is almost certainly an index into a list (mic,
 *             ratio, waveshape, sync division). A value outside the observed
 *             set may index past the end of that list. These are the dangerous
 *             ones.
 *
 *   RANGE  -- continuous param written outside the observed min/max. Often
 *             harmless, but worth seeing.
 *
 * Usage: node check-ranges.js <corpusDir> <genDir>
 */

const fs = require('fs');
const path = require('path');

const load = (f) => JSON.parse(fs.readFileSync(f).subarray(8).toString('utf8'));
const listHsp = (d) => fs.readdirSync(d).filter((f) => f.toLowerCase().endsWith('.hsp')).map((f) => path.join(d, f));

let [corpusDir, genDir] = process.argv.slice(2);
const corpus = require('../lib/corpus.js');
// One argument means the TARGET directory, with the reference taken from the
// corpus. Two arguments are explicit: <referenceDir> <targetDir>.
if (corpusDir && !genDir) { genDir = corpusDir; corpusDir = corpus.dir(); }
if (!corpusDir) corpusDir = corpus.dir();
if (!fs.existsSync(corpusDir) ||
    fs.readdirSync(corpusDir).filter((f) => f.toLowerCase().endsWith('.hsp')).length === 0) {
  console.error(corpus.explain('no reference presets found, so there is nothing to check against.'));
  process.exit(1);
}

/* ---- learn the envelope ---- */
const stats = new Map(); // "model.param" -> {min,max,ints:Set,allInt,count,bools}

function valuesOf(pv) {
  const out = [];
  if (pv && typeof pv === 'object') {
    if ('value' in pv) out.push(pv.value);
    if (Array.isArray(pv.snapshots)) out.push(...pv.snapshots.filter((x) => x !== null));
  }
  return out;
}

function eachParam(preset, fn) {
  for (const flow of preset.preset.flow) {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled') continue;
      for (const slot of b.slot) {
        for (const [k, pv] of Object.entries(slot.params || {})) fn(slot.model, k, pv, id);
      }
    }
  }
}

for (const f of listHsp(corpusDir)) {
  let j; try { j = load(f); } catch { continue; }
  eachParam(j, (model, k, pv) => {
    const key = `${model}.${k}`;
    if (!stats.has(key)) stats.set(key, { min: Infinity, max: -Infinity, ints: new Set(), allInt: true, count: 0, bools: 0 });
    const st = stats.get(key);
    for (const val of valuesOf(pv)) {
      if (typeof val === 'boolean') { st.bools++; continue; }
      if (typeof val !== 'number') continue;
      st.count++;
      st.min = Math.min(st.min, val); st.max = Math.max(st.max, val);
      if (Number.isInteger(val)) st.ints.add(val); else st.allInt = false;
    }
  });
}

/* A param is enum-ish if every observed value is a SMALL integer. The
 * magnitude cap matters: HighCut/LowCut are continuous Hz controls that happen
 * to be set to round numbers in factory presets, and without the cap they look
 * like enums and drown the report. A max above 32 is a real quantity, not an
 * index into a list. */
const isEnum = (st, param) =>
  st.allInt && st.count >= 4 && st.ints.size <= 12 && st.max <= 32 && st.min >= -32 &&
  !fractionalSomewhere.has(param);

/* The corpus stores float32; comparing a written 0.707 against a stored
 * 0.7070000171661377 must not read as out of range. */
const f32 = (n) => Math.fround(n);
const below = (val, min) => f32(val) < f32(min) && Math.abs(f32(val) - f32(min)) > 1e-6;
const above = (val, max) => f32(val) > f32(max) && Math.abs(f32(val) - f32(max)) > 1e-6;

/* A non-integer written where the corpus only ever shows integers >1 means the
 * control is a switch position, not a 0-1 knob. That is a real error, not a
 * stylistic one, so it is reported even when the value is inside the range. */
const isSwitchLike = (st, param) =>
  st.allInt && st.max > 1 && st.max <= 32 && !fractionalSomewhere.has(param);

/* Guard against per-model sampling luck: cab `Distance` is continuous inches,
 * but one cab model may only ever appear at 1.0 and 2.0 and so look switch-like.
 * If a param name is ever fractional on ANY model, it is a continuous control. */
const fractionalSomewhere = new Set();
for (const [key, st] of stats) {
  if (!st.allInt) fractionalSomewhere.add(key.split('.').slice(1).join('.'));
}

/* ---- check generated files ---- */
const findings = [];

for (const f of listHsp(genDir)) {
  const j = load(f);
  eachParam(j, (model, k, pv, id) => {
    const key = `${model}.${k}`;
    const st = stats.get(key);
    if (!st || !st.count) return;
    for (const val of valuesOf(pv)) {
      if (typeof val !== 'number') continue;
      const set = () => `observed only {${[...st.ints].sort((a, b) => a - b).join(', ')}}`;
      if (isSwitchLike(st, k) && !Number.isInteger(val)) {
        findings.push({ sev: 'SWITCH', file: path.basename(f), id, key, val,
          detail: `${set()} — this is a switch position, not a 0-1 knob` });
      } else if (isEnum(st, k) && !st.ints.has(val)) {
        findings.push({ sev: 'ENUM', file: path.basename(f), id, key, val, detail: set() });
      } else if (below(val, st.min) || above(val, st.max)) {
        const fmt = (n) => (Number.isInteger(n) ? n : +n.toFixed(3));
        findings.push({ sev: 'RANGE', file: path.basename(f), id, key, val: fmt(val),
          detail: `observed ${fmt(st.min)} … ${fmt(st.max)}` });
      }
    }
  });
}

const order = { SWITCH: 0, ENUM: 1, RANGE: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.file.localeCompare(b.file));

const switches = findings.filter((x) => x.sev === 'SWITCH');
const enums = findings.filter((x) => x.sev === 'ENUM');
const ranges = findings.filter((x) => x.sev === 'RANGE');

const dedupe = (arr) => {
  const seen = new Set();
  return arr.filter((x) => {
    const k = `${x.file}|${x.id}|${x.key}|${x.val}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
};

console.log(`envelope learned from ${listHsp(corpusDir).length} files, ${stats.size} model/param pairs\n`);

const report = (label, arr) => {
  const d = dedupe(arr);
  console.log(`${label}: ${d.length}`);
  for (const x of d) console.log(`  ${x.file}  ${x.id}  ${x.key} = ${x.val}   (${x.detail})`);
  console.log();
};

report('SWITCH — fractional value written to a switch-position param  [REAL BUG]', switches);
report('ENUM   — integer outside the observed index set', enums);
report('RANGE — continuous value outside observed min/max', ranges);

if (!switches.length && !enums.length && !ranges.length) console.log('Every written value sits inside the corpus envelope.');
process.exit(switches.length ? 1 : 0);
