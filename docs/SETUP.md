# Getting this into your own Claude Code

Twenty minutes, most of it exporting presets. At the end, Claude Code in this
folder will know the `.hsp` format, the traps, and your device's own number
formatting — and can build and validate patches for you.

> **Back up your presets before you import anything generated.** A malformed
> preset can make the unit fault (watchdog restart, splash screen, no full
> boot). It recovers, but you have to find and delete the offending preset. The
> toolkit exists to prevent this; it is not a guarantee.

---

## 1. Prerequisites

| | |
|---|---|
| Node.js | 18 or newer. `node --version` |
| Git | any recent version |
| Claude Code | https://claude.com/claude-code |
| HX Edit | Line 6's editor, for exporting presets |

No npm install. There are no dependencies — everything is standard library, on
purpose, so it still runs in five years.

## 2. Clone it

```bash
git clone https://github.com/g3rtg3rt/helix-stadiumXL-claudeCode-integration
cd helix-stadiumXL-claudeCode-integration
```

## 3. Export your own presets into `corpus/` — the step that matters

**This is not optional and it cannot be skipped.** Nothing here ships with
presets, for two reasons: the factory set is Line 6's content, and more
practically, *your* device and firmware may not match whoever built this.

1. Open **HX Edit** and connect your Helix.
2. Select presets **the device itself saved**. The factory set is ideal — it is
   broad, it covers many models, and you did not author it.
3. **File → Export** into the `corpus/` folder of this repo.

Thirty or more gives good parameter coverage. Fewer works; the learner just sees
fewer models and you get a warning.

```bash
node -e "const c=require('./lib/corpus.js'); console.log(c.presets().length + ' presets found')"
```

**Do not put presets this toolkit generated into `corpus/`.** The writer learns
correct formatting *from* the corpus, so feeding your own output back teaches it
your mistakes as ground truth. Only device-written files belong there.

`corpus/` is gitignored. Your presets stay yours and never get committed.

### Why a corpus at all

The firmware tells a float from an integer by the decimal point in the JSON
text. `JSON.stringify` writes `0.0` as `0`, handing a float-typed parameter an
integer — and the unit faults. But `"value": 0` is *correct* under `Mic` and
*fatal* under `Level`, so no blanket rule works. The writer learns the right
format per model+parameter from files your device wrote. `lib/corpus.js`
explains it at length.

## 4. Build your catalogue

```bash
node tools/mine-catalogue.js
```

This regenerates `docs/MODEL-CATALOGUE.md` from **your** corpus: every model id,
its parameters, and the value ranges your presets actually use. The committed
copy was mined elsewhere — treat it as a starting point, not truth, because
model availability differs between devices and firmware.

## 5. Check it works end to end

```bash
node examples/build-examples.js out
node tools/validate-presets.js corpus out
node tools/check-structure.js corpus out
node tools/check-ranges.js corpus out
```

Three example patches should build and pass. If `validate-presets.js` reports
problems in your **corpus** files rather than in `out/`, that is the tool
telling you its rules do not match your firmware — which is useful information,
not a failure. Open an issue with the output.

## 6. Start Claude Code

```bash
claude
```

That is the whole integration. Claude Code reads `CLAUDE.md` from the working
directory automatically, which carries the rules, the workflow and the
non-negotiables. The skill in `.claude/skills/helix-patch/` gives it a
step-by-step recipe it can invoke by name.

Try:

> Build me a clean patch for a Vox-style amp with a chorus, three snapshots,
> and tell me which values you are confident about.

or

> Read docs/FORMAT.md and explain how snapshots are stored.

### Importing just the knowledge, without the toolkit

If you only want Claude to *understand* the format — for your own tooling in
another language, say — the four documents are self-contained:

| File | What it gives you |
|---|---|
| `docs/FORMAT.md` | the container and the data model |
| `docs/GOTCHAS.md` | the traps, each with what it costs you |
| `docs/PATCH-DESIGN.md` | how to make a patch that works musically |
| `docs/MODEL-CATALOGUE.md` | model ids and observed parameter ranges |

Paste them into any Claude session, or copy them next to your own project with a
`CLAUDE.md` that points at them.

## 7. Get a patch onto the device

1. `out/*.hsp` → import via HX Edit (**File → Import**), or drop into a setlist.
2. **Back up first.**
3. Load the patch and play it before trusting it.

---

## Troubleshooting

**"the corpus is empty"** — step 3. The error prints the exact directory it
looked in.

**"the corpus directory does not exist"** — same, or point it elsewhere:
`HELIX_CORPUS=/path/to/exports node ...`

**A block is missing after import.** You used a model id the firmware does not
recognise. It drops silently rather than erroring. Check the id against your own
mined catalogue.

**The unit faults ~10 s after loading a preset.** Almost certainly a number
written as an int where the firmware wants a float. Delete the preset, then import the patch, export it
straight back out of HX Edit, and diff the two:

```bash
node tools/roundtrip-diff.js out/YourPatch.hsp reexported/YourPatch.hsp
```

That shows exactly which field the device rewrote or dropped. If it reveals a
writer bug, please open an issue with the output — that is the most useful bug
report this project can get.

**Snapshot names look truncated on the device.** Ten characters is the limit.

**The preset loads but something is obviously wrong — no stereo, a dead pedal,
a channel that will not change.** Run `node tools/check-rules.js`. It checks
the things the manual states and the other validators cannot see from the
corpus alone: the per-preset and per-path block limits, a mono block sitting
downstream of a hard-panned stereo image, and whether an amp's `Channel`
parameter is the right JSON type for that model.

**You updated the firmware.** Export a few presets and run
`node tools/check-firmware-delta.js path/to/new-exports`, then re-run the
catalogue miner. A firmware update can add parameters or models, and in the
worst case change how numbers are written — see
[FORMAT.md](FORMAT.md#when-the-firmware-changes), which walks through a real
1.3.2 → 1.4.1 comparison. Also update the `FIRMWARE` constant at the top of
`lib/builders.js`.

**A validator flags something in a corpus file.** Expected, occasionally: the
rules were derived from one device on one firmware. The tools deliberately check
the corpus against their own rules first so that this shows up as reference
files failing, instead of silently passing bad output.
