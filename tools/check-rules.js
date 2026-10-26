#!/usr/bin/env node
/*
 * check-rules.js: the rules the owner's manual states, checked in a file.
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
 * check-rules.js -- enforce the rules the MANUAL states, not just the shapes
 * the corpus happens to show.
 *
 * Everything the other validators know was inferred from exported files. These
 * rules come from the Helix Stadium owner's manual (Dynamic DSP, Signal Path
 * Routing, Cabs and Cab IRs, Amps and Preamps), so they catch a file that is
 * structurally perfect and still cannot work on the device.
 *
 * Usage: node check-rules.js <corpusDir> [targetDir ...]
 *
 * The corpus is checked FIRST and with the same rules. A rule that fires on
 * factory presets is a wrong rule, not a found bug -- which is the whole point
 * of checking the reference material against it.
 */
const fs = require('fs');
const path = require('path');

const MAGIC = 'rpshnosj';
const read = (f) => {
  const b = fs.readFileSync(f);
  if (b.slice(0, 8).toString('latin1') !== MAGIC) throw new Error(`${f}: bad magic`);
  return JSON.parse(b.slice(8).toString('utf8'));
};
/* Walk SUBDIRECTORIES too. A flat readdirSync silently skips a corpus kept in
 * folders -- per firmware, per device, per session -- with no warning that
 * anything was left out: a model present only in a subfolder reads as UNKNOWN,
 * and learned ranges come from a fraction of the evidence. mine-catalogue.js
 * had exactly this bug. */
const walkHsp = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walkHsp(p, out);
    else if (e.name.toLowerCase().endsWith('.hsp')) out.push(p);
  }
  return out;
};
const hsp = (d) => (fs.existsSync(d) ? walkHsp(d) : []);

/* ---- model classification -------------------------------------------------
 * "All Amp, Preamp, Poly effects, and Clone blocks are mono-only, so any
 *  stereo signal sent into these block types will be collapsed to mono."
 *   -- Signal Path Routing
 *
 * Poly models are named in Dynamic DSP as Feedbacker, Poly Sustain, Poly
 * Detune, Poly Pitch, Wham, Capo and 12 String. Only the first three and the
 * explicitly "Poly" ones can be recognised from a model id with confidence, so
 * the poly-count rule below reports what it matched and may undercount. The
 * MONO classification does not depend on that list.                           */
const isPoly = (m) => /Poly/.test(m) || /Feedback(Sim|er)/.test(m);
const NO_CAB = /NoCab$/;
const realSlots = (b) => (b.slot || []).filter((s) => s && s.model && !NO_CAB.test(s.model)).length;

const problems = [];
const note = (file, msg) => problems.push(`${path.basename(file)}: ${msg}`);

const checkFile = (file) => {
  const j = read(file);
  const flows = j.preset.flow || [];

  let amps = 0, cabs = 0, polys = 0, loopers = 0;
  const polyNames = [];

  flows.forEach((flow, fi) => {
    /* a "path" for the per-path limits is one of 1A/1B/2A/2B */
    const perPath = {};
    for (const [id, b] of Object.entries(flow)) {
      if (!b || typeof b !== 'object' || !b.type) continue;
      const p = b.path;
      perPath[p] = perPath[p] || { amps: 0, cabs: 0, polys: 0, blocks: 0, panned: null };
      const st = perPath[p];
      const model = (b.slot && b.slot[0] && b.slot[0].model) || '';

      if (b.type !== 'input' && b.type !== 'output') st.blocks++;

      if (b.type === 'amp') { amps++; st.amps++; }
      if (b.type === 'cab') { cabs++; st.cabs++; }
      if (/Looper/.test(model)) loopers++;
      if (isPoly(model)) { polys++; st.polys++; polyNames.push(model); }

      /* ---- stereo integrity ------------------------------------------
       * First attempt at this rule fired on 68 of 70 factory presets, so it
       * was wrong. What it got wrong: a stereo-capable bus is not stereo
       * CONTENT. A mono source through a single cab puts identical audio on L
       * and R, and a Split duplicates rather than widens -- a mono block after
       * either loses nothing. Factory presets also put mono EQs and volumes
       * after stereo delays constantly, so that cannot be an error either.
       *
       * What IS worth flagging is a mono block downstream of DELIBERATE hard
       * panning: a dual cab whose two slots are panned apart, or a Merge whose
       * A and B are panned apart. There the stereo image is the whole point of
       * the patch, and a mono block downstream silently throws it away. That
       * is the bug that bit this project four times.                          */
      const pan = (sl) => (sl && sl.params && sl.params.Pan && typeof sl.params.Pan.value === "number")
        ? sl.params.Pan.value : null;
      let panned = null;
      if (b.type === "cab" && realSlots(b) >= 2) {
        const [a, c] = [pan(b.slot[0]), pan(b.slot[1])];
        if (a !== null && c !== null && Math.abs(a - c) >= 0.5) panned = `${model} (slots panned ${a} / ${c})`;
      }
      if (/AppDSPJoin/.test(model)) {
        const p0 = b.slot && b.slot[0] && b.slot[0].params;
        const a = p0 && p0["A Pan"] && p0["A Pan"].value;
        const c = p0 && p0["B Pan"] && p0["B Pan"].value;
        if (typeof a === "number" && typeof c === "number" && Math.abs(a - c) >= 0.5)
          panned = `${model} (A/B panned ${a} / ${c})`;
      }

      const mono = b.type === "amp"
        || isPoly(model)
        || (b.type === "cab" && realSlots(b) < 2)
        || (b.type === "fx" && /Mono$/.test(model));

      if (mono && st.panned) {
        note(file, `flow${fi} path${p} ${id} ${model || b.type}: MONO block downstream of `
          + `${st.panned} -- sums the hard-panned image back to centre`);
        st.panned = null;
      }
      if (panned) st.panned = panned;
    }

    for (const [p, st] of Object.entries(perPath)) {
      if (st.amps > 2) note(file, `flow${fi} path${p}: ${st.amps} amp/preamp blocks (max 2 per path)`);
      if (st.cabs > 2) note(file, `flow${fi} path${p}: ${st.cabs} cab blocks (max 2 per path)`);
      if (st.polys > 1) note(file, `flow${fi} path${p}: ${st.polys} poly blocks (max 1 per path)`);
      if (st.blocks > 12) note(file, `flow${fi} path${p}: ${st.blocks} processing blocks (max 12 per path)`);
    }
  });

  if (amps > 4) note(file, `${amps} amp/preamp blocks in the preset (max 4)`);
  if (cabs > 4) note(file, `${cabs} cab blocks in the preset (max 4)`);
  if (polys > 2) note(file, `${polys} poly blocks in the preset (max 2): ${polyNames.join(', ')}`);
  if (loopers > 1) note(file, `${loopers} looper blocks in the preset (max 1)`);
};

