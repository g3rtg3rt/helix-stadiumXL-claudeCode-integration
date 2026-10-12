/*
 * Helix .hsp preset builders: block and amp primitives.
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
 * Helix Stadium XL preset builders -- the block and amp primitives.
 *
 * Every parameter set here was copied verbatim from real device exports, not
 * guessed. Models differ in which parameters they have AND in what those are
 * called, so a builder exists per amp rather than one generic amp() call.
 * See docs/GOTCHAS.md before adding one.
 *
 * Require this; do not run it. Example patches live in examples/.
 */

/*
 * Helix Stadium XL preset generator (.hsp)
 *
 * Container format, confirmed by byte-inspecting four exports
 * (2 factory + 2 user) from device_id 2490368 / device_version 318899516:
 *
 *   [8 ASCII bytes "rpshnosj"] + JSON.stringify(preset, sortedKeys, 2)
 *   LF line endings, UTF-8, no BOM, no trailing newline, no checksum.
 *
 * Everything below uses ONLY model ids and parameter sets observed in those
 * files. No model id is invented -- an unknown id imports as a silently
 * dropped block, not an error.
 *
 */

const fs = require('fs');
const path = require('path');

const { stringify } = require("./device-json.js");
const corpus = require("./corpus.js");

const MAGIC = "rpshnosj";
/* The number formatting is learned from YOUR corpus, lazily on first write.
 * See lib/corpus.js -- that file explains why this matters and why getting it
 * wrong faults the device. Keep presets this toolkit generated OUT of the
 * corpus: the learner would read your own mistakes back as ground truth. */
const DEVICE_ID = 2490368;
const DEVICE_VERSION = 318899516;
const SNAP_MAX = 8;

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

// Block id from path/position. Verified against all three samples:
// path1 pos6 -> b20, path1 pos13 -> b27, path1 pos0 -> b14.
const bid = (p, pos) => 'b' + String(p * 14 + pos).padStart(2, '0');

// Pad a snapshot array to 8 with nulls (null == snapshot slot not valid).
const snap = (vals) => vals.concat(Array(SNAP_MAX - vals.length).fill(null));

// Value, optionally with per-snapshot overrides.
const v = (value, snaps) =>
  snaps ? { snapshots: snap(snaps), value } : { value };

// Bypass state for a block: @enabled. `fs` assigns a footswitch source.
function enabled(value, snaps, fs) {
  const o = {};
  if (fs !== undefined) {
    o.controller = {
      behavior: 'latching',
      bypassed: false,
      curve: 'linear',
      delay: 0,
      goid: 0,
      max: true,
      midisource: 0,
      min: false,
      source: fs,
      threshold: 0.0,
      type: 'targetbypass',
    };
  }
  if (snaps) o.snapshots = snap(snaps);
  o.value = value;
  return o;
}

const HARNESS_FX = { '@enabled': { value: true }, params: { EvtIdx: v(-1), bypass: v(false), upper: v(true) } };
const HARNESS_FX_TRAILS = { '@enabled': { value: true }, params: { EvtIdx: v(-1), Trails: v(false), bypass: v(false), upper: v(true) } };
const HARNESS_FX_CS = { '@enabled': { value: true }, params: { ControlSource: v(0), EvtIdx: v(-1), bypass: v(false), upper: v(true) } };
const HARNESS_CAB = { '@enabled': { value: true }, params: { EvtIdx: v(-1), bypass: v(false), dual: v(true), upper: v(true) } };
const HARNESS_IO = { '@enabled': { value: true } };
const HARNESS_ROUTE = { '@enabled': { value: true }, params: { bypass: v(false) } };

// Generic block builder.
function block({ p = 0, pos, type, model, params, en, harness, linked, branch, endpoint }) {
  const b = { '@enabled': en || { value: true } };
  if (branch) b.branch = branch;
  if (endpoint) b.endpoint = endpoint;
  b.favorite = 0;
  b.harness = harness || HARNESS_FX;
  if (linked) b.linkedblock = linked;
  b.path = p;
  b.position = pos;
  b.slot = Array.isArray(model)
    ? model
    : [{ '@enabled': { value: true }, model, params, version: 0 }];
  b.type = type;
  return b;
}

/* ------------------------------------------------------------------ *
 * blocks -- every param set copied verbatim from an observed export
 * ------------------------------------------------------------------ */

const inputInst = (pos = 0, { gate = true, threshold = -60.0, decay = 0.05 } = {}) =>
  block({ pos, type: 'input', endpoint: 'b13', harness: HARNESS_IO,
    model: 'P35_InputInst1',
    params: { Pad: v(1), Trim: v(0.0), decay: v(decay), noiseGate: v(gate), threshold: v(threshold) } });

const inputNone = (p = 0, pos = 0, endpoint = 'b13') =>
  block({ p, pos, type: 'input', endpoint, harness: HARNESS_IO,
    model: 'P35_InputNone',
    params: { Trim: v(0.0), decay: v(0.1), noiseGate: v(false), threshold: v(-48.0) } });

const outputMatrix = (p = 0, pos = 13, gain = 0.0, en) =>
  block({ p, pos, type: 'output', endpoint: 'b00', harness: HARNESS_IO, en,
    model: 'P35_OutputMatrix', params: { gain: v(gain), pan: v(0.5) } });

