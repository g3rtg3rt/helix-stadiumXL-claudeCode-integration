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

### The whole Agoura-vs-HX difference, measured

`ChVol` / `Level` is one line of a clean structural split. Over 30 Agoura amps
and 22 HX/legacy amps in one corpus:

| parameter | Agoura (30) | HX/legacy (22) |
|---|---|---|
| `ChVol` | **0** | **22 — all** |
| `Level` | **29** | **0** |
| `Bias` | **0** | 18 |
| `BiasX` | **0** | 18 |
| `Hum` | **0** | 12 |
| `CabIdx` | 17 | 0 |
| `ZPrePost` | 26 | 0 |
| `Ripple` / `Sag` | 29 / 29 | 16 / 19 |

So an **Agoura amp is the HX tone and gain section plus an integrated cab and
impedance model**, with the bias trim and the hum control removed and the channel
volume renamed. Worked through on the one documented relative pair —
`HD2_AmpLine6Litigator` (12 parameters) against `Agoura_AmpLine6Prosecutor` (22),
which Line 6 describes as "inspired by Litigator" — the eight shared parameters
are `Bass`, `Drive`, `Master`, `Mid`, `Presence`, `Ripple`, `Sag`, `Treble`; the
Agoura side adds the ten `AmpCab*` parameters plus `CabIdx`, `ZPrePost`, `Hype`
and `Level`.

This tells you which parameters **exist**, which is the part that faults the unit
if you get it wrong. It does not give you values, and "inspired by" is not the
same amp, so there is no controlled pair here.

**Both apparent exceptions are spelling, not structure** — which is the usual
answer in this format:

- **Who Watt 103** is the one Agoura amp without `Level`. It spells the same
  control `"Output Volume"`, with a space. See section 11.
- The impedance parameter is `ZPrePost` on 26 Agoura amps, **`PrePost`** on Cali
  2C+ and US Drip Bass, **`XPrePost`** on Revv Ch4 Red, and **absent entirely**
  on Agua 751 — which also carries no `Ripple` and no `Sag`.

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

**The clearest case is a control that exists on seven amps under six names.** A
jumped or two-channel amp replaces `Drive` with two drive controls — that much is
structural and derivable. What it calls them is not:

| model | the two drive keys |
|---|---|
| Brit Trem Jump (HX) | `NrmDrive`, `BrtDrive` |
| Brit Plexi, Brit SL100 (Agoura) | `NormDrv`, `BrightDrv` |
| Essex TB30CC (Agoura) | `NrmDrv`, `BrtDrv` |
| Who Watt 103 (Agoura) | `NormDrive`, `BrtDrive` |
| Matchstick 30 (Agoura) | `Ch1Drv`, `Ch2Drv` |
| Cartographer (HX) | `Drive`, `Drive2` |

`Nrm` or `Norm`, `Brt` or `Bright`, `Drv` or `Drive`, and one amp numbering its
channels instead of naming them. One concept, seven models, no two spellings in
full agreement.

Cartographer is also worth noting for a different reason: it has two drives
**without being a jumped amp**, so a second drive control is a two-channel feature
that jumping happens to use.

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

## 13. A stereo variant can add parameters, and which ones depends on the family

`...Mono` and `...Stereo` are separate models. A stereo variant never drops a
parameter, but what it *adds* varies: nothing for dirt, dynamics, EQ, reverb and
wah; `Spread` for almost all modulation; `Scale` and/or `Spread` for delays,
inconsistently; and `PanVoice1` / `PanVoice2` / `PanDry` for pitch effects. See
the table in `docs/FORMAT.md`. Only the first group is safe to derive from the
other variant's bytes.

The reason this is a gotcha rather than a fact: an earlier version of these docs
asserted the additions were always `Spread`, `Scale` or `Stereo`. That was true
of all 36 pairs then in the corpus and false of the format, because none of those
36 was a pitch effect. **An induced rule inherits the corpus's blind spots.**

## 14. Command Center carries fields the manual omits, and one that means nothing

- **`Utility.Level Trim`** is in the bytes and absent from the manual's Utility
  section, which documents only `Action` and `Command`.
- **`snaptarget: true`** is how a snapshot-controlled *command* parameter is
  marked. No block parameter uses it — 0 of 1849 — so copying the block-parameter
  shape yields a command that silently ignores snapshots.
- **`toggle`** is not configuration. It flipped `true` → `false` across two
  saves of one preset with nothing deliberately changed. The real Toggle action
  is `Action: 3`. Write `toggle: false`.
- **Instants cannot take every type.** Instant 1~16 accept all command types
  *except* `PresetSnapshot` and `Utility`; expression pedals and XY axes accept
  MIDI CC only. The device does not offer the others, so an instruction to assign
  one is simply unfollowable.

## 15. The official Model List is not a clean data source

