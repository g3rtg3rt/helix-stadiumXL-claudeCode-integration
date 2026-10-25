# The `.hsp` format

Reverse-engineered from a corpus of device exports and confirmed by loading
generated files on real hardware. Everything here is observed behaviour, not
documentation from Line 6 — where a claim rests on a thin sample it says so.

Device these notes were derived from: Helix Stadium XL, `device_id 2490368`,
firmware 1.3.2.1340 and 1.4.1.1343. The container and data model are likely
shared across the Helix family; model availability is not.

**`meta.device_version` is a packed integer**, not an opaque id:

    (major << 28) | (minor << 24) | (patch << 16) | build

Confirmed against two real exports:

| Integer | Hex | Firmware |
|---|---|---|
| 318899516 | `0x1302053C` | 1.3.2.1340 |
| 335611199 | `0x1401053F` | 1.4.1.1343 |

So you can compute yours rather than copy a magic number, and you can read the
firmware off any preset a device exported.

---

## Container

```
offset 0   8 bytes   "rpshnosj"      ASCII, no terminator
offset 8   ...       pretty-printed JSON, UTF-8
```

`rpshnosj` is `jsonhspr` reversed.

- 2-space indent
- **LF** line endings
- UTF-8, **no BOM**
- **no trailing newline**
- **no checksum anywhere** — you can edit and rewrite freely

Keys are sorted. The writer in `lib/device-json.js` sorts recursively so output
byte-matches what the editor itself produces.

## Top level

```json
{
  "meta":   { "color", "device_id", "device_version", "info", "name" },
  "preset": { "clip", "commands", "cursor", "flow", "params", "snapshots", "sources", "xyctrl" }
}
```

`preset.commands` is **optional** — the device omits the key entirely when no
Command Center assignment exists, which is true of most presets. See
[Command Center](#command-center-presetcommands).

`meta.info` is the free-text notes field shown in HX Edit. It is a good place to
record *why* a patch is set up the way it is — it travels with the file.

## Signal routing: flows, paths, positions

Four grids of blocks:

```
preset.flow[0]   Path 1      path 0 = upper, path 1 = lower
preset.flow[1]   Path 2      path 0 = upper, path 1 = lower
```

Each path has **14 positions**, `0` to `13`. Position 0 is the input block and
13 the output block, leaving 1–12 for processing. The manual confirms the
arithmetic from the other direction: "Helix Stadium's four paths (Path 1A, 1B,
2A, and 2B) each offer 12 block locations, for a total 48 block capacity."

**Paths 1 and 2 have independent DSP.** `flow[0]` and `flow[1]` are not merely
two grids — they are two processors. A preset with everything on `flow[0]` uses
half the device. Routing is what joins them: a Path 1 output block set to
`Path 2A` makes one long serial chain.

### Hard limits the device enforces

From Dynamic DSP. These are counts, not DSP estimates, so they can be checked
in a file — `tools/check-rules.js` does:

| Block | Maximum |
|---|---|
| Amp or Preamp | 4 per preset, **2 per path** |
| Cab | 4 per preset, **2 per path** (each holding up to 2 cabs/IRs) |
| Poly / high-DSP effects | 2 per preset, **1 per path** |
| Looper | **1 per preset** |

Named poly models: Feedbacker, Poly Sustain, Poly Detune, Poly Pitch, Wham,
Capo, 12 String. DSP cost, roughly: Amp, Clone, Reverb and Poly are expensive;
Cab, EQ, Dynamics, Volume/Pan and Send/Return are cheap; a stereo effect costs
about twice its mono version.

**Block ids are arithmetic, not arbitrary:**

```
id = "b" + String(path * 14 + position).padStart(2, "0")
```

So path 0 position 6 is `b06`; path 1 position 6 is `b20`. Rebuilding a flow
means recomputing ids — moving a block changes its key.

A flow object also carries its own `"@enabled": { "value": true }`.

## Blocks

