#!/usr/bin/env node
/*
 * Schema conformance checker for Helix .hsp presets.
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
 * Validate generated .hsp files against reference exports from the device.
 *
 * Builds a schema from the reference files (model id -> exact param name set,
 * block types, harness shapes) and asserts every generated preset conforms.
 * Anything the device has never been seen to accept is reported.
 *
 * Usage: node validate-presets.js <refDir> <genDir>
 */

const fs = require('fs');
const path = require('path');

const MAGIC = 'rpshnosj';

function load(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 8).toString('ascii');
  if (head !== MAGIC) throw new Error(`${file}: bad magic ${JSON.stringify(head)}`);
  return JSON.parse(buf.subarray(8).toString('utf8'));
}

const listHsp = (dir) =>
  fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.hsp')).map((f) => path.join(dir, f));

/* Parameters that only some corpus instances of a model carry -- typically
 * added by a firmware update. Collected and summarised once instead of
 * reported against every block that predates them. */
const optional = new Set();

/* ---- build reference schema ---- */
const schema = {
  models: new Map(), types: new Map(), blockTypes: new Set(),
  /* model -> { seen, params: Map<param, count> }, so a parameter present on
   * only some instances can be told from one present on all. A corpus that
   * spans two firmware versions makes this distinction mandatory: a parameter
   * an update added is absent from every older file. */
  counts: new Map(),
};

function learn(preset) {
  for (const flow of preset.preset.flow) {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled') continue;
      schema.blockTypes.add(b.type);
      for (const slot of b.slot) {
        const keys = slot.params ? Object.keys(slot.params).sort() : [];
        if (!schema.models.has(slot.model)) schema.models.set(slot.model, new Set(keys));
        else keys.forEach((k) => schema.models.get(slot.model).add(k));
        if (!schema.counts.has(slot.model)) schema.counts.set(slot.model, { seen: 0, params: new Map() });
        const c = schema.counts.get(slot.model);
        c.seen++;
        keys.forEach((k) => c.params.set(k, (c.params.get(k) || 0) + 1));
        schema.types.set(slot.model, b.type);
      }
    }
  }
}

/* ---- checks ---- */
const problems = [];
const note = (f, msg) => problems.push(`${path.basename(f)}: ${msg}`);

function check(file) {
  const p = load(file); // throws on bad magic / bad JSON
  const m = p.meta;
  if (m.device_id !== 2490368) note(file, `device_id ${m.device_id}`);
  if (m.device_version !== 318899516) note(file, `device_version ${m.device_version}`);

  const snaps = p.preset.snapshots;
  if (snaps.length !== 8) note(file, `snapshots length ${snaps.length}`);
  // Hard field limit. 560 snapshot names across 70 device-written presets,
  // none longer than 10 -- and the factory names are visibly abbreviated to
  // fit ("Rhythm Bst", "Dr Sharp A"). Overrunning it is a strong suspect for
  // the firmware watchdog restarts seen on 2026-09-13.
  snaps.forEach((s, i) => {
    if (typeof s.name === "string" && s.name.length > 10) {
      note(file, `snapshot ${i + 1} name ${JSON.stringify(s.name)} is ${s.name.length} chars, device field holds 10`);
    }
  });
  const validCount = snaps.filter((s) => s.valid).length;

  if (p.preset.flow.length !== 2) note(file, `flow length ${p.preset.flow.length}`);

  p.preset.flow.forEach((flow, fi) => {
    const ids = new Set(Object.keys(flow).filter((k) => k !== '@enabled'));
    const refs = [];

    for (const id of ids) {
      const b = flow[id];

      // 1. block id must equal path*14 + position
      const want = 'b' + String(b.path * 14 + b.position).padStart(2, '0');
      if (want !== id) note(file, `flow${fi} ${id}: id/path/position mismatch (expected ${want})`);
      if (b.position < 0 || b.position > 13) note(file, `flow${fi} ${id}: position ${b.position}`);
      if (b.path !== 0 && b.path !== 1) note(file, `flow${fi} ${id}: path ${b.path}`);

      // 2. model ids and param sets must exist in the reference schema
      for (const slot of b.slot) {
        if (!schema.models.has(slot.model)) {
          note(file, `flow${fi} ${id}: UNKNOWN model "${slot.model}"`);
          continue;
        }
        if (schema.types.get(slot.model) !== b.type) {
          note(file, `flow${fi} ${id}: model ${slot.model} used as type "${b.type}", reference says "${schema.types.get(slot.model)}"`);
        }
        const ref = schema.models.get(slot.model);
        const got = new Set(slot.params ? Object.keys(slot.params) : []);
        const cnt = schema.counts.get(slot.model) || { seen: 0, params: new Map() };
        for (const k of got) {
          if (ref.has(k)) continue;
          note(file, `flow${fi} ${id} ${slot.model}: extra param "${k}" `
            + `(never seen on this model; it appears ${cnt.seen}x in the corpus)`);
        }
        for (const k of ref) {
          if (got.has(k)) continue;
          const on = cnt.params.get(k) || 0;
          if (on < cnt.seen) { optional.add(`${slot.model}.${k} (on ${on} of ${cnt.seen})`); continue; }
          note(file, `flow${fi} ${id} ${slot.model}: MISSING param "${k}"`);
        }

        // 3. every param must be an object carrying `value`
        for (const [k, pv] of Object.entries(slot.params || {})) {
          if (pv === null || typeof pv !== 'object' || Array.isArray(pv)) {
            note(file, `flow${fi} ${id} ${slot.model}: param "${k}" is a bare ${typeof pv}, expected {value:...}`);
            continue;
          }
          if (!('value' in pv)) note(file, `flow${fi} ${id} ${slot.model}: param "${k}" has no value`);
          if (pv.snapshots) checkSnapArray(file, `flow${fi} ${id} ${slot.model}.${k}`, pv.snapshots, validCount);
        }
      }

      // 4. snapshot arrays on bypass state
      if (b['@enabled'] && b['@enabled'].snapshots) {
        checkSnapArray(file, `flow${fi} ${id} @enabled`, b['@enabled'].snapshots, validCount);
      }

      // 5. cross-references must resolve inside the same flow
      if (b.endpoint) refs.push([id, 'endpoint', b.endpoint]);
      if (b.branch) refs.push([id, 'branch', b.branch]);
      // linkedblock may cross flows ("Modern Metal D" links a flow0 amp to a
      // flow1 cab), an amp may have no cab at all, and the link may be ONE-WAY
      // -- several factory presets declare it on the cab only. So: the target
      // must exist and be the complementary type, and if the partner declares a
      // link of its own it must point back here rather than somewhere else.
      if (b.linkedblock) {
        const lf = p.preset.flow[b.linkedblock.flow];
        const partner = lf && lf[b.linkedblock.block];
        const complement = { amp: 'cab', cab: 'amp' }[b.type];
        if (!partner) {
          note(file, `flow${fi} ${id}: linkedblock -> flow${b.linkedblock.flow}/${b.linkedblock.block} does not exist`);
        } else if (complement && partner.type !== complement) {
          note(file, `flow${fi} ${id}: ${b.type} linked to a "${partner.type}" block, expected "${complement}"`);
        } else if (partner.linkedblock &&
                   (partner.linkedblock.block !== id || partner.linkedblock.flow !== fi)) {
          note(file, `flow${fi} ${id}: partner flow${b.linkedblock.flow}/${b.linkedblock.block} links elsewhere ` +
            `(flow${partner.linkedblock.flow}/${partner.linkedblock.block})`);
        }
      }
    }

    for (const [id, kind, target] of refs) {
      if (!ids.has(target)) note(file, `flow${fi} ${id}: ${kind} -> ${target} does not exist in this flow`);
    }

    // 6. path 0 of each flow needs input at position 0 and output at 13.
    //    Path 1 is a split branch and carries neither in any reference file.
    if (!ids.has('b00')) note(file, `flow${fi} path0: no input block at position 0`);
    if (!ids.has('b13')) note(file, `flow${fi} path0: no output block at position 13`);
  });

  // 7. controller sources referenced must be declared. Only walk controller
  //    objects -- snapshot metadata has its own unrelated `source` field.
  const declared = new Set(Object.keys(p.preset.sources));
  const used = new Set();
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    // source 0 means "unassigned" and is never declared in preset.sources.
    if (node.controller && typeof node.controller.source === 'number' && node.controller.source !== 0) {
      used.add(String(node.controller.source));
    }
    Object.values(node).forEach(walk);
  })(p.preset.flow);
  for (const s of used) if (!declared.has(s)) note(file, `controller source ${s} not declared in preset.sources`);

  return { validCount, blocks: p.preset.flow.reduce((n, f) => n + Object.keys(f).length - 1, 0) };
}

