# Helix patch building — instructions for Claude Code

You are working in a toolkit that generates Line 6 Helix `.hsp` preset files
programmatically. This file is the operating manual. Read `docs/GOTCHAS.md`
before writing your first patch; everything in it was learned by breaking
something.

## The one rule that can damage the user's experience

**Never write a `.hsp` with `JSON.stringify`.** Always go through
`lib/device-json.js` (`stringify(obj, corpus.numberFormat())`).

The firmware decides whether a parameter is a float or an integer **by whether
the JSON text contains a decimal point**. `JSON.stringify` renders `0.0` as `0`,
which hands a float-typed parameter an integer. The unit then faults: watchdog
restart, splash screen, no full boot, about ten seconds after the preset becomes
active. It recovers — but the user has to find and delete the preset.

`"value": 0` is *correct* under `Mic` and *fatal* under `Level`, so this cannot
be solved with a blanket rule. The writer learns the right format per
model+parameter from the user's own corpus. That is why a corpus is mandatory.

**Tell the user to back up their presets before importing anything you made.**

## Non-negotiables

1. **Never invent a model id.** An unrecognised one does not error — the block
   is silently dropped on import, and the user gets a patch with a hole in it.
   Every model id must come from `docs/MODEL-CATALOGUE.md` or from the corpus.
2. **Never invent a parameter name or set.** Parameter sets are per-model and
   inconsistent (`Treb` vs `Treble`, `XPrePost` vs `ZPrePost`, `Ch Level` with a
   space). Copy the set from a real export. `lib/builders.js` has one builder
   per amp for exactly this reason — do not write a generic `amp()`.
3. **Snapshot names are capped at 10 characters.** The builder throws.
4. **Run all three validators before handing a patch over**, and read the
   output rather than just the exit code.
5. **Verify bytes, not parsed objects.** A parse-and-compare round trip is blind
   to formatting, which is the one thing most likely to be wrong. Use
   `tools/roundtrip-diff.js`.
6. **`roundtrip-diff.js` needs two files**, not a directory: the patch you
   generated and the same preset exported back off the device after import.
   It is the only check that proves the device KEPT what you wrote -- schema
   validation cannot see a block the firmware silently dropped, a value it
   clamped, or a field it rewrote. Ask the user to re-export after importing
   when a patch matters.
7. **Gain staging is per-model and not interchangeable.** Anchor any new patch's
   levels to a measured value for *that amp* from the corpus, never a generic
   number. `docs/GOTCHAS.md` has a table.

## After a firmware update

Read the vendor's release notes for that version first, then run
`node tools/check-firmware-delta.js <newExportDir>` and tell the user what both
said. The tool diffs files, so it reports only on models the sample uses: if the
user re-exported presets they already had, it **cannot** see models the update
added, and saying "no new models" on that basis is wrong. New models need a
scratch preset exported per model before anything can be built with them. A firmware update can add parameters
to existing models, and can in principle change how numbers are rendered — which
is the failure that faults the unit. Also update the `FIRMWARE` constant in
`lib/builders.js`; `device_version` is computed from it.

## Workflow

```bash
# once, per device
#   export presets from HX Edit into corpus/   (see docs/SETUP.md)
node tools/mine-catalogue.js                 # regenerate the catalogue for YOUR device

# per patch
node examples/build-examples.js out          # or your own builder
node tools/validate-presets.js corpus out    # schema conformance
node tools/check-structure.js corpus out     # structural conventions
node tools/check-ranges.js corpus out        # value sanity, switch/enum bugs
node tools/roundtrip-diff.js out/Patch.hsp reexported/Patch.hsp
                                             # did the device KEEP it?
```

The validators take `<corpus> <target>`. They check the **corpus against their
own rules first**, so if a rule is wrong you see the reference files failing
rather than a false pass on your output.

## What to do when the user asks for a patch

1. Ask which guitar and pickup if they have not said. It changes the voicing
   more than most tone requests do — see `docs/PATCH-DESIGN.md`.
2. Find a comparable amp in the corpus and copy its gain staging.
3. Build it, validate it, and report what the validators actually said.
4. Say plainly which values are founded in the corpus and which are your
   judgement. The user cannot tell by looking, and will be playing it on stage.

## Editing a patch the user has already changed on the device

**Transform the file. Do not regenerate it.** Their edits are the sound they
approved. A device-written file is identifiable — it contains float artefacts
like `-6.66e-15` that this writer never produces.

Write transforms that **assert the shape they expect** and fail loudly if a
block is not where it should be. A transform that silently matches nothing is
worse than an error, because it reports success.

## Design rules worth knowing before you build

- **A mono block downstream of the cab or the Join sums hard-panned stereo back
  to centre.** This is the most common way to build a patch that looks stereo
  and is not. Check for a `...Stereo` twin of the model before moving anything.
- **Put per-snapshot level in ONE gain block**, keep the preset output for
  patch-to-patch balance, and freeze amp and cab levels. Mixing those jobs makes
  balancing unmanageable and slides the stereo image between snapshots.
- **Level alone cannot make a hard-played part sit back.** That is dynamics.
  Compression, a mid cut and more reverb all push a part back; only compression
  costs dynamics.

Full reasoning for each in `docs/PATCH-DESIGN.md`.

## Honesty requirements specific to this domain

You cannot hear anything you build. Say so when it matters:

- Loudness cannot be measured from the file. If you set a level, say it is an
  estimate and what you derived it from.
- A patch built to match a recording is a guess at that recording.
- A model that appears once or twice in the corpus rests on a thin sample — say
  which parameters you are confident about and which you are not.
