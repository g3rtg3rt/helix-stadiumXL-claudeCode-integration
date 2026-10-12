# Patch design

`GOTCHAS.md` is about making a file the device accepts. This is about making a
patch that works musically. All of it came from building patches, playing them
at rehearsal, and being told what was wrong.

---

## Mono blocks destroy stereo, silently

**A mono block downstream of the cab — or of the Join — sums hard-panned stereo
back to centre.**

This is the most common way to build a patch that looks stereo and is not. It
has been the root cause four separate times, and in the worst case it is
invisible until someone engages the block:

- A mono flanger sitting after the cab made a dual panned cab pointless. Moving
  it in front of the amp fixed it — mild in that case, because the amp ran near
  clean, so pre- versus post-amp placement mattered much less than it would on a
  cranked amp.
- A mono tremolo sitting after the Join, **bypassed by default**, would have
  collapsed two hard-panned amps the first time the tremolo was used, and never
  before. Nothing would have looked wrong.

**Before moving a mono block, check for a `...Stereo` twin of the same model.**
A mono compressor swapped for `HX2_CompressorDeluxeCompStereo` kept its exact
values and its position, because the stereo version has an **identical
parameter set**. Not every model has a twin — the Gray Flanger does not — and
then you have to choose between moving it and losing the width.

**Verify, do not assume.** After any stereo change, walk the flow and print
every block downstream of the cab or Join, flagging any model ending `Mono`.
It takes five lines and it catches the thing you cannot hear.

Reverb, delay and EQ are **linear**, so a gain block before them sounds
identical to one after. Useful when the only free position is upstream — and
sitting ahead of a reverb has a real advantage: a snapshot change does not
retroactively rescale a tail that is still ringing, so transitions do not jump.

## Keep the three level jobs apart

| Control | Job | Snapshot-controlled? |
|---|---|---|
| preset **output** block `gain` | how loud this PATCH is vs your others | **No — one value** |
| a `VolPanGainStereo` block at the end of the chain | per-snapshot level, in dB | Yes |
| amp `Level`/`ChVol`, cab `Level`, amp drives | the left/right mix and the voicing | **No — frozen** |

Mixing these is what makes balancing unmanageable. The failure that prompted
this: a verse was being pulled back by moving four controls at once — amp
`ChVol`, one cab `Level`, the other amp's `Level` and its cab `Level`. Three
distinct problems resulted:

1. Four controls in two different units that interact. Changing the verse level
   meant four coordinated edits.
2. **`ChVol` is not a level control.** It is a 0–1 taper, so using it for level
   re-voices the amp — and near the top of the taper it barely changes the level
   at all. A `0.85 → 0.97` "boost" was inaudible, which read as the boost being
   broken rather than as the wrong control.
3. **The two sides moved by different amounts, so the stereo image slid
   sideways between snapshots.** This is the one that is hard to diagnose by
   ear: it reads as the sound jumping, not as a level error.

Amp **drives** count as voicing and must be frozen too. Leaving
`Drive`/`NrmDrv`/`BrtDrv` snapshotted changes breakup per snapshot, which fights
a level control.

The payoff: one number per snapshot, and all your patches work the same way —
which matters when you are editing on the unit at rehearsal rather than at a
desk.

## Level alone cannot make a hard-played part sit back

If someone digs in on a verse, a level cut scales the transients down too and
they still punch through. That is a **dynamics** problem, not a volume one.

Four cues push a part back. Only one costs dynamics:

| Cue | Costs dynamics? |
|---|---|
| level, via the gain block | no |
| a deeper cut in the harsh band (2–3 kHz) | no |
| more reverb — wet reads as distance | no |
| heavier compression | **yes, all of it** |

Use all four and the part sits back convincingly: quieter, duller, further away
and squashed. Then when the player asks for *more dynamics* in that same part —
which sounds contradictory and is not — you take the compressor right off and
let the other three hold it back. Name the conflict, then give back the only
control that was hurting.

A mid lift is what makes a solo **audible**; level alone just makes it louder.

## The guitar matters more than most tone requests

Ask which guitar and pickup before voicing anything. Most published settings
assume a bright, thin, low-output single coil, and a bridge humbucker is the
opposite in every way that counts.

| | Bridge humbucker | Bridge single coil |
|---|---|---|
| output | hot | much lower |
| lows / low mids | thick | thin |
| harsh band | ~2.6 kHz, broad push | ~3.2 kHz, spiky and wiry |
| top above 5 kHz | noticeably less | much more |

Consequences, each learned by getting it wrong first:

- **"Harsh" is usually 2–3 kHz, not treble.** A PA tends to emphasise the same
  region the pickup pushes, so the two stack — which is why a patch is fine at
  home and harsh in the room. Fix it with a **narrow** dip (Q ≈ 1.1): pick
  attack lives in the same 2–4 kHz span and a broad roll-off costs definition.
- **Do not add low-mid "body" for warmth with a humbucker.** It already has that
  weight; a low shelf lift reads as boxy. Raise Low Cut instead. For a
  single-coil patch the same shelf inverts to roughly **+1.5 dB** — it is the
  only control that flips direction between the two.
- **Treble and presence go UP, not down,** relative to a single-coil setting,
  because the humbucker has less top. Cutting treble it does not have is a real
  and easy mistake.
- **Drive goes DOWN** relative to a single-coil setting; the hot pickup drives
  the amp harder for the same knob position.

**A thin-source voicing is detectable:** high Treble *with* scooped Mid. That is
how you make a thin single coil glassy, and with a humbucker it goes honky. If a
patch scores like that and is being played with a humbucker, it was probably
voiced for a different guitar. (The test does not apply to amps with no Mid
control — several two-band models exist.)

## Staccato playing and ambience

For short, muted, syncopated playing the silences carry the groove, so nothing
may fill them in:

- **Shorten the reverb.** A 1.6 s tail smears the gaps that make syncopation
  read as syncopation.
- **Leave a short slap delay alone.** 100–150 ms with low feedback reinforces a
  staccato figure rather than blurring it. Long trails are the problem, not
  delay as such.
- **Keep the pick attack.** It lives around 2–4 kHz, the same place as the
  harshness, so the fix is a narrow dip rather than a broad roll-off.
- A gentle input gate makes mutes go quiet. Watch the threshold against pickup
  output — a setting that suits a humbucker will chop quiet notes from a single
  coil.

## Snapshot design

- Name them for what they do in the song, not what they are. "SNAPSHOT 1" tells
  you nothing on a dark stage. Ten characters.
- A snapshot that is "the same as X but with Y" is best expressed that way in
  code: copy **every** per-snapshot value from X, then override only Y. Spelled
  out as a list of values you will forget one, and it will silently keep a value
  from somewhere else.
- Changing a solo boost means changing it in **every** snapshot that has one.
  Two solo variants drift apart otherwise.

## Mono compatibility

Hard-panned cabs or amps **partially comb-filter when summed to mono**. If a
mono PA thins the patch out, pull the pans in from 0/10 toward 3/7 rather than
abandoning the width. Say so in `meta.info` — the person debugging it in a
venue is probably not you.
