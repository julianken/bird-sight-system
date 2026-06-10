# Bird Photo Quality Rubric — Research (Phase 0)

- **Date:** 2026-06-10
- **Status:** Draft → feeds `packages/photo-quality/src/rubric.config.ts`
- **Spec:** `docs/specs/2026-06-10-photo-quality-curation-design.md` §6
- **Purpose:** Synthesize authoritative field-guide / bird-photography quality
  criteria + the disqualifier taxonomy into a repeatable rubric. This document
  is the source the vision-judge `judgePrompt` is derived from. The judge is a
  Claude Code agent that `Read`s the image (no SDK, no API key — it uses the
  session model); the rubric below is the instruction it receives.

## 1. What makes a field-guide-quality bird photo

A "nature-guide" photo serves identification first and aesthetics second. This
is the same priority Cornell's Macaulay Library codifies in its media star
guidance: a rating reflects *technical quality of the depiction*, not the rarity
or biological interest of the bird — "a great photo of a common, drab bird
should still be 5 stars and a poor photo of a very rare or hard-to-photograph
bird could still be only 1 or 2 stars" ([eBird/ML rating
guidance](https://support.ebird.org/en/support/solutions/articles/48001064392-rating-media)).
Our rubric inherits that stance: score the photo's value *as an ID reference*,
independent of how interesting the species is.

The synthesized consensus across the sources in §6:

- **Framing / subject size.** The bird fills a meaningful share of the frame
  (roughly subject occupies ⅓–⅔ of the shorter dimension), is not clipped at
  wings/tail/feet, and sits with comfortable headroom in its direction of gaze.
  Distant specks where the bird is a smudge are field records, not guide photos.
  Macaulay's 5-star bar requires the bird be "at least fairly large in the frame
  and not significantly obscured," and explicitly down-rates photos where the
  subject is small, partially obstructed, or backlit
  ([rating guidance](https://support.ebird.org/en/support/solutions/articles/48001064392-rating-media)).
  Audubon's composition guidance similarly warns photographers to shoot at a
  wide enough angle that wing tips are not cropped off
  ([How to Compose the Perfect Bird Photo](https://www.audubon.org/magazine/how-compose-perfect-bird-photo),
  [Clipped Wings](https://www.audubon.org/multimedia/clipped-wings)).
- **Subject clarity / focus.** The plane of focus is on the bird, and crucially
  on the **eye** — a sharp catchlit eye is the single strongest signal of a
  keeper. Field practitioners single out the eye as the bond between subject and
  viewer and recommend single-point AF tracking the near eye for the sharpest
  result; sharpness is treated as the first technical gate of a usable bird
  image ([Photzy — Staying Sharp and
  Focused](https://photzy.com/bird-photography-stay-sharp-and-focused/),
  [Akari composition guide](https://akariphototours.com/resources/wildlife-photography-tutorials/bird-photography-composition-guide/)).
  Diagnostic feather detail (wing bars, mantle pattern, breast streaking) must
  be resolvable.
- **Natural setting.** A wild bird on a natural perch / in natural habitat. The
  presence of a human hand, a banding grip, a cage/aviary, a feeder, a studio
  backdrop, or a collection-tray specimen all degrade guide value. Macaulay is
  unambiguous here: photos of dead or captive birds "are generally not
  appropriate" and ML Search hides captive media by default; in-hand photos —
  defined as "any photo or video of a live bird being held or restrained by a
  person," including mist-netted or temporarily-restrained birds — are not
  appropriate except in association with a permitted scientific operation
  ([photo upload
  guidelines](https://support.ebird.org/en/support/solutions/articles/48001064357-photo-upload-guidelines),
  [media of birds
  in-hand](https://support.ebird.org/en/support/solutions/articles/48001275751-media-of-birds-in-hand)).
  This is the provenance norm that motivates our `naturalness` criterion and the
  `captive` / `in-hand` / `specimen` flags.
- **Pose.** A diagnostic profile or ¾ view that shows the field marks an ID
  depends on, over a tail-on or obscured pose. The up-and-down wing strokes that
  reveal feather and wing detail are preferred over wings pointed flat away from
  the camera ([Audubon composition
  guide](https://www.audubon.org/magazine/how-compose-perfect-bird-photo)).
- **Background.** Clean, non-distracting, ideally separated from the subject;
  busy/cluttered backgrounds that camouflage field marks score lower.
  Practitioners describe background as "where many images fall apart" — a clean,
  separated background (achieved with aperture/working distance) reads as a
  keeper, while a competing background pulls the eye off the bird
  ([fstoppers](https://fstoppers.com/animal/bird-flight-photography-settings-actually-work-900352),
  [Akari composition guide](https://akariphototours.com/resources/wildlife-photography-tutorials/bird-photography-composition-guide/)).
- **Lighting.** Even, natural light that renders true color and feather texture.
  Harsh on-camera flash (specular hotspots, black backgrounds, red-eye /
  steel-eye) and blown highlights / crushed shadows degrade the photo. Macaulay's
  editing norm is to "make the bird look as it did in the field" — a natural
  reproduction of how the bird looked in life, not an artificially altered one
  ([photo upload
  guidelines](https://support.ebird.org/en/support/solutions/articles/48001064357-photo-upload-guidelines)).
  Exposure (histogram clipping) is one of the two dimensions automated aesthetic
  models like Google's NIMA learn to score, which is why we keep a deterministic
  exposure check ahead of the LLM judge
  ([NIMA](https://research.google/blog/introducing-nima-neural-image-assessment/)).

## 2. The seven scored criteria (0–10 each)

These are the per-criterion sub-scores the judge returns. They map 1:1 onto the
`CriteriaScores` keys in the pinned interface contract:

| Criterion        | Key (verbatim)   | What 10 looks like | What 0 looks like |
|------------------|------------------|--------------------|-------------------|
| Framing          | `framing`        | Subject well-sized, uncropped, balanced | Distant speck or limbs clipped |
| Subject clarity  | `subjectClarity` | Eye tack-sharp, feather detail crisp | Soft / motion-blurred / eye lost |
| Liveness         | `liveness`       | Alert, healthy, alive | Dead / sick / injured |
| Naturalness      | `naturalness`    | Wild bird, natural perch/habitat | In-hand / captive / feeder / specimen |
| Pose             | `pose`           | Diagnostic profile or ¾ view | Tail-on / obscured / head hidden |
| Background       | `background`     | Clean, separated, non-distracting | Cluttered, camouflaging |
| Lighting         | `lighting`       | Even natural light, true color | Harsh flash, blown / crushed |

The split mirrors how field reviewers actually triage: Macaulay's star bands
combine **sharpness/focus**, **resolution**, **subject size in frame**, and
**lighting** into a single ordinal rating
([rating guidance](https://support.ebird.org/en/support/solutions/articles/48001064392-rating-media)).
We decompose that ordinal into separate sub-scores so the composite is tunable
(weights), so the curation UI can show *why* a photo scored low, and so a
disqualifier (e.g. captive provenance) can cap the composite without silently
muddying the technical sub-scores.

## 3. Disqualifier taxonomy (the nine flags)

Hard quality signals that, when present, cap the composite regardless of other
sub-scores. The judge emits these as `flags` (string literals); the config maps
a subset to numeric caps (§5). The wild-vs-captive / dead / in-hand distinctions
are taken straight from Macaulay Library upload policy (captive and dead media
not appropriate; in-hand restricted to permitted scientific operations) — they
are exactly the provenance failures that disqualify an image as a field-guide
reference ([upload
guidelines](https://support.ebird.org/en/support/solutions/articles/48001064357-photo-upload-guidelines),
[in-hand
policy](https://support.ebird.org/en/support/solutions/articles/48001275751-media-of-birds-in-hand)).
The `watermark` down-weight follows Macaulay's explicit rule that watermarks
lower a rating by 1–4 stars depending on size/obtrusiveness
([rating guidance](https://support.ebird.org/en/support/solutions/articles/48001064392-rating-media)).

| Flag                | Meaning | Cap behavior |
|---------------------|---------|--------------|
| `dead`              | Carcass, roadkill, deceased bird | Hard cap (≤20) |
| `specimen`          | Museum / collection-tray specimen, study skin | Hard cap (≤20) |
| `in-hand`           | Held in a human hand / banding grip | Cap (≤35) |
| `captive`           | Aviary, cage, zoo, rehab, feeder/seed-tray | Cap (≤45) |
| `sick`              | Visibly ill / injured / heavily distressed | Cap (≤30) |
| `distant`           | Bird too small in frame to read field marks | Down-weights framing/clarity |
| `multiple-subjects` | More than one bird, ambiguous which is the subject | Down-weights framing |
| `watermark`         | Overlaid text / logo / signature | Down-weights aesthetics |
| `harsh-flash`       | On-camera flash artifacts (black bg, steel-eye, hotspots) | Down-weights lighting |

## 4. Composite scoring model

`overall` (0–100) is a **weight-and-scale** of the seven sub-scores, then
clamped by any disqualifier cap. The seven `weights` **sum to 1.0** (a convex
combination), so `composeOverall = (Σ weightᵢ · criteriaᵢ) · 10` lands the
result in 0–100 (each criterion is 0–10, the weighted average is 0–10, ×10 →
0–100). No separate normalization by the weight-sum is needed because the sum
is 1 by construction. Weights reflect ID-first priorities: `subjectClarity` and
`framing` dominate (a sharp, well-framed bird is the core of a guide photo);
`naturalness` and `liveness` carry the disqualifier-adjacent weight; `pose`,
`background`, `lighting` round out aesthetics. Exact numeric weights live in
`rubric.config.ts` and are tuned during calibration (spec §6, decision #7) —
this document fixes the *ranking* rationale and the sum-to-1 convention, not the
final floats. (Slice 2's `composeOverall` implements exactly this math; Slice 1
only ships the sum-to-1 config.)

This two-stage shape — a cheap deterministic gate (resolution / sharpness /
aspect, in the spirit of NIMA's *technical-quality* model) ahead of a learned /
judged *aesthetic+ID* score — is the same separation Google's NIMA work draws
between technical and aesthetic image assessment, and is why a sharpness floor
can short-circuit obviously-soft images before they reach the LLM
([NIMA](https://research.google/blog/introducing-nima-neural-image-assessment/)).

Verdict bands map composite to `Verdict`: `great` / `good` / `mediocre` /
`reject`, with `thresholds.autoAccept` / `review` / `reject` as the cut points.

## 5. Calibration plan

Per spec §6 decision #7: assemble a ~30–40 image sample spanning known-good and
known-bad (including obvious `dead` / `in-hand` cases), score with the draft
config, review verdicts against operator judgment, and tune weights / thresholds
/ prompt until they agree. Only then run the full ~715-species pass. The config's
`version` field is bumped on every tune so cached scores can be invalidated. The
judge is a Claude Code agent using the session model — there is no SDK model id
to choose or swap; calibration tunes the rubric (weights / thresholds / prompt),
not a model tier. The known-bad anchors are easy to source against Macaulay's own
exclusions (captive / dead / in-hand media that ML Search filters out), giving us
a labeled negative set the draft caps must reproduce
([upload
guidelines](https://support.ebird.org/en/support/solutions/articles/48001064357-photo-upload-guidelines)).

## 6. Sources

Concrete named guides consulted, grouped by category. The rubric's design intent
— ID-first, eye-sharpness-led, disqualifier-gated — is the durable output
regardless of which individual guide is quoted.

- **Field-guide photographic conventions** (subject size, diagnostic feather
  detail, natural perch, eye sharpness, avoiding clipped wings):
  - National Audubon Society — [How to Compose the Perfect Bird
    Photo](https://www.audubon.org/magazine/how-compose-perfect-bird-photo)
  - National Audubon Society — [Clipped
    Wings](https://www.audubon.org/multimedia/clipped-wings) (cropping ethics /
    framing)
  - Illinois Audubon Society — [Getting Started with Bird Photography: The
    Exposure
    Triangle](https://illinoisaudubon.org/blog/2018/11/26/getting-started-with-bird-photography-the-exposure-triangle/)
- **Media-rating norms** (sharpness, framing, exposure, resolution, watermark,
  behavioral/ID value as ordinal star bands):
  - Cornell Lab / eBird — [How to rate media in the Macaulay
    Library/eBird](https://support.ebird.org/en/support/solutions/articles/48001064392-rating-media)
  - Cornell Lab / eBird — [Photo Upload
    Guidelines](https://support.ebird.org/en/support/solutions/articles/48001064357-photo-upload-guidelines)
  - Macaulay Library — [Introducing community rating for photos and
    sounds](https://www.macaulaylibrary.org/2017/03/10/introducing-community-rating-for-photos-and-sounds/)
- **Critique literature** (eye sharpness as the keeper test, clean background,
  separating the subject, focus technique):
  - Photzy — [Bird Photography: Staying Sharp and
    Focused](https://photzy.com/bird-photography-stay-sharp-and-focused/)
  - Akari Photo Tours — [Bird Photography Composition
    Guide](https://akariphototours.com/resources/wildlife-photography-tutorials/bird-photography-composition-guide/)
  - Fstoppers — [Bird in Flight Photography Settings That Actually
    Work](https://fstoppers.com/animal/bird-flight-photography-settings-actually-work-900352)
    (background/aperture separation)
- **Aesthetic-scoring background** (the technical-vs-aesthetic split that
  motivates the deterministic-gate-then-judge architecture):
  - Google Research — [Introducing NIMA: Neural Image
    Assessment](https://research.google/blog/introducing-nima-neural-image-assessment/)
  - Talebi & Milanfar, *NIMA: Neural Image Assessment*,
    [arXiv:1709.05424](https://arxiv.org/pdf/1709.05424)
- **Ethics / provenance** (wild-vs-captive, in-hand/banding norms that motivate
  the `naturalness` criterion and the `captive` / `in-hand` / `specimen` flags):
  - Cornell Lab / eBird — [Media of Birds
    In-hand](https://support.ebird.org/en/support/solutions/articles/48001275751-media-of-birds-in-hand)
  - Cornell Lab / eBird — [Photo Upload
    Guidelines](https://support.ebird.org/en/support/solutions/articles/48001064357-photo-upload-guidelines)
    (captive/dead media not appropriate; natural-reproduction editing norm)

> The categories above each cite the specific guides consulted inline. The
> rubric's design intent — ID-first, eye-sharpness-led, disqualifier-gated — is
> the durable output regardless of which individual guide is quoted.
