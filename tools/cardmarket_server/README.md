# PokéArb Local Cardmarket Pricing

This optional local service logs into Cardmarket and returns the cheapest live listing matching the selected language and minimum condition.

The iPhone PWA calls Next.js, and Next.js calls this service at `http://127.0.0.1:8766/cardmarket/raw-price`. The Next.js server tries to auto-start this sidecar on the first live Cardmarket request when using the default localhost URL.

## Setup

```powershell
cd C:\Users\nicko\Documents\GitHub\PokéArbitrage\tools\cardmarket_server
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m playwright install chromium
```

The service also reads the existing sibling
`C:\Users\nicko\Documents\GitHub\Cardmarket_watcher\.env` file. To override
that, add credentials to the repo `.env.local` or to this folder's `.env`:

```env
CM_USERNAME=your_cardmarket_email
CM_PASSWORD=your_cardmarket_password
POKEARB_CM_LANGUAGE=en
POKEARB_CM_GAME=Pokemon
```

## Run

```powershell
cd C:\Users\nicko\Documents\GitHub\PokéArbitrage\tools\cardmarket_server
.\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8766
```

Override the URL used by Next.js if needed:

```env
CARDMARKET_SIDECAR_URL=http://127.0.0.1:8766/cardmarket/raw-price
CARDMARKET_SIDECAR_TIMEOUT_MS=12000
```

If this service is offline or blocked, PokéArb falls back to TCGdex Cardmarket aggregate pricing.
