/*
 * report-levels.js: where each preset's level comes from, and how much of it.
 *
 * WHY THIS EXISTS. Three patches in a row turned out to be 14 dB or more too
 * quiet on the device, and the cause was a reasoning error rather than a typo:
 * the amp `Level` trim had been picked from the model's observed corpus range
 * and from what OTHER patches in the set used. Neither of those tells you
 * anything about how much level a given amp model MAKES at a given drive, and
 * that is the number that decides whether a patch is loud enough.
 *
 * WHAT THIS IS NOT, AND THE EVIDENCE FOR SAYING SO. It is not a loudness
 * measurement, it cannot be one, and above all it must not be normalised to a
 * target. Two measurements settle that:
 *
 *   - A SET LEVELLED BY EAR. Four patches levelled by ear on real speakers and
 *     gigged with read -15.6, -11.6, -7.3 and +2.0 here -- the same range as
 *     the patches that measured far too quiet. If the total predicted
 *     loudness, by-ear levelling would be wrong.
 *   - LINE 6'S OWN FACTORY PRESETS. Across the 81 that carry an amp block,
 *     median total per drive bin runs -4.5 to -19.3 with no trend against
 *     drive at all (the least-squares slope is slightly POSITIVE), and 34 dB
 *     of spread inside single bins. There is no drive-to-trim compensation
 *     curve to copy.
 *
 * Normalising a whole set to one target would therefore have moved 17 presets
 * by +12 to +25 dB, past the ones already known to be right.
 *
 * WHAT THE TABLE IS GOOD FOR: spotting a patch whose trim is far from its
 * SIBLINGS ON THE SAME AMP MODEL. That is the comparison that found the real
 * fault -- two patches on one blackface Fender model both sitting 14 dB below
 * where that model needed to be, while every other model in the set was fine.
 * After that, it is ears.
 *
 * THE ARITHMETIC THAT MATTERS. Hard-panned legs -- two amps or two cabs across
 * L and R -- are PARALLEL, not in series. Each feeds one side, so they
 * AVERAGE; adding them overstates a dual-cab patch by 6 dB. Snapshot arrays
 * average too, since the number wanted is the patch's centre of mass rather
 * than any one snapshot.
 *
 * Usage: node tools/report-levels.js [dir]      (default: out/)
 */
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..', 'out');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const vals = (pv) => (pv.snapshots
  ? pv.snapshots.filter((x) => typeof x === 'number')
  : [pv.value]).filter((x) => typeof x === 'number');

const DRIVE = ['Drive', 'NormDrv', 'LeadDrive', 'NrmDrv', 'NrmDrive', 'NormDrive', 'BrightDrv', 'BrtDrv'];

const rows = [];
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith('.hsp') || /\(Conflicted copy /i.test(f)) continue;
  const P = JSON.parse(fs.readFileSync(path.join(dir, f)).subarray(8).toString('utf8')).preset;
  const amps = [], cabs = [], gains = [], outs = [], drives = [], ampModels = [];
  P.flow.forEach((flow) => {
    for (const [id, b] of Object.entries(flow)) {
      if (id === '@enabled' || !b.slot) continue;
      for (const s of b.slot) {
        if (!s || !s.model || /NoCab|InputNone/.test(s.model)) continue;
        const pa = s.params || {};
        if (b.type === 'amp') {
          ampModels.push(s.model);
          if (pa.Level) amps.push(mean(vals(pa.Level)));
          for (const k of DRIVE) if (pa[k]) drives.push(mean(vals(pa[k])));
        }
        if (b.type === 'cab' && pa.Level) cabs.push(mean(vals(pa.Level)));
        if (/VolPanGainStereo/.test(s.model) && pa.Gain) gains.push(mean(vals(pa.Gain)));
        if (s.model === 'P35_OutputMatrix' && pa.gain) outs.push(mean(vals(pa.gain)));
      }
    }
  });
  /* mean(), not sum(): parallel legs each feed one side. */
  const total = mean(amps) + mean(cabs) + mean(gains) + (outs.length ? outs[outs.length - 1] : 0);
  rows.push({
    name: f.replace(/\.hsp$/, ''),
    amp: amps.map((x) => +x.toFixed(1)).join('/') || '-',
    cab: cabs.map((x) => +x.toFixed(1)).join('/') || '-',
    gain: +mean(gains).toFixed(1),
    out: outs.length ? +outs[outs.length - 1].toFixed(1) : 0,
    total: +total.toFixed(1),
    drive: drives.length ? +Math.max(...drives).toFixed(2) : null,
    models: [...new Set(ampModels)],
  });
}

rows.sort((a, b) => a.total - b.total);
console.log(`${rows.length} preset(s) in ${path.relative(process.cwd(), dir) || dir}\n`);
console.log(`${'preset'.padEnd(21)}${'amp Lv'.padEnd(13)}${'cab Lv'.padEnd(11)}${'gain'.padStart(5)}`
  + `${'out'.padStart(5)}${'TOTAL'.padStart(7)}${'maxDrive'.padStart(10)}  shape`);
/* Group by amp model, because the one comparison that DID find the fault is
 * between patches built on the same amp: two on Agoura_AmpUSDoubleBlack both
 * at -8 dB, 14 dB below where that model needed to be. A patch far from its
 * own siblings is worth a listen; a patch far from the set mean is not
 * evidence of anything, as the by-ear numbers in the header show. */
const byModel = new Map();
for (const r of rows) for (const m of r.models) {
  if (!byModel.has(m)) byModel.set(m, []);
  byModel.get(m).push(r.total);
}

for (const r of rows) {
  const sibling = r.models
    .map((m) => byModel.get(m).filter((_, i) => true))
    .filter((a) => a.length > 1);
  const spread = sibling.length
    ? Math.max(...sibling.flat()) - Math.min(...sibling.flat()) : 0;
  const flag = spread >= 8 ? `${spread.toFixed(0)} dB spread across this amp's patches` : '';
  console.log(`${r.name.padEnd(21)}${r.amp.padEnd(13)}${r.cab.padEnd(11)}`
    + `${String(r.gain).padStart(5)}${String(r.out).padStart(5)}${String(r.total).padStart(7)}`
    + `${String(r.drive ?? '-').padStart(10)}  ${flag}`);
}
console.log('\nTOTAL is the static trim sum (parallel legs averaged), NOT loudness:');
console.log('an amp model with a cranked preamp makes its own level and SHOULD read low here.');
