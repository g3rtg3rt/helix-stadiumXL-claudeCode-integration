#!/usr/bin/env node
/*
 * Byte-level round-trip diff against a device re-export.
 * Copyright (C) 2026 g3rtg3rt
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
 * Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/*
 * Round-trip diff: compare a generated .hsp against the same preset after it
 * has been imported into the device and exported back out.
 *
 * This is the only check that proves the device actually KEPT what was written.
 * Schema validation proves internal consistency; it cannot detect a block the
 * device silently dropped, a parameter it clamped, or a field it rewrote.
 *
 * Floats are compared at float32 precision, because the device round-trips
 * 0.55 as 0.550000011920929 -- that is storage precision, not a change.
 *
 * Usage: node roundtrip-diff.js <generated.hsp> <re-exported.hsp>
 */

const fs = require('fs');
const path = require('path');

const load = (f) => JSON.parse(fs.readFileSync(f).subarray(8).toString('utf8'));

const same = (a, b) =>
  (typeof a === 'number' && typeof b === 'number')
    ? Math.fround(a) === Math.fround(b)
    : a === b;

const out = { dropped: [], added: [], changed: [] };

function walk(a, b, trail) {
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) out.dropped.push(`${trail}.${k}`);
      else walk(a[k], b[k], `${trail}.${k}`);
    }
    for (const k of Object.keys(b)) if (!(k in a)) out.added.push(`${trail}.${k} = ${JSON.stringify(b[k])}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.changed.push(`${trail}: array length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${trail}[${i}]`);
    return;
  }
  if (!same(a, b)) out.changed.push(`${trail}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
}

const [genFile, refFile] = process.argv.slice(2);

/* Compare BYTES before anything else.
 *
 * This tool originally compared only parsed JSON, and reported a "clean round
 * trip" for a file whose every whole-numbered float had been written as an
 * integer -- because 0.0 and 0 parse to the same number. That false green sent
 * the 2026-09-13 crash investigation down two useless ablation ladders. A
 * format check that parses first cannot see formatting. */
{
  const a = fs.readFileSync(genFile).subarray(8).toString('utf8').split('\n');
  const b = fs.readFileSync(refFile).subarray(8).toString('utf8').split('\n');
  const lines = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) lines.push({ i, a: (a[i] || '').trim(), b: (b[i] || '').trim() });
  }
  // Same number, different text = a formatting difference the parser hides.
  const numeric = /^("[^"]*"\s*:\s*)?(-?\d+(\.\d+)?([eE][-+]?\d+)?),?$/;
  const fmtOnly = lines.filter((l) => {
    const ma = numeric.exec(l.a), mb = numeric.exec(l.b);
    // Same key AND same value, different text. Without the key check this
    // matches any two unrelated lines that both happen to end in ": 0".
    return ma && mb && (ma[1] || '') === (mb[1] || '') && Number(ma[2]) === Number(mb[2]);
  });
  console.log(`text lines differing: ${lines.length}` +
    (fmtOnly.length ? `  (${fmtOnly.length} are NUMBER FORMATTING -- same value, different text)` : ''));
  for (const l of fmtOnly.slice(0, 10)) {
    console.log(`  FORMAT  line ${l.i}:  written ${l.a}   returned ${l.b}`);
  }
  if (fmtOnly.length) {
    console.log('  ^ the firmware distinguishes float from int by the decimal point.\n' +
      '    Write via device-json.js, not JSON.stringify.');
  }
  console.log();
}

const gen = load(genFile);
const ret = load(refFile);

// Blocks are the headline: a dropped block is the failure mode that matters.
const blocksOf = (p) => {
  const m = new Map();
  p.preset.flow.forEach((fl, fi) => {
    for (const [id, b] of Object.entries(fl)) {
      if (id === '@enabled') continue;
      m.set(`flow${fi}.${id}`, b.slot.map((s) => s.model).join(' + '));
    }
  });
  return m;
};

const gb = blocksOf(gen), rb = blocksOf(ret);
console.log(`blocks written: ${gb.size}   blocks returned: ${rb.size}\n`);

let blockProblem = false;
for (const [id, model] of gb) {
  if (!rb.has(id)) { console.log(`  DROPPED  ${id}  ${model}`); blockProblem = true; }
  else if (rb.get(id) !== model) { console.log(`  CHANGED  ${id}  ${model} -> ${rb.get(id)}`); blockProblem = true; }
}
for (const [id, model] of rb) if (!gb.has(id)) { console.log(`  ADDED    ${id}  ${model}`); blockProblem = true; }
if (!blockProblem) console.log('  every block survived the round trip, same models\n');

walk(gen, ret, '');

// meta/clip churn is the editor's own bookkeeping, not a change to the patch.
const boring = (s) => /^\.meta\.|^\.preset\.(clip|cursor|params\.activesnapshot)/.test(s);
const changed = out.changed.filter((s) => !boring(s));
const dropped = out.dropped.filter((s) => !boring(s));
const added = out.added.filter((s) => !boring(s));

const show = (label, arr) => {
  if (!arr.length) return;
  console.log(`\n${label} (${arr.length}):`);
  for (const s of arr.slice(0, 60)) console.log('  ' + s);
  if (arr.length > 60) console.log(`  ... and ${arr.length - 60} more`);
};

show('FIELDS THE DEVICE DROPPED', dropped);
show('FIELDS THE DEVICE ADDED', added);
show('VALUES THE DEVICE CHANGED (clamping, quantising, re-voicing)', changed);

if (!dropped.length && !added.length && !changed.length && !blockProblem) {
  console.log('\nClean round trip: the device kept the preset exactly as written.');
} else {
  console.log(`\n${dropped.length + added.length + changed.length} field difference(s) outside meta/clip bookkeeping.`);
}
