# 🚇 Live Transit Board

A self-contained live board for **trains, buses, and planes**. No build step, no backend, no
database — it runs entirely in the browser and talks directly to public APIs, so once it's on free
hosting it **never expires**.

Pin it full-screen on a tablet, wall display, TV browser, or the old Facebook Portal.

## Two boards, one codebase
There are **two separate pages**, each pinned to its own city so they never fight over "current
location" — open whichever one matches where you are:

- **`index.html`** — Bethesda / DC area: Metrorail, Metrobus, MARC, Ride On (routes 23 & 29), Amtrak, planes.
- **`philadelphia.html`** — Philadelphia: SEPTA Regional Rail, SEPTA Subway (Market-Frankford + Broad
  Street Line), PATCO, Amtrak, planes. (No Metro/MARC/Ride On — those are DC-specific.)

Both pages have their own **"Location"** setting (type any address, city, or zip — see below) and
their own saved settings (independent `localStorage` namespaces), so switching between them, or
typing a different address on one, never affects the other. Each has a small nav link in the header
to jump to the other one, plus **"🌙 Night"** (shared night mode — see below).

## What it shows
- **🚆 Metrorail** *(Bethesda board)* — WMATA live arrival predictions at your nearest stations, the colored **Metro line map**, and (with the TrainPositions product, below) **live trains gliding along the lines**
- **🚌 Metrobus** *(Bethesda board)* — WMATA **live predictions** *and* **scheduled** timetable times at the nearest stops; live buses also plotted on the map and move in real time
- **🚆 MARC** *(Bethesda board)* — next **scheduled** commuter-rail trains at your nearest stations **and trains placed on the map** (interpolated from the schedule), from a bundled copy of MARC's timetable. **Zero setup — no key, no Worker.** *(Optional: exact real-time positions via the free Worker below.)*
- **🚌 Ride On** *(Bethesda board;* routes **23** and **29** — edit `ROUTES` in `gen-rideon-schedule.py` to track others) — next **scheduled** departures at nearby stops **and buses placed on the map**, interpolated from a bundled copy of Ride On's own timetable. **Zero setup — no key, no Worker.** Ride On is Montgomery County's own bus system (a *different* agency from WMATA Metrobus above) and publishes **no public real-time feed at all** — only a private, key-gated API the county doesn't hand out — so scheduled interpolation is the honest best available to anyone.
- **🚆 SEPTA Regional Rail** *(Philadelphia board)* — next **scheduled** trains at nearby stations across **all 13 lines**, **and** trains placed on the map (interpolated from the schedule). **Zero setup — no key, no Worker.** *(Optional: exact real-time Regional Rail + live SEPTA buses/trolleys via the free Worker below.)*
- **🚇 SEPTA Subway** *(Philadelphia board)* — next scheduled trains **and** trains on the map for the **Market-Frankford Line** and **Broad Street Line**, the two rapid-transit spines useful regardless of exactly where in Philly you live. **Zero setup — no key, no Worker.** (Surface trolleys aren't bundled yet — add specific ones once you know your school/dorm; see `gen-septa-subway-schedule.py`.)
- **🚆 PATCO** *(Philadelphia board;* Philadelphia ↔ Camden, NJ) — next scheduled trains **and** trains on the map for the whole high-speed line (all 14 stations). **Zero setup — no key, no Worker** (PATCO doesn't publish a real-time API at all, so scheduled is the only option for anyone).
- **🚄 Amtrak** *(both boards)* — live regional/intercity trains within ~60 mi on the map, with next-stop **scheduled vs. actual** times and delay status
- **✈️ Planes overhead** *(both boards)* — live ADS-B aircraft within ~12 nm (altitude, airline, speed, climbing/descending), plotted on a live map
- All map vehicles **animate smoothly** between position updates instead of jumping
- **🌙 Night mode** (`night.html`, shared by both boards) — a big-letters, dark, low-light page showing just the single **nearest** plane, Amtrak train, or Ride On bus (switchable via the ⚙ gear), with a photo (planes), an animated origin→destination arc, and a live ETA estimate. Also pick a **color theme** (6 presets + a custom color picker) in the same panel. *(True on-time/late status for flights isn't shown — it needs a paid flight-status API.)*
- **📍 Any location** — each board auto-detects your location (with a per-board default: Bethesda 20816, or Temple University for the Philadelphia board), or type **any address, city, or zip** in ⚙︎ to re-center that board there. The address is geocoded free via [Nominatim/OpenStreetMap](https://nominatim.openstreetmap.org) — no key. Your choice is saved (per board) and won't be overridden by GPS; click "Use my current location instead" to switch back. Systems from the *other* city just show an honest "nothing nearby" rather than being hidden by force — e.g. Amtrak/planes work anywhere in the US regardless of which board or address you use.
- Refreshes transit/Amtrak every 30s and planes every 15s

Everything works with **zero setup except the WMATA key** (Bethesda board only, for Metrorail/Metrobus). MARC, Ride On, SEPTA, and PATCO are all built in. You can also pick an **accent color** and a **custom location** in the ⚙︎ gear on either board.

## Data sources
| Data | Source | Key needed? | Cost |
|------|--------|-------------|------|
| Metrorail + Metrobus | [WMATA API](https://developer.wmata.com) | ✅ free key | Free |
| Amtrak | [amtraker API](https://github.com/piemadd/amtrak) | ❌ none | Free |
| MARC | bundled `marc-schedule.json` (MTA Maryland GTFS) | ❌ none | Free |
| Ride On | bundled `rideon-schedule.json` (Montgomery County GTFS) | ❌ none | Free |
| SEPTA Regional Rail | bundled `septa-rail-schedule.json` (SEPTA GTFS) | ❌ none | Free |
| SEPTA Subway (MFL/BSL) | bundled `septa-subway-schedule.json` (SEPTA GTFS) | ❌ none | Free |
| PATCO | bundled `patco-schedule.json` (PATCO GTFS via National RTAP) | ❌ none | Free |
| Planes | [airplanes.live](https://airplanes.live) | ❌ none | Free |
| Address search | [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap) | ❌ none | Free |
| Map tiles | CARTO / OpenStreetMap | ❌ none | Free |

## One-time setup: free WMATA key (2 minutes) — Bethesda board only
The Philadelphia board needs no key at all. On the Bethesda board, planes/Amtrak/MARC/Ride On work
with zero setup; Metrorail and Metrobus need a **free** WMATA key:

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
# then open http://localhost:4173/          (Bethesda board)
# or      http://localhost:4173/philadelphia.html
```

## Deploy so it never expires (free, permanent) — GitHub Pages
1. Create a new GitHub repo (e.g. `bethesda-transit`).
2. Upload `index.html`, `philadelphia.html`, and `night.html`, plus the bundled `*.json` schedule
   files (`marc-schedule.json`, `rideon-schedule.json`, `septa-rail-schedule.json`,
   `septa-subway-schedule.json`, `patco-schedule.json`) — everything the boards read at runtime.
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `root`**.
4. Wait ~1 minute. Your boards are live forever at:
   `https://<your-username>.github.io/bethesda-transit/` (Bethesda)
   `https://<your-username>.github.io/bethesda-transit/philadelphia.html` (Philadelphia)
5. Open whichever board matches where you are, enter a WMATA key if needed, and pin it full-screen.

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
## MARC, Ride On, SEPTA (Regional Rail + Subway) & PATCO — built in, no setup
All five work out of the box from bundled copies of their published GTFS timetables, using the same
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
  from buses, and Regional Rail alone is small enough to bundle whole.
- **`septa-subway-schedule.json`** → the SEPTA Subway card **and** trains on the map. SEPTA's subway,
  trolleys, and buses are all one big GTFS file (~20MB — too big to bundle whole, and it runs so
  frequently that even just subway+trolleys together is ~3MB), so this is filtered to `ROUTES` inside
  `gen-septa-subway-schedule.py` (currently **L1** Market-Frankford Line + **B1/B2/B3** Broad Street
  Line — the two rapid-transit spines useful regardless of exactly where in Philly you live). Add
  specific surface trolley route IDs there once you know your school/dorm.
- **`patco-schedule.json`** → the PATCO card **and** trains on the map. PATCO (Philadelphia↔Camden, NJ)
  is a single small line (14 stations, ~525 trips) with no real-time API at all, so it's bundled whole.

When a timetable changes (a few times a year), regenerate the files:

```bash
python3 gen-marc-schedule.py         # re-downloads MARC's GTFS -> marc-schedule.json
python3 gen-rideon-schedule.py       # re-downloads Ride On's GTFS -> rideon-schedule.json
python3 gen-septa-rail-schedule.py   # re-downloads SEPTA's GTFS -> septa-rail-schedule.json
python3 gen-septa-subway-schedule.py # re-downloads SEPTA's GTFS -> septa-subway-schedule.json
python3 gen-patco-schedule.py        # re-downloads PATCO's GTFS -> patco-schedule.json
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
5. On the Bethesda board: **⚙︎ → "Advanced: real-time MARC positions"**, paste the URL, Save.
   On the Philadelphia board: **⚙︎ → "Optional: live SEPTA positions + buses/trolleys"**, paste the URL, Save.