```json
"b06": {
  "@enabled": { "value": true, "snapshots": [...], "controller": {...} },
  "favorite": 0,
  "harness":  { "@enabled": {...}, "params": {...} },
  "path": 0,
  "position": 6,
  "type": "amp",
  "slot": [ { "@enabled": {...}, "model": "...", "params": {...}, "version": 0 } ],
  "linkedblock": { "block": "b07", "flow": 0 }
}
```

| Field | Notes |
|---|---|
| `type` | `input` `output` `fx` `amp` `cab` `split` `join` — the UI calls a join a **Merge**, and the model id is `P35_AppDSPJoin`. Searching the manual for "join" finds nothing |
| `slot` | an array. Amps and most fx have one; **cabs have two** |
| `harness` | per-type wrapper params — see below |
| `linkedblock` | amp↔cab association. **May be one-way, may cross flows, may be absent entirely.** Three stricter assumptions about this were disproven by factory files — the manual explains why: the link is only established when the cab is added via the amp list's **Add Cab Block** toggle, and never for Clone blocks. A hand-added cab is simply not linked |
| `branch` | present on a split **exactly when its lower path has blocks** (21/21 vs 3/3 in the corpus) |
| `endpoint` | on input/output blocks, naming the opposite end |

### Harness shapes

The harness is a wrapper around the block, distinct from the model's own params.

| Used by | Params |
|---|---|
| blocks created under firmware 1.4+ | adds `CpuMonitor` (boolean, `false`) |
| most fx | `EvtIdx`, `bypass`, `upper` |
| fx with trails (delay, reverb) | adds `Trails` |
| fx with a control source (gate, comp) | adds `ControlSource` |
| cab | adds `dual` |
| input / output | `@enabled` only |
| split / join | `bypass` only |

## Parameters

Three shapes, all under `slot[n].params`:

```json
"Level":  { "value": -7.0 }
"Bass":   { "value": 0.32, "snapshots": [0.32, 0.32, 0.34, 0.40, null, null, null, null] }
"Pedal":  { "value": 0.5,  "controller": { ... } }
```

Values are numbers, booleans or small integers depending on the model. **The
parameter set is per model and the names are not consistent between models** —
see `docs/GOTCHAS.md`, which exists mostly for this.

## Snapshots

Eight slots, always. `preset.snapshots` holds the metadata:

```json
{ "color": "auto", "expsw": -1, "name": "Rhythm", "source": 0, "tempo": 120.0, "valid": true }
```

- **`name` is capped at 10 characters.** 560 corpus names, none longer; factory
  names are visibly abbreviated ("Rhythm Bst").
- The device stamps `color` onto invalid slots too, so emit all eight.

Per-snapshot values live in 8-element `snapshots` arrays on `@enabled` (bypass
state) and on any parameter. `null` marks a slot that is not valid. **Every
valid slot must hold a real value** — a `null` inside the valid range is a hole.

When a preset has more than one valid snapshot, every amp / cab / fx / split /
join block wants an `@enabled.snapshots` array: 96% of corpus cabs and ~98% of
amps and fx carry one, and without it what the block does on recall is undefined
rather than chosen. **Input and output blocks are the exception** and mostly
omit it (inputs 22%, outputs 38%). `tools/fix-snapshot-coverage.js` fills the
gap, seeding from the block's current value so behaviour does not change.

What a snapshot stores, per the manual: **block bypass state** for every
processing block **except the Looper**, including splits and whole switchable
routings; any parameter with **Snapshot Ctrl** on; Command Center values; and
**tempo only if** Global Settings > Tempo/Click > Tempo Select is `Snapshot`
(the default is `Per Preset`, so the `tempo` field in each snapshot is inert
on a default device).

An amp's **`Channel`** parameter is snapshot-controllable, which is how one
preset covers several channels of the same amp.

The per-block **Snapshots Set Bypass** toggle in the UI looks like the presence
of `@enabled.snapshots` on the block: it defaults on, and in one 70-preset
corpus 803 of 823 processing blocks carry the array while input and output
blocks mostly do not. *That mapping is a hypothesis from the correlation, not
something confirmed by writing the file and reading the toggle back.*

