#!/usr/bin/env node
/*
 * Mines a model catalogue from a corpus of device exports.
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
 * Mine a folder of .hsp exports into a model catalogue.
 *
 * For every model id seen: its block type, its exact parameter set, and the
 * range of values observed for each parameter. Observed ranges are NOT declared
 * min/max -- they are the span the factory presets actually use, which is a
 * useful sanity envelope but not a hard limit.
 *
 * Usage: node tools/mine-catalogue.js [corpusDir] [outFile.md]
 *
 * With no arguments it reads your corpus/ and rewrites docs/MODEL-CATALOGUE.md.
 * Do this once per device: model availability and parameter sets differ between
 * devices and firmware, so a catalogue mined elsewhere is a starting point only.
 */

const fs = require('fs');
const path = require('path');

const corpus = require('../lib/corpus.js');

// Default to the corpus and to docs/, so the documented no-argument form works.
const dir = process.argv[2] || corpus.dir();
const outFile = process.argv[3] || path.join(__dirname, '..', 'docs', 'MODEL-CATALOGUE.md');

if (!fs.existsSync(dir)) {
  console.error(corpus.explain('the corpus directory does not exist.'));
  process.exit(1);
}
/* Walk SUBDIRECTORIES too. This was a flat readdirSync, which silently skipped
 * every per-firmware subfolder of the corpus. On a corpus with a 1.4.1/ folder
 * beside the top-level exports that meant 69 of 318 models missing from the
 * catalogue, with nothing in the output to say anything had been left out. */
function listHsp(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) listHsp(p, out);
    else if (e.name.toLowerCase().endsWith('.hsp')) out.push(p);
  }
  return out;
}

// Refuse to write an empty catalogue over a good one. The directory existing is
// not enough -- corpus/ ships with a README and a .gitkeep in it.
if (listHsp(dir).length === 0) {
  console.error(corpus.explain('the corpus has no .hsp files, so there is nothing to mine.'));
  console.error('Refusing to overwrite ' + outFile + ' with an empty catalogue.');
  process.exit(1);
}

const models = new Map(); // model -> {type, params: Map(name -> stats), seen}

function note(model, type, params) {
  if (!models.has(model)) models.set(model, { type, params: new Map(), seen: 0 });
  const m = models.get(model);
  m.seen++;
  for (const [k, pv] of Object.entries(params || {})) {
    if (!m.params.has(k)) m.params.set(k, { min: Infinity, max: -Infinity, nums: 0, bools: 0, other: 0 });
    const st = m.params.get(k);
    const vals = [];
    if (pv && typeof pv === 'object') {
      if ('value' in pv) vals.push(pv.value);
      if (Array.isArray(pv.snapshots)) vals.push(...pv.snapshots.filter((x) => x !== null));
    }
    for (const val of vals) {
      if (typeof val === 'number') { st.nums++; st.min = Math.min(st.min, val); st.max = Math.max(st.max, val); }
      else if (typeof val === 'boolean') st.bools++;
      else st.other++;
    }
  }
}

const files = listHsp(dir);
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f).subarray(8).toString('utf8')); }
  catch (e) { console.error(`skip ${path.relative(dir, f)}: ${e.message}`); continue; }
  for (const flow of j.preset.flow) {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled') continue;
      for (const s of b.slot) note(s.model, b.type, s.params);
    }
  }
}

/* Strip the generation marker off a model id.
 *
 * The id grammar is NOT `KNOWNPREFIX_Name`. Observed forms, all in real exports:
 *   HD2_DelayMultiPassStereo        prefix from a known set
 *   L6SPB_PolyWham                  prefix outside the set first written down
 *   EuclideanDelayStereo_Victoria   generation marker as a SUFFIX, no prefix
 *   TapeEater                       no marker at all
 *   HD2_DL4AnalogDelayStereo        a SECOND, inner marker (DL4/MM4/FM4/DM4)
 * so the prefix list must be open-ended and the family token cannot be assumed
 * to sit at the start of what is left. See docs/GOTCHAS.md. */
const stem = (model) => model
  .replace(/_[A-Z][a-z]+$/, '')              // trailing generation marker
  .replace(/^[A-Za-z0-9]+_/, '')             // any leading PREFIX_, known or not
  .replace(/^(DL4|MM4|FM4|DM4|MM|M13)/, ''); // legacy source-device marker

/* Ids that carry no family token at all, so no amount of pattern matching will
 * place them. Category per the official model list's own section for each. */
const BY_HAND = {
  MM4Dimension: 'Modulation',       // legacy Dimension chorus
  TapeEater: 'Modulation',          // legacy, between Rotary Drum and Warble-Matic
  FM4Growler: 'Pitch & Synth',      // legacy synth
  FeedbackSim: 'Dynamics',          // Feedbacker, in the Dynamics section
  AcousGtrSimMono: 'EQ, Filter & Wah',   // Acoustic Sim, in the EQ section
  AcousGtrSimStereo: 'EQ, Filter & Wah',
};

