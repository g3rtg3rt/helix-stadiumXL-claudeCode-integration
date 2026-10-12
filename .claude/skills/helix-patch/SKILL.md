---
name: helix-patch
description: Build, edit or validate a Line 6 Helix .hsp preset in this toolkit. Use when the user asks for a new patch, a change to an existing one, snapshot or level balancing, or wants a patch checked. Covers the format rules that can fault the device.
---

# Building a Helix patch

## Before anything

Confirm the corpus is present. Everything depends on it and the failure is
cheap to check:

```bash
node -e "const c=require('./lib/corpus.js'); console.log(c.presets().length+' presets in '+c.dir())"
```

Zero means stop and point the user at `docs/SETUP.md` — the writer cannot
produce a safe file without it, and that is not a limitation to work around.

## Ask first, if not already known

- **Which guitar and pickup?** It changes the voicing more than most tone
  requests do. A bridge humbucker and a single coil want opposite moves in the
  low mids, the treble and the drive. `docs/PATCH-DESIGN.md` has the table.
- **What is it for?** A song, a style, or a specific recording. "Like the
  record" is a guess at the record, and worth saying so.
- **Mono or stereo rig?** Hard-panned width partially comb-filters in mono.

## Building

1. **Find a comparable amp in the corpus and copy its gain staging.** `Level`
   means different things on different models; a generic number gives you a
   patch that is wildly louder or quieter than the user's others.
2. **Use the per-amp builder in `lib/builders.js`.** Do not write a generic
   amp call — parameter sets and names differ per model
   (`Treb` vs `Treble`, `XPrePost` vs `ZPrePost`, `Ch Level` with a space).
3. **Put per-snapshot level in one `gainStereo` block** at the end of the
   chain. Leave the preset output at 0 dB for patch-to-patch balance. Freeze
   amp and cab levels and drives.
4. **Check nothing mono sits downstream of the cab or the Join.** Walk the flow
   and flag any model ending `Mono`. This silently destroys stereo and is
   invisible until the block is engaged.
5. **Snapshot names: 10 characters**, named for what they do in the song.

## Validating — all four, and read the output

```bash
node tools/validate-presets.js corpus out   # schema conformance
node tools/check-structure.js  corpus out   # structural conventions
node tools/check-ranges.js     corpus out   # value sanity; catches switch/enum bugs
```

And when a patch matters, the one check that proves the device kept it — import
the patch, export it back out of HX Edit, and diff the two files:

```bash
node tools/roundtrip-diff.js out/Patch.hsp reexported/Patch.hsp
```

A range flag is often an intentional deviation — say which, rather than
reporting it as a fault or hiding it. A **SWITCH** or **ENUM** flag is a real
bug: a fractional value written to a switch-position parameter.

`tools/fix-snapshot-coverage.js` fills missing `@enabled.snapshots` arrays when
a preset gains its second snapshot.

## Editing a patch the user changed on the device

**Transform the file; do not regenerate it.** Their edits are the sound they
approved, and the builder would replace them with yours.

- Device-written files contain float artefacts like `-6.66e-15`. That is how you
  tell.
- Write the transform to **assert the shape it expects** and fail loudly if a
  block is not where it should be. Silent no-ops report success, which is worse
  than an error.
- Prefer expressing an intent as a rule over a list of values. "Snapshot 4 is
  snapshot 2 but with snapshot 3's delay" should copy *everything* from 2 then
  override the delay — spelled out as values, you will miss one.

## Reporting back

Say which values are founded in the corpus and which are your judgement. The
user cannot tell by looking and will be playing it on stage.

You cannot hear it. Loudness in particular cannot be measured from the file — if
you set a level, say what you derived it from and that it is an estimate.

Then tell them to **back up, import, and play it** before trusting it.

## The rule that matters most

Never write a `.hsp` with `JSON.stringify`. Always
`stringify(obj, corpus.numberFormat())` via `lib/device-json.js`. The firmware
reads a missing decimal point as an integer and faults.
`docs/GOTCHAS.md` §1 has the detail.