**Snapshots cannot change a block's model.** They can change parameters and
bypass state. One useful exception: `P35_AppDSPSplitAB`'s `RouteTo` crossfade
*is* snapshot-controllable, which is how a single preset covers clean and
high-gain from two parallel amps.

## Stereo

There are **four split types**, not two:

| Model | Parameters |
|---|---|
| `...SplitY` | `Balance A`, `Balance B` — even by default; set A left / B right to separate channels |
| `...SplitAB` | `Route To` — the crossfade, and the one that is snapshot-controllable |
| Crossover | `Frequency`, `Reverse` — splits by frequency (highs to A, lows to B) |
| Dynamic | `Threshold`, `Attack`, `Decay`, `Reverse` — splits by how hard you play |

A Merge is `Merge > Mixer` with `A Level`, `A Pan`, `B Level`, `B Pan`,
`B Polarity` and `Level`. Note the manual's warning that "the overall output
level of the signal is increased slightly for each parallel path added" —
compensate on the Merge's `Level`, not further downstream.

`P35_AppDSPSplitY` plus a Join with `"A Pan": 0` and `"B Pan": 1` gives hard
left/right stereo. Cab blocks use `...WithPan` models with a `Pan` parameter,
`0.0` hard left to `1.0` hard right, `0.5` centre.

**A cab block's routing changes with how many slots you use**, which the manual
states outright and which matters more than it sounds:

- **one slot** in use — the block **sums its input to mono**, and outputs stereo
- **two slots** in use — stereo in, stereo out

So a single-cab block is itself a stereo-destroying block, and a dual-cab block
is the only cab configuration that passes a stereo image through. `NO CAB` is
only selectable for the *second* slot.

A cab block has **two slots**. The second may be `HD2_CabMicIr_NoCab`, or a real
cab — including a **different** cab model, which four factory presets do (all of
them leaving `dual` absent). Two hard-panned cabs is the tone-preserving way to
make a single-amp patch stereo: two mic images of one amp, so the amp voicing is
untouched.

**Mono blocks sum stereo back to centre.** See `docs/PATCH-DESIGN.md` — it is
the most common way to build a patch that looks stereo and is not.

### The shape of a model id

Not `KNOWNPREFIX_FamilyNameVariant`. Across 318 ids in one corpus, all five of
these forms occur:

| form | example | count |
|---|---|---|
| `PREFIX_Name` | `HD2_DelayMultiPassStereo` | `HD2_` 214, `Agoura_` 30, `VIC_` 20, `HX2_` 19, `P35_` 16 |
| a prefix outside the obvious set | `L6SPB_PolyWham` | 4 |
| a prefix plus an inner device marker | `HD2_DL4AnalogDelayStereo` (`DL4`, `MM4`, `FM4`, `DM4`) | several |
| generation marker as a **suffix**, no prefix | `EuclideanDelayStereo_Victoria` | 1 |
| no marker at all | `TapeEater` | 1 |

So the prefix set is open-ended, two of the forms are not prefixes, and the
family token cannot be assumed to sit at the start of what remains after
stripping. Anything matching `^(HD2_|HX2_|VIC_|P35_|Agoura_)` will skip models
without saying so. `tools/mine-catalogue.js` has a `stem()` worth copying.

Separately: **the id is not the menu name.** Ten confirmed cases share no text
at all with the display name — see `docs/MODEL-NAME-MAP.md`, which also covers
how to establish a mapping that holds.

### Mono and stereo variants of the same model

Most effects ship as two models, `...Mono` and `...Stereo`. They are separate
ids with separate parameter sets, so you cannot rename the suffix and hope.

Across 55 sibling pairs in the corpus, a stereo variant **only ever adds**
parameters — it never drops one or renames one. What it adds depends on the
family, and that is the part worth knowing before you generate one you have no
bytes for:

