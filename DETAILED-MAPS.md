# Detailed city maps

The eleven live city boards use a local MapLibre renderer over their existing Leaflet map. The default light style uses pale land, blue water, green parks, building outlines and clear street labels. Map appearance is independent of board appearance. This is an original map using OpenStreetMap data, not Apple Maps or an Apple service.

## Integration contract

Only the basemap import block changes in each city HTML file. `transit-map.js` retains the existing `TBBasemap.add(map, theme, options)`, `addDark`, and returned `setTheme(theme)` API. The Leaflet map, live and scheduled vehicle fleets, departure rendering, selected location, follow layer, and settings remain owned by the existing city scripts. No Claude files, existing timetable generators, workers, secrets, or dependencies are changed. Mini, night and spotter pages retain their existing basemap.

The new independent route layer does not disappear when a departure card hides. Once its bundle loads, it suppresses the old background route groups and decorative range rings to avoid duplicate lines. Vehicle, stop and follow layers remain in place. If the bundle cannot load, the original route groups remain available. If WebGL or the local renderer cannot load, the map falls back to the standard OpenStreetMap street tiles; the transit layer still works.

Map choices are saved separately for each city under `tb.transitMap.<city>.v1`. Light is the default; Dark and Match board are available. Rail, metro/light rail, major bus/BRT, stations and local POIs can be toggled. Ferries, where present in the source, share the metro/light-rail switch. Network overview changes only the map view; My board location returns to the saved board location. Neither changes that location. The control occupies the map rather than adding a departure panel.

## Major stations

Big stations get a larger dot; tapping one opens that station's timetable, every service in one list, soonest first. Hubs are a curated list in `map-data/station-hubs.json`, and `station-hubs.js` draws them. `python3 test-station-hubs.py` checks that each hub still lands on stops in the timetables it names. Times come from the bundled schedules (scheduled only), WMATA with the board's key (live), Amtrak (only trains already running) and, for Zürich, Cologne, Stuttgart and Rome, the same APIs those boards already use. The Major stations switch under Map layers hides them. Rome has no Map layers panel, so its dots stay on.

A hub lists a bundle only where that bundle covers it properly. Partial bus bundles are left out, and subway departures outside Manhattan and nearby are noted rather than implied.

## Network coverage

Network bundles contain the passenger lines available in the listed agencies' published geometry, clipped to a regional boundary. They are not a promise of every operator in an entire state or country. All distinct supplied rail shapes are retained. Missing shapes are never replaced by invented straight segments. Source editions are exposed under Map coverage & sources. Route geometry is static network information, not a live-service guarantee.

| City | Sources |
| --- | --- |
| Philadelphia | SEPTA rail, metro, trolley and major bus; PATCO; NJ TRANSIT rail/light rail in the region; Amtrak |
| Washington | WMATA's six rail lines and stations; agency-designated frequent Metrobus routes; MARC; VRE; Ride On / Flash; Amtrak |
| NYC | Subway; LIRR; Metro-North; PATH; NJ TRANSIT; major buses from all five borough feeds and MTA Bus Company; Amtrak |
| Boston | MBTA subway, Green Line, commuter rail, Silver Line, major bus and ferries; Amtrak |
| New Jersey | NJ TRANSIT rail/light rail and major bus; PATH; PATCO; Amtrak |
| San Francisco | BART; Muni rail, cable cars and major buses including Van Ness; Caltrain; Amtrak |
| Los Angeles | Metro rail; major buses including G and J; seven Metrolink lines; Amtrak |
| Amsterdam | National OVapi/NDOV passenger feed within the Amsterdam region, including rail, metro, tram, major bus and ferry |
| Zürich | ZVV tram and major bus GTFS; 32 canton-published S-Bahn lines |
| Cologne | VRS/go.Rheinland rail, light rail, major bus and ferry geometry |
| Stuttgart | VVS regional/S-Bahn, Stadtbahn and major bus geometry |

