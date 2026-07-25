Build "Nerd Neck" — a webcam-based posture tracker that gamifies fixing "tech neck" with streaks, points, and AI-generated roasts when you slouch.

Goal
A browser-based app that uses the webcam and a pose-detection model to monitor posture in real time, awards points for maintaining good posture, tracks streaks, and generates a witty/roasting AI comment when it detects prolonged slouching.

Tech stack
React + TypeScript (Vite)

TensorFlow.js with MoveNet or MediaPipe Pose for real-time pose detection (runs client-side, no video leaves the browser)

LocalStorage or IndexedDB for streak/points persistence (no backend required for v1)

Optional: OpenAI/Anthropic API call (text-only, sends posture state, not video) to generate a fresh roast line

Tailwind CSS for UI

Project structure
text
nerd-neck/
├── README.md
├── package.json
├── .env.example
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── WebcamFeed.tsx
│   │   ├── PostureOverlay.tsx
│   │   ├── ScoreBoard.tsx
│   │   └── RoastToast.tsx
│   ├── lib/
│   │   ├── poseDetector.ts       # wraps TF.js pose model, computes neck angle
│   │   ├── postureScoring.ts     # streaks, points logic
│   │   └── roastGenerator.ts     # calls LLM API for roast text, has local fallback jokes
│   └── styles/
└── public/
Requirements
Request webcam permission, run pose detection at ~10fps, compute a simple neck/shoulder angle metric.

Define "good posture" vs "slouching" thresholds (configurable).

Award points per minute of good posture, track daily/session streaks, persist locally.

When slouching is detected for more than N seconds (configurable, default 15s), show a toast with an AI-generated roast line. Include a local fallback list of 20 pre-written roasts in case no API key is set.

Simple dashboard showing today's score, current streak, and a 7-day history chart (client-side, e.g. using Recharts).

Privacy-first:

