# Selling the Transit Board — go-live guide

The licensing stack is **built and dormant**. Boards behave exactly as before until you
complete the steps below; then unlicensed visitors see a small "◇ evaluation" chip and
can buy a key that unlocks up to 5 of their devices.

**The model:** $19 one-time, hobbyists, honor-friendly soft gate (a static site can't
hard-lock its source — the license removes the evaluation notice and supports you).
Adjust the price freely in `buy.html`.

## The pieces (already in the repo)

| File | What it does |
|---|---|
| `license-worker.js` | Cloudflare Worker: issues keys after Stripe payment, verifies keys, 5-device cap |
| `license.js` | Loaded by every city board; shows the evaluation chip + key-entry dialog |
| `buy.html` | Pricing page → Stripe checkout (or demo checkout in test mode) |
| `activate.html` | After payment: shows the buyer their key and activates the device |

## Step 1 — Deploy the license Worker (~10 min, no CLI)

1. Cloudflare dashboard → **Workers & Pages → Create → "Hello World" template** →
   name it `tb-license` → Deploy. *(Create from the template first — pasting big code
   at creation time gets blocked; editing afterwards works.)*
2. Open the worker → **Edit Code** → replace everything with `license-worker.js` → Deploy.
3. **Storage & Databases → KV → Create namespace** `TB_LICENSES`, then in the worker's
   **Settings → Bindings** add a KV binding: variable name `LICENSES` → `TB_LICENSES`.
4. **Settings → Variables and Secrets**:
   - `ADMIN_SECRET` (secret) — any long random string; lets you hand out free keys
   - `TEST_MODE` (variable) = `1` — for now; **remove before going live**
5. Your worker URL is `https://tb-license.<your-subdomain>.workers.dev`.

## Step 2 — Point the site at the Worker

Paste that URL into:
- `license.js` → `workerUrl`
- `buy.html` → `WORKER_URL`
- `activate.html` → `WORKER_URL`

Deploy (`./deploy.sh`). From this moment boards show the evaluation chip to
unlicensed browsers.

## Step 3 — Test the whole flow (no Stripe needed yet)

1. Open `buy.html` → **"Demo checkout (test mode)"** → you land on `activate.html`
   with a fresh `TB-XXXX-XXXX-XXXX` key.
2. **Activate this device** → back to the board, chip gone.
3. On another device/browser: click the chip → enter the same key → chip gone.
4. A 6th device should be refused (device cap).

## Step 4 — Connect Stripe (~30 min)

1. Create a Stripe account (stripe.com) and finish business verification.
2. **Product catalog → Add product**: "Transit Board license", one-time, $19.
3. **Payment Links → New**: pick the product. Under **After payment**, choose
   "Don't show confirmation page" and redirect to:
   `https://YOUR-SITE/activate.html?session_id={CHECKOUT_SESSION_ID}`
   (type the `{CHECKOUT_SESSION_ID}` placeholder literally — Stripe fills it in).
4. Recommended: enable **Stripe Tax** on the link so sales tax is handled for you.
5. Paste the Payment Link URL into `buy.html` → `PAYMENT_LINK`.
6. Worker → Variables: add `STRIPE_SECRET` (secret) = your **secret key**
   (`sk_live_…` from Developers → API keys). Set `TEST_MODE` to `0` / remove it.
7. Deploy the site again. Do one real $19 purchase yourself end-to-end, then
   refund it from the Stripe dashboard.

Handing out free keys (friends, refunds, support):
```bash
curl -X POST https://tb-license.YOU.workers.dev/grant -H "x-admin-secret: YOUR_ADMIN_SECRET"
```

## Step 5 — ⚠️ BEFORE charging anyone: the data-feed licenses

Several feeds the boards use today are **free for non-commercial use only**. Selling
the product without swapping them is a terms-of-service violation waiting to happen:

- **airplanes.live** (planes) — free feed prohibits commercial use. Swap to a paid
  plan/alternative (FlightAware AeroAPI, ADS-B Exchange commercial). One URL in each
  board's `fetchPlanes()`.
- **adsbdb** (flight routes, origin → destination) — free community API with no
  published commercial terms and no rate-limit guarantee. Confirm terms with its
  maintainer, or swap to the same paid flight API you pick above. One URL in each
  board's `lookupRoute()`; the boards degrade gracefully to tail numbers without it.
- **CARTO basemap tiles** — free tier is non-commercial. Swap `tileUrlForTheme()` to a
  paid MapTiler/Mapbox/CARTO plan (still one URL per theme).
- **Nominatim geocoding** — fair-use only. Swap `geocodeAddress()` to a paid geocoder
  (Geoapify, LocationIQ, Mapbox).
- **Wikimedia/planespotters photos** (night mode) — check per-image licensing or
  disable photos in the sold version.
- Transit feeds (WMATA/MTA/SEPTA/MBTA/BART/GTFS bundles) are generally fine with
  attribution; WMATA needs each customer's own free key anyway (already the design).

Also before launch: write a simple terms-of-service + refund policy page and link it
from `buy.html`. None of this document is legal advice — read each provider's terms
yourself.

## Ideas once it's earning

- Hard gate: move feed fetches behind the Worker and require a valid key server-side
  (real enforcement, more Worker code + usage costs).
- A `?license=TB-…` URL parameter for one-tap kiosk provisioning.
- Per-screen subscription tier for businesses (cafés, lobbies) — where bigger revenue
  usually lives.