Bus selection ranks scheduled weekday trips, taking the highest-service routes per agency/borough and the principal supplied shape in each direction. Explicit rapid corridors are included even if they fall outside that ranking. WMATA uses its official frequent-service map to select routes from Open Data DC's current bus geometry. These rankings are not ridership, real-time frequency or crowding measurements. A rapid bus route may use dedicated lanes for only part of its length. The basemap also shows muted physical railway infrastructure; colored overlays identify the passenger services.

## Refresh and validation

Python 3 and curl are sufficient. No package install is required.

```sh
# Use a fresh cache directory to fetch current public source editions.
python3 gen-transit-network.py --cache /tmp/transit-network-refresh
# Or refresh a subset:
python3 gen-transit-network.py philadelphia boston --cache /tmp/transit-network-refresh
PYTHONDONTWRITEBYTECODE=1 python3 test-transit-network.py
```

Feed URLs, regional bounds, bus limits, rapid-route identifiers and GIS mappings live in `map-data/feeds.json`. Existing downloads in the chosen cache are reused. Do not reuse a stale cache for a current-data refresh. The generator fails rather than replacing a city bundle when a source download fails, the GIS response is truncated, required geometry is missing, or no routes are returned. Each completed city is written atomically; earlier successful cities can update before a later city fails. Review the diff and source editions before publishing. `--supplements-only` is for rebuilding documented GIS supplements against an already generated base bundle; a normal refresh should omit it.

The supplied unit checks cover disjoint clipping, preservation of bends, expired timetable selection, missing geometry, and all bundled coordinates/coverage. Browser checks additionally cover all eleven boards, saved layer toggles, themes, keyboard dismissal, desktop fit, mobile controls, vehicle following, card hiding, zoom and both fallback paths. The standalone verification report is provided with the handoff.

## Dependencies, attribution and sources

- MapLibre GL JS 6.3.0 (ES modules, worker and shared module), BSD 3-Clause and bundled third-party notices: `vendor/maplibre/LICENSE.txt`.
- MapLibre GL Leaflet adapter 0.1.4, ISC: `vendor/maplibre/LEAFLET-LICENSE.txt`. The two imports are adapted to use the board's existing `window.L` and local MapLibre module. No second Leaflet instance is created.
- [OpenFreeMap](https://openfreemap.org/quick_start/) Liberty and Dark styles are hosted locally. Light colors, building treatment, labels and track emphasis are customized. Original style notices: `map-data/STYLES-LICENSE.md`. Fonts, sprites and vector street tiles are fetched from OpenFreeMap's public service.
- Map attribution links to [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles](https://openmaptiles.org/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Street data: ODbL. No offline tile scraping or bulk prefetching is implemented.
- GTFS URLs are recorded in the config and each output bundle. Primary source catalogs include [SEPTA](https://api.septa.org/), [MTA](https://www.mta.info/developers), [WMATA](https://www.wmata.com/ride/maps.html), [VRS](https://www.vrs.de/fuer-unternehmen/open-data-service), and [Zürich](https://data.stadt-zuerich.ch/dataset/vbz_fahrplandaten_gtfs).
- WMATA rail and frequent-bus geometry: [Open Data DC transportation service](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_Rail_Bus_WebMercator/MapServer), layers 58, 51 and 59. Selection follows WMATA's official frequent-service maps. This avoids requiring a new WMATA API key.
- Metrolink geometry: [Southern California Association of Governments](https://maps.scag.ca.gov/scaggis/rest/services/OpenData/Metrolinklinescag/MapServer/0), agency 2025 lines supplementing the GTFS feed's missing shapes.
- Zürich S-Bahn: [Canton Zürich / VBZ / ZVV](https://geolion.zh.ch/geodatensatz/2150), layer 108.1, freely reusable OGD; catalog edition 2025-12-14. Zürich municipal GTFS is CC0. VRS data is Datenlizenz Deutschland Zero 2.0. VVS attribution is retained in source metadata (CC BY 4.0).

No deployment is required to preview locally: serve the repository with `python3 -m http.server 4185` and open a city HTML page. Preview for this change is running on port 4185. The accompanying TV sizing correction is documented in `TV-SIZING.md`.
