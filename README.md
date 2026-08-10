# 🚇 Live Transit Board

A self-contained live board for **trains, buses, and planes**. No build step, no backend, no
database — it runs entirely in the browser and talks directly to public APIs, so once it's on free
hosting it **never expires**.

Pin it full-screen on a tablet, wall display, TV browser, or the old Facebook Portal.

## Three boards, one codebase
There are **three separate pages**, each pinned to its own city so they never fight over "current
location" — open whichever one matches where you are:

- **`index.html`** — Bethesda / DC area: Metrorail, Metrobus, MARC, Ride On (routes 23 & 29), Amtrak, planes.
- **`philadelphia.html`** — Philadelphia: SEPTA Regional Rail, SEPTA Subway (Market-Frankford + Broad
  Street Line), SEPTA Bus (routes 3, 4 & 16 — Cecil B. Moore Ave and North Broad St near Temple
  University), PATCO, Amtrak, planes. (No Metro/MARC/Ride On — those are DC-specific.)
- **`nyc.html`** — New York (Manhattan + nearby Brooklyn/Queens): Subway, LIRR, Metro-North, MTA Bus
  (M42/M15/M34/M34A), PATH, Amtrak, planes. Subway/LIRR/Metro-North are all **live with zero setup** —
  no key, no Worker (see below). (No Metro/MARC/Ride On/SEPTA/PATCO — those are DC/Philly-specific.)

Each page has its own **"Location"** setting (type any address, city, or zip — see below) and its own
saved settings (independent `localStorage` namespaces), so switching between them, or typing a
different address on one, never affects the others. Each has small nav links in the header to jump to
the other two, plus **"🌙 Night"** (shared night mode — see below).

