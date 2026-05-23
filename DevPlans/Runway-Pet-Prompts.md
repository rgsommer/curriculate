# Runway Prompts — Pet Feeding Animations

**Recommended workflow: ONE combined clip per pet** (15 files instead of 75).

`AnimatedPet` plays the single clip and seeks-and-clamps to the segment for the current mood — so the player only ever sees one mood looping at a time. Defaults assume **5 seconds per mood** (25s total clip).

If you can afford a longer clip, **10 seconds per mood** (50s total) gives noticeably smoother animation. Both options below.

---

## Save the result as

```
frontend/public/pets/<type>/all.mp4
```

(For example: `frontend/public/pets/dog/all.mp4`.)

If your clip uses non-default segment durations, also drop a sibling `all.json` like:

```json
{
  "idle":        [0, 10],
  "eatingBad":   [10, 20],
  "eatingGood":  [20, 30],
  "celebrating": [30, 40],
  "sick":        [40, 50]
}
```

Default in code is `[0,5][5,10][10,15][15,20][20,25]` — the 5s-per-mood layout. Drop a `<type>/all.json` only if you used a different timing.

---

## Combined clip — 5s per mood (25s total) — RECOMMENDED

> Cute, friendly cartoon character animation in a stylized 2D / soft-3D Pixar-adjacent style. Centered full-body shot, soft pastel background that doesn't distract. Studio lighting, slight bounce, exaggerated expressions. No text, no UI, no logos. **Same character throughout the whole clip — same fur, same proportions, same eye style.**
>
> A [PET] performs five distinct emotional states back-to-back, exactly **5 seconds each (25 seconds total)**, separated by a quick 0.2s background-colour wipe so each mood is clearly demarcated:
>
> - **0–5s · idle**: standing relaxed on a pale-blue background, eyes blinking slowly twice, body bobbing gently up and down, ears or tail swaying softly. Mouth closed in a small contented smile. Returns to neutral pose at 5s.
> - **5–10s · eatingBad**: light-green background, [PET] reacts with disgust to bad food — tongue sticks out, eyes squeeze shut, body shakes left-right once, ears droop, a small "yuck" stink-puff appears and dissipates. Returns to a frown stance.
> - **10–15s · eatingGood**: pale-yellow background, [PET] eagerly chews food — mouth opens and closes rhythmically, cheeks puff, eyes squint into happy crescents, tail wags fast, sparkles ✨ float up. Pet bounces in place from joy. Returns to a delighted neutral.
> - **15–20s · celebrating**: pale-pink background, [PET] does a happy victory dance — jumping, paws/arms/fins raised, big sparkly eyes ✨, confetti pieces falling, mouth wide open in a huge grin. Pure joy.
> - **20–25s · sick**: muted mint-green background, [PET] looks sluggish and unwell — slumped posture, half-closed droopy eyes, very slow body sway, ears flopped, faint green sickly tint on cheeks. Cute, not scary.
>
> Smooth transitions between segments. Same character identity preserved across all 5 moods. The first frame and last frame are both neutral standing poses (so the whole clip can re-trigger cleanly).

## Combined clip — 10s per mood (50s total) — HIGHER FIDELITY

> {Same style preamble as above.} A [PET] performs five distinct emotional states back-to-back, exactly **10 seconds each (50 seconds total)**, separated by a quick 0.2s background-colour wipe so each mood is clearly demarcated:
>
> - **0–10s · idle**: pale-blue background, slow gentle bob (about one bob every 1.5 seconds), eyes blink slowly four times across the segment, ears/tail sway softly, mouth in a small content smile. Returns to neutral pose at 10s.
> - **10–20s · eatingBad**: light-green background, [PET] reacts with multiple beats of disgust over 10 seconds — first the bite, then a tongue-out gag, eyes squeeze shut, body shake, ears droop, a "yuck" stink-puff blooms then fades, slow recovery to a frowning settled pose.
> - **20–30s · eatingGood**: pale-yellow background, [PET] enthusiastically eats with multiple chew cycles over 10 seconds — paws raised, mouth opens and closes rhythmically, cheeks puff, eyes squint happy, tail wags fast, sparkles ✨ float up at intervals, two small joyful jumps in place. Settles into a delighted grin.
> - **30–40s · celebrating**: pale-pink background, [PET] does a sustained victory dance over 10 seconds — repeated jumps, twirl on the spot, paws/arms/fins raised in triumph, big sparkly eyes ✨, confetti continuously falling, mouth wide open in a huge grin. Pure joy with multiple choreographed beats.
> - **40–50s · sick**: muted mint-green background, [PET] looks sluggish and unwell — slumps slowly, half-closed droopy eyes, very slow body sway (one cycle every 3s), ears flopped, faint green sickly cheeks, occasional weak sigh. Cute, melancholic, never scary.
>
> Smooth transitions between segments. Same character identity preserved across all 5 moods. First and last frames are both neutral standing poses so the clip can re-trigger cleanly.

