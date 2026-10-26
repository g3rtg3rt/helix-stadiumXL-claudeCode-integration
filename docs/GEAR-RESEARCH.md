# Building a patch for a specific song

A patch for a named song has a right answer that exists outside your ears: the
rig that was actually used. This document is about finding it, mapping it onto
models, and deviating from it on purpose rather than by accident.

It exists because the alternative does not work. Picking models by instinct and
then tuning by ear produces patches that sound fine and are wrong in ways you
cannot hear from inside the patch — and the corrections are usually one model
away, already installed.

## The failure this prevents

Two patches in the author's own set, both built by choosing a model whose name
sounded right:

| Patch | Model used | What the record used | What was available all along |
|---|---|---|---|
| Enter Sandman | `HD2_AmpCaliIVR1` — Mesa Mark **IV** | Mesa Mark **IIC+** | `Agoura_AmpCali2CPlus` |
| Voodoo Child | `HD2_DistBallisticFuzzMono` — "Ballistic Fuzz" | Dallas Arbiter **Fuzz Face** | `HD2_DistArbitratorFuzzMono` |

"Ballistic Fuzz" is Line 6's model of a **Euthymia ICBM**: a modern boutique
fuzz with a tone control the Fuzz Face does not have. Nothing about the name
says so. Nothing in the file says so. The patch sounded good, and the fuzz was
the wrong circuit for a 1968 record.

## Step 1 — find the documented rig

Search for the song plus "guitar gear", "rig", "tone breakdown". Gear
journalism and artist-rig sites are the realistic sources; session
documentation almost never exists.

**Treat attribution carefully, because the sources do.** The better ones label
their own guesses — "most likely", "you can assume", "not entirely confirmed" —
and that labelling is the most valuable thing on the page. Carry it forward
instead of laundering it into fact. Three grades worth distinguishing:

- **Interview-backed.** The player said it. Rare and worth building on.
- **Stated as fact, unsourced.** Common. Usually right about amps, less reliable
  about which guitar played which track.
- **Inferred from a pedalboard photo.** "He had one at the time" is not "he used
  it on this song."

What you want, in order: the amp(s), the cab, the pedals, **how they were
connected**, and the pickup position. Routing is often the signature — the
Boss CE-1 on *By the Way* was used as a preamp *and as the splitter feeding two
Marshalls*, which is more characteristic of those tones than any single pedal.

## Step 2 — map it through Line 6's own "Based on" column

Line 6 publishes a model list with a **Based on** column covering all ~490
models. That column is authoritative and is the only reliable way to go from
hardware to model. Do not go from the model name.

```bash
node tools/model-lookup.js fuzz face
node tools/model-lookup.js "super bass"
node tools/model-lookup.js --list        # everything, as TSV
```

Names that mislead, all confirmed from that column:

| Model name | What you would guess | What it actually models |
|---|---|---|
| Ballistic Fuzz | a Fuzz Face | Euthymia ICBM |
| Arbitrator Fuzz | something generic | Arbiter Fuzz Face |
| Brit Jujube | nothing in particular | Marshall Silver Jubilee |
| Brit MegaBass | a bass rig | Marshall Super Bass 1992 |
| Triangle Fuzz | a shape | Electro-Harmonix Big Muff Pi |
| Bighorn Fuzz | a different shape | '73 Ram's Head Big Muff Pi |
| 70s Chorus | a generic chorus | BOSS CE-1 Chorus Ensemble |
| Courtesan Flange | nothing in particular | EHX Deluxe Electric Mistress |
| Jazz Rivet 120 | a jazz amp | Roland JC-120 |

The lookup returns **display names**. The id written into a `.hsp` is a separate
namespace — see [MODEL-NAME-MAP.md](MODEL-NAME-MAP.md) — so confirm the id
against your own corpus with `tools/mine-catalogue.js` before building.

## Step 3 — expect gear that is not modelled at all

Plenty of famous equipment has no model. Checked against all 492 rows: there is
no Marshall Major, no Fender Vibroverb, no Marshall ShredMaster, no Fender
Eighty-Five, no Ibanez WH-10.

When that happens, say so in the builder and name the substitute:

```js
/* NO MARSHALL MAJOR MODEL EXISTS. Brit SL100 (Super Lead '67-'71) is the
 * closest thing in the device: same plexi-era preamp family, wrong output
 * stage. The Major's extra headroom is approximated by keeping NormDrv modest
 * rather than by winding drive up. */
```

A substitution recorded like that stays reviewable. An unrecorded one becomes
indistinguishable from a mistake six months later — which is exactly how the
Mark IV above survived.

## Step 4 — deviate deliberately, and write down why

Three things force deviation every time:

1. **Your guitar is not the guitar on the record.** Published settings almost
   always assume a single coil. A humbucker inverts drive, treble and low-shelf
   direction — see [PATCH-DESIGN.md](PATCH-DESIGN.md). The record tells you
   which *models*; it does not tell you your knob positions.
2. **Mono-only models cannot sit after a split.** If the documented chain has a
   pedal after the amps and only a stereo model exists — or vice versa — one of
   the two has to move. Prefer the right pedal in the wrong place over the wrong
   pedal in the right place: the circuit is more audible than the position.
3. **A studio tone is usually not one amp.** Layered takes, re-amping, and mix
   EQ you cannot reproduce in a preset. A faithful single-amp copy can sound
   thinner than the record and read as wrong.

## Step 5 — put the sources in the builder

The builder is where the reasoning has to live, because it is the only file that
travels with the patch:

```js
/* THE RIG ON THE RECORD                       WHAT THIS PATCH USES
 *   1960 Fender Custom Telecaster, bridge      a Les Paul -- see VOICING
 *   Boss CE-1 Chorus Ensemble                  70s Chorus      EXACT
 *   Marshall Major, 200W                       Brit SL100      substitute
 *   Marshall Super Bass, 100W                  Brit MegaBass   EXACT
 *   EHX Deluxe Electric Mistress (bridge)      Courtesan Flange EXACT
 *   EHX Big Muff Pi (solo)                     Triangle Fuzz   EXACT
 */
```

Then put the deviations in the preset's `info` text as well, so they are
readable on the device by whoever is standing in front of it — including you,
two years later, wondering why the flanger is after the amps.

## What this does not fix

Research gets the equipment right. It does not get the *performance* right, and
for some songs that is most of the sound: the "Can't Stop" riff is a hard pick
attack with nearly everything muted, and no amount of model-matching
substitutes for that. When a patch sounds wrong and the models are right, the
answer is usually in the right hand.
