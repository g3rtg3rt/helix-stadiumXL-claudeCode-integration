# Gotchas

Each of these cost something to find. Ordered by what it costs you if you get
it wrong.

---

## 1. Float formatting — this one faults the device

**The firmware tells floats from integers by the decimal point in the JSON
text.** `JSON.stringify` renders `0.0` as `0`, handing a float-typed parameter
an integer. The unit faults: watchdog restart, splash screen, no full boot,
roughly ten seconds after the preset becomes active. It recovers, but you have
to find and delete the preset.

It cannot be fixed with a blanket rule, because `"value": 0` is **correct** under
`Mic` and **fatal** under `Level`.

So the writer does not guess. `lib/device-json.js` learns the correct format per
**model + parameter** from presets the device itself wrote, and reproduces 66 of
69 corpus files byte-for-byte (the other three differ only in float print
precision).

**Never write a `.hsp` with `JSON.stringify`.** Always
`stringify(obj, corpus.numberFormat())`.

This is also why a corpus is mandatory rather than convenient.

## 2. An unknown model id does not error — the block vanishes

Invent a model id and the firmware silently drops that block on import. No
warning. You get a patch with a hole in it and no indication why.

Every model id must come from your own mined catalogue or from the corpus.

Corollary for tooling: every tool here **checks the corpus against its own rules
first**. If a rule is wrong, you see reference files failing rather than a false
pass on your own output.

## 3. Parameter names are per-model and inconsistent

There is no generic amp interface. Observed, all real:

| Trap | Detail |
|---|---|
| `Treb` vs `Treble` | `Agoura_AmpUSPrincess76` uses `Treb`, and has **no** Mid or Presence |
| `XPrePost` vs `ZPrePost` | `Agoura_AmpRevvCh4Red` spells impedance `XPrePost`; its sibling `Ch3Purple` uses `ZPrePost`. Same family |
| spaces in names | `Ch Level` (Revv), `Spring Count` (Hx Spring), `A Pan` / `B Pan` (Join) |
| `MasterVol` | `Agoura_AmpUSDoubleBlack` calls its master that |
| missing controls | `Agoura_AmpEssexTB30CC` has no Mid or Presence; `NrmDrv`/`BrtDrv` are its **channel volumes**, and its `HighCut` is normalised 0–1, **not Hz** |
| type changes between models | `Channel` is a boolean on Solid 100 and an integer elsewhere |
| switch positions | `Aggression` (Revv) is 0/1/2, **not** a 0–1 knob. Writing `0.5` is a bug `check-ranges.js` will catch |
| built-in graphic EQ | `HD2_AmpCaliIVR1` carries its own 5-band EQ: `80Hz`, `240Hz`, `750Hz`, `2200Hz`, `6600Hz`, in dB |

**Copy the parameter set from a real export.** `lib/builders.js` has one builder
per amp for exactly this reason — resist the urge to unify them.

## 4. Gain staging is per-model and not interchangeable

`Level` means different things on different models. Anchor a new patch to a
measured value for **that amp** from your corpus.

| Amp | Master | Level |
|---|---|---|
| `Agoura_AmpEssexTB30CC` (Vox) | 1.0 | ≈ −12 dB |
| `Agoura_AmpUSLuxeBlack` | 1.0 | ≈ 0 dB |
| `Agoura_AmpEVPanamaRed` | 0.21 | −6.2 dB (cab carries +6 dB) |
| `Agoura_AmpRevvCh4Red` | 0.60 | −10 dB, Drive only 0.35 |
| `Agoura_AmpBritPlexi` | 1.0 | −7 dB |
| `Agoura_AmpBrit2203MV` | 1.0 | **+1.5 dB** (positive) |

Values from one corpus; re-derive from your own. The practical consequence: a
patch whose amp sits near 0 dB will be *much* louder than your others and will
need its output trimmed. Easier to get right at build time.

## 5. `Channel` is a number on most amps and a boolean on some

Many Agoura amps have their channels built in: the manual says they "have two
or more channels of the amp baked in, letting you freely change them with the
knob, from an assigned Stomp switch, or via snapshots." So an amp offering four
eras with three channels each is **one model with a `Channel` parameter**, not
twelve models — and it is snapshot-controllable.

**An amp can have a second such parameter.** The Brit SL100 (Marshall Super
Lead) advertises twelve channels and is **one model with `Era` and `Channel`**:
`Era` 0–3 for '67/'68/'70/'71 and `Channel` 0–2 for Normal/Bright/Jumped. Two
exports of it differing in `Era` alone, and in nothing else, settled that. So
do not assume one parameter covers a multi-channel amp, and do not assume a
twelve-way amp is twelve models.

The trap is the type. Across one corpus:

| Type | Models |
|---|---|
| `number` | AmpegSVT, BritMegaBass, BritPlexi, EssexTB30CC, Matchstick30, USDoubleBlack, USDripBass, USLuxeBlack |
| `boolean` | MandarinRockerMk3, Solid100 |

Two-channel amps are written `true`/`false`; multi-channel amps are written
`0`, `1`, `2`… Writing `Channel: 0` on a boolean-typed amp is the wrong JSON
type, and the float-vs-int learning in `lib/device-json.js` will not save you —
it distinguishes float from integer, not number from boolean.

`tools/check-rules.js` reports the observed type per model and flags a
mismatch. Check it before setting `Channel` on an amp you have not used before.

## 6. Level: Agoura amps have one, HD2 amps do not

They are not interchangeable, and this one costs you a rebuild.