const outputPath2 = (which, p, pos, en) =>
  block({ p, pos, type: 'output', endpoint: 'b00', harness: HARNESS_IO, en,
    model: which === 'A' ? 'P35_OutputPath2A' : 'P35_OutputPath2B',
    params: { gain: v(0.0), pan: v(0.5) } });

// Volume pedal on EXP 2 -- copied verbatim from the factory Rock Rig.
const volPedal = (pos, en) =>
  block({ pos, type: 'fx', en, model: 'HD2_VolPanVolMono',
    params: {
      Pedal: { controller: { behavior: 'continuous', bypassed: true, curve: 'linear', delay: 0,
        goid: 0, max: 1.0, midisource: 0, min: 0.0, source: 16908545, threshold: 0.0, type: 'param' },
        value: 1.0 },
      VolumeTaper: v(false),
    } });

const gate = (pos, en, { threshold = -59.6, decay = 0.33 } = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_CS, model: 'HX2_GateNoiseGateMono',
    params: { Decay: v(decay), Level: v(0.0), Threshold: v(threshold) } });

const comp = (pos, en, { peak = 0.70, gain = 0.61, mix = 0.70, emphasis = 0.30 } = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_CS, model: 'HX2_CompressorLAStudioCompMono',
    params: { Emphasis: v(emphasis), Gain: v(gain), Level: v(0.0), Mix: v(mix),
      PeakReduction: v(peak), Type: v(false) } });

const scream808 = (pos, en, { gain = 0.0, tone = 0.65, level = 0.85 } = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_DistScream808Mono',
    params: { Gain: v(gain), Level: v(level), Tone: v(tone) } });

const minotaur = (pos, en, { gain = 0.22, tone = 0.45, level = 0.75 } = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_DistMinotaurMono',
    params: { Gain: v(gain), Level: v(level), Tone: v(tone) } });

const eqParam = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HX2_EQParametricMono',
    params: {
      HighCut: v(o.highCut ?? 20000.0), HighCutEnable: v(true), HighCutSlope: v(1),
      HighEnable: v(true), HighFreq: v(o.highFreq ?? 5500.0),
      HighGain: v(o.highGain ?? 0.0), HighQ: v(0.707),
      HighShelfEnable: v(true), HighShelfFreq: v(o.shelfFreq ?? 9000.0),
      HighShelfGain: v(o.shelfGain ?? 0.0),
      Level: v(o.level ?? 0.0),
      LowCut: v(o.lowCut ?? 20.0), LowCutEnable: v(true), LowCutSlope: v(1),
      LowEnable: v(true), LowFreq: v(o.lowFreq ?? 150.0),
      LowGain: v(o.lowGain ?? 0.0), LowQ: v(0.707),
      LowShelfEnable: v(true), LowShelfFreq: v(80.0), LowShelfGain: v(0.0),
      MidEnable: v(true), MidFreq: v(o.midFreq ?? 900.0),
      MidGain: v(o.midGain ?? 0.0, o.midGainSnaps), MidQ: v(o.midQ ?? 0.707),
    } });

const chorus = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_ChorusStereo',
    params: { Depth: v(o.depth ?? 0.45), Level: v(0.7), Mix: v(o.mix ?? 0.30, o.mixSnaps),
      Predelay: v(0.25), Speed: v(o.speed ?? 0.19), Spread: v(1.0),
      SyncSelect1: v(5), TempoSync1: v(false), Tone: v(0.44), WaveShape: v(2) } });

const simpleDelay = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'HD2_DelaySimpleDelayStereo',
    params: { Feedback: v(o.fb ?? 0.20, o.fbSnaps), Level: v(0.0),
      Mix: v(o.mix ?? 0.20, o.mixSnaps), Scale: v(1.0),
      SyncSelect1: v(6), TempoSync1: v(false), Time: v(o.time ?? 0.120, o.timeSnaps) } });

const tapeDelay = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'HD2_DelayTransistorTapeStereo',
    params: { DryThru: v(false), Feedback: v(o.fb ?? 0.20, o.fbSnaps), Headroom: v(-3.0),
      Level: v(0.0), Mix: v(o.mix ?? 0.20, o.mixSnaps), Scale: v(0.8), Spread: v(1.0),
      SyncSelect1: v(8), TempoSync1: v(false),
      Time: v(o.time ?? 0.141, o.timeSnaps), WowFlutter: v(o.wow ?? 0.25) } });

// Simple two-knob compressor. Used on the lead patch for sustain.
const dm4Comp = (pos, en, { thresh = 0.61 } = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_CS, model: 'HX2_DM4TubeComp',
    params: { Level: v(0.0), Thresh: v(thresh) } });

// Polyphonic downtune. Interval is in semitones.
const polyDowntune = (pos, en, { interval = -2, autoEQ = 0.70, tracking = 3 } = {}) =>
  block({ pos, type: 'fx', en, model: 'L6SPB_PolyDowntune',
    params: { AutoEQ: v(autoEQ), Interval: v(interval), Level: v(0.0),
      Mix: v(1.0), Tracking: v(tracking) } });