/* ---- Channel is typed per model: boolean on some amps, integer on others --- */
const channelTypes = (files) => {
  const seen = new Map();
  for (const f of files) {
    const j = read(f);
    for (const flow of j.preset.flow || []) for (const b of Object.values(flow)) {
      if (!b || !b.slot) continue;
      for (const s of b.slot) {
        const c = s && s.params && s.params.Channel;
        if (!c) continue;
        const t = typeof c.value;
        if (!seen.has(s.model)) seen.set(s.model, new Set());
        seen.get(s.model).add(t);
        for (const v of c.snapshots || []) if (v !== null) seen.get(s.model).add(typeof v);
      }
    }
  }
  return seen;
};

const corpusDir = process.argv[2] || require('../lib/corpus.js').dir();
const targets = process.argv.slice(3);
if (!corpusDir) {
  console.error('usage: node check-rules.js <corpusDir> [targetDir ...]');
  process.exit(2);
}
const corpusFiles = hsp(corpusDir);
if (!corpusFiles.length) { console.error(`no .hsp files in ${corpusDir}`); process.exit(2); }

console.log(`--- the rules, checked against the corpus first (${corpusFiles.length} files) ---`);
corpusFiles.forEach(checkFile);
if (problems.length) {
  console.log(`  ${problems.length} hit(s) ON THE CORPUS. A rule that fires on device-written`);
  console.log('  presets is a wrong rule. Treat these as bugs in this tool:');
  problems.forEach((p) => console.log(`    ! ${p}`));
} else {
  console.log('  clean -- the rules agree with every device-written preset');
}

const chan = channelTypes(corpusFiles);
console.log(`\n--- Channel parameter type, per model (${chan.size} model(s) observed) ---`);
for (const [m, ts] of [...chan].sort()) {
  const t = [...ts].join('/');
  console.log(`  ${t === 'boolean' ? 'bool  ' : t === 'number' ? 'number' : 'MIXED '} ${m}`);
}

for (const dir of targets) {
  const files = hsp(dir);
  if (!files.length) { console.log(`\n${dir}: no .hsp files`); continue; }
  problems.length = 0;
  console.log(`\n--- ${dir} (${files.length} files) ---`);
  files.forEach(checkFile);
  /* Channel type must match what the corpus showed for that model */
  for (const [m, ts] of channelTypes(files)) {
    const ref = chan.get(m);
    if (!ref) { console.log(`  . ${m}: Channel never observed in the corpus -- type unverified`); continue; }
    for (const t of ts) if (!ref.has(t)) problems.push(`${m}: Channel is ${t}, corpus has ${[...ref].join('/')}`);
  }
  if (problems.length) problems.forEach((p) => console.log(`  ! ${p}`));
  else console.log('  clean');
}
