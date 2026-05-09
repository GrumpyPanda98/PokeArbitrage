# PokéArb Japan

Private iPhone Safari PWA for checking Pokémon card deals in Japanese card shops.

The app is built around one in-store question:

```txt
Is this exact card worth buying at this shop price?
```

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Default passcode is case-sensitive:

```txt
Japan
```

To change it for a deployment:

```bash
NEXT_PUBLIC_POKEARB_PASSCODE=your-passcode
```

## Current Flow

- Pick what is physically in front of you: Raw, PSA 9, or PSA 10.
- Scan one photo to read both the card number and Japanese shop price, then
  confirm the matches.
- Search/select the exact card with PokémonTCG.io + TCGdex + TCGTracking-backed
  matching if OCR is unclear.
- A local authenticated Cardmarket sidecar can fill raw reference value from
  the cheapest live listing matching language and minimum condition.
- If the sidecar is offline, TCGdex Cardmarket aggregate pricing fills raw
  reference value when available.
- PokePrices is fetched server-side for raw, PSA 9, and PSA 10 values when a
  selected card page can be matched.
- Enter the Japanese shop price manually if OCR is unclear.
- Get one main result: BUY, MAYBE, or SKIP.
- Manual value inputs are hidden under `Edit values`.
- History saves the actual deal and selected condition.

## Market Data

Reference pricing uses server-side Next routes. For raw Cardmarket pricing,
PokéArb first tries the optional local Cardmarket sidecar in
`tools/cardmarket_server`, which logs in with your Cardmarket account and reads
the cheapest live listing matching the selected language and minimum condition.
If that sidecar is unavailable, the app falls back to TCGdex Cardmarket
aggregate pricing. PokePrices and PriceCharting are used for graded reference
values when they can be matched.

Card and shop-price OCR uses one on-device Tesseract.js pass in the browser.
OCR never selects a card or applies a shop price automatically; you confirm the
result.

## Optional Cardmarket Live Pricing

PokéArb tries to auto-start this service on the first live Cardmarket request.
Manual start is still useful while testing:

```powershell
cd C:\Users\nicko\Documents\GitHub\PokéArbitrage\tools\cardmarket_server
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8766
```

The service reads your existing sibling `Cardmarket_watcher\.env` file. To
override that, set:

```env
CM_USERNAME=your_cardmarket_email
CM_PASSWORD=your_cardmarket_password
POKEARB_CM_GAME=Pokemon
```

Set `CARDMARKET_SIDECAR_AUTO_START=false` to disable auto-start.

## Formula

```txt
costDkk = shopPriceYen / yenDivisor
netMarketValueDkk = selectedReferenceValueDkk * (1 - sellingFee)
profitDkk = netMarketValueDkk - costDkk
marginPercent = profitDkk / costDkk * 100
```

Defaults:

```txt
yenDivisor = 25
sellingFee = 0.05
BUY threshold = 30
MAYBE threshold = 15
```

## Verify

```bash
npm test
npm run lint
npm run build
```

## Private Deploy

Deploy to Vercel as a private/unlisted project and set
`NEXT_PUBLIC_POKEARB_PASSCODE`. On iPhone Safari, open the deployed URL, tap
Share, then Add to Home Screen.