const rotatingVerb = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'VIC_ReverbRotatingStereo',
    params: { BassBoost: v(0.0), BassFreq: v(100.0), Damping: v(o.damping ?? 5900.0),
      Decay: v(o.decay ?? 3.0, o.decaySnaps), Diffusion: v(o.diffusion ?? 0.10),
      HighCut: v(o.highCut ?? 12000.0), Level: v(0.0), LowCut: v(o.lowCut ?? 400.0),
      Mix: v(o.mix ?? 0.22, o.mixSnaps), Motion: v(o.motion ?? 0.27),
      Predelay: v(o.preDelay ?? 0.10, o.preDelaySnaps), RoomSize: v(o.roomSize ?? 0) } });

const roomVerb = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'VIC_ReverbDynRoomStereo',
    params: { BassBoost: v(0.0), BassFreq: v(100.0), Damping: v(o.damping ?? 3720.0),
      Decay: v(o.decay ?? 1.3, o.decaySnaps), Diffusion: v(o.diffusion ?? 0.5),
      ERLevel: v(0.8), HighCut: v(o.highCut ?? 8000.0), Level: v(0.0),
      LowCut: v(o.lowCut ?? 250.0), MatrFreq: v(0.333),
      Mix: v(o.mix ?? 0.20, o.mixSnaps), PreDelay: v(o.preDelay ?? 0.02) } });

/* ---- cabs. Mic indices reused from the export that shipped that cab ---- */
const CAB_DEFAULTS = {
  '4x12SoloLeadEM':  { mic: 3,  distance: 3.0, lowCut: 90.0,  highCut: 9000.0, position: 0.03 },
  '2x12SilverBell':  { mic: 11, distance: 1.25, lowCut: 90.0, highCut: 5000.0, position: 0.55 },
  '1x12USDeluxe':    { mic: 6,  distance: 3.5, lowCut: 90.0,  highCut: 6500.0, position: 0.30 },
  '4x121960AT75':    { mic: 11, distance: 3.0, lowCut: 90.0,  highCut: 9500.0, position: 0.05 },
  '1x12OpenCream':   { mic: 0,  distance: 1.0, lowCut: 79.0,  highCut: 9100.0, position: 0.30 },
  '2x12MatchH30':    { mic: 9,  distance: 1.0, lowCut: 60.0,  highCut: 8900.0, position: 0.35 },
  '4x12Greenback25': { mic: 0,  distance: 1.0, lowCut: 19.9, highCut: 8200.0, position: 0.30, level: 6.0 },
  '4x12Greenback30': { mic: 11, distance: 2.0, lowCut: 90.0,  highCut: 9000.0, position: 0.40, level: 2.0 },
  '2x12JazzRivet':   { mic: 9,  distance: 1.0, lowCut: 19.9, highCut: 20100.0, position: 0.23 },
  '2x12BlueBell':    { mic: 3,  distance: 1.25, lowCut: 90.0, highCut: 7000.0, position: 0.28, level: -5.0 },
  '2x12DoubleC12N':  { mic: 5,  distance: 2.0, lowCut: 80.0,  highCut: 5500.0, position: 0.30 },
  // From "Modern Metal D" -- note this one carries +6 dB of cab Level, which
  // pairs with the Panama sitting at roughly -6 dB. Keep the pair together.
  '4x12CaliV30':     { mic: 10, distance: 1.0, lowCut: 65.0,  highCut: 10000.0, position: 0.04, level: 6.0 },
};

function cab(p, pos, name, linked, o = {}) {
  const d = { ...CAB_DEFAULTS[name], ...o };
  return block({ p, pos, type: 'cab', harness: HARNESS_CAB, linked,
    en: o.en, model: [
      { '@enabled': { value: true }, model: `HD2_CabMicIr_${name}WithPan`, version: 0,
        params: { Angle: v(0.0), Delay: v(0.0), Distance: v(d.distance), HighCut: v(d.highCut),
          IrData: v(0), Level: v(d.level ?? 0.0), LowCut: v(d.lowCut), Mic: v(d.mic),
          Pan: v(0.5), Position: v(d.position) } },
      { '@enabled': { value: true }, model: 'HD2_CabMicIr_NoCab', params: null, version: 0 },
    ] });
}

/* ---- amps. Param sets are model-specific; each is copied verbatim. ---- */
const AMP_CAB_EQ = {
  AmpCabPeak2Fc: v(1000.0), AmpCabPeak2G: v(0.0), AmpCabPeak2Q: v(0.707),
  AmpCabPeakFc: v(100.0), AmpCabPeakG: v(0.0), AmpCabPeakQ: v(0.707),
  AmpCabShelfF: v(1000.0), AmpCabShelfG: v(0.0),
  AmpCabZFir: v(0), AmpCabZUpdate: v(0),
};

// Agoura_AmpSolid100 -- the factory "Stadium Rock Rig" amp. Marshall-voiced.
const ampSolid100 = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpSolid100',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.45, o.bassSnaps),
      Channel: v(o.channel ?? true, o.channelSnaps),
      Drive: v(o.drive ?? 0.70, o.driveSnaps),
      Hype: v(o.hype ?? 0.0),
      Level: v(o.level ?? -2.0, o.levelSnaps),
      Master: v(o.master ?? 0.35, o.masterSnaps),
      Mid: v(o.mid ?? 0.60, o.midSnaps),
      NrmBright: v(o.nrmBright ?? true, o.nrmBrightSnaps),
      NrmMode: v(o.nrmMode ?? true, o.nrmModeSnaps),
      Presence: v(o.presence ?? 0.50, o.presenceSnaps),
      Ripple: v(o.ripple ?? 0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.62, o.trebleSnaps),
      ZPrePost: v(0.30) } });