| Family | Pairs seen | What stereo adds | Safe to derive? |
|---|---|---|---|
| distortion, fuzz, compressor, EQ, volume/pan, looper | 17 | nothing | **yes** |
| reverb | 6 | nothing | **yes** |
| wah **and filter** | 5 | nothing | **yes** |
| modulation (chorus, phaser, flanger, tremolo, vibrato) | 16 | `Spread` — 14 of 16 | no: Dimension W adds nothing, 70s Chorus also adds `Stereo` |
| pitch | 5 | one pan per voice | **yes** — see the voice rule below |
| delay | 11 | `Scale`, `Spread`, `Source`, or nothing | **no** |

**Pitch follows a mechanism, not a family rule.** A stereo pitch variant adds one
pan parameter for each discrete voice the model has, plus `PanDry` when it mixes
in dry signal, and adds nothing when it has no voices:

| model | voice parameters | stereo adds |
|---|---|---|
| Dual Pitch | `LevelVoice1`, `LevelVoice2` | `PanVoice1`, `PanVoice2`, `PanDry` |
| Twin Harmony | `LevelVoice1`, `LevelVoice2` | `PanVoice1`, `PanVoice2` |
| Simple Pitch | `LevelVoice1` | `PanVoice1`, `PanDry` |
| Pitch Wham | none — a pedal bend | nothing |
| Boctaver | none — `Oct1Level`/`Oct2Level` | nothing |

So the test is whether the mono variant's parameter set contains `LevelVoiceN`,
which is checkable in bytes you already hold. That makes pitch derivable.

**Delay is the one family that is not.** Over 11 pairs the addition is `Scale`
and `Spread` (4), `Scale` alone (3), `Spread` alone (2), `Source` alone (Double
Take), or nothing (Glitch Delay) — with no property of the mono variant that
predicts which.

Two cautionary notes on how that table was built. An early revision claimed the
additions came only from `{Spread, Scale, Stereo}`; that held across 36 pairs and
was false, because the sample happened to contain no pitch effects. A later
revision then called pitch "unpredictable, needs bytes" on the strength of three
pairs; two more pairs showed the mechanism and made it predictable. **A rule
induced from a corpus is only as general as that corpus's coverage of the thing
being ruled on** — and "unpredictable" is itself a claim that needs the same
scrutiny as a rule, because it stops you looking.

## Controllers: footswitches and expression pedals

`preset.sources` declares the control surface; individual assignments live on
the thing being controlled.

**Source ids are packed bytes, not a lookup table.** Read one as four bytes —
`class | group | kind | index` — and the whole control surface falls out:

| Hex | Decimal of index 0 | Source | `behavior` |
|---|---|---|---|
| `0x01 01 01 nn` | 16843008 | **Stomp A** switch *nn* | `latching` |
| `0x01 01 02 nn` | 16843264 | **Stomp B** switch *nn* | `latching` |
| `0x01 01 05 00` | 16844032 | **toe switch** | `latching` |
| `0x01 02 01 nn` | 16908544 | **expression pedal** *nn* | `continuous` |
| `0x02 02 01 nn` | 33685760 | external controller *nn* (XL) | `latching` |
| `0x04 04 01 nn` | 67371264 | **Instant** *nn* (Command Center only) | `latching` |
| `0x08 02 03 00` | 134349568 | **XY controller** axis | `latching` |

Earlier revisions of this file described `16843008 + n` as "footswitch *n*" and
gave the toe switch as `0x1010400`. Both were wrong: Stomp A and Stomp B are
separate `kind` bytes, and the toe switch is `0x01010500`.

A bypass assignment is `type: "targetbypass"` on the block's `@enabled`. A
parameter assignment is `type: "param"` on the parameter:

```json
"controller": {
  "behavior": "continuous", "bypassed": true, "curve": "linear",
  "delay": 0, "goid": 0, "max": 1, "midisource": 0, "min": 0,
  "source": 16908544, "threshold": 0.0, "type": "param"
}
```

