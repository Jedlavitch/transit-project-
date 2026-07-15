# 🚇 Bethesda Live Transit Board

A self-contained live board for **trains, buses, and planes** around Bethesda, MD (20816).
One HTML file. No build step, no backend, no database. It runs entirely in the browser and
talks directly to public APIs, so once it's on free hosting it **never expires**.

Pin it full-screen on a tablet, wall display, TV browser, or the old Facebook Portal.

## What it shows
- **🚆 Metrorail** — WMATA live arrival predictions at your nearest stations (Bethesda / Friendship Heights, etc.)
- **🚌 Metrobus** — WMATA **live predictions** *and* **scheduled** timetable times at the nearest stops; live buses also plotted on the map
- **🚄 Amtrak** — live regional/intercity trains within ~60 mi on the map, with next-stop **scheduled vs. actual** times and delay status
- **✈️ Planes overhead** — live ADS-B aircraft within ~12 nm (altitude, airline, speed, climbing/descending), plotted on a live map
- Auto-detects your location (with 20816 as the fallback), refreshes transit/Amtrak every 30s and planes every 15s

## Data sources
| Data | Source | Key needed? | Cost |
|------|--------|-------------|------|
| Metrorail + Metrobus | [WMATA API](https://developer.wmata.com) | ✅ free key | Free |
| Amtrak | [amtraker API](https://github.com/piemadd/amtrak) | ❌ none | Free |
| Planes | [airplanes.live](https://airplanes.live) | ❌ none | Free |
| Map tiles | CARTO / OpenStreetMap | ❌ none | Free |

## One-time setup: free WMATA key (2 minutes)
Planes work with zero setup. Trains and buses need a **free** WMATA key:

1. Create an account → https://developer.wmata.com/signup
2. Subscribe to the **“Default Tier”** product → https://developer.wmata.com/products
3. Copy your **Primary key** → https://developer.wmata.com/profile
4. Open the board, click the **⚙︎** button, paste the key, **Save**.

The key is stored only in your browser (`localStorage`). The Default Tier allows 10 requests/sec
and 50,000/day — far more than this board uses.

## Run locally
```bash
cd "Transit Claude"
python3 -m http.server 4173
# then open http://localhost:4173/
```

## Deploy so it never expires (free, permanent) — GitHub Pages
1. Create a new GitHub repo (e.g. `bethesda-transit`).
2. Upload `index.html` (the only file that matters).
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `root`**.
4. Wait ~1 minute. Your board is live forever at:
   `https://<your-username>.github.io/bethesda-transit/`
5. Open that URL on your display, enter your WMATA key once, and pin it full-screen.

Because everything runs client-side against public APIs, there's no server to keep alive and
nothing to renew — GitHub Pages serves the static file indefinitely for free.

### Share on Facebook
Paste the GitHub Pages URL into a Facebook post or page. Facebook can't *run* the live app, but
anyone who clicks the link opens the live board in their browser.

## Customize (edit the `CFG` block near the top of the script)
- `defaultLoc` — change the fallback location / label
- `planeRadiusNm` — how far out to look for aircraft (nautical miles)
- `railStations` / `busStops` — how many nearby stations/stops to watch
- `busRadius` — search radius for nearby bus stops (meters)
- `transitEveryMs` / `planeEveryMs` — refresh cadence

## Notes
- Metrorail predictions are live estimates (the Metro runs on frequencies, so trains don't have a
  fixed per-train published timetable the way buses do — buses show both live and scheduled).
- If trains/buses stay empty, re-check the WMATA key in ⚙︎ (the status bar will say "transit stale").
## Why not MARC and Ride On?
These were considered and intentionally left out to keep the app 100% client-side (no server):
- **MARC** publishes a live GTFS-Realtime feed, but it's protobuf hosted on S3 **without CORS headers**,
  so a browser cannot fetch it directly. It would require a small always-on proxy (e.g. a free
  Cloudflare Worker) to decode + re-serve it with CORS. Doable later if you want it.
- **Ride On** (Montgomery County) has **no public real-time feed** — live data is only available through
  Swiftly's private, key-gated API. Only the static timetable is public, so live positions aren't
  possible for anyone without a county-issued key.

If you later want MARC on the map (via a tiny free Cloudflare Worker) or Ride On *scheduled* times from
the static timetable, both can be added.
