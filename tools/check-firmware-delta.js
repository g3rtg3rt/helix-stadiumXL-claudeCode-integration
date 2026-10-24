#!/usr/bin/env node
/*
 * Firmware delta check: what changed between two firmware versions.
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
 * Compare presets exported from a NEW firmware against the existing corpus,
 * and report exactly what changed.
 *
 * Everything this project knows was learned from one firmware. A firmware
 * update can invalidate any of it, and the failure mode that matters is silent:
 * if the device now renders a number differently, the writer keeps using the
 * old convention and the first sign of trouble is a unit that faults ten
 * seconds after a preset loads.
 *
 * Checks, worst consequence first:
 *   1. NUMBER FORMATTING  per model+parameter float-vs-int. The one that bites
 *   2. device_id / device_version
 *   3. schema shape -- new or removed keys at preset and block level
 *   4. models -- added, removed
 *   5. parameter sets on models present in BOTH -- added, removed, retyped
 *
 * Usage: node check-firmware-delta.js <newExportDir> [oldCorpusDir]
 *        oldCorpusDir defaults to exported_presets/
 *
 * The strongest input is the SAME presets exported from both firmwares -- that
 * isolates firmware changes from preset differences. It reports on whatever
 * overlap it finds and says how much that was.
 */

const fs = require('fs');
const path = require('path');
const { learnNumberFormat, MAGIC } = require('../lib/device-json.js');

const NEW = process.argv[2];
const OLD = process.argv[3] || require('../lib/corpus.js').dir();

if (!NEW) {
  console.error('usage: node check-firmware-delta.js <newExportDir> [oldCorpusDir]');
  process.exit(2);
}
for (const [label, d] of [['new', NEW], ['old', OLD]]) {
  if (!fs.existsSync(d)) { console.error(`${label} directory does not exist: ${d}`); process.exit(1); }
}

const load = (dir) => {
  const out = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.hsp'))) {
    const raw = fs.readFileSync(path.join(dir, f));
    if (raw.subarray(0, 8).toString('ascii') !== MAGIC) continue;
    out.set(f, { text: raw.subarray(8).toString('utf8'), json: JSON.parse(raw.subarray(8).toString('utf8')) });
  }
  return out;
};

const newFiles = load(NEW);
const oldFiles = load(OLD);
if (newFiles.size === 0) { console.error(`no .hsp files in ${NEW}`); process.exit(1); }

const overlap = [...newFiles.keys()].filter((f) => oldFiles.has(f));
console.log(`new: ${newFiles.size} preset(s) from ${NEW}`);
console.log(`old: ${oldFiles.size} preset(s) from ${OLD}`);
console.log(overlap.length
  ? `same filename in both: ${overlap.length} -- these give the cleanest comparison\n`
  : `\nNOTE: no filenames in common. Differences below may be preset differences\n` +
    `rather than firmware differences. Re-export the SAME presets for certainty.\n`);

let blockers = 0;
const say = (sev, msg) => { if (sev === 'X') blockers++; console.log(`  ${sev} ${msg}`); };

/* ---- 2. identity ---- */
console.log('--- device identity ---');
const ids = (m) => {
  const s = new Set();
  for (const { json } of m.values()) s.add(`${json.meta.device_id} / ${json.meta.device_version}`);
  return [...s];
};
const oldIds = ids(oldFiles), newIds = ids(newFiles);
console.log(`  old: ${oldIds.join(', ')}`);
console.log(`  new: ${newIds.join(', ')}`);
if (newIds.join() !== oldIds.join()) {
  say('!', 'device_version CHANGED. Update the FIRMWARE constant at the top of');
  say(' ', '  lib/builders.js -- device_version is computed from it. The field packs');
  say(' ', '  as (major<<28)|(minor<<24)|(patch<<16)|build; see docs/FORMAT.md.');
} else {
  console.log('  unchanged');
}

/* ---- 1. number formatting: the dangerous one ---- */
console.log('\n--- number formatting (float vs int per model+parameter) ---');
const fmtOld = learnNumberFormat(OLD, []);
const fmtNew = learnNumberFormat(NEW, []);
const disagree = [];
for (const [field, isFloatNew] of fmtNew) {
  if (field === '__stats') continue;
  if (!fmtOld.has(field)) continue;                 // new field, covered below
  if (fmtOld.get(field) !== isFloatNew) {
    disagree.push(`${field}: old=${fmtOld.get(field) ? 'float' : 'int'} new=${isFloatNew ? 'float' : 'int'}`);
  }
}
const onlyNew = [...fmtNew.keys()].filter((f) => f !== '__stats' && !fmtOld.has(f));
if (disagree.length) {
  say('X', `${disagree.length} parameter(s) RENDER DIFFERENTLY under the new firmware:`);
  for (const d of disagree.slice(0, 25)) console.log(`      ${d}`);
  if (disagree.length > 25) console.log(`      ... and ${disagree.length - 25} more`);
  say(' ', '  This is the failure mode that faults the unit. Re-learn from the new');
  say(' ', '  corpus before writing any more presets.');
} else {
  console.log(`  no disagreements across ${fmtNew.size - 1} fields seen in both`);
}
if (onlyNew.length) console.log(`  ${onlyNew.length} field(s) only in the new exports (new models or params)`);

