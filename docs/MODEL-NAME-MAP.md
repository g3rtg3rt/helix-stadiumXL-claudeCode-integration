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
| Dynamic Hall | `VIC_ReverbRotatingStereo` | block position + the Dynamic family's parameter signature |
| Bighorn Fuzz | `HD2_DistRamsHeadMono` | block position; the official list's `basedOn` names the circuit |

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
2. **A family parameter signature.** Parameters that appear on one family and
   nowhere else place a model even when its id does not. `BassBoost` + `BassFreq`
   + `Damping` occur on exactly four models in a 318-model corpus, all four in
   the Dynamic reverb group; no other reverb has any of them.
3. **A distinctive single parameter.** `Detune` on a detuner, `Spring Count` on a
   spring reverb. Suggestive, but one parameter can be shared more widely than
   you think.
4. **Elimination.** If a preset holds *k* models and *k−1* map by name, the last
   one is the last request. Only valid when you can rule out extra blocks the
   file might hold for other reasons — a preset that also carries a bonus model
   breaks it, and they often do.
5. **Naming convention.** Weakest of all, and the one most likely to feel
   convincing. See below.

## Do not let a naming convention overrule position

`VIC_ReverbRotatingStereo` arrived in the slot where "Dynamic Hall" was
requested, and was then rejected on the grounds that the Dynamic reverb family is
consistently `VIC_…Dyn…` — `VIC_DynPlate`, `VIC_ReverbDynRoom`,
`VIC_ReverbDynAmbience`, `VIC_ReverbDynBloom` — while `Rotating` carries no
`Dyn`. The conclusion was wrong. It is Dynamic Hall, and the parameter signature
says so plainly: `BassBoost` + `BassFreq` + `Damping` sit on the three `Dyn…`
reverbs and on `Rotating`, and on no other reverb in the corpus. `Motion` is
what a rotating reverb matrix would expose, which is the usual arrangement here —
the id names the mechanism, the menu names the feel.

The mistake worth remembering is the shape of it: **a naming convention was used
to overturn the one method that proves a mapping, in a format whose central
lesson is that names are unreliable.** If the id and the position disagree,
position wins unless a *parameter-level* fact contradicts it.

Two weaker arguments also went into that wrong call, and neither was evidence:
that the model already appeared in factory presets (a factory preset using
Dynamic Hall is exactly what you would expect), and that one parameter, `Motion`,
is shared with Shimmer (families overlap; that is why signature means a *set* of
parameters, not one).

Position does still fail when the person placing the blocks did not find the
model they were aiming for — it faithfully records a mis-pick. Resolve that by
checking the parameter signature, not the id's spelling.

## `basedOn` is a hint for you, not a second matcher

The Model List carries a "based on" column naming the original gear, and
sometimes the model id is built from *that* rather than from the menu name.
"Bighorn Fuzz" is `HD2_DistRamsHeadMono`, and the list says it is based on a
"'73 Electro-Harmonix Ram's Head Big Muff Pi". So when a name match fails, read
that row's `basedOn` and look for a distinctive proper noun.

**Do not automate it.** Matching ids against `basedOn` tokens was measured over
491 rows: 240 match by name, and a token pass on `basedOn` claims 92 more, of
which most are wrong — "lead", "clean", "crunch", "super", "deluxe", "twin" and
even "with" all match unrelated ids. It produces false positives faster than
real matches, which is worse than not running it, because a false *match* reads
as success while a false *miss* at least prompts a look.

Proper nouns work (Ram's Head, Revv, Omega, GSG100); descriptive words do not.
That distinction is easy for a person reading one row and unreliable as a rule.

## The official Model List goes stale

The published Model List is versioned, and a device on newer firmware has models
that are not in it. An id you cannot match may be a renamed model *or* a model
added after the list you are reading. Nothing in the file distinguishes those two
cases, so an unmatched id is not evidence of a mismatch on its own.
