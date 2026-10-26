#!/usr/bin/env node
/*
 * Structural convention checker for Helix .hsp presets.
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
 * Structural check.
 *
 * validate-presets.js checks parameter names; check-ranges.js checks values.
 * Neither looks at the scaffolding AROUND the parameters -- block-level keys,
 * the `harness` object, preset-level keys. A field that every real preset
 * carries and mine omits is a strong candidate for something that breaks the
 * device while it is reading the preset rather than running it.
 *
 * Reports fields present in >=90% of corpus instances but missing from a
 * generated file, and fields present in mine that the corpus never shows.
 *
 * Usage: node check-structure.js <corpusDir> <genDir>
 */

const fs = require('fs');
const path = require('path');

const load = (f) => JSON.parse(fs.readFileSync(f).subarray(8).toString('utf8'));
/* Walk SUBDIRECTORIES too. A flat readdirSync silently skips a corpus kept in
 * folders -- per firmware, per device, per session -- with no warning that
 * anything was left out: a model present only in a subfolder reads as UNKNOWN,
 * and learned ranges come from a fraction of the evidence. mine-catalogue.js
 * had exactly this bug. */
const listHsp = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) listHsp(p, out);
    else if (e.name.toLowerCase().endsWith('.hsp')) out.push(p);
  }
  return out;
};
let [corpusDir, genDir] = process.argv.slice(2);
const corpus = require('../lib/corpus.js');
// One argument means the TARGET directory, with the reference taken from the
// corpus. Two arguments are explicit: <referenceDir> <targetDir>.
if (corpusDir && !genDir) { genDir = corpusDir; corpusDir = corpus.dir(); }
if (!corpusDir) corpusDir = corpus.dir();
if (!fs.existsSync(corpusDir) ||
    listHsp(corpusDir).length === 0) {
  console.error(corpus.explain('no reference presets found, so there is nothing to check against.'));
  process.exit(1);
}

/* tally[scope][key] = count ; totals[scope] = instances */
const tally = {}, totals = {};
const bump = (scope, keys) => {
  tally[scope] = tally[scope] || new Map();
  totals[scope] = (totals[scope] || 0) + 1;
  for (const k of keys) tally[scope].set(k, (tally[scope].get(k) || 0) + 1);
};

function scopesOf(j, visit) {
  visit('preset', Object.keys(j.preset));
  visit('meta', Object.keys(j.meta));
  for (const flow of j.preset.flow) {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled') continue;
      // Verified rule: a split carries `branch` exactly when its lower path
      // has blocks (21/21 with blocks have it, 3/3 with an empty lower path
      // omit it). Normalise so an empty-branch split is not a false positive.
      let bkeys = Object.keys(b);
      if (b.type === "split" && !b.branch) {
        const lower = Object.values(flow).filter(
          (x) => x && x.path === 1 && x.position > 0 && x.position < 13).length;
        if (!lower) bkeys = bkeys.concat(["branch"]);
      }
      visit(`block:${b.type}`, bkeys);
      visit(`harness:${b.type}`, Object.keys(b.harness || {}));
      if (b.harness && b.harness.params) {
        // harness params vary per MODEL, so key them by model
        visit(`harnessParams:${b.type}`, Object.keys(b.harness.params));
      }
      visit(`enabled:${b.type}`, Object.keys(b['@enabled'] || {}));
      for (const s of b.slot) visit('slot', Object.keys(s));
    }
  }
}

for (const f of listHsp(corpusDir)) {
  let j; try { j = load(f); } catch { continue; }
  scopesOf(j, bump);
}

const problems = [];
for (const f of listHsp(genDir)) {
  const j = load(f);
  const mine = {};
  scopesOf(j, (scope, keys) => {
    mine[scope] = mine[scope] || new Set();
    keys.forEach((k) => mine[scope].add(k));
  });

  for (const [scope, keys] of Object.entries(mine)) {
    const ref = tally[scope];
    if (!ref) { problems.push(`${path.basename(f)}  scope "${scope}" never seen in corpus`); continue; }
    const total = totals[scope];
    for (const [k, n] of ref) {
      const pct = n / total;
      if (pct >= 0.9 && !keys.has(k)) {
        problems.push(`${path.basename(f)}  ${scope}: MISSING "${k}"  (present in ${(pct * 100).toFixed(0)}% of ${total} corpus instances)`);
      }
    }
    for (const k of keys) {
      if (!ref.has(k)) problems.push(`${path.basename(f)}  ${scope}: field "${k}" never appears in corpus`);
    }
  }
}

const uniq = [...new Set(problems)].sort();
console.log(`corpus: ${listHsp(corpusDir).length} files, ${Object.keys(tally).length} structural scopes\n`);
if (!uniq.length) { console.log('No structural differences from the corpus.'); process.exit(0); }
console.log(`${uniq.length} structural difference(s):`);
for (const p of uniq) console.log('  ! ' + p);
process.exit(1);
