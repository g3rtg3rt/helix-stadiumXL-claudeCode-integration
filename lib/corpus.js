/*
 * Corpus resolution and device number-format learning.
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
 * The corpus: where this toolkit learns your device's own number formatting.
 *
 * READ THIS BEFORE ANYTHING ELSE IN THE REPO.
 *
 * The firmware decides whether a parameter is a float or an integer by whether
 * the JSON text has a decimal point. `JSON.stringify` renders 0.0 as `0`, which
 * hands a float-typed parameter an integer -- and the unit faults: watchdog
 * restart, splash screen, no full boot, roughly ten seconds after the preset
 * goes active.
 *
 * So the writer never guesses a number's format. It learns the correct one per
 * model+parameter from presets the DEVICE ITSELF wrote, because `"value": 0` is
 * correct under `Mic` and fatal under `Level`.
 *
 * That makes a corpus a hard requirement, not a nicety. You supply your own:
 * see docs/SETUP.md. Nothing is shipped in `corpus/` because factory presets
 * are Line 6's content, and because your device and firmware may not match
 * whoever built this.
 */

const fs = require('fs');
const path = require('path');
const { learnNumberFormat } = require('./device-json.js');

const ROOT = path.resolve(__dirname, '..');
const DIR = process.env.HELIX_CORPUS
  ? path.resolve(process.env.HELIX_CORPUS)
  : path.join(ROOT, 'corpus');

/** Absolute path of the corpus directory in use. */
const dir = () => DIR;

/** The .hsp files in the corpus, as absolute paths. */
function presets() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.toLowerCase().endsWith('.hsp'))
    .map((f) => path.join(DIR, f));
}

function explain(problem) {
  return [
    '',
    'Helix toolkit: ' + problem,
    '  looked in: ' + DIR,
    '',
    'This toolkit writes .hsp files by learning how your DEVICE formats numbers.',
    'It does not guess. The firmware tells a float from an int by the decimal',
    'point in the JSON text, and getting it wrong makes the unit fault, so the',
    'corpus is a hard requirement rather than a warning you can skip.',
    '',
    'To fix it:',
    '  1. Open HX Edit and connect your Helix.',
    '  2. Select presets the device itself saved -- the factory set is ideal --',
    '     and export them to:',
    '       ' + DIR,
    '  3. Re-run. Thirty or more gives good parameter coverage; fewer still',
    '     works, the learner just sees fewer models.',
    '',
    'Do NOT put presets this toolkit generated into the corpus. The learner would',
    'read your own mistakes back as ground truth. Only device-written files belong.',
    '',
    'Point somewhere else with:  HELIX_CORPUS=/path/to/exports',
    '',
  ].join('\n');
}

let memo = null;

/**
 * The learned per-field number formatting, computed once on first use.
 * Lazy on purpose: requiring the library should never fail, so tools that do
 * not write files (validators, the catalogue miner) work on their own terms.
 */
function numberFormat() {
  if (memo) return memo;
  if (!fs.existsSync(DIR)) throw new Error(explain('the corpus directory does not exist.'));
  const files = presets();
  if (files.length === 0) throw new Error(explain('the corpus is empty -- no .hsp files found.'));
  if (files.length < 10) {
    console.warn('WARNING: only ' + files.length + ' preset(s) in the corpus. The number-format');
    console.warn('learner will not have seen many models. Export more before trusting output.');
  }
  memo = learnNumberFormat(DIR, []);
  return memo;
}

module.exports = { dir, presets, numberFormat, explain };