- **Agoura amps** have `Level`. The manual: "Unlike the Master volume, it has
  no effect on the block's tone… a helpful method of balancing apparent preset
  levels against one another." That is a clean level control. Use it.
- **HD2 amps** have **`ChVol`** and no `Level`. `ChVol` is channel volume — it
  feeds the power amp stage, so raising it adds saturation and lowering it
  cleans up. It is a *tone* control that happens to move the level.

Which means: on an HD2 amp there is no tone-neutral level control in the amp
block at all. If you need one, put a `Volume/Pan > Gain` block after the cab
and leave `ChVol` alone. Treating `ChVol` as a level control produces a patch
that breaks up when you turn it up and goes limp when you turn it down.

`Hype` and `Level` appear on every Agoura amp and no HD2 amp; `ChVol` the
reverse. Either one tells you which family you are holding.

## 7. Snapshot names: 10 characters

Hard device limit. 560 corpus names, none longer; factory names are visibly
abbreviated ("Rhythm Bst"). The builder throws rather than letting the device
truncate.

## 8. A `null` inside the valid snapshot range is a hole

Snapshot arrays are always 8 long, `null` marking an invalid slot. Going from
one snapshot to two means **every existing array must be filled in the newly
valid slot**. Miss one and that parameter has no stored value for the new
snapshot.

Likewise, a block with no `@enabled.snapshots` array at all in a multi-snapshot
preset does something undefined on recall rather than something chosen.
`tools/fix-snapshot-coverage.js` fixes both, seeding from current values so
nothing audible changes.

## 9. Verify bytes, not parsed objects

A parse-and-compare round trip is **blind to formatting**, which is the single
thing most likely to be wrong. It will happily report a clean result on a file
that faults the device.

`tools/roundtrip-diff.js` compares bytes. Use it.

## 10. Things that look like constraints and are not

Three stricter assumptions, each disproven by factory files:

- `linkedblock` (amp↔cab) may be **one-way**, may **cross flows**, and an amp
  may have **no cab at all**.
- A cab block's second slot may hold a **different cab model**, not just the same
  one or `NoCab`.
- `source: 0` on a controller means **unassigned** — it is not a missing
  declaration you need to add.

## 11. Parameter names are per-model even within one amp family

Section 3 covers this generally; the Agoura Cali 2C+ is the extreme case and a
good test of whether you are reading the corpus or guessing. On that one model:

- the 5-band graphic EQ keys contain **spaces** and use an **underscore for the
  decimal point** — `'80 Hz'`, `'240 Hz'`, `'750 Hz'`, `'2_2 KHz'`,
  `'6_6 KHz'` — where the HD2 version of the same amp writes `80Hz`, `240Hz`,
  `2200Hz`, `6600Hz` with no spaces at all
- midrange is **`Middle`**, not `Mid`
- impedance is **`PrePost`** — a third spelling, alongside `ZPrePost` on most
  Agoura amps and `XPrePost` on the Revv Ch4
- master is **`MasterVol`**, with a separate `Volume1` and a whole lead channel
  (`LeadDrive`, `LeadMaster`, `LeadBright`)
- `Channel`, `Class`, `Deep`, `ShiftBass` and `ShiftTreble` are **booleans**

**`AmpCabShelfF` is per-model too**, which is easy to miss because it looks
like boilerplate: 1000 on most Agoura amps, **3000** on US Luxe Black, Cali 2C+
and Prosecutor, and **5355** on German Xtra Red. If your builder spreads a
shared constant for the `AmpCab*` family, override it per model.

## 12. Device features that quietly undo file-level work

Firmware gains conveniences that act on a preset after you generated it. Two
worth knowing about, both from Helix Stadium 1.4:

- **Swap Mono/Stereo Effects** converts a block between its mono and stereo
  version, keeping its settings — useful, and it is exactly the fix for the
  mono-block trap in `docs/PATCH-DESIGN.md`. But the release notes state that
  **snapshot and controller assignments are cleared** when you swap. On a patch
  whose snapshots carry per-snapshot values, or whose block is on an expression
  pedal, swapping on the device throws that away. Swap in the builder instead,
  where the `snapshots` arrays and `controller` blocks travel with the change.
- **`EXP [X] Pedal Position: Per Preset | Global`**
  (Global Settings > Switches/Pedals). Per preset is the default. The manual is
  precise about what Global overrides: the pedal's **position recall**, "even if
  Snapshot Control is currently active for the preset's pedal position
  parameter." It does *not* break the preset's assignments — the pedal still
  controls the parameter, it just keeps its current position across a preset
  change instead of taking the saved one. So a snapshot that parks the wah at
  heel will not do so when this is Global.
- **A newly assigned pedal can look dead until you rock it.** The manual:
  "You may need to rock the pedal back and forth a few times initially for a new
  assignment to begin controlling its parameter." Worth trying before you go
  looking for a bug in the file.

## 12. Windows-specific, if you are working there

- **Clone with LF.** Git for Windows sets `core.autocrlf=true` in its *system*
  config, so a default clone rewrites shell scripts to CRLF and they then fail
  with `bad interpreter: /bin/bash^M`. This repo ships a `.gitattributes`
  pinning `eol=lf`, which overrides that per-repo.
- **Normalise line endings before concluding two copies differ.** A CRLF-vs-LF
  checkout makes nearly every file look modified. It is noise, and it hides real
  divergence.
- **Do not keep a git repo inside a cloud-sync folder.** Sync clients can skip
  or mangle `.git`, leaving the files intact and the repository gone.