/* group by family + type for readability */
const CATEGORY = (model, type) => {
  if (type === 'amp') return 'Amps';
  if (type === 'cab') return 'Cabs & IRs';
  if (type === 'input' || type === 'output') return 'Input / Output';
  if (type === 'split' || type === 'join') return 'Routing';
  if (type === 'looper') return 'Looper';
  const bare = model.replace(/^[A-Za-z0-9]+_/, '');
  if (BY_HAND[bare]) return BY_HAND[bare];
  const n = stem(model);
  /* Anchored first -- the family token leads in the common case, and anchoring
   * keeps "RingModulatorPitchRingMod" out of Pitch. Unanchored only as a
   * fallback, so a model whose family token sits mid-id still lands somewhere
   * better than "Other FX". */
  for (const anchored of [true, false]) {
    const re = (s) => new RegExp(anchored ? `^(${s})` : `(${s})`).test(n);
    if (re('Dist|Drive|Fuzz|Boost|Screamer')) return 'Drives & Distortion';
    if (re('Delay|Echo')) return 'Delay';
    if (re('Reverb|Spring|Plate|Room|Hall|Tank|Ambience|Shimmer|Bloom')) return 'Reverb';
    if (re('Chorus|Phaser|Flanger|Tremolo|Rotary|Vibrato|Vibe|Mod|Reel|RingMod')) return 'Modulation';
    if (re('EQ|Filter|Wah|CaliQ|Parametric|Tilt')) return 'EQ, Filter & Wah';
    if (re('Comp|Gate|Limit|Squeeze')) return 'Dynamics';
    if (re('Pitch|Poly|Synth|Harmon|Octav')) return 'Pitch & Synth';
    if (re('Vol|Pan')) return 'Volume & Pan';
  }
  return 'Other FX';
};

const byCat = new Map();
for (const [model, m] of models) {
  const c = CATEGORY(model, m.type);
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push([model, m]);
}

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));

const lines = [
  '# Helix Stadium XL — model catalogue',
  '',
  `Generated by \`tools/mine-catalogue.js\` from ${files.length} device export(s).`,
  '',
  '**Regenerate this for YOUR device and firmware** — model availability and',
  'parameter sets differ between devices and firmware versions, so a catalogue',
  'mined elsewhere is a starting point rather than truth. Run the miner against',
  'your own `corpus/`.',
  '',
  'This file holds only model identifiers, parameter names, observed numeric',
  'ranges and usage counts — factual interoperability data. No preset content,',
  'names or settings are reproduced here.',
  '',
  `**${models.size} models** across ${byCat.size} categories.`,
  '',
  'Ranges are what the sampled presets actually use, not the device\'s declared',
  'min/max. Treat them as a sanity envelope: a value inside the range is certainly',
  'valid, a value outside it may still be.',
  '',
  '`n` = how many blocks in the corpus used this model — a rough popularity signal,',
  'and a confidence signal for the parameter set (a model seen once may have',
  'parameters that preset never touched).',
  '',
];

for (const cat of [...byCat.keys()].sort()) {
  const entries = byCat.get(cat).sort((a, b) => b[1].seen - a[1].seen || a[0].localeCompare(b[0]));
  lines.push(`## ${cat}`, '');
  for (const [model, m] of entries) {
    lines.push(`### \`${model}\``, '', `type \`${m.type}\` · n = ${m.seen}`, '');
    if (!m.params.size) { lines.push('_no parameters_', ''); continue; }
    lines.push('| Param | Type | Observed range |', '|---|---|---|');
    for (const k of [...m.params.keys()].sort()) {
      const st = m.params.get(k);
      let type = st.nums ? 'number' : st.bools ? 'bool' : 'other';
      let range = st.nums
        ? (st.min === st.max ? `\`${fmt(st.min)}\` (constant)` : `\`${fmt(st.min)}\` … \`${fmt(st.max)}\``)
        : st.bools ? 'true / false' : '—';
      if (st.nums && st.bools) { type = 'number or bool'; range += ' (also seen as bool)'; }
      lines.push(`| \`${k}\` | ${type} | ${range} |`);
    }
    lines.push('');
  }
}

fs.writeFileSync(outFile, lines.join('\n'), 'utf8');

console.log(`${files.length} files -> ${models.size} models`);
for (const cat of [...byCat.keys()].sort()) {
  console.log(`  ${cat.padEnd(22)} ${String(byCat.get(cat).length).padStart(3)}`);
}
console.log(`
wrote ${outFile}`);
