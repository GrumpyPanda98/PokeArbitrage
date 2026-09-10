# PokéArbitrage — Card Recognition & Price Comparison

A mobile-first web app for comparing Pokémon card prices while browsing Japanese card shops. Identify a card from a photo or search, confirm the print and condition, and compare the shop price with reference market values in DKK.

Built with Next.js, TypeScript, and optional Python image-recognition tools. This is a personal project under active development; card matching and market coverage are incomplete.

## What it does

- Photo-assisted identification using a local OpenCV matcher, optional DINOv2 embeddings, and OCR.
- Search by card name, number, and set when recognition is uncertain.
- Compare raw and graded cards using reference prices from supported providers.
- Estimate fees, grading costs, profit, and margin; keep a local deal history.

Recognition results need confirmation. Prices are references, not guaranteed sale proceeds, and the calculation does not account for every cost or tax.

## Run locally

Use Node.js 22 LTS and npm. From the repository root:

```sh
npm ci
npm run dev -- --hostname 127.0.0.1
```

In Windows PowerShell, use `npm.cmd run dev -- --hostname 127.0.0.1` so npm's PowerShell wrapper does not consume the forwarded flags.

Open [localhost:3000](http://localhost:3000). The default interface passcode is `Japan` (case-sensitive). It is a client-side convenience lock, **not authentication**. Publishing this source does not make the app suitable for an unauthenticated internet deployment.

No API keys are needed to start the interface. Manual entry remains available; search and reference pricing depend on external services. Optional recognition backends need their own setup and, for local matching, a downloaded image index.

Copy `.env.example` to `.env.local` only if you need custom settings. Keep credentials server-side and out of Git. For a hosted instance, provide real access control around the application and its API routes before connecting account-backed services.

## Architecture

| Path | Role |
| --- | --- |
| `src/app/` | Mobile interface and server-side API routes |
| `src/lib/` | Card identity, provider adapters, OCR, pricing, and calculations |
| [`tools/card_matcher/`](tools/card_matcher/README.md) | OpenCV retrieval, optional embeddings, OCR evidence, and candidate reranking |
| [`tools/price_ocr_server/`](tools/price_ocr_server/README.md) | Optional local price OCR service |
| [`tools/cardmarket_server/`](tools/cardmarket_server/README.md) | Optional account-backed live-listing service |

The committed matcher uses DINOv2 as an optional retrieval stage. Model weights, reference-image caches, personal photos, credentials, and local transaction history are not distributed here. More recent local experiments are separate from this release baseline.

## Optional services

The basic app runs without the Python services. Enable only what you need:

- **Card matching:** follow the matcher README to create `tools/card_matcher/.venv` and build a small reference index. `LOCAL_CARD_MATCHER_PYTHON` can select another compatible Python environment.
- **Price OCR:** the local service listens on `127.0.0.1:8765`; browser OCR/manual entry provide alternatives.
- **Live Cardmarket:** disabled unless `CARDMARKET_LIVE_ENABLED=true`. Configure your own credentials explicitly; the service no longer reads a sibling project's environment file automatically. Check the provider's usage terms before using automation.

CPU matching is available; CUDA and PaddleOCR are optional and require compatible installations. Provider availability, rate limits, languages, and condition coverage can affect results. API-based scan providers may receive the uploaded photo when explicitly configured.

## Checks and milestones

```sh
npm test
npm run lint
npm run build
```

These check the committed app and library behaviour. They do not establish real-photo recognition accuracy or verify live marketplace accounts. See [ROADMAP.md](ROADMAP.md) for the next milestones and their acceptance criteria.

[Nickolaj Ajay Atchuthan](https://atchuthan.com/)
