#!/usr/bin/env node
/*
 * Example Helix patches built with lib/builders.js.
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
 * Example patches, built with lib/builders.js.
 *
 * These are real patches that have been loaded and played on hardware, with
 * the names changed. The parameter values are therefore known-good rather
 * than plausible -- which matters, because an invented value can be anywhere
 * from inaudible to a device fault.
 *
 * Each one is chosen to teach a different thing. Read them in this order:

 *   single-amp.js         the basics: one amp, one cab, four snapshots, footswitches
 *   high-gain.js          a high-gain amp whose parameter names break the usual pattern
 *   stereo-dual-amp.js    two amps panned hard left and right, and the mono-block trap
 *
 * You need a corpus first -- see docs/SETUP.md. Then:
 *   node examples/build-examples.js [outDir]
 */

const fs = require('fs');
const path = require('path');

const {
  enabled, block, inputInst, inputNone, outputMatrix, outputPath2, gate, comp,
  scream808, minotaur, eqParam, chorus, simpleDelay, roomVerb, cab, ampEssex,
  ampBritPlexi, ampRevvRed, pingPong, ampJazzRivet, grayFlanger, trinityChorus, eqParamStereo, dynPlate,
  splitY, join, preset, mkFlow, emptyFlow2, write,
} = require('../lib/builders.js');

/* ================================================================== *
 * Example Single Amp -- the basics: one amp, one cab, four snapshots, footswitches
 * ================================================================== */
function plexiCrunch() {
  //            Rhythm  Push   Lead   Clean
  const minoOn = [false, true,  true,  false];
  const tsOn   = [false, false, true,  false];
  const dlyOn  = [true,  true,  true,  false];

  const blocks = [
    inputInst(0, { threshold: -62.0, decay: 0.03 }),
    minotaur(2, enabled(false, minoOn, 16843008), { gain: 0.18, tone: 0.55, level: 0.80 }),
    scream808(3, enabled(false, tsOn, 16843009), { gain: 0.0, tone: 0.62, level: 0.80 }),
    // Channel 2 jumps the Normal and Bright inputs -- the hot-rodded Plexi.
    // Snapshot 4 drops to Channel 0 (Normal only) for the cleaner sound.
    ampBritPlexi(0, 6, { block: 'b07', flow: 0 }, {
      en: enabled(true, [true, true, true, true]),
      normDrv:  0.30, normDrvSnaps:  [0.30, 0.30, 0.38, 0.20],
      brightDrv:0.48, brightDrvSnaps:[0.48, 0.48, 0.58, 0.26],
      bass:     0.32, bassSnaps:     [0.32, 0.32, 0.34, 0.40],
      mid:      0.78, midSnaps:      [0.78, 0.78, 0.82, 0.70],
      treble:   0.59, trebleSnaps:   [0.59, 0.59, 0.56, 0.54],
      presence: 0.66, presenceSnaps: [0.66, 0.66, 0.62, 0.58],
      level:   -7.0,  levelSnaps:    [-7.0, -7.0, -5.2, -6.4],
      channel:  2,    channelSnaps:  [2, 2, 2, 0],
    }),
    cab(0, 7, '4x121960AT75', { block: 'b06', flow: 0 },
      { en: enabled(true, [true, true, true, true]), distance: 3.0, highCut: 9500.0, lowCut: 90.0 }),
    simpleDelay(9, enabled(true, dlyOn, 16843010),
      { time: 0.118, fb: 0.08, mix: 0.18, mixSnaps: [0.18, 0.18, 0.22, 0.14] }),
    roomVerb(11, enabled(true, [true, true, true, true], 16843011),
      { decay: 1.6, decaySnaps: [1.6, 1.6, 2.2, 1.8], mix: 0.16,
        mixSnaps: [0.16, 0.16, 0.22, 0.18], lowCut: 250.0, highCut: 9000.0 }),
    outputMatrix(0, 13, 0.0),
  ];

  return preset({
    name: "Example Single Amp",
    info:
      "EXAMPLE: single amp, four snapshots. Marshall-voiced crunch where the amp\\n" +
      "itself is the distortion, so it cleans up from the guitar volume knob.\\n" +
      "\\n" +
      "What this example demonstrates:\\n" +
      "  - a minimal chain: input, two drives, amp, cab, delay, reverb, output\\n" +
      "  - per-snapshot values via the *Snaps options (bassSnaps, levelSnaps, ...)\\n" +
      "  - per-snapshot BYPASS via enabled(value, snapshots, footswitch)\\n" +
      "  - Channel 2 jumpers the Plexi Normal and Bright inputs; snapshot 4 drops\\n" +
      "    to Channel 0 for a cleaner sound. Channel is an INTEGER on this model\\n" +
      "    and a boolean on others -- see docs/GOTCHAS.md\\n" +
      "\\n" +
      "Snap 1 Rhythm - amp only\\n" +
      "Snap 2 Push - Minotaur boost\\n" +
      "Snap 3 Lead - Minotaur + 808, more mid, +2 dB\\n" +
      "Snap 4 Clean-ish - gain pulled back, no delay\\n" +
      "\\n" +
      "FS: Minotaur / 808 / Delay / Reverb",
    flows: [mkFlow(blocks), emptyFlow2()],
    snapNames: ['Rhythm', 'Push', 'Lead', 'Clean-ish'],
  });
}