// Agoura_AmpEssexTB30CC -- AC30 Top Boost. No Mid, no Presence; two channel
// volumes (NrmDrv/BrtDrv); HighCut is normalised 0-1, not Hz; Master fixed 1.0.
const ampEssex = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpEssexTB30CC',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.50, o.bassSnaps),
      BrtDrv: v(o.brtDrv ?? 0.50, o.brtDrvSnaps),
      Channel: v(o.channel ?? 1, o.channelSnaps),
      HighCut: v(o.highCut ?? 0.05, o.highCutSnaps),
      Hype: v(o.hype ?? 0.10, o.hypeSnaps),
      Level: v(o.level ?? -11.5, o.levelSnaps),
      Master: v(1.0),
      NrmDrv: v(o.nrmDrv ?? 0.50, o.nrmDrvSnaps),
      Ripple: v(0.0), Sag: v(0.0),
      Treble: v(o.treble ?? 0.76, o.trebleSnaps),
      ZPrePost: v(1.0) } });

// Agoura_AmpUSLuxeBlack -- blackface Deluxe. No Mid (correct for the circuit).
const ampUSLuxe = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpUSLuxeBlack',
    params: { ...AMP_CAB_EQ, AmpCabShelfF: v(3000.0), AmpCabShelfG: v(12.0),
      Bass: v(o.bass ?? 0.42, o.bassSnaps),
      Channel: v(o.channel ?? 0, o.channelSnaps),
      Drive: v(o.drive ?? 0.35, o.driveSnaps),
      Hype: v(o.hype ?? 0.0),
      Level: v(o.level ?? 0.0, o.levelSnaps),
      Master: v(1.0),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.58, o.trebleSnaps),
      VibBass: v(0.75), VibTreb: v(0.30), VibratoVolume: v(0.45),
      ZPrePost: v(0.30) } });

// Agoura_AmpEVPanamaRed -- the high-gain amp, from "Modern Metal D".
// No Channel param (this model IS the red channel). Runs a low Master (~0.21)
// and about -6 dB of Level, paired with +6 dB on the Cali V30 cab.
const ampPanama = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpEVPanamaRed',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.54, o.bassSnaps),
      Drive: v(o.drive ?? 0.55, o.driveSnaps),
      Hype: v(o.hype ?? 0.0),
      Level: v(o.level ?? -6.2, o.levelSnaps),
      Master: v(o.master ?? 0.21, o.masterSnaps),
      Mid: v(o.mid ?? 0.45, o.midSnaps),
      Presence: v(o.presence ?? 0.85, o.presenceSnaps),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.60, o.trebleSnaps),
      ZPrePost: v(0.30) } });

// Agoura_AmpBritPlexi -- a real Plexi. Two channel volumes; Channel 2 jumps
// them, which is the classic hot-rodded sound. Master stays at 1.0.
const ampBritPlexi = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpBritPlexi',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.32, o.bassSnaps),
      BrightDrv: v(o.brightDrv ?? 0.48, o.brightDrvSnaps),
      Channel: v(o.channel ?? 2, o.channelSnaps),
      Hype: v(o.hype ?? 0.0),
      Level: v(o.level ?? -7.0, o.levelSnaps),
      Master: v(1.0),
      Mid: v(o.mid ?? 0.78, o.midSnaps),
      NormDrv: v(o.normDrv ?? 0.30, o.normDrvSnaps),
      Presence: v(o.presence ?? 0.66, o.presenceSnaps),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.59, o.trebleSnaps),
      ZPrePost: v(0.30) } });

// Agoura_AmpRevvCh4Red -- the high-gain channel. Note the impedance param is
// spelled XPrePost on this model, and "Ch Level" carries a space.
// Voicing switches: Bright / Contour / Fat are booleans.
const ampRevvRed = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpRevvCh4Red',
    params: { ...AMP_CAB_EQ,
      // Switch position (0/1/2), NOT a 0-1 knob.
      Aggression: v(o.aggression ?? 0, o.aggressionSnaps),
      Bass: v(o.bass ?? 0.85, o.bassSnaps),
      Bright: v(o.bright ?? false),
      'Ch Level': v(o.chLevel ?? 0.68, o.chLevelSnaps),
      Contour: v(o.contour ?? false, o.contourSnaps),
      Depth: v(o.depth ?? 0.50, o.depthSnaps),
      Drive: v(o.drive ?? 0.35, o.driveSnaps),
      Fat: v(o.fat ?? false),
      Hype: v(o.hype ?? 0.0),
      Level: v(o.level ?? -10.0, o.levelSnaps),
      Master: v(o.master ?? 0.60, o.masterSnaps),
      Mid: v(o.mid ?? 0.56, o.midSnaps),
      Presence: v(o.presence ?? 0.88, o.presenceSnaps),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.80, o.trebleSnaps),
      XPrePost: v(0.31) } });