`source: 0` means **unassigned**, not a missing declaration.

Those field names are opaque in the file and obvious in the UI:

| Field | Called in the UI | Notes |
|---|---|---|
| `min` / `max` | Min Value / Max Value | heel and toe for a pedal. **`min` > `max` is legal** and reverses the control |
| `threshold` | Position | for a bypass on a pedal: where in the travel it switches |
| `delay` | Wait | how long before the bypass follows |
| `behavior` | Type / Behavior | `latching` toggles, `momentary` only while held, `continuous` for a pedal |
| `midisource` | MIDI In | `0` = None; otherwise a CC, where 0–63 is off and 64–127 on |
| `curve` | — | `linear` throughout the corpus; the manual does not document alternatives |
| `goid` | — | still unexplained; copy what the corpus has |

The device drops `bypass` from any switch entry in `sources` that nothing is
assigned to, so only emit it for switches actually in use.

### A wah, which is the worked example

Every wah in the corpus is wired identically — and the manual confirms this is
not a convention someone chose but what the device does automatically when you
add the block. Copy it rather than reinventing it:

- the block sits at **position 1**, straight after the input
- its `Pedal` parameter → **EXP 1** (`16908544`, continuous)
- its **bypass** → the **toe switch** (`16844032`, latching), so rocking the
  pedal past toe-down engages it — no footswitch involved
- it is therefore bypassed in **every** snapshot: the pedal owns it, so the wah
  stays available regardless of which snapshot is active

This needs the pedal sources declared in `preset.sources` (`{"bypass": false}`
for each of `16844032`, `16908544`, `16908545`) — in this toolkit,
`preset({ pedals: true })`. Without them the assignments exist but the device
has nowhere to attach them.

**A volume or pan block gets the same treatment on EXP 2**: Position (or Pan) to
EXP 2, bypass to the toe switch. Assigning the parameter and forgetting the
bypass leaves the block permanently in circuit, so wherever the pedal happens to
be parked sets the level — park it at heel and the patch is silent.

**This differs by device.** On a **Stadium XL** the bypass goes to the onboard
**toe switch**, as above. On a **Stadium** (no onboard pedal) it goes to
**EXP Toggle**, and the user wires an external pedal and switch to the Control
A/B jack. If you are generating for a non-XL, the corpus you mined will tell
you which one your device writes.

## Command Center (`preset.commands`)

An **optional** top-level section, absent from most presets. It is a map of
**source id → array of commands**, keyed by exactly the ids in the table above.

```json
"commands": {
  "16843012": [
    { "behavior": "latching", "curve": "linear", "delay": 0, "goid": 0,
      "ordinal": 0, "threshold": 0, "toggle": false, "type": "MIDI",
      "params": { "Action": { "value": 1 }, "CC#": { "value": 20 }, ... } },
    { "ordinal": 1, "type": "MIDI", "params": { "Action": { "value": 0 }, ... } }
  ]
}
```

The meta fields are the same shape as a controller assignment, plus `ordinal`
and `toggle`.

### Two commands on one source

Stomp switches, the toe switch, external switches and triggers take **two**
commands — the two tabs in the inspector. Both live in the one array, each
carrying its own `ordinal` (0 and 1).

- `ordinal` is **tab order, not action order.** In the corpus sample, ordinal 0
  holds the Release and ordinal 1 the Press.
- The pair may use **different CC numbers**. The manual's description — the same
  CC with two values — is a convention it suggests, not a constraint the format
  enforces.

### The seven command types

`type` selects the category, and each has its own parameter set:

| `type` | Parameters |
|---|---|
| `MIDI` | three shapes — see below |
| `PresetSnapshot` | `Action`, `Command`, `Preset`, `Setlist`, `Snapshot` |
| `Looper` | `Action`, `Command` |
| `Utility` | `Action`, `Command`, `Level Trim` |
| `Song` | `Command`, `Wait` |
| `ExtAmp` | `Action`, `Select`, `toggle` |
| `HotKey` | `Keystroke`, `Modifier 1`, `Modifier 2`, `Modifier 3`, `Wait` |

