#!/usr/bin/env node
/*
 * check-builders.js: do the builders write what the DEVICE writes?
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
 * Verify each new builder against the device's own export of that model.
 *
 * The first version of this compared rendered TEXT and failed 6 of 10 -- all
 * of it float32 print noise. The device stores float32 and prints the full
 * float64 expansion (0.57 -> 0.5699999928474426); this writer prints the
 * shortest round-tripping double (0.57). Both load as the same float32, and
 * 17 generated presets run on the unit, so that difference is cosmetic.
 *
 * What actually matters, and what this now checks:
 *   1. the key set matches exactly -- a missing or invented parameter
 *   2. the int-vs-float RENDERING matches -- the property that faults the unit
 *   3. the value matches as float32 -- the precision the device actually keeps
 *   4. booleans are booleans
 * Deliberate departures from the device's value are declared, not tolerated
 * silently.
 */
const fs = require('fs');
const path = require('path');
const P = require('path').join(__dirname, '..');
const b = require('../lib/builders.js');
const dj = require('../lib/device-json.js');
const CORPUS = process.argv[3] || require('../lib/corpus.js').dir();
const learned = dj.learnNumberFormat(CORPUS);

/* documented intentional differences: model -> param -> why */
const INTENDED = {
  Agoura_AmpLine6Prosecutor: {
    Level: 'device export reads -9.9999 (knob landed just shy); -10.0 is the '
      + 'cleaner default and the device stores exact -10.0 on other amps',
  },
};

const deviceParams = new Map();
const dir = process.argv[2] || require('../lib/corpus.js').dir();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.hsp'))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f)).slice(8).toString('utf8'));
  for (const flow of j.preset.flow || []) {
    for (const blk of Object.values(flow)) {
      if (!blk || !blk.slot) continue;
      for (const s of blk.slot) {
        if (s && s.model && !deviceParams.has(s.model)) deviceParams.set(s.model, { params: s.params, from: f });
      }
    }
  }
}

const CASES = [
  ['Agoura_AmpBritSL100', () => b.ampBritSL100(0, 6, null)],
  ['Agoura_AmpOmegaGrano', () => b.ampOmegaGrano(0, 6, null)],
  ['Agoura_AmpLine6Prosecutor', () => b.ampProsecutor(0, 6, null)],
  ['Agoura_AmpCali2CPlus', () => b.ampCali2CPlus(0, 6, null)],
  ['HD2_DistMercatorMono', () => b.mercator(2, true)],
  ['HD2_DistRockBoxMono', () => b.rockBox(3, true)],
  ['HD2_DistRockBoxBoostMono', () => b.rockBoxBoost(4, true)],
  ['HD2_DistPortaBox424Mono', () => b.portaBox424(5, true)],
  ['HD2_VibratoEssexVibeMono', () => b.essexVibe(2, true)],
  ['HD2_ChorusDimensionWMono', () => b.dimensionW(3, true)],
];

const f32 = (x) => Math.fround(x);
/* how a value is RENDERED for this model+param: int, float or bool */
const kind = (model, key, value) => {
  if (typeof value === 'boolean') return 'bool';
  const txt = dj.stringify({ model, params: { [key]: { value } } }, learned);
  const m = txt.match(/"value": (-?[\d.eE+-]+)/);
  if (!m) return 'other';
  return m[1].includes('.') || /[eE]/.test(m[1]) ? 'float' : 'int';
};

let fail = 0, intended = 0;
for (const [model, make] of CASES) {
  const dev = deviceParams.get(model);
  if (!dev) { console.log(`  ?  ${model}: not in the exports`); fail++; continue; }
  const mine = make().slot[0].params;
  const kd = Object.keys(dev.params).sort(), km = Object.keys(mine).sort();
  const missing = kd.filter((k) => !km.includes(k));
  const extra = km.filter((k) => !kd.includes(k));
  const bad = [], noted = [];

  for (const k of kd) {
    if (!(k in mine)) continue;
    const dv = dev.params[k].value, mv = mine[k].value;
    const dk = kind(model, k, dv), mk = kind(model, k, mv);
    if (dk !== mk) { bad.push(`${k}: rendered as ${mk}, device renders ${dk}  <-- FAULT CLASS`); continue; }
    if (dk === 'bool') { if (dv !== mv) bad.push(`${k}: ${mv} vs device ${dv}`); continue; }
    if (f32(dv) !== f32(mv)) {
      const why = INTENDED[model] && INTENDED[model][k];
      if (why) noted.push(`${k}: ${mv} vs device ${dv} -- intended: ${why}`);
      else bad.push(`${k}: ${mv} vs device ${dv}`);
    }
  }

  if (!missing.length && !extra.length && !bad.length) {
    intended += noted.length;
    console.log(`  OK ${model.padEnd(28)} ${kd.length} params`
      + (noted.length ? `, ${noted.length} intended difference` : ''));
    noted.forEach((n) => console.log(`       . ${n}`));
    continue;
  }
  fail++;
  console.log(`  X  ${model}  (device copy from ${dev.from})`);
  if (missing.length) console.log(`       MISSING: ${missing.join(', ')}`);
  if (extra.length) console.log(`       EXTRA:   ${extra.join(', ')}`);
  bad.forEach((x) => console.log(`       ${x}`));
}
console.log(fail
  ? `\n${fail} builder(s) do not match the device`
  : `\nall ${CASES.length} builders match the device: key sets identical, `
    + `int/float rendering identical, values identical as float32`
    + (intended ? ` (${intended} declared departure)` : ''));
process.exit(fail ? 1 : 0);