// Agoura_AmpUSPrincess76 -- small warm combo that breaks up early.
// Note: treble is `Treb`, not `Treble`, and there is no Mid or Presence at all.
const ampPrincess = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpUSPrincess76',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.32, o.bassSnaps),
      Drive: v(o.drive ?? 0.46, o.driveSnaps),
      Hype: v(o.hype ?? 0.0),
      Level: v(o.level ?? -9.5, o.levelSnaps),
      Master: v(1.0),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treb: v(o.treb ?? 0.66, o.trebSnaps),
      ZPrePost: v(0.30) } });

const deluxeComp = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_CS, model: 'HX2_CompressorDeluxeCompMono',
    params: { Attack: v(o.attack ?? 0.038), Knee: v(o.knee ?? 6), Level: v(o.level ?? 6.0),
      Mix: v(o.mix ?? 1.0), Ratio: v(o.ratio ?? 3), Release: v(o.release ?? 0.20),
      Threshold: v(o.threshold ?? -37.0, o.thresholdSnaps) } });

// `Spring Count` carries a space in the key.
const springVerb = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'HD2_ReverbHxSpringStereo',
    params: { Drip: v(o.drip ?? 1.0), Dwell: v(o.dwell ?? 0.62),
      HighCut: v(o.highCut ?? 3900.0), Level: v(0.0), LowCut: v(o.lowCut ?? 186.0),
      Mix: v(o.mix ?? 0.22, o.mixSnaps), 'Spring Count': v(o.springs ?? 1.8) } });

const biasTrem = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_Tremolo60sBiasTremMono',
    params: { Intensity: v(o.intensity ?? 0.55, o.intensitySnaps), Level: v(o.level ?? 3.0),
      Mode: v(false), Speed: v(o.speed ?? 0.34, o.speedSnaps),
      SyncSelect1: v(6), TempoSync1: v(false) } });

// Agoura_AmpMatchstick30 -- Matchless-voiced chime. Two channel drives; its
// `HighCut` is normalised 0-1, and `Ripple` may legitimately go negative.
const ampMatchstick = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpMatchstick30',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.38, o.bassSnaps),
      Ch1Drv: v(o.ch1 ?? 0.43, o.ch1Snaps),
      Ch2Drv: v(o.ch2 ?? 0.44, o.ch2Snaps),
      Ch2Tone: v(o.ch2Tone ?? 3),
      Channel: v(o.channel ?? 0, o.channelSnaps),
      HighCut: v(o.highCut ?? 0.32, o.highCutSnaps),
      Hype: v(o.hype ?? 0.27),
      Level: v(o.level ?? -7.0, o.levelSnaps),
      Master: v(1.0),
      Ripple: v(o.ripple ?? -0.24), Sag: v(o.sag ?? 0.64),
      Treble: v(o.treble ?? 0.68, o.trebleSnaps),
      ZPrePost: v(1.0) } });

// Agoura_AmpRevvCh3Purple -- the mid-gain purple channel. NOTE: unlike its
// Ch4Red sibling this one spells the impedance param ZPrePost, not XPrePost.
const ampRevvPurple = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpRevvCh3Purple',
    params: { ...AMP_CAB_EQ,
      Aggression: v(o.aggression ?? 0, o.aggressionSnaps),
      Bass: v(o.bass ?? 0.36, o.bassSnaps),
      Bright: v(o.bright ?? false),
      'Ch Level': v(o.chLevel ?? 0.47, o.chLevelSnaps),
      Contour: v(o.contour ?? false, o.contourSnaps),
      Depth: v(o.depth ?? 0.20),
      Drive: v(o.drive ?? 0.58, o.driveSnaps),
      Fat: v(o.fat ?? true),
      Hype: v(0.0),
      Level: v(o.level ?? -2.5, o.levelSnaps),
      Master: v(o.master ?? 0.50),
      Mid: v(o.mid ?? 0.56, o.midSnaps),
      Presence: v(o.presence ?? 0.56, o.presenceSnaps),
      Ripple: v(0.0), Sag: v(0.0),
      Treble: v(o.treble ?? 0.64, o.trebleSnaps),
      ZPrePost: v(0.31) } });

const simplePitch = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_PitchSimplePitchMono',
    params: { Cents1: v(0), Interval1: v(o.interval ?? 12), Level: v(o.level ?? 0.0),
      LevelVoice1: v(o.voice ?? 1.0), Mix: v(o.mix ?? 0.30, o.mixSnaps), Time1: v(0) } });

const pingPong = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'HD2_DelayPingPongStereo',
    params: { Feedback: v(o.fb ?? 0.30, o.fbSnaps), HighCut: v(o.highCut ?? 5000.0),
      Level: v(0.0), LowCut: v(o.lowCut ?? 220.0), Mix: v(o.mix ?? 0.26, o.mixSnaps),
      Scale: v(0.5), Spread: v(1.0), SyncSelect1: v(6), TempoSync1: v(false),
      Time: v(o.time ?? 0.420, o.timeSnaps) } });

const reverseDelay = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'HD2_DelayReverseDelayStereo',
    params: { Depth: v(0.5), Feedback: v(o.fb ?? 0.30, o.fbSnaps),
      HighCut: v(o.highCut ?? 3500.0), Level: v(0.0), LowCut: v(o.lowCut ?? 300.0),
      Mix: v(o.mix ?? 0.30, o.mixSnaps), ModulationMode: v(0), Speed: v(0.30),
      Spread: v(1.0), SyncSelect1: v(6), TempoSync1: v(false), Time: v(o.time ?? 0.60) } });