`Utility.Level Trim` is **not in the manual**, which lists only Action and
Command for that category. It is in the bytes regardless.

In `PresetSnapshot`, `Command` picks what the switch does: **7 = Snapshot**,
**4 = Preset**, with `Snapshot` / `Setlist` / `Preset` as the sibling indices.
The indices read 0-based — snapshot 3 stores as `2`.

### MIDI has three parameter shapes, chosen by the source class

| Shape | How to tell | Sources |
|---|---|---|
| switch | has `Action`, no `Wait` | Stomp A/B, toe switch, external, triggers |
| instant | has `Wait`, no `Action` | Instant 1~16 |
| continuous | `Curve`, `Min Value`, `Max Value`; no `Action`, no `Command` | expression pedals, XY axes |

So the shape is derivable from the source id — no probing needed. The switch and
instant shapes otherwise share their keys: `CC#`, `Command`, `LSB`, `MIDI Ch`,
`MSB`, `Message`, `Note`, `NoteOff`, `PC`, `Value`, `Velocity`.

`Command` selects the message: **0 = PC, 1 = CC, 2 = Note**. The siblings a
given message does not use stay present and parked — `PC: -1`, `MSB: -1`,
`LSB: -1` — so a MIDI command always writes the full set.

**`Value` is optional on the continuous shape.** Two of three corpus samples
carry it and one does not; it appeared on a re-save of the same preset. Treat it
as optional or the validator will flag good files.

### `Action`

| Value | Action |
|---|---|
| 0 | Press |
| 1 | Release |
| 2 | Hold |
| 3 | Toggle |

Expression pedals, XY axes and Instants have no `Action` at all.

### Snapshot control of a command value

A command parameter under snapshot control gains **`snaptarget: true`** beside
its `snapshots` array:

```json
"PC": { "snapshots": [4, 6, null, null, null, null, null, null],
        "snaptarget": true, "value": 4 }
```

**`snaptarget` appears on no block parameter** — 0 of 1849 snapshot-controlled
block parameters in the corpus carry it. Writing a snapshot-controlled command
by analogy to a block parameter therefore produces a command that does not
track snapshots.

### What a source will not accept

The manual's Source Controller Types table is worth obeying, because the device
simply does not offer the option:

- **Instant 1~16** take every type **except `PresetSnapshot` and `Utility`**.
- **Expression pedals and XY axes** take **MIDI CC only**, one command each.
- Everything else takes all types, two commands each.

### `toggle` is not configuration

The meta field `toggle` read `true` on one Instant and `false` on the same
Instant after a re-save with nothing deliberately changed. Corpus-wide it is 22
`false` to 1 `true`. It is **not** the Toggle action — that is `Action: 3` with
`toggle: false`. Write `false` and do not read meaning into it.

## `preset.params`

```json
{ "activeexpsw": 1, "activesnapshot": 0, "inst1Z": "FirstEnabled",
  "inst2Z": "FirstEnabled", "tempo": 120.0 }
```

`inst1Z` / `inst2Z` are the **Instrument Input Z** setting — the input
impedance circuit that loads your pickups. `FirstBlock` follows the first
block whether or not it is enabled, `FirstEnabled` follows the first *enabled*
block, or a fixed value from 10k to 1M Ohm. Lower values roll off highs and
soften the feel; higher values are brighter and tighter. `activesnapshot` is
the snapshot the preset opens on.

## When the firmware changes

Everything in this document was learned from one device on two firmware
versions. An update can invalidate any of it, and the dangerous failure is
silent: if the firmware starts rendering a number differently, the writer keeps
using the old convention and the first symptom is a unit that faults.

**First, read the vendor's release notes.** The check below compares files,
so it can only report on models your sample actually uses. Re-export the
presets you already had and it will say "no new models" — truthfully about the
sample, misleadingly about the firmware. An update that adds amps and effects
adds them to a list you have no preset for yet.

