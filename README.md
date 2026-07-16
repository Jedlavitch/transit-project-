# 🚇 Bethesda Live Transit Board

A self-contained live board for **trains, buses, and planes** around Bethesda, MD (20816).
One HTML file. No build step, no backend, no database. It runs entirely in the browser and
talks directly to public APIs, so once it's on free hosting it **never expires**.

Pin it full-screen on a tablet, wall display, TV browser, or the old Facebook Portal.

## What it shows
- **🚆 Metrorail** — WMATA live arrival predictions at your nearest stations (Bethesda / Friendship Heights, etc.), the colored **Metro line map**, and (with the TrainPositions product, below) **live trains gliding along the lines**
- **🚌 Metrobus** — WMATA **live predictions** *and* **scheduled** timetable times at the nearest stops; live buses also plotted on the map and move in real time
- All map vehicles (Metro, MARC, Amtrak, buses, planes) **animate smoothly** between position updates instead of jumping
- **🌙 Night mode** (`night.html`, "Night" tab) — a big-letters, dark, low-light page showing just the **nearest flight**: airline, flight #, aircraft, and **origin → destination** cities (via [adsbdb](https://www.adsbdb.com)), plus live distance/altitude/phase. *(True on-time/late status isn't shown — it needs a paid flight-status API; see note below.)*
- **🚄 Amtrak** — live regional/intercity trains within ~60 mi on the map, with next-stop **scheduled vs. actual** times and delay status
- **🚆 MARC** — next **scheduled** commuter-rail trains at your nearest stations **and trains placed on the map** (interpolated from the schedule), from a bundled copy of MARC's timetable. **Zero setup — no key, no Worker.** *(Optional: exact real-time positions via the free Worker below.)*
- **🚌 Ride On** — next **scheduled** departures at your nearest stops, from a bundled (trimmed) copy of Ride On's timetable. **Zero setup — no key.** (Ride On has no public real-time feed, so this is timetable-only.)
- **✈️ Planes overhead** — live ADS-B aircraft within ~12 nm (altitude, airline, speed, climbing/descending), plotted on a live map
- Auto-detects your location (with 20816 as the fallback), refreshes transit/Amtrak every 30s and planes every 15s

Everything works with **zero setup except the WMATA key** (which only Metrorail/Metrobus need). MARC and Ride On are built in. You can also pick an **accent color** in the ⚙︎ gear.

## Data sources
| Data | Source | Key needed? | Cost |
|------|--------|-------------|------|
| Metrorail + Metrobus | [WMATA API](https://developer.wmata.com) | ✅ free key | Free |
| Amtrak | [amtraker API](https://github.com/piemadd/amtrak) | ❌ none | Free |
| MARC | bundled `marc-schedule.json` (MTA Maryland GTFS) | ❌ none | Free |
| Ride On | bundled `rideon-schedule.json` (Montgomery County GTFS) | ❌ none | Free |
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

### Optional: live Metro *trains* moving on the map
The colored Metro **lines** and arrival **times** work with the Default Tier. To also show Metro
**trains** moving along the lines, subscribe to WMATA's **“TrainPositions”** product on the same
[products page](https://developer.wmata.com/products) (same key). WMATA reports trains as track-circuit
IDs, so the board interpolates each train's position between the two stations its circuit sits between.
If the product isn't enabled, everything else still works — Metro trains simply don't appear.

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
## MARC & Ride On — built in, no setup
Both work out of the box from bundled copies of their published GTFS timetables:

- **`marc-schedule.json`** → MARC card (next scheduled trains at nearby stations) **and** MARC trains
  on the map, placed by interpolating each running trip's scheduled position between stations.
- **`rideon-schedule.json`** → Ride On card (next scheduled departures at nearby stops). This is a
  *trimmed* copy (stops within ~1.5 mi of home) because Ride On's full GTFS is ~34 MB. Ride On has
  **no public real-time feed**, so scheduled is the honest best.

When a timetable changes (a few times a year), regenerate the files:

```bash
python3 gen-marc-schedule.py     # re-downloads MARC's GTFS -> marc-schedule.json
python3 gen-rideon-schedule.py   # re-downloads Ride On's GTFS -> rideon-schedule.json
```
(To recenter Ride On on a different area, edit `HERE`/`RADIUS_MI` at the top of `gen-rideon-schedule.py`.)

## Optional: exact real-time MARC positions (free, ~5 min)
MARC on the map is *scheduled* by default. If you want the exact **live** positions instead, a browser
can't read MARC's live feed directly (protobuf on S3, no CORS), so the included **`marc-worker.js`** is
a tiny [Cloudflare Worker](https://workers.cloudflare.com) that reads it server-side and re-serves JSON.

1. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** → sign up (free) → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it (e.g. `marc`), **Deploy**, then **Edit code**.
3. Delete the starter code, **paste in all of `marc-worker.js`**, **Deploy** again.
4. Copy your Worker URL (`https://marc.YOUR-NAME.workers.dev`).
5. In the board: **⚙︎ → "Advanced: real-time MARC positions"**, paste the URL, Save.