const ganymede = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'HD2_ReverbGanymedeStereo',
    params: { Decay: v(o.decay ?? 0.45, o.decaySnaps), Level: v(0.0),
      Mix: v(o.mix ?? 0.26, o.mixSnaps), Modulation: v(o.mod ?? 0.55),
      Predelay: v(o.preDelay ?? 0.086), Tone: v(o.tone ?? 0.40) } });

// HD2_AmpCaliIVR1 -- Mesa Mark IV, Rhythm 1. Carries the Mark's own 5-band
// graphic EQ, which is where the scooped "V" curve lives. No AmpCab* block and
// no Level: `ChVol` is the volume, `Master` is the power amp.
const ampCaliIV = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'HD2_AmpCaliIVR1',
    params: {
      '80Hz': v(o.eq80 ?? 0.0, o.eq80Snaps),
      '240Hz': v(o.eq240 ?? 0.0, o.eq240Snaps),
      '750Hz': v(o.eq750 ?? 0.0, o.eq750Snaps),
      '2200Hz': v(o.eq2200 ?? 0.0, o.eq2200Snaps),
      '6600Hz': v(o.eq6600 ?? 0.0, o.eq6600Snaps),
      Bass: v(o.bass ?? 0.52, o.bassSnaps),
      Bias: v(0.5), BiasX: v(0.5),
      ChVol: v(o.chVol ?? 0.72, o.chVolSnaps),
      Drive: v(o.drive ?? 0.62, o.driveSnaps),
      Master: v(o.master ?? 0.60, o.masterSnaps),
      Mid: v(o.mid ?? 0.40, o.midSnaps),
      Presence: v(o.presence ?? 0.68, o.presenceSnaps),
      Ripple: v(0.5), Sag: v(o.sag ?? 0.35),
      Treble: v(o.treble ?? 0.72, o.trebleSnaps),
    } });

// Agoura_AmpBrit2203MV -- JCM800. Has a `Jack` switch and runs Master wide
// open with Level doing the work; note its Level is POSITIVE, unlike most.
const ampBrit2203 = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpBrit2203MV',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.62, o.bassSnaps),
      Drive: v(o.drive ?? 0.58, o.driveSnaps),
      Hype: v(0.0), Jack: v(o.jack ?? 0),
      Level: v(o.level ?? 1.5, o.levelSnaps),
      Master: v(1.0),
      Mid: v(o.mid ?? 0.52, o.midSnaps),
      Presence: v(o.presence ?? 0.52, o.presenceSnaps),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.60, o.trebleSnaps),
      ZPrePost: v(0.30) } });

// Agoura_AmpUSDoubleBlack -- blackface Twin. Loud, bright, plenty of clean
// headroom. Master is `MasterVol`, not `Master`, and `Bright`/`VibBright` are
// integer switches rather than booleans.
const ampUSDouble = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'Agoura_AmpUSDoubleBlack',
    params: { ...AMP_CAB_EQ,
      Bass: v(o.bass ?? 0.48, o.bassSnaps),
      Bright: v(o.bright ?? 1),
      Channel: v(o.channel ?? 0),
      Drive: v(o.drive ?? 0.45, o.driveSnaps),
      Hype: v(o.hype ?? 0.20),
      Level: v(o.level ?? -9.5, o.levelSnaps),
      MasterVol: v(1.0),
      Mid: v(o.mid ?? 0.58, o.midSnaps),
      Ripple: v(0.0), Sag: v(o.sag ?? 0.0),
      Treble: v(o.treble ?? 0.52, o.trebleSnaps),
      VibBass: v(0.71), VibBright: v(0), VibMid: v(0.80), VibTreb: v(0.42),
      VibratoVolume: v(0.32), ZPrePost: v(0.33) } });

// HD2_AmpJazzRivet120 -- the JC-120. Solid state, bright, enormous clean
// headroom: the definitive chorused-80s-clean platform. Unlike the Agoura amps
// it has NO AmpCab* block, no Level, no Sag and no Ripple -- `ChVol` is the
// volume and `Master` stays wide open. `Bright` is an integer switch.
const ampJazzRivet = (p, pos, linked, o = {}) =>
  block({ p, pos, type: 'amp', linked, en: o.en,
    model: 'HD2_AmpJazzRivet120',
    params: {
      Bass: v(o.bass ?? 0.56, o.bassSnaps),
      Bright: v(o.bright ?? 1),
      ChVol: v(o.chVol ?? 0.78, o.chVolSnaps),
      Drive: v(o.drive ?? 0.28, o.driveSnaps),
      Master: v(1.0),
      Mid: v(o.mid ?? 0.32, o.midSnaps),
      Presence: v(o.presence ?? 0.55, o.presenceSnaps),
      Treble: v(o.treble ?? 0.78, o.trebleSnaps),
    } });