Scraping Line 6's model list is the right way to find what you are missing, but
it needs defensive parsing:

- **The "category" column is the mono/stereo column** for effects. The real
  effect category is a page heading, not a field.
- **Cabs are mixed in with amps** under the Guitar and Bass headings. A leading
  speaker configuration (`4x12`, `1x15`, …) is what separates them — except
  `Soup Pro Ellipse`, which is a cab with no such prefix.
- **The vendor's own spelling drifts between the list and the model id**:
  official *Alpaca Rogue* is `DistAlpacaRouge`, official *Ratatoullie Dist* is
  `DistRatatouille`.
- **Model ids drop words the display name has** — *Mercator Dist* →
  `DistMercator`, *Cali Q Graphic* → `CaliQ`, *Lo Res* → `DL4LowResDelay` — and
  abbreviate others (`Dynamic`→`Dyn`, `Volume`→`Vol`, `One`→`1`).
- **Short names false-positive on substring matching.** *Chrome* matched
  `WahChromeCustomMono`, hiding the fact that Chrome and Chrome Custom are two
  different models (Vox V847 and a modded V847) with no overlap.

Match on tokens with a stem fallback, then **eyeball the borderline band** — and
reverse the match too, so ids that fit no official name reveal the abbreviations
you have not handled.

## 16. Legacy (HX) amps share almost nothing

Across 14 legacy amps in one corpus, exactly **three** parameters are common to
all of them: `Bass`, `ChVol`, `Treble`. Everything else is per-model — Matchstick
has `Cut` and `Ch1Drive`, Grammatico GSG has 20 parameters including `ODSwitch`,
`PAB` and `JazzRock`, Woody Blue has `TuningFork`, `Variamp` and `TFCoarse`,
Cali IV carries a 5-band graphic EQ and SVT-4 Pro a 9-band.

So **no legacy amp can be inferred from another one**. Each needs its own export
before you can build it. Non-jumped channel siblings are the one exception: Solo
Lead Clean, Crunch and OD have identical key sets, so one covers the family —
but a *Jumped* variant generally adds a second drive control and does not.

## 17. A preamp is its amp minus the power stage

A preamp model is the same model without a power amp, and its parameter set says
so literally: it drops the power-amp controls and keeps everything else.

**No preamp in a 12-preamp sample carries `Bias`, `BiasX` or `Ripple`.** Not one.
Those three are power-amp parameters, and 14 of 18 legacy amps have them.
`Presence` goes the same way in 11 of 12, with Line 6 Ventoux the one preamp that
keeps it.

The three controlled pairs — the same model available both as `…Amp…` and
`…Preamp…` — all obey it:

| model | amp | preamp | drops |
|---|---|---|---|
| Derailed Ingrid | 13 | 9 | `Bias`, `BiasX`, `Presence`, `Ripple` |
| Placater Dirty | 17 | 13 | `Bias`, `BiasX`, `Presence`, `Ripple` |
| Woody Blue | 12 | 12 | nothing — **it has none of those four** |

Woody Blue is the case worth dwelling on. An earlier revision of this file used
it as proof that *no* rule existed: one pair identical, one pair losing four
parameters, therefore unpredictable. But Woody Blue's amp has no `Bias`, `BiasX`,
`Presence` or `Ripple` to lose — it is a tuning-fork amp carrying `TFCoarse`,
`TFFine`, `TuningFork` and `Variamp` instead. That pair is identical *because* the
rule applies and finds nothing to remove. **A model the rule does not bite on
looks exactly like proof that there is no rule, as long as the rule is unstated.**

So: derive a preamp as its amp minus `{Bias, BiasX, Ripple}`, treat `Presence` as
a per-model question, and check bytes where you can. Three pairs is enough to
predict with and not enough to be certain.

**Channel variants are a different matter and really are not derivable.**
`HD2_PreampPlacaterClean` has 7 parameters; `HD2_PreampPlacaterDirty` has 13, six
of which — `C45`, `HBE`, `SSwitch`, `Fat`, `Voice`, `Saturation` — do not exist on
the clean channel. Same physical amp, adjacent in the menu, nothing shared.

**And legacy amps still share almost nothing with each other.** Across 18 of them
the parameters common to *all* are `Bass`, `ChVol` and `Treble` — three. Adding
four more amps to the sample did not add a fourth.

## 18. The model id is neither the menu name nor a predictable shape

Two separate traps, and both make a "which models do I have?" report wrong in the
quiet direction — it says *missing* when you hold the model.