/* ================================================================== *
 * Example High Gain -- a high-gain amp whose parameter names break the usual pattern
 * ================================================================== */
function modernMetal() {
  //           Chug   Open   Half   Wall
  const dlyOn = [false, true,  false, true];

  const blocks = [
    inputInst(0, { threshold: -54.0, decay: 0.012 }),
    gate(1, enabled(true, [true, true, true, true], 16843008), { threshold: -54.0, decay: 0.12 }),
    scream808(3, enabled(true, [true, true, true, true], 16843009),
      { gain: 0.0, tone: 0.68, level: 0.88 }),
    // Revv Ch4 red. Drive 0.35 looks absurdly low and is right for this amp --
    // the saturation lives in the preamp voicing, not the Drive knob.
    // Aggression is the extra high-gain stage; Contour scoops the mids.
    ampRevvRed(0, 6, { block: 'b07', flow: 0 }, {
      en: enabled(true, [true, true, true, true]),
      drive:     0.35, driveSnaps:      [0.35, 0.35, 0.22, 0.42],
      aggression:1,    aggressionSnaps: [1, 1, 0, 2],
      bass:      0.85, mid: 0.56,       midSnaps: [0.56, 0.56, 0.58, 0.60],
      treble:    0.80, presence: 0.88, depth: 0.50,
      master:    0.60, chLevel: 0.68,
      contour:   false, contourSnaps:   [false, false, false, true],
      level:   -10.0,  levelSnaps:      [-10.0, -10.0, -9.6, -9.4],
    }),
    cab(0, 7, '4x12CaliV30', { block: 'b06', flow: 0 },
      { en: enabled(true, [true, true, true, true]), distance: 3.0, lowCut: 95.0, highCut: 9000.0 }),
    // 3.2 kHz notch = the fizz band. Far more surgical than pulling Presence.
    eqParam(8, enabled(true, [true, true, true, true], 16843010),
      { lowCut: 95.0, highCut: 9000.0, midFreq: 3200.0, midGain: -3.0, midQ: 2.0 }),
    simpleDelay(9, enabled(false, dlyOn, 16843011),
      { time: 0.250, fb: 0.15, mix: 0.12 }),
    roomVerb(11, enabled(true, [true, true, true, true], 16843012),
      { decay: 1.2, decaySnaps: [1.2, 1.2, 1.2, 1.5], mix: 0.08,
        mixSnaps: [0.08, 0.12, 0.08, 0.14], lowCut: 400.0, highCut: 7500.0 }),
    outputMatrix(0, 13, 0.0),
  ];

  return preset({
    name: "Example High Gain",
    info:
      "EXAMPLE: modern high-gain, four snapshots.\\n" +
      "\\n" +
      "What this example demonstrates:\\n" +
      "  - an amp model whose parameter NAMES do not follow the others. This one\\n" +
      "    spells impedance XPrePost where its sibling channel uses ZPrePost, and\\n" +
      "    its channel volume is \"Ch Level\" -- with a space. Aggression is a\\n" +
      "    switch position (0/1/2), not a 0-1 knob, so writing 0.5 there is a bug\\n" +
      "    the range checker will catch\\n" +
      "  - a tight noise gate in front of a lot of gain\\n" +
      "  - why you copy a parameter set from a real export instead of assuming it",
    flows: [mkFlow(blocks), emptyFlow2()],
    snapNames: ['Chug', 'Open riff', 'Half-gain', 'Wall'],
  });
}

