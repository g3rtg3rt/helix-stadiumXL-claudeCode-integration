#!/usr/bin/env node
/*
 * check-snaps.js: can every parameter actually move per snapshot?
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
 * Two rules about per-snapshot parameter values.
 *
 * RULE 1, capability: a factory option that sets a parameter must also accept
 * its "Snaps" sibling, so that parameter CAN be moved per snapshot.
 *
 *   This is a check rather than a convention because the sweep that added
 *   snapshot support to the builders rewrote `v(o.x ?? d)` call sites -- and
 *   so was blind to every factory that took DESTRUCTURED arguments instead.
 *   Seven of them stayed frozen: gate, comp, scream808, minotaur, dm4Comp,
 *   polyDowntune, volPedal. Nothing noticed, because every other check here
 *   asks whether what was written is correct, and a parameter that cannot
 *   move writes a perfectly correct static value. assertSnapsReached only
 *   fires when a builder ASKS for a snapshot array, so it can never fire for
 *   an option nobody is able to pass.
 *
 *   Writing the check then found five more factories behind those seven,
 *   including cab() -- 11 options in all that silently could not move.
 *
 * RULE 2, coherence: within one parameter, the snapshot array must render the
 * same way as the value -- both int, or both float.
 *
 *   Why: a field is identified MODEL|PARAM|value, and a snapshot array is
 *   MODEL|PARAM|snapshots, learned separately. A parameter whose value the
 *   corpus has observed and whose snapshots it has not therefore falls through
 *   to the float default ON THE ARRAY ALONE: half the parameter typed from
 *   evidence, half of it guessed. That is how an int-typed field acquires a
 *   decimal point, which is the one thing that faults the unit.
 *
 *   The device agrees this is a rule. Measured on a 113-preset corpus: 500
 *   parameters carry both a value and a snapshot array, and 0 of them render
 *   the two differently.
 *
 * Usage:
 *   node tools/check-snaps.js                 # the shipped examples in out/
 *   node tools/check-snaps.js <dir> ...        # any directory of .hsp files
 *
 * Point it at your corpus to check the rules against the device itself -- a
 * rule that fires on factory presets is a wrong rule, not a found bug.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const B = require(path.join(ROOT, 'lib', 'builders.js'));
const dj = require(path.join(ROOT, 'lib', 'device-json.js'));
const corpus = require(path.join(ROOT, 'lib', 'corpus.js'));

let fail = 0;

/* ------------------------------------------------------------------ *
 * RULE 1 -- every option that sets a parameter can move per snapshot
 * ------------------------------------------------------------------ */

/* Declared exceptions, each with its evidence. An option named here is frozen
 * ON PURPOSE. An option NOT named here that cannot move is the bug.
 *
 * The bar for an entry is DEVICE evidence that the parameter holds no
 * per-snapshot state -- not a rule about taste. Amp Level, join Level and cab
 * Level should all stay still from snapshot to snapshot, because level belongs
 * in one gain block and a moving leg level slides the stereo image. But that is
 * a rule about how to VOICE a patch, and the amps have always been able to move
 * theirs. Enforcing it by withholding the capability from some blocks and not
 * others taught nobody anything and only hid which blocks were deliberate. */
const FROZEN = {
  '*.en': 'not a parameter -- per-snapshot bypass goes through enabled(value, snaps)',
  'inputInst.gate': 'input blocks hold no per-snapshot state: 0 of 231 input '
    + 'parameters in a 113-preset corpus carry a snapshots array, 129 of them '
    + 'InputInst1. The input gate is global; for per-snapshot gating use gate().',
  'inputInst.threshold': 'see inputInst.gate',
  'inputInst.decay': 'see inputInst.gate',
};
const frozen = (fac, opt) => FROZEN[`${fac}.${opt}`] || FROZEN[`*.${opt}`];

/* Comments are blanked before scanning, newlines kept so reported line numbers
 * still point at the factory. Without this the scanner reads prose: a comment
 * in cab() mentioning `o.x` came back as an option named x. */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

/* Factories are read from the source rather than called, so a factory of any
 * signature is covered -- amps take (p, pos, linked, o), cabs a name as well. */
function scanFactories(file) {
  const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
  const starts = [];
  lines.forEach((l, i) => {
    const m = /^(?:const|function)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*)?\(/.exec(l);
    if (m) starts.push([m[1], i]);
  });
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const [name, i] = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1][1] : lines.length;
    const src = lines.slice(i, end).join('\n');
    if (!/block\(\{/.test(src)) continue;          // not a block factory
    const reads = new Set();
    /* Options are read as `o.x` -- but also through an alias, because cab()
     * used to merge the caller's options over the per-cabinet defaults and
     * then read `d.x`. The first version of this scanner knew only `o.x`, so
     * it reported cab() as having one option and said nothing about the six
     * that could not move. A lint with its own blind spot is worse than none. */
    const alias = new Set(['o']);
    for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{[^}]*\.\.\.o\b/g)) {
      alias.add(m[1]);
    }
    for (const a of alias) {
      for (const m of src.matchAll(new RegExp(`\\b${a}\\.([A-Za-z_$][\\w$]*)`, 'g'))) reads.add(m[1]);
    }
    /* a surviving destructured options argument: { x = 1, y = 2 } = {} */
    const d = /\{([^}]*)\}\s*=\s*\{\}/.exec(src.slice(0, src.indexOf('block(')));
    const destructured = d
      ? d[1].split(',').map((s) => s.trim().split('=')[0].trim()).filter(Boolean)
      : [];
    out.push({ name, line: i + 1, reads, destructured });
  }
  return out;
}