/* ---- 3. schema shape ---- */
console.log('\n--- schema shape ---');
const shape = (m) => {
  const preset = new Set(), blk = new Set(), slot = new Set();
  for (const { json } of m.values()) {
    Object.keys(json.preset).forEach((k) => preset.add(k));
    for (const fl of json.preset.flow) {
      for (const [id, b] of Object.entries(fl)) {
        if (id === '@enabled' || !b) continue;
        Object.keys(b).forEach((k) => blk.add(k));
        for (const s of b.slot || []) Object.keys(s).forEach((k) => slot.add(k));
      }
    }
  }
  return { preset, blk, slot };
};
const so = shape(oldFiles), sn = shape(newFiles);
for (const [label, a, b] of [['preset', so.preset, sn.preset], ['block', so.blk, sn.blk], ['slot', so.slot, sn.slot]]) {
  const added = [...b].filter((k) => !a.has(k));
  const gone = [...a].filter((k) => !b.has(k));
  if (added.length) say('!', `${label}: NEW key(s) ${added.join(', ')}`);
  if (gone.length) console.log(`  . ${label}: key(s) not seen in the new sample: ${gone.join(', ')} (may just be absent from this sample)`);
  if (!added.length && !gone.length) console.log(`  ${label}: unchanged`);
}

/* ---- 4 + 5. models and their parameter sets ---- */
const models = (m) => {
  const out = new Map();
  for (const { json } of m.values()) {
    for (const fl of json.preset.flow) {
      for (const [id, b] of Object.entries(fl)) {
        if (id === '@enabled' || !b || !b.slot) continue;
        for (const s of b.slot) {
          if (!out.has(s.model)) out.set(s.model, new Set());
          Object.keys(s.params || {}).forEach((k) => out.get(s.model).add(k));
        }
      }
    }
  }
  return out;
};
const mo = models(oldFiles), mn = models(newFiles);
console.log('\n--- models ---');
const addedModels = [...mn.keys()].filter((k) => !mo.has(k));
console.log(`  old corpus: ${mo.size} models    new sample: ${mn.size} models`);
if (addedModels.length) {
  console.log(`  ${addedModels.length} model(s) in the new sample that the corpus has never seen:`);
  for (const m of addedModels.slice(0, 20)) console.log(`      + ${m}`);
  if (addedModels.length > 20) console.log(`      ... and ${addedModels.length - 20} more`);
  console.log('  (not a problem - re-run tools/mine-catalogue.js to pick them up)');
}

console.log('\n--- parameter sets on models present in BOTH ---');
let changed = 0;
for (const [model, pNew] of mn) {
  const pOld = mo.get(model);
  if (!pOld) continue;
  const added = [...pNew].filter((k) => !pOld.has(k));
  const gone = [...pOld].filter((k) => !pNew.has(k));
  if (!added.length && !gone.length) continue;
  changed++;
  // A parameter missing from a small new sample is probably just untouched by
  // those presets; a parameter that APPEARED is a real schema change.
  if (added.length) say('X', `${model}: NEW param(s) ${added.join(', ')}`);
  if (gone.length && newFiles.size >= 10) {
    console.log(`  . ${model}: not seen in new sample: ${gone.join(', ')} (small sample? probably untouched)`);
  }
}
if (!changed) console.log('  no parameter-set changes detected');

/* ---- verdict ---- */
console.log('\n' + '='.repeat(60));
if (blockers) {
  console.log(`${blockers} finding(s) that need acting on before generating more presets.`);
  process.exit(1);
}
console.log('Nothing found that invalidates what the toolkit already knows.');
console.log('Caveat: this only sees what your sample exercises. A model or');
console.log('parameter absent from these exports is simply untested.');
console.log('');
console.log('IMPORTANT -- "no new models" above means none in THIS SAMPLE.');
console.log('If you re-exported presets you already had, it CANNOT show you');
console.log('models the update added: an old preset does not use them. Read the');
console.log('release notes for what was added, then build one scratch preset per');
console.log('new model on the device and export that too. Until a model appears');
console.log('in a device-written export there is no parameter set and no number');
console.log('formatting for it, so it cannot be written safely.');
