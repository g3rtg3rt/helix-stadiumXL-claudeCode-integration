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
  "preset": { "clip", "cursor", "flow", "params", "snapshots", "sources", "xyctrl" }
}
```

`meta.info` is the free-text notes field shown in HX Edit. It is a good place to
record *why* a patch is set up the way it is — it travels with the file.

## Signal routing: flows, paths, positions

Four grids of blocks:

```
preset.flow[0]   Path 1      path 0 = upper, path 1 = lower
preset.flow[1]   Path 2      path 0 = upper, path 1 = lower
```

Each path has **14 positions**, `0` to `13`. Position 0 is the input block and
13 the output block, leaving 1–12 for processing.

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
| `type` | `input` `output` `fx` `amp` `cab` `split` `join` |
| `slot` | an array. Amps and most fx have one; **cabs have two** |
| `harness` | per-type wrapper params — see below |
| `linkedblock` | amp↔cab association. **May be one-way, may cross flows, may be absent entirely.** Three stricter assumptions about this were disproven by factory files |
| `branch` | present on a split **exactly when its lower path has blocks** (21/21 vs 3/3 in the corpus) |
| `endpoint` | on input/output blocks, naming the opposite end |

### Harness shapes

The harness is a wrapper around the block, distinct from the model's own params.

| Used by | Params |
|---|---|
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

**Snapshots cannot change a block's model.** They can change parameters and
bypass state. One useful exception: `P35_AppDSPSplitAB`'s `RouteTo` crossfade
*is* snapshot-controllable, which is how a single preset covers clean and
high-gain from two parallel amps.

## Stereo

`P35_AppDSPSplitY` plus a Join with `"A Pan": 0` and `"B Pan": 1` gives hard
left/right stereo. Cab blocks use `...WithPan` models with a `Pan` parameter,
`0.0` hard left to `1.0` hard right, `0.5` centre.

A cab block has **two slots**. The second may be `HD2_CabMicIr_NoCab`, or a real
cab — including a **different** cab model, which four factory presets do (all of
them leaving `dual` absent). Two hard-panned cabs is the tone-preserving way to
make a single-amp patch stereo: two mic images of one amp, so the amp voicing is
untouched.

**Mono blocks sum stereo back to centre.** See `docs/PATCH-DESIGN.md` — it is
the most common way to build a patch that looks stereo and is not.

## Controllers: footswitches and expression pedals

`preset.sources` declares the control surface; individual assignments live on
the thing being controlled.

| Source id | Meaning | `behavior` |
|---|---|---|
| `16843008 + n` (`0x0101xxxx`) | footswitch *n* | `latching` |
| `16844032` (`0x1010400`) | **toe switch** | `latching` |
| `16908544` (`0x1020100`) | **expression pedal 1** | `continuous` |
| `16908545` (`0x1020101`) | expression pedal 2 | `continuous` |

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

The device drops `bypass` from any switch entry in `sources` that nothing is
assigned to, so only emit it for switches actually in use.

### A wah, which is the worked example

Every wah in the corpus is wired identically, and it is worth copying rather
than reinventing:

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

## `preset.params`

```json
{ "activeexpsw": 1, "activesnapshot": 0, "inst1Z": "FirstEnabled",
  "inst2Z": "FirstEnabled", "tempo": 120.0 }
```

## When the firmware changes

Everything in this document was learned from one device on two firmware
versions. An update can invalidate any of it, and the dangerous failure is
silent: if the firmware starts rendering a number differently, the writer keeps
using the old convention and the first symptom is a unit that faults.

**After any firmware update, export a handful of presets and run:**

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
- Nothing else: no other new parameters anywhere, and block and slot schema
  unchanged.

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