**The id is not the display name.** Thirteen confirmed cases share no text with the
menu entry: "3 OSC Synth" is `HD2_SynthSubtractiveStereo`, "Dynamic Hall" is
`VIC_ReverbRotatingStereo`, "Bleat Chop Trem" is
`HD2_TremoloPatternStereo`, "Tesselator" is `VIC_DelayStutterEditStereo`, "Poly
Detune" is `L6SPB_PolyChorus`. The id tends to name the mechanism and the menu
the feel — a pattern you can notice and cannot extrapolate.
`docs/MODEL-NAME-MAP.md` has the full list and how to establish a mapping that
holds; the short version is to place blocks in a known order and read the mapping
off the slot positions.

**The id shape is not `PREFIX_Name`.** `EuclideanDelayStereo_Victoria` puts its
generation marker in a suffix with no prefix at all; `TapeEater` has neither. See
the id-shape table in `docs/FORMAT.md`. `tools/mine-catalogue.js` used to anchor
its family match to the start of the stripped id and filed 20 models under "Other
FX" as a result, 17 of them wrongly — including every `DL4…` delay and every
`VIC_DynPlate…` reverb.

Also, the **Model List goes stale**: a device on newer firmware has models the
published list does not mention, so an id you cannot match may be a renamed model
*or* a new one. The file does not tell you which.

## 19. A tool that walks a corpus must walk subdirectories

`mine-catalogue.js` used a flat `readdirSync`, so a corpus organised with a
per-firmware subfolder beside the top-level exports was mined at 76 files when it
held 110, and catalogued 249 models of 318. Nothing in the output said anything
had been skipped — the counts looked plausible, which is what let it survive.

If you organise a corpus into subfolders, check that every tool reading it
recurses. The symptom is a model you know you exported being absent from a
report, which reads as an export problem rather than a tool one.

The same function then needed three more rounds, each from a model id that had not
existed in the corpus when the previous round was written. Worth listing, because
each is a different way to get id parsing wrong:

1. **A fixed prefix list** missed `L6SPB_`, and anchoring the family match to the
   start of the stripped id filed 20 models under "Other FX", 17 wrongly.
2. **A blanket `^[A-Za-z0-9]+_` strip** turned `Warble_Matic` into `Matic`.
3. **A shape test for the trailing marker** (`_[A-Z][a-z]+$`) ate `_Matic` as
   readily as `_Victoria`.
4. **Case-insensitive matching**, added so that "Overdrive" would match `Drive`,
   made upper-case `EQ` match the "eq" inside `FrequencyShifter` and filed a
   legacy frequency shifter under EQ/Filter/Wah. Acronyms need a case-sensitive
   pass; words need a folded one.

The pattern across all four: **every one looked correct against the corpus at the
time and was falsified by the next export.** A categoriser over an open vocabulary
is not a thing you write once. The cheap defence is to assert that the fallback
bucket is *empty* after a run, so a new id that nothing matches is a failure
rather than a quiet default.

## 20. A legacy model's prefix predicts its parameter shape

Legacy effects carry the modeller they came from: `DL4`, `MM4`, `FM4`, `DM4`,
`M13`. That marker is worth more than it looks, because it predicts the parameter
set and not just the family.

Three legacy distortions, picked to be as unalike as that section offers, came back
with **no parameters in common at all** — not even `Level`:

| model | parameters |
|---|---|
| `HD2_DM4Overdrive` (DOD 250) | `Bass`, `Drive`, `Mid`, `Output`, `Treble` |
| `HD2_DM4FacialFuzz` (Fuzz Face) | `Bass`, `Drive`, `Mid`, `Output`, `Treble` |
| `KillerZ` (BOSS Metal Zone) | `Contour`, `Dist`, `Gain`, `Mid Amt`, `Mid Freq`, `Smart` |

The first two are **parameter-identical** despite modelling completely different
pedals, because both are `DM4` models. The third has **no prefix at all** and is a
different generation. So within a marker the family is uniform and inferable;
across markers it is not.

The `FM4`/`MM4` families likewise share `Level`, `Mix`, and on anything
speed-based `Speed` plus `SyncSelect1`/`TempoSync1`. Two of them — `Warble_Matic`
and `SampleAndHold` — have *identical* parameter sets while being different
effects.

And legacy compressors are all two parameters that each name the second one
differently: `Level`+`Sustain`, `Level`+`Amount`, `Level`+`Thresh`. Same shape,
three names — see section 11.

## 21. Windows-specific, if you are working there

- **Clone with LF.** Git for Windows sets `core.autocrlf=true` in its *system*
  config, so a default clone rewrites shell scripts to CRLF and they then fail
  with `bad interpreter: /bin/bash^M`. This repo ships a `.gitattributes`
  pinning `eol=lf`, which overrides that per-repo.
- **Normalise line endings before concluding two copies differ.** A CRLF-vs-LF
  checkout makes nearly every file look modified. It is noise, and it hides real
  divergence.
- **Do not keep a git repo inside a cloud-sync folder.** Sync clients can skip
  or mangle `.git`, leaving the files intact and the repository gone.
