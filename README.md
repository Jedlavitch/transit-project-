# 🚇 Live Transit Board

A self-contained live board for **trains, buses, and planes** — defaults to Bethesda, MD (20816),
but you can type **any address, city, or zip** to re-center it anywhere (see "Any location" below).
One HTML file. No build step, no backend, no database. It runs entirely in the browser and
talks directly to public APIs, so once it's on free hosting it **never expires**.

Pin it full-screen on a tablet, wall display, TV browser, or the old Facebook Portal.

## What it shows
- **🚆 Metrorail** — WMATA live arrival predictions at your nearest stations (Bethesda / Friendship Heights, etc.), the colored **Metro line map**, and (with the TrainPositions product, below) **live trains gliding along the lines**
- **🚌 Metrobus** — WMATA **live predictions** *and* **scheduled** timetable times at the nearest stops; live buses also plotted on the map and move in real time
- All map vehicles (Metro, MARC, Amtrak, buses, planes) **animate smoothly** between position updates instead of jumping
- **🌙 Night mode** (`night.html`, "Night" tab) — a big-letters, dark, low-light page showing just the single **nearest** plane, Amtrak train, or Ride On bus (switchable via the ⚙ gear), with a photo (planes), an animated origin→destination arc, and a live ETA estimate. Also pick a **color theme** (6 presets + a custom color picker) in the same panel. *(True on-time/late status for flights isn't shown — it needs a paid flight-status API.)*
- **🚄 Amtrak** — live regional/intercity trains within ~60 mi on the map, with next-stop **scheduled vs. actual** times and delay status
- **🚆 MARC** — next **scheduled** commuter-rail trains at your nearest stations **and trains placed on the map** (interpolated from the schedule), from a bundled copy of MARC's timetable. **Zero setup — no key, no Worker.** *(Optional: exact real-time positions via the free Worker below.)*
- **🚌 Ride On** (routes **23** and **29** — edit `ROUTES` in `gen-rideon-schedule.py` to track others) — next **scheduled** departures at nearby stops **and buses placed on the map**, interpolated from a bundled copy of Ride On's own timetable. **Zero setup — no key, no Worker.** Ride On is Montgomery County's own bus system (a *different* agency from WMATA Metrobus above) and publishes **no public real-time feed at all** — only a private, key-gated API the county doesn't hand out — so scheduled interpolation is the honest best available to anyone.
- **🚆 SEPTA Regional Rail** (Philadelphia) — next **scheduled** trains at nearby stations across **all 13 lines**, **and** trains placed on the map (interpolated from the schedule). **Zero setup — no key, no Worker.** *(Optional: exact real-time Regional Rail + live SEPTA buses/trolleys via the free Worker below.)*
- **✈️ Planes overhead** — live ADS-B aircraft within ~12 nm (altitude, airline, speed, climbing/descending), plotted on a live map
- **📍 Any location** — auto-detects your location (with 20816 as the fallback), or type **any address, city, or zip** in ⚙︎ to re-center the whole board there — Metrorail, Metrobus, Amtrak, SEPTA, and planes all re-query around the new spot. (Metrorail/MARC/Ride On only cover DC–Maryland; SEPTA only covers Philadelphia; Amtrak and planes work anywhere in the US — systems far from your location just show an honest "nothing nearby.") The address is geocoded free via [Nominatim/OpenStreetMap](https://nominatim.openstreetmap.org) — no key. Your choice is saved and won't be overridden by GPS; click "Use my current location instead" to switch back.
- Refreshes transit/Amtrak every 30s and planes every 15s

Everything works with **zero setup except the WMATA key** (which only Metrorail/Metrobus need). MARC, Ride On, and SEPTA Regional Rail are built in. You can also pick an **accent color** and a **custom location** in the ⚙︎ gear.

## Data sources
| Data | Source | Key needed? | Cost |
|------|--------|-------------|------|
| Metrorail + Metrobus | [WMATA API](https://developer.wmata.com) | ✅ free key | Free |
| Amtrak | [amtraker API](https://github.com/piemadd/amtrak) | ❌ none | Free |
| MARC | bundled `marc-schedule.json` (MTA Maryland GTFS) | ❌ none | Free |
| Ride On | bundled `rideon-schedule.json` (Montgomery County GTFS) | ❌ none | Free |
| SEPTA Regional Rail | bundled `septa-rail-schedule.json` (SEPTA GTFS) | ❌ none | Free |
| Planes | [airplanes.live](https://airplanes.live) | ❌ none | Free |
| Address search | [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap) | ❌ none | Free |
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
## MARC, Ride On & SEPTA Regional Rail — built in, no setup
All three work out of the box from bundled copies of their published GTFS timetables, using the same
trick: since none of them publish a real-time feed a browser can read, each running trip's position is
**interpolated between stops using its scheduled time** — good enough to glide realistically on the
map and show genuinely accurate next-departure times.

- **`marc-schedule.json`** → the MARC card (next scheduled trains at nearby stations) **and** MARC
  trains on the map. Covers the whole MARC system (small: ~180 trips).
- **`rideon-schedule.json`** → the Ride On card (next scheduled departures at nearby stops) **and**
  Ride On buses on the map. Montgomery County's full Ride On GTFS is huge (700k+ stop-time rows), so
  this is filtered to just the routes in `ROUTES` inside `gen-rideon-schedule.py` (currently **23**
  and **29**) — add more route numbers there and re-run to track additional lines.
- **`septa-rail-schedule.json`** → the SEPTA Regional Rail card **and** trains on the map. Covers the
  whole Regional Rail system (all 13 lines, ~1,400 trips) — SEPTA's own GTFS separates Regional Rail
  from buses, and Regional Rail alone is small enough to bundle whole (unlike Ride On's/SEPTA's bus
  networks, which are huge and not yet scoped to specific routes).

When a timetable changes (a few times a year), regenerate the files:

```bash
python3 gen-marc-schedule.py         # re-downloads MARC's GTFS -> marc-schedule.json
python3 gen-rideon-schedule.py       # re-downloads Ride On's GTFS -> rideon-schedule.json
python3 gen-septa-rail-schedule.py   # re-downloads SEPTA's GTFS -> septa-rail-schedule.json
```

## Optional: exact real-time MARC / SEPTA positions (free, ~5 min each)
MARC and SEPTA Regional Rail are *scheduled* on the map by default. For the exact **live** positions
instead — and, for SEPTA, live **buses/trolleys** too (no schedule fallback exists for those yet) — a
browser can't call their live feeds directly (MARC: protobuf on S3, no CORS; SEPTA: plain JSON but
also no CORS), so two tiny [Cloudflare Worker](https://workers.cloudflare.com)s read them server-side
and re-serve the data with CORS added: **`marc-worker.js`** and **`septa-worker.js`**.

1. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** → sign up (free) → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it (e.g. `marc` or `septa`), **Deploy**, then **Edit code**.
3. Delete the starter code, **paste in all of `marc-worker.js`** (or `septa-worker.js`), **Deploy** again.
4. Copy your Worker URL (`https://marc.YOUR-NAME.workers.dev` / `https://septa.YOUR-NAME.workers.dev`).
5. In the board: **⚙︎ → "Advanced: real-time MARC positions"** or **"Philadelphia: SEPTA"**, paste the URL, Save.