## What it shows
- **🚆 Metrorail** *(Bethesda board)* — WMATA live arrival predictions at your nearest stations, the colored **Metro line map**, and (with the TrainPositions product, below) **live trains gliding along the lines**
- **🚌 Metrobus** *(Bethesda board)* — WMATA **live predictions** *and* **scheduled** timetable times at the nearest stops; live buses also plotted on the map and move in real time
- **🚆 MARC** *(Bethesda board)* — next **scheduled** commuter-rail trains at your nearest stations **and trains placed on the map** (interpolated from the schedule), from a bundled copy of MARC's timetable. **Zero setup — no key, no Worker.** *(Optional: exact real-time positions via the free Worker below.)*
- **🚌 Ride On** *(Bethesda board;* routes **23** and **29** — edit `ROUTES` in `gen-rideon-schedule.py` to track others) — next **scheduled** departures at nearby stops **and buses placed on the map**, interpolated from a bundled copy of Ride On's own timetable. **Zero setup — no key, no Worker.** Ride On is Montgomery County's own bus system (a *different* agency from WMATA Metrobus above) and publishes **no public real-time feed at all** — only a private, key-gated API the county doesn't hand out — so scheduled interpolation is the honest best available to anyone.
- **🚆 SEPTA Regional Rail** *(Philadelphia board)* — next **scheduled** trains at nearby stations across **all 13 lines**, **and** trains placed on the map (interpolated from the schedule). **Zero setup — no key, no Worker.** *(Optional: exact real-time Regional Rail + live SEPTA buses/trolleys via the free Worker below.)*
- **🚇 SEPTA Subway** *(Philadelphia board)* — next scheduled trains **and** trains on the map for the **Market-Frankford Line** and **Broad Street Line**, the two rapid-transit spines useful regardless of exactly where in Philly you live. **Zero setup — no key, no Worker.** (Surface trolleys aren't bundled yet — add specific ones once you know your school/dorm; see `gen-septa-subway-schedule.py`.)
- **🚌 SEPTA Bus** *(Philadelphia board;* routes **3**, **4** & **16** — Cecil B. Moore Ave and North Broad St near Temple University) — next scheduled buses **and** buses placed on the map, plus route lines. **Zero setup — no key, no Worker.** SEPTA's full bus network is huge (~20MB, hundreds of routes) so only these are bundled; edit `ROUTES` in `gen-septa-bus-schedule.py` to track others. *(Optional: exact live positions for these routes, or live system-wide buses/trolleys, via the free Worker below.)*
- **🚆 PATCO** *(Philadelphia board;* Philadelphia ↔ Camden, NJ) — next scheduled trains **and** trains on the map for the whole high-speed line (all 14 stations). **Zero setup — no key, no Worker** (PATCO doesn't publish a real-time API at all, so scheduled is the only option for anyone).
- **🚇 Subway** *(NYC board;* Manhattan + nearby Brooklyn/Queens, ~25 lines) — **live** trains on the map and the departures card, decoded directly from MTA's real-time feed in the browser. **Zero setup — no key, no Worker.** Real per-line colors and route shapes. NYC Subway trains report no GPS at all (signaled by track circuit, not satellite — most of the network is underground), so positions are placed at each train's current/next station instead of mid-track; live delay minutes where MTA reports them.
- **🚆 LIRR** *(NYC board)* — **live** trains (real GPS) on the map and the departures card. **Zero setup — no key, no Worker.**
- **🚆 Metro-North** *(NYC board)* — **live** trains (GPS for most, station-based for the rest) on the map and the departures card. **Zero setup — no key, no Worker.**
- **🚌 MTA Bus** *(NYC board;* routes **M42**, **M15**/M15-SBS, **M34+**/M34A+ — edit `ROUTES` in `gen-mta-bus-schedule.py` to track others) — next **scheduled** departures **and** buses on the map by default. **Zero setup — no key, no Worker.** *(Optional: exact live positions via the free Worker below — MTA Bus's live feed has real data but no CORS, unlike Subway/LIRR/Metro-North.)*
- **🚆 PATH** *(NYC board;* Manhattan ↔ New Jersey) — next **scheduled** departures **and** trains on the map by default. **Zero setup — no key, no Worker.** PATH's live data is station-based next-arrival countdowns (not vehicle positions), so the optional Worker only upgrades the departures card, not the map.
- **🚄 Amtrak** *(all three boards)* — live regional/intercity trains within ~60 mi on the map, with next-stop **scheduled vs. actual** times and delay status
- **✈️ Planes overhead** *(every board)* — live ADS-B aircraft within ~12 nm, plotted on a live map. Each row carries three lines: the **aircraft type**; the **airline, build year and ground speed**; and the **flight's route, its distance and compass bearing from you, its heading and its squawk** — with **altitude**, **climb/descent in ft/min**, and the autopilot's **selected altitude** (where a climb or descent is levelling off) stacked on the right. Hover the route line for full city names. **Zero setup — no key.**
  - Routes come from [adsbdb](https://api.adsbdb.com) (free, no key, CORS-open) because ADS-B itself broadcasts no destination. **adsbdb answers by callsign, and airlines reuse flight numbers heavily, so most of its answers are the wrong flight for the aircraft actually overhead** — measured live over Bethesda, 19 of 29 routes were impossible (a "LAX → OAK" climbing out of DC). So every route is checked against physics before it's displayed: it must lie near the great circle it claims, and below 10,000 ft one end must be within 60 nm, since an aircraft that low is landing or departing locally. A route that fails is **dropped rather than shown** — the row falls back to the tail number instead of stating something false. Expect roughly a third of rows to show a route; the rest are private, business or military aircraft with genuinely no scheduled route.
  - The airline is read from the **callsign prefix** (AAL, SWA, KLM), not from the registration — a US airliner's registered owner is usually a leasing trust, so the registration alone labels American Airlines jets "Wilmington Trust Trustee".
- All map vehicles **animate smoothly** between position updates instead of jumping
- **🗺 Map-only full screen** *(every board)* — the ⛶ button pinned on the map (or the **M** key) pins the map over the whole screen: just the map and its vehicles, no cards. **Esc** or the same button goes back. The choice is saved per board, so a wall display can live in map-only mode.
- **Trains per box** *(every board, in ⚙︎)* — Fewer / Normal / More row density. The default is the compact size so more vehicles fit on screen; pick Fewer for bigger type or More to pack even more in.
- **🌙 Night mode** (`night.html`, shared by all three boards) — a big-letters, dark, low-light page showing just the single **nearest** plane, train (Amtrak, or the board's own local rail — MARC/SEPTA/Subway+LIRR+Metro-North), or bus (switchable via the ⚙ gear), with a photo, an animated origin→destination arc or live mini-map, and a live ETA estimate. A real astronomical **sunrise/sunset sky gradient** (toggle in ⚙) tints the background by the sun's actual elevation at your location. Also pick a **color theme** (6 presets + a custom color picker) in the same panel. *(True on-time/late status for flights isn't shown — it needs a paid flight-status API.)*
- **📍 Any location** — each board auto-detects your location (with a per-board default: Bethesda 20816, Temple University for Philadelphia, or Penn Station for NYC), or type **any address, city, or zip** in ⚙︎ to re-center that board there. The address is geocoded free via [Nominatim/OpenStreetMap](https://nominatim.openstreetmap.org) — no key. Your choice is saved (per board) and won't be overridden by GPS; click "Use my current location instead" to switch back. Systems from another city just show an honest "nothing nearby" rather than being hidden by force — e.g. Amtrak/planes work anywhere in the US regardless of which board or address you use.
- Refreshes transit/Amtrak every 15–30s and planes every 15s

Everything works with **zero setup except the WMATA key** (Bethesda board only, for Metrorail/Metrobus). MARC, Ride On, SEPTA, PATCO, and NYC's Subway/LIRR/Metro-North/MTA Bus/PATH are all built in. You can also pick an **accent color** and a **custom location** in the ⚙︎ gear on any board.

## Data sources
| Data | Source | Key needed? | Cost |
|------|--------|-------------|------|
| Metrorail + Metrobus | [WMATA API](https://developer.wmata.com) | ✅ free key | Free |
| Amtrak | [amtraker API](https://github.com/piemadd/amtrak) | ❌ none | Free |
| MARC | bundled `marc-schedule.json` (MTA Maryland GTFS) | ❌ none | Free |
| Ride On | bundled `rideon-schedule.json` (Montgomery County GTFS) | ❌ none | Free |
| SEPTA Regional Rail | bundled `septa-rail-schedule.json` (SEPTA GTFS) | ❌ none | Free |
| SEPTA Subway (MFL/BSL) | bundled `septa-subway-schedule.json` (SEPTA GTFS) | ❌ none | Free |
| SEPTA Bus (3/4/16) | bundled `septa-bus-schedule.json` (SEPTA GTFS) | ❌ none | Free |
| PATCO | bundled `patco-schedule.json` (PATCO GTFS via National RTAP) | ❌ none | Free |
| NYC Subway | live [MTA GTFS-Realtime](https://api.mta.info) (direct, CORS-open) + bundled `mta-subway-schedule.json` fallback | ❌ none | Free |
| LIRR | live [MTA GTFS-Realtime](https://api.mta.info) (direct, CORS-open) + bundled `lirr-schedule.json` fallback | ❌ none | Free |
| Metro-North | live [MTA GTFS-Realtime](https://api.mta.info) (direct, CORS-open) + bundled `mnr-schedule.json` fallback | ❌ none | Free |
| MTA Bus (M42/M15/M34/M34A) | bundled `mta-bus-schedule.json` (MTA GTFS) | ❌ none | Free |
| PATH | bundled `path-schedule.json` (PATH GTFS via Trillium Transit) | ❌ none | Free |
| Planes | [airplanes.live](https://airplanes.live) | ❌ none | Free |
| Flight routes (origin → destination) | [adsbdb](https://api.adsbdb.com) (CORS-open; answers sanity-checked against the aircraft's real position before display) | ❌ none | Free |
| Address search | [Nominatim](https://nominatim.openstreetmap.org) (OpenStreetMap) | ❌ none | Free |
| Map tiles | CARTO / OpenStreetMap | ❌ none | Free |

## One-time setup: free WMATA key (2 minutes) — Bethesda board only
The Philadelphia and NYC boards need no key at all. On the Bethesda board, planes/Amtrak/MARC/Ride On
work with zero setup; Metrorail and Metrobus need a **free** WMATA key:

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
# or      http://localhost:4173/nyc.html
```

## Deploy so it never expires (free, permanent) — GitHub Pages
1. Create a new GitHub repo (e.g. `bethesda-transit`).
2. Upload `index.html`, `philadelphia.html`, `nyc.html`, and `night.html`/`flipboard.html`, plus every
   bundled `*.json` schedule file (`marc-schedule.json`, `rideon-schedule.json`,
   `septa-rail-schedule.json`, `septa-subway-schedule.json`, `septa-bus-schedule.json`,
   `patco-schedule.json`, `mta-subway-schedule.json`, `mta-subway-shapes.json`, `lirr-schedule.json`,
   `mnr-schedule.json`, `mta-bus-schedule.json`, `path-schedule.json`, `amtrak-routes.json`) —
   everything the boards read at runtime.
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `root`**.
4. Wait ~1 minute. Your boards are live forever at:
   `https://<your-username>.github.io/bethesda-transit/` (Bethesda)
   `https://<your-username>.github.io/bethesda-transit/philadelphia.html` (Philadelphia)
   `https://<your-username>.github.io/bethesda-transit/nyc.html` (New York)
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
- `transitEveryMs` / `planeEveryMs` / `subwayEveryMs` / `lirrEveryMs` / `mnrEveryMs` / `busEveryMs` / `pathEveryMs` — refresh cadence

## Notes
- Metrorail predictions are live estimates (the Metro runs on frequencies, so trains don't have a
  fixed per-train published timetable the way buses do — buses show both live and scheduled).
- NYC Subway positions are placed at a train's current/next *station*, not mid-track — the real-time
  feed reports which stop a train is at/approaching, not GPS coordinates (there isn't any; subway
  trains are signaled by track circuit, mostly underground). LIRR/Metro-North do report real GPS for
  most vehicles.
- If trains/buses stay empty, re-check the WMATA key in ⚙︎ (the status bar will say "transit stale").

## MARC, Ride On, SEPTA (Regional Rail + Subway + Bus), PATCO, MTA Bus & PATH — built in, no setup
Every one of these works out of the box from a bundled copy of its published GTFS timetable, using the
same trick: since none of them (or, for MTA Bus/PATH, not by default) publish a real-time feed a
browser can read, each running trip's position is **interpolated between stops using its scheduled
time** — good enough to glide realistically on the map and show genuinely accurate next-departure
times.

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
- **`septa-bus-schedule.json`** → the SEPTA Bus card **and** buses + route lines on the map. Same
  ~20MB-GTFS problem as the subway, so filtered to `ROUTES` inside `gen-septa-bus-schedule.py`
  (currently **3**, **4**, **16** — determined by directly querying SEPTA's GTFS for which routes
  actually run *along* Cecil B. Moore Ave and North Broad St near Temple, not just cross them once).
  Add more route numbers there once you know other routes you actually ride.
- **`patco-schedule.json`** → the PATCO card **and** trains on the map. PATCO (Philadelphia↔Camden, NJ)
  is a single small line (14 stations, ~525 trips) with no real-time API at all, so it's bundled whole.
- **`mta-subway-schedule.json`** + **`mta-subway-shapes.json`** → fallback/labeling reference only
  (live is primary and zero-setup for Subway — see above). Filtered to a Manhattan + nearby Brooklyn/
  Queens bounding box (a full-length subway route can span the whole city, e.g. a 4/5 train runs
  Bronx↔Brooklyn, so this is scoped by geography, not by route) — edit the `LAT_MIN`/`LAT_MAX`/
  `LON_MIN`/`LON_MAX` box in `gen-mta-subway-schedule.py` to widen or narrow it. Route lines use MTA's
  real `shapes.txt` geometry (like Amtrak's routes below), not straight lines between stops, since the
  underground curves are real and visible at typical map zoom.
- **`lirr-schedule.json`** / **`mnr-schedule.json`** → fallback/labeling reference only (live is
  primary and zero-setup for both — see above). Each bundled whole (small systems: 13 and 6 branches
  respectively).
- **`mta-bus-schedule.json`** → the MTA Bus card **and** buses + route lines on the map, by default
  (no live Worker configured). Filtered to `ROUTES` inside `gen-mta-bus-schedule.py` (currently
  **M42**, **M15**/M15-SBS, **M34+**/M34A+ — Midtown's core crosstown/spine corridors) — add more
  route IDs there once you know other routes you ride.
- **`path-schedule.json`** → the PATH card **and** trains on the map, always (PATH's own live data is
  station-based next-arrival countdowns, not vehicle positions, so there's no live map data to upgrade
  to — see the Worker section below). Bundled whole (13 stations, one small system).

When a timetable changes (a few times a year), regenerate the files:

```bash
python3 gen-marc-schedule.py         # re-downloads MARC's GTFS -> marc-schedule.json
python3 gen-rideon-schedule.py       # re-downloads Ride On's GTFS -> rideon-schedule.json
python3 gen-septa-rail-schedule.py   # re-downloads SEPTA's GTFS -> septa-rail-schedule.json
python3 gen-septa-subway-schedule.py # re-downloads SEPTA's GTFS -> septa-subway-schedule.json
python3 gen-septa-bus-schedule.py    # re-downloads SEPTA's GTFS -> septa-bus-schedule.json
python3 gen-patco-schedule.py        # re-downloads PATCO's GTFS -> patco-schedule.json
python3 gen-mta-subway-schedule.py   # re-downloads MTA's subway GTFS -> mta-subway-schedule.json + mta-subway-shapes.json
python3 gen-lirr-schedule.py         # re-downloads LIRR's GTFS -> lirr-schedule.json
python3 gen-mnr-schedule.py          # re-downloads Metro-North's GTFS -> mnr-schedule.json
python3 gen-mta-bus-schedule.py      # re-downloads MTA's bus GTFS -> mta-bus-schedule.json
python3 gen-path-schedule.py         # re-downloads PATH's GTFS -> path-schedule.json
```

## Optional: exact real-time MARC / SEPTA / MTA Bus / PATH positions (free, ~5 min each)
MARC, SEPTA Regional Rail, SEPTA Bus (3/4/16), MTA Bus (M42/M15/M34/M34A), and PATH are all
*scheduled* on the map by default (NYC Subway/LIRR/Metro-North are already **live by default with no
setup at all** — nothing to configure for those three). For exact **live** positions on the ones
above instead — and, for SEPTA, live buses/trolleys **system-wide** (not just 3/4/16) — a browser
can't call their live feeds directly (MARC/MTA Bus: protobuf, no CORS; SEPTA/PATH: plain JSON but
also no CORS), so four tiny [Cloudflare Worker](https://workers.cloudflare.com)s read them server-side
and re-serve the data with CORS added: **`marc-worker.js`**, **`septa-worker.js`**,
**`mta-bus-worker.js`**, and **`path-worker.js`**.

Note: PATH's own live data is station-based next-arrival countdowns, not vehicle positions, so its
Worker only upgrades the departures **card** — the map keeps using the bundled schedule's
interpolation either way.

1. Go to **[dash.cloudflare.com](https://dash.cloudflare.com)** → sign up (free) → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it (e.g. `marc`, `septa`, `mta-bus`, or `path`), **Deploy**, then **Edit code**.
3. Delete the starter code, **paste in all of** the matching `*-worker.js` file, **Deploy** again.
4. Copy your Worker URL (`https://marc.YOUR-NAME.workers.dev`, etc.).
5. On the Bethesda board: **⚙︎ → "Advanced: real-time MARC positions"**, paste the URL, Save.
   On the Philadelphia board: **⚙︎ → "Optional: live SEPTA positions + buses/trolleys"**, paste the URL, Save.
   On the NYC board: **⚙︎ → "Optional: exact live MTA Bus positions"** and/or **"Optional: exact live
   PATH arrivals"**, paste the matching URL, Save.

## Optional: Govee room lights that follow what's overhead (free, ~5 min)
The sky view already knows which carrier is passing and has a colour for it. **`govee-worker.js`**
turns that into room lighting: a United-blue room while a United aircraft is overhead, back to
however you left the lights when the sky empties. Trains and buses work too, in their agency's
colour.

A Worker is the only way in, not a shortcut — Govee's LAN control is UDP, which no browser can
speak, and its cloud API sends no CORS header (and would expose your API key in a page served off
GitHub Pages).

1. **Govee Home app → Profile → About Us → Apply for API Key.** It arrives by email in a minute or two.
2. Same Worker steps as above — name it `govee`, paste in `govee-worker.js`, **Deploy**.
3. **Worker → Settings → Variables and Secrets** → add a **secret** named `GOVEE_API_KEY`.
4. Sky view: **⚙︎ → "Room lights"**, paste the Worker URL, **Save**, then **Scan** and pick a light.
   Switch it **On**.

Colour-capable devices only — plugs and humidifiers are filtered out of the picker. A colour is held
for at least 45s so a busy corridor can't strobe the room, and the lights are restored when the sky
goes quiet, when you switch it off, or when the tab closes. Only while the sky view is actually
open: nothing is running when the page is closed.

### Philips Hue instead — `hue-lights.py`
**Needs a Hue bridge.** Bluetooth-only Hue bulbs — the ones you pair straight to the phone app with
no bridge in the box — cannot be driven by this at all. There is no IP to talk to: the bulb speaks
BLE to whatever is holding it, and nothing on your network can see it. A bridge is what puts a Hue
light on the LAN in the first place.

Hue can't go through a Worker, and that's a routing fact rather than a missing feature: the bridge
sits on your LAN behind a private address and a Cloudflare Worker runs in Cloudflare's network, so
there is no path between them. Talking to the bridge directly is both the only way and the nicer
one — no key to apply for, no cloud round-trip, and it keeps running when the board is closed.

```bash
python3 hue-lights.py --setup      # finds the bridge, asks you to press the link button
python3 hue-lights.py --list       # your lights and their ids
python3 hue-lights.py --light <id> # choose one (repeat for more)
python3 hue-lights.py --test       # 15s of United blue, then back to how it was
python3 hue-lights.py              # watch, polling every 60s (--once for cron)
```

Stdlib only, nothing to `pip install`. Carrier colours are **parsed out of `night.html`** rather than
copied, so the room and the screen can't disagree about what colour United is. If `--setup` can't
find the bridge, get its IP from the Hue app (Settings → My Hue System) and pass `--bridge <ip>`.

## Optional: NJ Transit (blocked on your own registration)
NJ Transit rail (into Penn Station) isn't built in yet — it's the one system in this project that
breaks the "zero setup" pattern entirely. Unlike every other agency here, NJ Transit requires
registering for developer credentials at [developer.njtransit.com](https://developer.njtransit.com)
and accepting their terms before any code can be written against it (an assistant can't do this
registration step for you). If you want NJ Transit added, register there first, then share the
resulting credentials so a `gen-njt-schedule.py` and/or `njt-worker.js` can be built against NJT's
actual API contract — also worth reading NJT's terms for any restriction on how live data may be
re-exposed through a Worker before that Worker gets built.
