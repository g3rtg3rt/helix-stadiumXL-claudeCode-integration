#!/usr/bin/env node
/*
 * check-reproducible.js: does the shipped .hsp still match its builder?
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
 * Every other check here reads a .hsp and asks whether it is well formed.
 * None of them asks the one question that catches a whole class of mistake:
 *
 *   is the file you are about to load onto the device still what its build
 *   script produces today?
 *
 * It drifts in both directions. A builder gains a parameter and the file on
 * disk is left behind; a file is hand-edited and the builder is never told.
 * Neither leaves a trace -- the stale file is perfectly valid -- so nothing
 * failed, and the preset you audit by reading the script is not the preset
 * you play.
 *
 * Measured on this project the first time it ran: 8 of 22 presets no longer
 * matched their builders. Seven were a stale number format from before the
 * corpus was read recursively. The eighth, Hallelujah, had a footswitch
 * assignment in the file that the builder never wrote -- it had never once
 * reproduced the preset it claims to build, and the mismatch had been sitting
 * in the first commit.
 *
 * Usage:
 *   node tools/check-reproducible.js                      # the shipped examples
 *   node tools/check-reproducible.js <outDir> <script>...  # anywhere else
 *
 * Exit 0 clean, 1 if anything drifted. The builders have already rewritten
 * the drifted files by the time it reports: the point is to tell you which
 * ones changed under you, so you can look before you load them.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'out'));
/* DISCOVERED, not listed. A hand-written array of builders is a list that
 * something has to check the completeness of, and nothing does: add a builder
 * without adding it here and every preset it writes is hashed before and after
 * with nothing touching it, which reads as a clean pass. That happened on
 * 2026-11-11 in the private project this toolkit came from -- the run reported
 * "all 28 presets are byte-identical to what their builders write" while
 * covering 27. See also the UNBUILT check below, which catches the same thing
 * from the other end.
 *
 * A cloud-sync conflict copy is skipped: discovery means this script EXECUTES
 * what it finds, and a weeks-old copy of a builder will happily overwrite a
 * current preset. (That also happened, the first time discovery ran.) */
const scripts = process.argv.length > 3
  ? process.argv.slice(3)
  : fs.readdirSync(path.join(ROOT, 'examples'))
    .filter((x) => /^build-.*\.js$/.test(x) && !/\(Conflicted copy /i.test(x)).sort()
    .map((x) => path.join(ROOT, 'examples', x));

/* Presets NO builder is meant to write -- hand-edited ones, for instance.
 * Anything matching is expected in the untouched list and is not a failure. */
const NEVER_BUILT = [];

const hashes = (dir) => {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  (function walk(d, base) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, rel);
      /* A cloud-sync conflict copy is not a preset; it is debris, and counting
       * it as "new" buries the real finding. */
      else if (e.name.toLowerCase().endsWith('.hsp') && !/Conflicted copy/i.test(e.name)) {
        /* The mtime rides along because an identical rewrite is invisible to
         * the hash, and "was this file written at all" is a different question
         * from "did its contents change". */
        out.set(rel, {
          hash: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
          mtime: fs.statSync(p).mtimeMs,
        });
      }
    }
  }(dir, ''));
  return out;
};

const before = hashes(outDir);
console.log(`${before.size} preset(s) in ${path.relative(process.cwd(), outDir) || outDir}`);

for (const s of scripts) {
  try {
    execFileSync(process.execPath, [s], { cwd: path.dirname(path.resolve(s)), stdio: 'pipe' });
    console.log(`  ran  ${path.basename(s)}`);
  } catch (e) {
    console.log(`  FAILED to run ${path.basename(s)}:`);
    console.log(String(e.stderr || e.message).split('\n').slice(0, 6).map((l) => `       ${l}`).join('\n'));
    process.exit(2);
  }
}

const after = hashes(outDir);
const drifted = [];
const appeared = [];
const vanished = [];
const untouched = [];
const declared = [];
for (const [f, a] of after) {
  if (!before.has(f)) { appeared.push(f); continue; }
  const b = before.get(f);
  if (b.hash !== a.hash) drifted.push(f);
  else if (b.mtime !== a.mtime) continue;                      // rewritten, identical
  else if (NEVER_BUILT.some((re) => re.test(f))) declared.push(f);
  else untouched.push(f);
}
for (const f of before.keys()) if (!after.has(f)) vanished.push(f);

if (drifted.length) {
  console.log(`\n${drifted.length} preset(s) did NOT match their builder and have been rewritten:`);
  drifted.forEach((f) => console.log(`  CHANGED  ${f}`));
  console.log('\nDiff them before loading. A difference here is one of two things:');
  console.log('  * the file was stale -- the builder is right, keep the new one');
  console.log('  * the file held something the builder does not write -- the');
  console.log('    BUILDER is wrong, and the fix belongs in the script');
}
if (appeared.length) {
  console.log(`\n${appeared.length} preset(s) the output dir did not have before:`);
  appeared.forEach((f) => console.log(`  NEW      ${f}`));
}
if (vanished.length) {
  /* Not a build failure: a renamed preset leaves its old file behind, and an
   * archived one is meant to disappear. Still worth naming. */
  console.log(`\n${vanished.length} preset(s) present before and not rebuilt:`);
  vanished.forEach((f) => console.log(`  ORPHAN   ${f}`));
}

if (untouched.length) {
  /* The failure a before/after hash comparison CANNOT see: a preset that no
   * builder wrote is identical to itself every time. Unchanged is not the same
   * as verified. */
  console.log(`\n${untouched.length} preset(s) NO builder wrote, so nothing here verified them:`);
  untouched.forEach((x) => console.log(`  UNBUILT  ${x}`));
  console.log('\nEither the builder is missing, or the preset is hand-edited and');
  console.log('belongs in NEVER_BUILT with the reason.');
}

/* Count what was VERIFIED, not how many files were looked at. */
const covered = after.size - untouched.length - declared.length;
const bad = drifted.length + appeared.length + untouched.length;
console.log(bad
  ? `\n${bad} preset(s) were not reproducible. Look at them.`
  : `\nall ${covered} built presets are byte-identical to what their builders write`
    + (declared.length ? `; ${declared.length} declared hand-edited and NOT checked here.` : '.'));
process.exit(bad ? 1 : 0);