If your generator can't sustain 50s in one shot, render two halves (0–25s and 25–50s) and concat with `ffmpeg -i a.mp4 -i b.mp4 -filter_complex concat=n=2:v=1:a=0 all.mp4`.

---

## [PET] substitutions (one per type)

Use these as drop-in replacements for the `[PET]` placeholder in either prompt above. **Keep the prompt body identical — only the subject description changes** so the character style stays consistent across pets.

| type | [PET] description |
|------|-------------------|
| `dog` | a chubby cartoon golden retriever puppy with floppy ears and a curly tail |
| `cat` | a fluffy cartoon grey tabby kitten with pointy ears and big round eyes |
| `bunny` | a soft white cartoon rabbit with long floppy ears and a fluffy round tail |
| `cow` | a chibi black-and-white spotted cartoon calf with big eyes and tiny horns |
| `pig` | a round pink cartoon piglet with a curly tail and tiny hooves |
| `chicken` | a yellow chibi cartoon chick with tiny wings and an orange beak |
| `dolphin` | a smiling cartoon dolphin with a curved fin |
| `octopus` | a cute purple cartoon octopus with eight short curling tentacles and big innocent eyes |
| `shark` | a friendly grey cartoon shark with rounded teeth and a tall dorsal fin |
| `trex` | a chibi green cartoon T-Rex with tiny arms and rows of bony back-spikes |
| `triceratops` | a chibi mint-green cartoon triceratops with three stubby horns and a beak |
| `raptor` | a chibi orange cartoon velociraptor with feathered tail-tip and bright eyes |
| `dragon` | a small purple cartoon dragon with tiny wings, spiky back, and curling tail |
| `unicorn` | a soft pastel-pink cartoon unicorn with a golden horn and rainbow mane |
| `phoenix` | a cartoon orange-and-red phoenix with feathered wings, glowing softly without flames |

---

## Tips for getting clean segments

1. **Tell the model "exactly 5/10 seconds each, total 25/50 seconds"** verbatim — most modern generators (Runway Gen-4, Sora, Veo) will respect explicit duration callouts when stated this directly.
2. **Background-colour wipe** between moods is the single biggest readability win — it gives the seek-and-clamp loop a natural visual delimiter, so even small timing drift between the requested 5s mark and the actual cut isn't jarring.
3. **Same character identity throughout** — emphasise this. If the fur/proportions drift between moods you'll see a "morph" mid-loop.
4. **First and last frame neutral**. Even though we loop just one segment, the same clip ends up replaying after each mood transition — having a clean neutral pose at the seam helps.
5. **Then trim the segment-ends in code** if needed — the per-pet `all.json` lets you nudge `[start, end]` per pet without re-rendering. E.g. if the cat's "eatingBad" actually starts at 5.4s and ends at 9.6s, drop `{ "eatingBad": [5.4, 9.6] }` in `cat/all.json`.

## Existing example

`frontend/public/pets/cat/all.mp4` is a 10-second clip (2s per mood) with `cat/all.json` overriding to `[0,2][2,4][4,6][6,8][8,10]`. You can use this as the working reference. Replacing it with a 25s or 50s version: drop the new `.mp4` in place and either delete `all.json` (default 5s segments) or update its values.