// HD2_FlangerGrayFlangerMono -- MONO. It must sit BEFORE a stereo split: a
// mono block dropped into a stereo path sums the two sides together and throws
// away the width the two amps just created.
const grayFlanger = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_FlangerGrayFlangerMono',
    params: { Headroom: v(0.0), Level: v(0.0),
      Manual: v(o.manual ?? 0.29), Mix: v(o.mix ?? 0.38, o.mixSnaps),
      Rate: v(o.rate ?? 0.22, o.rateSnaps), Regen: v(o.regen ?? 0.62),
      SyncSelect1: v(6), TempoSync1: v(false), Width: v(o.width ?? 0.66) } });

// Lush wide stereo chorus -- three independent voices rather than one LFO.
const trinityChorus = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HD2_ChorusTrinityChorusStereo',
    params: { Center: v(o.center ?? 0.52), CenterBoost: v(false),
      Left: v(o.left ?? 0.79), LeftBoost: v(false), Level: v(0.0),
      Manual: v(true), Mix: v(o.mix ?? 0.42, o.mixSnaps), Mode: v(true),
      Preset: v(true), Rate: v(o.rate ?? 0.28, o.rateSnaps),
      Right: v(o.right ?? 0.85), RightBoost: v(false),
      SyncSelect1: v(6), TempoSync1: v(false) } });

// Stereo parametric EQ. The mono one would collapse a stereo image, so this is
// the only EQ that can sit after a join -- which is where a global "tame the
// top end" control belongs, since it catches reverb and delay sizzle too.
const eqParamStereo = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, model: 'HX2_EQParametricStereo',
    params: {
      HighCut: v(o.highCut ?? 11000.0), HighCutEnable: v(true), HighCutSlope: v(2),
      HighEnable: v(true), HighFreq: v(o.highFreq ?? 5000.0),
      HighGain: v(o.highGain ?? 0.0), HighQ: v(0.707),
      HighShelfEnable: v(true), HighShelfFreq: v(o.shelfFreq ?? 4000.0),
      HighShelfGain: v(o.shelfGain ?? 0.0, o.shelfGainSnaps),
      Level: v(o.level ?? 0.0),
      LowCut: v(o.lowCut ?? 90.0), LowCutEnable: v(true), LowCutSlope: v(2),
      LowEnable: v(true), LowFreq: v(o.lowFreq ?? 150.0),
      LowGain: v(o.lowGain ?? 0.0), LowQ: v(0.707),
      LowShelfEnable: v(true), LowShelfFreq: v(o.lowShelfFreq ?? 650.0),
      LowShelfGain: v(o.lowShelfGain ?? 0.0, o.lowShelfGainSnaps),
      MidEnable: v(true), MidFreq: v(o.midFreq ?? 2000.0),
      MidGain: v(o.midGain ?? 0.0, o.midGainSnaps), MidQ: v(o.midQ ?? 0.707),
    } });

const dynPlate = (pos, en, o = {}) =>
  block({ pos, type: 'fx', en, harness: HARNESS_FX_TRAILS, model: 'VIC_DynPlateStereo',
    params: { BassBoost: v(o.bassBoost ?? 1.0), BassFreq: v(o.bassFreq ?? 204.0),
      Damping: v(o.damping ?? 6000.0), Decay: v(o.decay ?? 3.2, o.decaySnaps),
      HighCut: v(o.highCut ?? 12000.0), Level: v(0.0), LowCut: v(o.lowCut ?? 220.0),
      MatrFreq: v(0.18), Mix: v(o.mix ?? 0.38, o.mixSnaps),
      PreDelay: v(o.preDelay ?? 0.02), VarDelayAmpl: v(0.58) } });

/* ---- routing ---- */
// Split Y -- an even two-way split. This is the one the device's own stereo
// presets use to drive a pair of amps; the A/B split is for crossfading.
const splitY = (pos, branch, endpoint, o = {}) =>
  block({ pos, type: 'split', branch, endpoint, harness: HARNESS_ROUTE, en: o.en,
    model: 'P35_AppDSPSplitY',
    params: { BalanceA: v(o.a ?? 0.5), BalanceB: v(o.b ?? 0.5), enable: v(true) } });

const splitAB = (pos, endpoint, o = {}) =>
  block({ pos, type: 'split', endpoint, harness: HARNESS_ROUTE, en: o.en,
    model: 'P35_AppDSPSplitAB',
    params: {
      RouteTo: {
        controller: { behavior: 'continuous', bypassed: true, curve: 'linear', delay: 0,
          goid: 0, max: 1.0, midisource: 0, min: 0.0, source: 16908544, threshold: 0.0, type: 'param' },
        ...(o.routeSnaps ? { snapshots: snap(o.routeSnaps) } : {}),
        value: o.route ?? 0.0,
      },
      enable: v(true),
    } });

const join = (p, pos, branch, endpoint, o = {}) =>
  block({ p, pos, type: 'join', branch, endpoint, harness: HARNESS_ROUTE, en: o.en,
    model: 'P35_AppDSPJoin',
    params: { 'A Level': v(o.aLevel ?? 0.0), 'A Pan': v(o.aPan ?? 0.5),
      'B Level': v(o.bLevel ?? 0.0), 'B Pan': v(o.bPan ?? 0.5),
      'B Polarity': v(false), Level: v(o.level ?? 0.0) } });

/* ------------------------------------------------------------------ *
 * preset scaffolding
 * ------------------------------------------------------------------ */