function checkSnapArray(file, where, arr, validCount) {
  if (arr.length !== 8) return note(file, `${where}: snapshot array length ${arr.length}`);
  for (let i = 0; i < 8; i++) {
    const isNull = arr[i] === null;
    if (i < validCount && isNull) note(file, `${where}: null at snapshot ${i + 1} but that snapshot is valid`);
    if (i >= validCount && !isNull) note(file, `${where}: value at snapshot ${i + 1} but that snapshot is invalid`);
  }
}

/* ---- run ---- */
let [refDir, genDir] = process.argv.slice(2);
const corpus = require('../lib/corpus.js');
// One argument means the TARGET directory, with the reference taken from the
// corpus. Two arguments are explicit: <referenceDir> <targetDir>.
if (refDir && !genDir) { genDir = refDir; refDir = corpus.dir(); }
if (!refDir) refDir = corpus.dir();
if (!fs.existsSync(refDir) ||
    fs.readdirSync(refDir).filter((f) => f.toLowerCase().endsWith('.hsp')).length === 0) {
  console.error(corpus.explain('no reference presets found, so there is nothing to check against.'));
  process.exit(1);
}
const refs = listHsp(refDir);
refs.forEach((f) => learn(load(f)));

console.log(`Reference schema from ${refs.length} export(s): ${schema.models.size} models, types: ${[...schema.blockTypes].sort().join(', ')}\n`);

// Self-test: the references must validate against their own schema.
console.log('-- reference files (self-check) --');
for (const f of refs) {
  const before = problems.length;
  const r = check(f);
  console.log(`  ${path.basename(f).padEnd(28)} ${String(r.blocks).padStart(3)} blocks, ${r.validCount} snapshots  ${problems.length === before ? 'OK' : 'ISSUES'}`);
}

console.log('\n-- generated files --');
for (const f of listHsp(genDir)) {
  const before = problems.length;
  const r = check(f);
  console.log(`  ${path.basename(f).padEnd(28)} ${String(r.blocks).padStart(3)} blocks, ${r.validCount} snapshots  ${problems.length === before ? 'OK' : 'ISSUES'}`);
}

if (optional.size) {
  console.log(`\n${optional.size} optional parameter(s) -- present on some corpus instances of a`);
  console.log('model and not others, which is what a firmware update looks like. Not');
  console.log('an error; listed so the information is not silently dropped:');
  for (const o of [...optional].sort()) console.log(`  . ${o}`);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log('  ! ' + p);
  process.exit(1);
}
console.log('\nAll files conform to the reference schema.');
