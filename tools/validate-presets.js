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

/* Walk SUBDIRECTORIES too. A flat readdirSync silently skips a corpus kept in
 * folders -- per firmware, per device, per session -- with no warning that
 * anything was left out: a model present only in a subfolder reads as UNKNOWN,
 * and learned ranges come from a fraction of the evidence. mine-catalogue.js
 * had exactly this bug. */
const listHsp = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listHsp(p, out);
    else if (e.name.toLowerCase().endsWith('.hsp')) out.push(p);
  }
  return out;
};

/* Parameters that only some corpus instances of a model carry -- typically
 * added by a firmware update. Collected and summarised once instead of
 * reported against every block that predates them. */
const EXPECTED_FW = require('../lib/builders.js').DEVICE_VERSION;
/* every firmware the reference corpus actually contains */
const corpusFw = new Set();
const fwName = (n) =>
  `${n >>> 28}.${(n >>> 24) & 15}.${(n >>> 16) & 255}.${n & 0xffff}`;

/* A param is firmware-gated when every firmware carrying it is strictly newer
 * than every firmware that does not. Returns the gate, or null. Reported with
 * its evidence rather than silently applied: a rule induced from one corpus is
 * only as general as that corpus. */
const firmwareGated = (name) => {
  const e = fwSeen.get(name);
  if (!e || !e.with.size || !e.without.size) return null;
  const lo = Math.max(...e.without), hi = Math.min(...e.with);
  return hi > lo ? { gate: hi, below: lo, n: e.with.size, m: e.without.size } : null;
};
const gatedSeen = new Map();

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

/* param name -> { with: Set(firmware), without: Set(firmware) }. A param a
 * firmware update ADDED looks identical to one the builders invented unless
 * you record which firmware each instance came from. */
const fwSeen = new Map();
const fwNote = (name, fw, has) => {
  if (!fwSeen.has(name)) fwSeen.set(name, { with: new Set(), without: new Set() });
  fwSeen.get(name)[has ? 'with' : 'without'].add(fw);
};

function learn(preset) {
  const fw = preset.meta.device_version;
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
        /* absence matters as much as presence: a firmware-gated param is one
         * that is always there above a version and never below it */
        const have = new Set(keys);
        for (const k of schema.models.get(slot.model)) fwNote(k, fw, have.has(k));
      }
    }
  }
}

/* ---- checks ---- */
const problems = [];
const note = (f, msg) => problems.push(`${path.basename(f)}: ${msg}`);

function check(file, isRef = false) {
  const p = load(file); // throws on bad magic / bad JSON
  const m = p.meta;
  if (m.device_id !== 2490368) note(file, `device_id ${m.device_id}`);
  /* A reference file was written BY the device, so whatever firmware it
   * carries is legitimate by definition and flagging it says nothing about
   * correctness. Only a generated file can carry the wrong stamp. */
  if (isRef) corpusFw.add(m.device_version);
  /* The firmware the builders stamp, taken from lib/builders.js so it cannot
   * go stale. This was a hardcoded 318899516 (1.3.2.1340), which meant every
   * preset on a newer firmware -- generated AND device-written -- was reported
   * as a problem, and the report drowned in notices about the current
   * firmware being current. */
  if (!isRef && m.device_version !== EXPECTED_FW) {
    note(file, `device_version ${m.device_version} (${fwName(m.device_version)})`
      + ` -- builders stamp ${EXPECTED_FW} (${fwName(EXPECTED_FW)})`);
  }

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
          /* not an error if a firmware update introduced it and this file is
           * stamped at or above that firmware -- the model simply has no copy
           * on the newer firmware in this corpus */
          const g = firmwareGated(k);
          if (g && p.meta.device_version >= g.gate) { gatedSeen.set(k, g); continue; }
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
    listHsp(refDir).length === 0) {
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
  const r = check(f, true);
  console.log(`  ${path.basename(f).padEnd(28)} ${String(r.blocks).padStart(3)} blocks, ${r.validCount} snapshots  ${problems.length === before ? 'OK' : 'ISSUES'}`);
}

console.log(`  firmware(s) in the reference corpus: `
  + [...corpusFw].sort().map((v) => fwName(v)).join(', '));

console.log('\n-- generated files --');
for (const f of listHsp(genDir)) {
  const before = problems.length;
  const r = check(f);
  console.log(`  ${path.basename(f).padEnd(28)} ${String(r.blocks).padStart(3)} blocks, ${r.validCount} snapshots  ${problems.length === before ? 'OK' : 'ISSUES'}`);
}

if (gatedSeen.size) {
  console.log(`\n${gatedSeen.size} firmware-gated parameter(s) -- present on every corpus`);
  console.log('instance at or above the firmware shown and on none below it, so a');
  console.log('generated file stamped that high is right to carry them:');
  for (const [k, g] of [...gatedSeen].sort()) {
    console.log(`  . ${k}: from ${fwName(g.gate)} (with it on ${g.n} firmware(s),`
      + ` without on ${g.m}, newest without = ${fwName(g.below)})`);
  }
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
