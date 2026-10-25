# Menu name is not model id

The name the device shows in its model list and the `model` string it writes into
a `.hsp` are **separate namespaces**. Most of the time they share enough text to
match by eye. Sometimes they share nothing at all, and there is no transformation
from one to the other.

This matters because the obvious way to answer "which models do I have?" is to
match the official Model List's display names against the ids in your corpus.
That method **silently undercounts**. Every case below was first reported as a
missing model that was in fact already in hand.

## Confirmed mismatches

| menu entry | model id | how it was established |
|---|---|---|
| 3 OSC Synth | `HD2_SynthSubtractiveStereo` | elimination + 3 oscillator voices in its parameters |
| Poly Capo | `L6SPB_PolyDowntune` | elimination + an `Interval` parameter |
| Poly Detune | `L6SPB_PolyChorus` | a `Detune` parameter, and it is the only poly in the file |
| Deluxe Looper | `P35_LooperHelixStereo` | block position, 7 consecutive slots aligned |
| Mystery Filter | `HX2_FilterMysterFilterStereo` | the id drops the `y` from "Mystery" |
| Tesselator | `VIC_DelayStutterEditStereo` | block position, 8 consecutive slots aligned |
| Bleat Chop Trem | `HD2_TremoloPatternStereo` | set difference against a 9-model request |
| Double Take | `HD2_DelayDoubleDoubleStereo` | set difference against the same request |
| Hot Springs | `HD2_ReverbHxSpringStereo` | block position + `Drip`/`Dwell`/`Spring Count` |

The pattern, where there is one: **the id names the mechanism and the menu names
the feel.** A step-sequenced tremolo is `TremoloPattern` on disk and "Bleat Chop
Trem" on screen. A doubler is `DelayDoubleDouble` on disk, "Double Take" on
screen, and filed under *Modulation* in the menu despite the `Delay` in its id.
A detuner is `PolyChorus`. Knowing the pattern does not let you predict the next
one.

## How to establish a mapping

Ranked by how much it proves:

1. **Block position.** Place the models you want in a known order, one per slot,
   and export. The ids come back in `b00`…`b27` order, so slot *n* is request
   *n*. This is the only method that proves a mapping rather than suggesting one,
   and it costs nothing — just place them in order.
2. **A distinctive parameter.** `Detune` on a detuner, `Spring Count` on a spring
   reverb. Strong, but a family can share parameters.
3. **Elimination.** If a preset holds *k* models and *k−1* map by name, the last
   one is the last request. Only valid when you can rule out extra blocks the
   file might contain for other reasons — a preset that also carries a bonus
   model breaks it.
4. **Semantic resemblance.** Weakest. `HxSpring` ↔ "Hot Springs" happens to be
   right; `Rotating` ↔ "Dynamic Hall" is not (see below).

## A case where resemblance was wrong

`VIC_ReverbRotatingStereo` sat in the slot where "Dynamic Hall" was requested,
which by method 1 should have settled it. It is a different model:

- the Dynamic reverb family is consistently `VIC_ReverbDyn…` —
  `VIC_DynPlate`, `VIC_ReverbDynRoom`, `VIC_ReverbDynAmbience`,
  `VIC_ReverbDynBloom` — and `Rotating` carries no `Dyn`;
- `Rotating` has a `Motion` parameter, which `VIC_ReverbShimmer` also has and no
  `Dyn…` reverb does;
- `Rotating` was already present in factory presets before the request.

So the slot held a mis-picked block, not a renamed one. **Method 1 proves a
mapping only when the person placing the blocks found the model they were
aiming for** — if they placed the wrong one, position faithfully records the
wrong answer. Cross-check against the family's own naming before trusting it.

## The official Model List goes stale

The published Model List is versioned, and a device on newer firmware has models
that are not in it. An id you cannot match may be a renamed model *or* a model
added after the list you are reading. Nothing in the file distinguishes those two
cases, so an unmatched id is not evidence of a mismatch on its own.
