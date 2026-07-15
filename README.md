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
- **🚆 MARC** — next **scheduled** commuter-rail trains at your nearest MARC stations (Brunswick / Penn / Camden), from a bundled copy of MARC's timetable. **Zero setup — no key, no Worker.** *(Optional: add live MARC trains moving on the map with the free Worker below.)*
- **🚌 Ride On** *(optional)* — **scheduled** departures at nearby stops. Needs a free Transitland key (below). Live Ride On isn't publicly available, so this is timetable-only.
- **✈️ Planes overhead** — live ADS-B aircraft within ~12 nm (altitude, airline, speed, climbing/descending), plotted on a live map
- Auto-detects your location (with 20816 as the fallback), refreshes transit/Amtrak every 30s and planes every 15s

Everything works with **zero setup except the WMATA key**. MARC and Ride On are optional add-ons you can enable anytime via the ⚙︎ gear.

## Data sources
| Data | Source | Key needed? | Cost |
|------|--------|-------------|------|
| Metrorail + Metrobus | [WMATA API](https://developer.wmata.com) | ✅ free key | Free |
| Amtrak | [amtraker API](https://github.com/piemadd/amtrak) | ❌ none | Free |
| MARC *(optional)* | MTA Maryland feed via your Cloudflare Worker | ❌ none (needs the Worker) | Free |
| Ride On *(optional)* | [Transitland](https://www.transit.land) (schedule) | ✅ free key | Free |
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
## MARC schedule — built in, no setup
The MARC card works out of the box: it reads **`marc-schedule.json`**, a bundled copy of MARC's
published timetable, and shows the next scheduled trains at your nearest MARC stations. Nothing to
configure. When MARC changes its timetable (a few times a year), refresh the file with:

```bash
python3 gen-marc-schedule.py    # re-downloads MARC's GTFS and rewrites marc-schedule.json
```

## Optional: live MARC trains *moving on the map* (free, ~5 min)
Only if you also want MARC trains gliding on the map (not just the schedule): a browser can't read
MARC's live feed directly (protobuf on S3, no CORS), so the included **`marc-worker.js`** is a tiny
[Cloudflare Worker](https://workers.cloudflare.com) that reads it server-side and re-serves it as
JSON — free tier, always on, never sleeps.

1. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** → sign up (free) → **Workers & Pages** → **Create** → **Create Worker**.
2. Give it a name (e.g. `marc`), click **Deploy**, then **Edit code**.
3. Delete the starter code, **paste in the entire contents of `marc-worker.js`**, and **Deploy** again.
4. Copy your Worker URL (looks like `https://marc.YOUR-NAME.workers.dev`).
5. In the board, click **⚙︎ → "add MARC trains & Ride On schedule"**, paste that URL into the **MARC helper URL** box, Save.

MARC trains (Brunswick / Penn / Camden) now appear on the map as color-coded **M** markers. No API key needed.

## Optional: enable Ride On scheduled times (free)
Montgomery County publishes **no public live feed** for Ride On (live data is locked behind a private
Swiftly key). The public timetable is available through Transitland, so this shows **scheduled** departures:

1. Sign up for a free [Transitland API key](https://www.transit.land/documentation#api-keys).
2. In the board, **⚙︎ → "add MARC trains & Ride On schedule"** → paste the key into the **Transitland API key** box, Save.

A "Ride On — scheduled" card appears with upcoming departures at your nearest stops. (No live map dots —
that data simply isn't public.)
