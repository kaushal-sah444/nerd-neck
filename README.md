# 🦴 Nerd Neck

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React 18](https://img.shields.io/badge/react-18-149eca.svg)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-30-brightgreen.svg)](#tests)
[![Live](https://img.shields.io/badge/demo-live-brightgreen.svg)](https://kaushal-sah444.github.io/nerd-neck/)
[![Privacy](https://img.shields.io/badge/video-never%20leaves%20your%20device-brightgreen.svg)](#privacy)

### ▶︎ [Try it live](https://kaushal-sah444.github.io/nerd-neck/)

A webcam posture tracker that gamifies fixing **tech neck** — points for sitting
up, streaks for keeping it up, and an AI-generated roast when you slump.

Pose detection runs in your browser on WebGL. **No video, no images and no
keypoints ever leave your device.**

```bash
npm install
npm run dev      # then open http://localhost:5173 and allow the camera
```

Or just open the [hosted version](https://kaushal-sah444.github.io/nerd-neck/) —
nothing to install. It is served over HTTPS because the camera API refuses to run
on an insecure origin.

Works with no API key at all — roasts come from a built-in list of 20 until you
add one.

## How it work

Every 100 ms (configurable) a frame goes to **MoveNet** via TensorFlow.js, which
returns 17 body keypoints. Four of them — both shoulders, both ears — are reduced
to three numbers:

| Metric | What it means | Bad when |
|---|---|---|
| **Neck angle** | degrees between vertical and the shoulders→ears line | large |
| **Head height ratio** | head-above-shoulders distance ÷ shoulder width | small |
| **Shoulder tilt** | degrees the shoulder line sits off horizontal | large |

The clinical measure of forward head posture is the craniovertebral angle, which
needs a **side** view. A laptop webcam sees you head-on, so these are front-facing
proxies. Dividing by shoulder width makes them scale-invariant — leaning closer to
the screen can't fake a good score.

Readings are smoothed over 5 frames before anything is judged, so a single
blurry frame doesn't cost you a streak. When keypoints are missing or
low-confidence the state is `unknown`, and **neither** counter advances — an empty
chair is not good posture, but it isn't slouching either.

### Calibration beats fixed thresholds

Torso proportions and camera angles vary enormously. Sit up straight, press
**Calibrate**, and your own good posture becomes the baseline — slouching is then
a 12% drop from *your* normal rather than from a number someone else picked.

## Scoring

- **Points** — 10 per minute of good posture (configurable).
- **Session streak** — unbroken seconds of sitting well; the best is kept.
- **Daily streak** — consecutive days hitting the points goal. Today being
  unfinished doesn't break it, so the number doesn't flicker to zero each morning.
- **Roast** — fires after 15 s of continuous slouching, then goes on a 60 s
  cooldown so it can't spam you.

Everything persists to `localStorage`. There is no backend and no account.

## Roasts

Without a key, roasts come from a list of 20 built-in lines. With one, they're
generated fresh and reference how long you've been slumped.

**What is sent to the model:** two numbers — seconds slouching and neck angle.
No video, no images, no keypoints.

The model call is raced against a 4-second timeout and **loses by default** — a
roast that lands after you've already sat up is worse than a canned one that lands
now. Any failure falls back to the built-in list silently.

> ⚠️ **API keys in a browser app are public.** Vite inlines every `VITE_*` variable
> into the bundle, so anyone who opens the page can read the key. Fine for a tool
> you run locally; not fine for anything you deploy. For deployment, put the call
> behind a small proxy and set `VITE_ROAST_PROXY_URL` — that path sends no key to
> the browser and takes priority when set.

See [.env.example](.env.example).

## Privacy

- Pose detection runs **entirely client-side** via TensorFlow.js on WebGL.
- Frames are read from the `<video>` element and discarded — never uploaded,
  never stored, never written to disk.
- The camera stream is torn down on stop and unmount, so the camera light
  actually goes out.
- The only outbound request the app can ever make is the roast call, and it
  carries two integers.
- There is no analytics, no telemetry and no backend.

## Tests

```bash
npm test
```

30 tests, no webcam or network required. The scoring model is pure functions fed
elapsed time, so streaks, the roast grace period, the cooldown and the daily-streak
edge cases are all verified deterministically. The posture maths is tested with
synthetic keypoints — including that it's scale-invariant, that it reports
`unknown` instead of guessing, and that smoothing absorbs a bad frame without
flipping the verdict. `App.test.tsx` mounts the full tree in jsdom, including
corrupt-`localStorage` recovery.

## Configuration

Everything in the **Settings** panel writes to `localStorage`:

| Setting | Default | Effect |
|---|---|---|
| Slouch angle | 22° | higher is more forgiving |
| Grace period | 15 s | slouch this long before a roast |
| Roast cooldown | 60 s | minimum gap between roasts |
| Points per minute | 10 | scoring rate |
| Daily goal | 100 pts | threshold that keeps the daily streak alive |
| Detection rate | 10 fps | lower saves battery |

Defaults live in [`src/lib/config.ts`](src/lib/config.ts).

## Project layout

```
nerd-neck/
├── src/
│   ├── App.tsx                  session state, persistence, roast trigger
│   ├── components/
│   │   ├── WebcamFeed.tsx       camera + inference loop
│   │   ├── PostureOverlay.tsx   SVG skeleton on the video
│   │   ├── ScoreBoard.tsx       stats + 7-day Recharts history
│   │   └── RoastToast.tsx       the roast
│   └── lib/
│       ├── poseDetector.ts      MoveNet wrapper + posture metrics
│       ├── postureScoring.ts    points, streaks, roast triggering (pure)
│       ├── roastGenerator.ts    LLM call + 20 local fallbacks
│       ├── storage.ts           localStorage history and daily streaks
│       └── config.ts            thresholds
└── public/
```

TensorFlow.js (~2.3 MB) is **dynamically imported**, so it only downloads when you
press Start — the page itself paints immediately.

## Requirements

- Node 18+
- A browser with WebGL and `getUserMedia` (Chrome, Edge, Firefox, Safari 15+)
- A **secure context** for the camera: `localhost` counts, so `npm run dev` works
  as-is. Opening the LAN address on a phone will not unless you serve over HTTPS.
- Network on first run, to download the MoveNet weights (~5 MB, then cached)

## Known limitations

- **Front-facing cameras can't see true forward head posture.** The metrics are
  proxies; a side-mounted camera would be strictly better and isn't supported.
- **One person only.** MoveNet SinglePose tracks the nearest body.
- **Bad lighting breaks it.** Low confidence reports `unknown` rather than
  guessing, which is the honest failure mode but means no scoring.
- **Not medical advice.** It nudges you to sit up; it does not diagnose anything.

## License

MIT — see [LICENSE](LICENSE).