**Then export a handful of presets and run:**

```bash
node tools/check-firmware-delta.js path/to/new-exports
```

It reports, worst consequence first: number-formatting changes, device id and
version, schema shape, added or removed models, and parameter-set changes on
models present in both. Export presets whose filenames match ones already in
your corpus — that isolates firmware changes from preset differences.

### A worked example: 1.3.2 to 1.4.1

Running exactly that check across nine re-exported presets found:

- **Number formatting: unchanged** across 1345 fields. The thing that could
  have faulted the unit did not change.
- **`device_version`** 318899516 → 335611199, i.e. 1.3.2.1340 → 1.4.1.1343.
- **A new parameter, `CabIdx`**, on the `Agoura_*` amp models — always `-1`
  (this format's "unset", as with `EvtIdx`), and present whether or not the amp
  has a `linkedblock`. The `HD2_*` amps did **not** gain it.
- **A `CpuMonitor` harness parameter** (boolean, `false`) on blocks *created*
  under 1.4 — almost certainly the release notes' improved per-block DSP
  reporting. It appeared on all 18 blocks of six freshly built presets and on
  **none** of the 111 migrated effect blocks in the corpus, which run fine
  without it. So it is optional, and this toolkit does not write it. Note that
  the first version of the delta check did not find this at all: it compared
  preset, block and slot key sets and never looked inside `harness`. It does
  now.
- Nothing else: no other new parameters anywhere, and block and slot schema
  unchanged.

The release notes then explained the one finding: 1.4 lists "speaker cabinet
interaction with Agoura power amps is more accurate." `CabIdx` is that
link — the Agoura amp's own reference to its cab, separate from the existing
`linkedblock`. Which is why it lands on the Agoura family and not on `HD2_*`.

**What the check could not tell us:** 1.4 added three amp models and six
effects. None appeared, because all nine presets predated the update. New
models only become usable once one of them appears in a preset the device
wrote — see below.

### New models an update adds

A model needs two things before it can be written safely: its parameter set
(names are per-model and not guessable — see `docs/GOTCHAS.md`) and the
float-vs-int rendering of each of those parameters. Both come only from a
preset **the device wrote**.

So for each new model: make a scratch preset on the device that uses it, export
it into `corpus/`, and re-run `node tools/mine-catalogue.js`. One preset can
carry several new effects at once; amps are DSP-hungry, so expect to split them.

If a new amp offers several channels or eras, check whether they are
*parameters* or separate *model ids* before assuming: export it twice with
different channels selected and compare. On the one amp where this was tested —
the Brit SL100, twelve channels — the two exports differed in a single integer
`Era` parameter and nothing else, so one export covered all twelve. Expect
parameters, but verify, because snapshots cannot change a model and a differing
id would mean one export per channel.

Once the exports are in, `node tools/check-builders.js` compares every builder
against the device's own copy of that model: key set, int-vs-float rendering,
and value as float32. It is the check worth running after writing a builder
from a fresh export, because it catches a mistyped parameter name or a
guessed-at value immediately.

`lib/builders.js` writes `CabIdx` only when the `FIRMWARE` constant you set
there is 1.4 or later, so a unit on 1.3.x does not receive a parameter its
firmware has never seen.

**One honest caveat on that finding:** eight Agoura models were observed with
`CabIdx` and three HD2 models without it. That the whole Agoura family gained
it is an *inference* from the pattern, not something every model was observed
doing — a sample of nine presets does not contain every amp. If your validator
reports `extra param "CabIdx"` for an Agoura amp, that is the tool correctly
telling you it has never seen that particular model carry it.

## Telling device-written files apart from generated ones

Device-written files contain float artefacts like `-6.66e-15` where a clean
`0.0` was meant. This writer never produces them, so their presence means the
file came back off the unit — useful when deciding whether a file holds edits
you should not overwrite.