/* ================================================================== *
 * Example Stereo Dual Amp -- two amps panned hard left and right, and the mono-block trap
 * ================================================================== */
function heaven() {
  //              Intro  Verse  Chorus Riff   Outro
  const allOn   = [true, true, true, true, true];

  const f0 = mkFlow([
    inputInst(0, { threshold: -64.0, decay: 0.06 }),

    // Lighter than before: heavy compression into a bright amp reads as harsh,
    // and its make-up gain was pushing the AC30 into breakup.
    comp(2, enabled(true, allOn, 16843008), { peak: 0.42, gain: 0.46, mix: 0.70 }),

    // MONO -- hence pre-split. Regen down from 0.62: high regeneration builds
    // resonant metallic peaks that read as sharpness rather than movement.
    grayFlanger(3, enabled(true, allOn, 16843009), {
      manual: 0.29, rate: 0.22, regen: 0.36, width: 0.66,
      mix: 0.38, mixSnaps: [0.42, 0.26, 0.34, 0.44, 0.46],
    }),

    splitY(5, 'b20', 'b09', { en: enabled(true, allOn) }),

    // LEFT -- JC-120. `Bright` is now OFF: on the brightest clean amp in the
    // set that switch was the worst single offender. Mid up, Treble and
    // Presence down -- a scooped mid makes the top end relatively louder,
    // which is a large part of why this read as harsh.
    ampJazzRivet(0, 6, { block: 'b08', flow: 0 }, {
      en: enabled(true, allOn),
      drive:  0.20, driveSnaps: [0.20, 0.18, 0.22, 0.20, 0.24],
      bass:   0.54, mid: 0.46, treble: 0.56, presence: 0.34, bright: 0,
      chVol:  0.84, chVolSnaps: [0.84, 0.80, 0.88, 0.84, 0.90],
    }),
    cab(0, 8, '2x12JazzRivet', { block: 'b06', flow: 0 },
      { en: enabled(true, allOn), distance: 1.0, lowCut: 80.0, highCut: 6500.0 }),

    // RIGHT -- AC30. This side was doing all of the breaking up (the JC-120
    // physically cannot), so both channel volumes come down a long way and
    // `Level` comes up to keep the balance. Remember `HighCut` works BACKWARDS
    // on this model: raising it removes more top end.
    ampEssex(1, 6, { block: 'b22', flow: 0 }, {
      en: enabled(true, allOn),
      nrmDrv:  0.30, nrmDrvSnaps: [0.30, 0.27, 0.34, 0.30, 0.37],
      brtDrv:  0.32, brtDrvSnaps: [0.32, 0.29, 0.36, 0.32, 0.39],
      bass:    0.46, treble: 0.60, highCut: 0.15, hype: 0.04,
      level: -10.2,  levelSnaps:  [-10.2, -10.6, -9.6, -10.2, -9.2],
      channel: 1,
    }),
    cab(1, 8, '2x12BlueBell', { block: 'b20', flow: 0 },
      { en: enabled(true, allOn), distance: 1.25, lowCut: 85.0, highCut: 6300.0 }),

    // Hard left/right. This is the width.
    join(0, 9, 'b22', 'b05', { en: enabled(true, allOn), aPan: 0.0, bPan: 1.0, level: 0.0 }),
    outputPath2('A', 0, 13, enabled(true, allOn)),
  ]);

  // Everything after the join is STEREO. Keep it that way -- one mono block
  // here would collapse the whole image.
  const f1 = mkFlow([
    inputNone(0, 0, 'b13'),
    trinityChorus(6, enabled(true, allOn, 16843010), {
      rate: 0.28, center: 0.52, left: 0.79, right: 0.85,
      mix: 0.42, mixSnaps: [0.46, 0.38, 0.44, 0.42, 0.50],
    }),
    pingPong(9, enabled(true, allOn, 16843011), {
      time: 0.400, fb: 0.28, highCut: 4600.0, lowCut: 220.0,
      mix: 0.26, mixSnaps: [0.28, 0.22, 0.26, 0.34, 0.32],
    }),
    // A bright reverb tail sizzles, and at these mix levels the tail is a big
    // part of what you hear. High Cut way down, Damping down to pull the top
    // out of the decay as well as the initial sound.
    dynPlate(11, enabled(true, allOn, 16843012), {
      bassBoost: 1.0, damping: 4200.0, lowCut: 220.0, highCut: 6800.0, preDelay: 0.02,
      // Long everywhere but the riff -- see the note at the top.
      decay: 3.2, decaySnaps: [3.6, 2.8, 4.0, 2.2, 4.4],
      mix:   0.38, mixSnaps:   [0.42, 0.34, 0.46, 0.30, 0.50],
    }),

    // ONE place to adjust overall brightness, last in the chain so it catches
    // the delay and reverb tails too, not just the amps. Stereo on purpose --
    // the mono parametric EQ here would collapse the whole image.
    //   HighShelfGain  = broad "less top" control
    //   MidGain @ 3 kHz = the narrow band that actually sounds harsh
    // If it is still sharp, make HighShelfGain more negative first.
    eqParamStereo(12, enabled(true, allOn, 16843014), {
      highCut: 7500.0, lowCut: 85.0,
      shelfFreq: 4000.0, shelfGain: -3.5,
      midFreq: 3000.0, midGain: -2.5, midQ: 1.1,
    }),

    outputMatrix(0, 13, 0.0),
  ]);

  return preset({
    name: "Example Stereo Dual Amp",
    info:
      "EXAMPLE: two amps in stereo, five snapshots. Wide chorused clean.\\n" +
      "\\n" +
      "What this example demonstrates:\\n" +
      "  - splitY + a Join with A Pan 0 / B Pan 1 gives hard left/right stereo\\n" +
      "  - two different amps, one per side, each with its own cab\\n" +
      "  - THE MONO TRAP: the flanger is a MONO block and sits BEFORE the split\\n" +
      "    deliberately. Moved after the join it would sum both amps and destroy\\n" +
      "    the stereo image. This is the single most common way to build a patch\\n" +
      "    that looks stereo and is not -- see docs/PATCH-DESIGN.md\\n" +
      "  - gain staging that is NOT interchangeable between models: the two amps\\n" +
      "    sit about 10 dB apart to balance, because Level means different things\\n" +
      "    on different models\\n" +
      "\\n" +
      "Mono note: two different amps panned hard will partially comb-filter when\\n" +
      "summed to mono. If a mono PA thins it out, pull the Join pans in from 0/10\\n" +
      "toward 3/7.",
    flows: [f0, f1],
    snapNames: ['Intro', 'Verse', 'Chorus', 'Riff', 'Outro'],
    cursor: { flow: 0, path: 0, position: 6 },
  });
}

const outDir = process.argv[2] || path.join(__dirname, "..", "out");
fs.mkdirSync(outDir, { recursive: true });

for (const make of [plexiCrunch, modernMetal, heaven]) {
  const p = make();
  const f = write(outDir, p);
  console.log(`${path.basename(f)}  ${fs.statSync(f).size} bytes`);
}