// Footswitch + expression sources.
// Round-trip testing showed the device drops `bypass` from any switch entry
// that nothing is actually assigned to, so only emit it for switches in use.
function sources({ pedals = false, used = new Set() } = {}) {
  const s = {};
  for (let i = 0; i <= 11; i++) {
    const id = 16843008 + i;
    s[id] = used.has(id)
      ? { bypass: true, fs_color: 'auto', fs_label: '', fs_topidx: 0 }
      : { fs_color: 'auto', fs_label: '', fs_topidx: 0 };
  }
  for (let i = 0; i <= 11; i++) {
    s[16843264 + i] = { fs_color: 'auto', fs_label: '', fs_topidx: 0 };
  }
  if (pedals) {
    s[16844032] = { bypass: false };
    s[16908544] = { bypass: false };
    s[16908545] = { bypass: false };
  }
  return s;
}

// The device stamps color onto invalid slots too, so emit it for all eight.
const SNAP_NAME_MAX = 10; // hard device limit: 560 corpus names, none over 10
function snapshotMeta(names) {
  for (const n of names) {
    if (n.length > SNAP_NAME_MAX) {
      throw new Error(`snapshot name ${JSON.stringify(n)} is ${n.length} chars; the device field holds ${SNAP_NAME_MAX}`);
    }
  }
  const out = [];
  for (let i = 0; i < SNAP_MAX; i++) {
    const valid = i < names.length;
    out.push({ color: 'auto', expsw: -1, name: valid ? names[i] : `SNAPSHOT ${i + 1}`,
      source: 0, tempo: 120.0, valid });
  }
  return out;
}

// Collect the controller sources a preset actually assigns.
function usedSources(flows) {
  const used = new Set();
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n.controller && typeof n.controller.source === 'number') used.add(n.controller.source);
    Object.values(n).forEach(walk);
  })(flows);
  return used;
}

function preset({ name, info, flows, snapNames, tempo = 120.0, pedals = false, cursor }) {
  return {
    meta: { color: 'auto', device_id: DEVICE_ID, device_version: DEVICE_VERSION, info, name },
    preset: {
      clip: { end: 10.0, filename: '<EMPTY>', path: 'USER CLIPS', start: 0.0 },
      cursor: cursor || { flow: 0, path: 0, position: 1 },
      flow: flows,
      params: { activeexpsw: 1, activesnapshot: 0, inst1Z: 'FirstEnabled', inst2Z: 'FirstEnabled', tempo },
      snapshots: snapshotMeta(snapNames),
      sources: sources({ pedals, used: usedSources(flows) }),
      xyctrl: { rbtime: 0.5, rubberband: 1, x: 0, y: 0 },
    },
  };
}

// Assemble a flow object from a list of blocks.
const mkFlow = (blocks) => {
  const f = { '@enabled': { value: true } };
  for (const b of blocks) f[bid(b.path, b.position)] = b;
  return f;
};

// Empty Path 2, for single-path presets (matches the factory Rock Rig).
const emptyFlow2 = () => mkFlow([inputNone(0, 0, "b13"), outputMatrix(0, 13, 0.0)]);

/* Sort keys recursively so output byte-matches the editor's own ordering. */
function sortKeys(x) {
  if (Array.isArray(x)) return x.map(sortKeys);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) o[k] = sortKeys(x[k]);
    return o;
  }
  return x;
}

function write(outDir, p) {
  const file = path.join(outDir, `${p.meta.name}.hsp`);
  fs.writeFileSync(file, MAGIC + stringify(p, corpus.numberFormat()), "utf8");
  return file;
}

/* ================================================================== *
 * PRESET 1 -- Plexi Crunch  (Agoura_AmpSolid100)
 * ================================================================== */

module.exports = {
  MAGIC,
  DEVICE_ID,
  DEVICE_VERSION,
  SNAP_MAX,
  bid,
  snap,
  v,
  enabled,
  HARNESS_FX,
  HARNESS_FX_TRAILS,
  HARNESS_FX_CS,
  HARNESS_CAB,
  HARNESS_IO,
  HARNESS_ROUTE,
  block,
  inputInst,
  inputNone,
  outputMatrix,
  outputPath2,
  volPedal,
  gate,
  comp,
  scream808,
  minotaur,
  eqParam,
  chorus,
  simpleDelay,
  tapeDelay,
  dm4Comp,
  polyDowntune,
  rotatingVerb,
  roomVerb,
  CAB_DEFAULTS,
  cab,
  AMP_CAB_EQ,
  ampSolid100,
  ampEssex,
  ampUSLuxe,
  ampPanama,
  ampBritPlexi,
  ampRevvRed,
  ampPrincess,
  deluxeComp,
  springVerb,
  biasTrem,
  ampMatchstick,
  ampRevvPurple,
  simplePitch,
  pingPong,
  reverseDelay,
  ganymede,
  ampCaliIV,
  ampBrit2203,
  ampUSDouble,
  ampJazzRivet,
  grayFlanger,
  trinityChorus,
  eqParamStereo,
  dynPlate,
  splitY,
  splitAB,
  join,
  sources,
  SNAP_NAME_MAX,
  snapshotMeta,
  usedSources,
  preset,
  mkFlow,
  emptyFlow2,
  sortKeys,
  write,
};
