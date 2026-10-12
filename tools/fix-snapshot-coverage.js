#!/usr/bin/env node
/*
 * Fills missing per-snapshot bypass arrays.
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
 * Ensure every amp / cab / fx / split / join block carries a per-snapshot
 * bypass array sized to the preset's valid snapshot count.
 *
 * Why it matters: a block with no `@enabled.snapshots` array has no stored
 * state per snapshot, so what it does when you recall one is undefined rather
 * than chosen. 96% of cab blocks and 98% of amp and fx blocks in the corpus
 * carry the array whenever a preset has more than one snapshot.
 *
 * Input and output blocks are deliberately skipped -- the corpus omits the
 * array there most of the time (inputs 22%, outputs 38%), so adding it would
 * be inventing a convention the device does not use.
 *
 * Idempotent: a block that already has a correctly sized array is left alone.
 * Values are seeded from the block's current `value`, so the fix never changes
 * what the patch does -- it only makes the existing behaviour explicit.
 *
 * Usage: node fix-snapshot-coverage.js <file.hsp|dir> [--dry]
 */

const fs = require('fs');
const path = require('path');
const { stringify, MAGIC } = require('../lib/device-json.js');
const corpus = require('../lib/corpus.js');

const target = process.argv[2];
const DRY = process.argv.includes('--dry');
if (!target) { console.error('usage: node fix-snapshot-coverage.js <file.hsp|dir> [--dry]'); process.exit(2); }

const FMT = corpus.numberFormat();
const SKIP = new Set(['input', 'output']);

const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter((f) => f.toLowerCase().endsWith('.hsp')).map((f) => path.join(target, f))
  : [target];

let totalChanged = 0;

for (const file of files) {
  const raw = fs.readFileSync(file);
  if (raw.subarray(0, 8).toString('ascii') !== MAGIC) { console.log(`${path.basename(file)}: not an .hsp, skipped`); continue; }
  const j = JSON.parse(raw.subarray(8).toString('utf8'));
  const valid = j.preset.snapshots.filter((s) => s.valid).length;

  if (valid < 2) { console.log(`${path.basename(file).padEnd(24)} ${valid} snapshot(s) -- nothing to do`); continue; }

  const added = [];
  for (const [fi, flow] of j.preset.flow.entries()) {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled' || SKIP.has(b.type)) continue;
      const en = b['@enabled'];
      const cur = Array.isArray(en.snapshots) ? en.snapshots : null;
      const needsFix = !cur || cur.slice(0, valid).some((x) => x === null);
      if (!needsFix) continue;
      const seed = typeof en.value === 'boolean' ? en.value : true;
      const next = Array(8).fill(null);
      for (let i = 0; i < valid; i++) next[i] = cur && cur[i] !== null && cur[i] !== undefined ? cur[i] : seed;
      en.snapshots = next;
      added.push(`f${fi}/${id} ${b.type}:${b.slot[0].model.replace(/^(HD2_|HX2_|VIC_|P35_|L6SPB_|Agoura_)/, '')}`);
    }
  }

  console.log(`${path.basename(file).padEnd(24)} ${valid} snapshots, ${added.length} block(s) fixed`);
  for (const a of added) console.log(`    + ${a}`);

  if (added.length && !DRY) {
    fs.writeFileSync(file, MAGIC + stringify(j, FMT), 'utf8');
  }
  totalChanged += added.length;
}

if (DRY) console.log('\n--dry: nothing written');
else if (totalChanged) console.log(`\n${totalChanged} block(s) updated`);
