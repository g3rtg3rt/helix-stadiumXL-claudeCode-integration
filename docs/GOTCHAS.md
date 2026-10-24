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

## 5. Snapshot names: 10 characters

Hard device limit. 560 corpus names, none longer; factory names are visibly
abbreviated ("Rhythm Bst"). The builder throws rather than letting the device
truncate.

## 6. A `null` inside the valid snapshot range is a hole

Snapshot arrays are always 8 long, `null` marking an invalid slot. Going from
one snapshot to two means **every existing array must be filled in the newly
valid slot**. Miss one and that parameter has no stored value for the new
snapshot.

Likewise, a block with no `@enabled.snapshots` array at all in a multi-snapshot
preset does something undefined on recall rather than something chosen.
`tools/fix-snapshot-coverage.js` fixes both, seeding from current values so
nothing audible changes.

## 7. Verify bytes, not parsed objects

A parse-and-compare round trip is **blind to formatting**, which is the single
thing most likely to be wrong. It will happily report a clean result on a file
that faults the device.

`tools/roundtrip-diff.js` compares bytes. Use it.

## 8. Things that look like constraints and are not

Three stricter assumptions, each disproven by factory files:

- `linkedblock` (amp↔cab) may be **one-way**, may **cross flows**, and an amp
  may have **no cab at all**.
- A cab block's second slot may hold a **different cab model**, not just the same
  one or `NoCab`.
- `source: 0` on a controller means **unassigned** — it is not a missing
  declaration you need to add.

## 9. Device features that quietly undo file-level work

Firmware gains conveniences that act on a preset after you generated it. Two
worth knowing about, both from Helix Stadium 1.4:

- **Swap Mono/Stereo Effects** converts a block between its mono and stereo
  version, keeping its settings — useful, and it is exactly the fix for the
  mono-block trap in `docs/PATCH-DESIGN.md`. But the release notes state that
  **snapshot and controller assignments are cleared** when you swap. On a patch
  whose snapshots carry per-snapshot values, or whose block is on an expression
  pedal, swapping on the device throws that away. Swap in the builder instead,
  where the `snapshots` arrays and `controller` blocks travel with the change.
- **Expression pedals can be assigned globally or per preset**
  (Global Settings > Switches/Pedals). A preset's own EXP assignments — the wah
  wiring in `docs/FORMAT.md`, a volume pedal — assume the per-preset mode. If a
  generated patch's pedal does nothing, check that setting before suspecting the
  file. *Reported from release notes, not tested here.*

## 10. Windows-specific, if you are working there

- **Clone with LF.** Git for Windows sets `core.autocrlf=true` in its *system*
  config, so a default clone rewrites shell scripts to CRLF and they then fail
  with `bad interpreter: /bin/bash^M`. This repo ships a `.gitattributes`
  pinning `eol=lf`, which overrides that per-repo.
- **Normalise line endings before concluding two copies differ.** A CRLF-vs-LF
  checkout makes nearly every file look modified. It is noise, and it hides real
  divergence.
- **Do not keep a git repo inside a cloud-sync folder.** Sync clients can skip
  or mangle `.git`, leaving the files intact and the repository gone.