const SOURCES = [
  path.join(ROOT, 'lib', 'builders.js'),
  path.join(ROOT, 'examples', 'build-examples.js'),
].filter((f) => fs.existsSync(f));

const gaps = [];
let options = 0; let exempt = 0; let factories = 0;
for (const f of SOURCES) {
  for (const fac of scanFactories(f)) {
    factories++;
    const opts = [...new Set(
      [...fac.reads].filter((x) => !/Snaps$/.test(x)).concat(fac.destructured),
    )];
    for (const opt of opts) {
      options++;
      if (fac.reads.has(`${opt}Snaps`)) continue;
      if (frozen(fac.name, opt)) { exempt++; continue; }
      gaps.push(`${path.relative(ROOT, f)}:${fac.line}  ${fac.name}(${opt})`
        + (fac.destructured.includes(opt) ? '  [destructured argument]' : ''));
    }
  }
}
console.log(`RULE 1  ${factories} block factories, ${options} options`);
if (gaps.length) {
  fail++;
  console.log(`  ${gaps.length} option(s) cannot carry a per-snapshot value and are not declared frozen:`);
  gaps.forEach((g) => console.log(`     X ${g}`));
  console.log('  Fix: v(o.x ?? default, o.xSnaps) -- or add it to FROZEN with the reason.');
} else {
  console.log(`  every option can move per snapshot, except ${exempt} declared frozen on purpose`);
}

/* ------------------------------------------------------------------ *
 * RULE 2 -- a snapshot array renders like its own value
 * ------------------------------------------------------------------ */

const walk = (d, o = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, o);
    else if (e.name.toLowerCase().endsWith('.hsp')
      && !/Conflicted copy/i.test(e.name)) o.push(p);
  }
  return o;
};
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : [path.join(ROOT, 'out')];
const files = dirs.flatMap((d) => (fs.existsSync(d) ? walk(d) : []));
const isFloatText = (t) => /[.eE]/.test(t);

if (!files.length) {
  console.log('\nRULE 2  no .hsp files found in: ' + dirs.join(', '));
  console.log('  Build the examples first, or pass a directory.');
  process.exit(fail ? 1 : 0);
}

const FMT = corpus.numberFormat();

/* 2a -- the writer's typing, asked of every model+parameter actually written:
 * WOULD a snapshot array of this value render like the value? This is the half
 * that does not wait for anyone to have used the capability. */
const seen = new Map();   // model|param -> value
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f).subarray(8).toString('utf8'));
  for (const flow of (j.preset && j.preset.flow) || []) {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled' || !b || !Array.isArray(b.slot)) continue;
      for (const s of b.slot) {
        if (!s || !s.model) continue;
        for (const [k, o] of Object.entries(s.params || {})) {
          if (!o || typeof o.value !== 'number') continue;
          if (!seen.has(`${s.model}|${k}`)) seen.set(`${s.model}|${k}`, o.value);
        }
      }
    }
  }
}
const mistyped = [];
for (const [key, value] of seen) {
  const [model, param] = key.split('|');
  const txt = dj.stringify(
    { model, params: { [param]: { snapshots: B.snap([value, value]), value } } }, FMT,
  );
  const vm = /"value": (-?[\d.eE+-]+)/.exec(txt);
  const sm = /"snapshots": \[([^\]]*)\]/s.exec(txt);
  if (!vm || !sm) continue;
  const nums = sm[1].split(',').map((x) => x.trim()).filter((x) => x && x !== 'null');
  const bad = nums.filter((n) => isFloatText(n) !== isFloatText(vm[1]));
  if (bad.length) mistyped.push(`${key}: value ${vm[1]} but snapshots ${bad[0]}`);
}
console.log(`\nRULE 2a ${seen.size} model+parameter pairs used by these presets`);
if (mistyped.length) {
  fail++;
  console.log(`  ${mistyped.length} would render a snapshot array differently from the value:`);
  mistyped.forEach((m) => console.log(`     X ${m}`));
} else {
  console.log('  all of them render a snapshot array exactly like the value');
}

/* 2b -- and the same question of the bytes already on disk. */
let pairs = 0;
const onDisk = [];
for (const f of files) {
  const text = fs.readFileSync(f).subarray(8).toString('utf8');
  const re = /"snapshots":\s*\[([^\]]*)\]\s*,\s*"value":\s*(-?[\d.eE+-]+)/g;
  let m;
  while ((m = re.exec(text))) {
    const nums = m[1].split(',').map((s) => s.trim()).filter((s) => s && s !== 'null');
    if (!nums.length) continue;
    pairs++;
    const bad = nums.filter((n) => isFloatText(n) !== isFloatText(m[2]));
    if (bad.length) onDisk.push(`${path.basename(f)}: value ${m[2]} vs snapshot ${bad[0]}`);
  }
}
console.log(`\nRULE 2b ${pairs} parameter(s) in ${files.length} file(s) carry both a value and a snapshot array`);
if (onDisk.length) {
  fail++;
  console.log(`  ${onDisk.length} disagree:`);
  onDisk.forEach((m) => console.log(`     X ${m}`));
} else {
  console.log('  none of them disagree');
}

console.log(fail ? `\n${fail} rule(s) failed` : '\nboth rules hold');
process.exit(fail ? 1 : 0);
