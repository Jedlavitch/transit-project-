# City toolkit and board designs

Open **City tools** beside Settings on any of the eleven city boards.

- **Plan transit** opens Google Maps with the board's location as the origin and the selected airport or station as the destination. When watching another place temporarily, the original location remains the trip origin.
- **Watch here** temporarily moves the board's pin and refreshes its existing feeds. **Back to my location** restores the original pin and map view. Reloading also returns to the board's normal location. A later GPS or Settings location choice takes precedence.
- **My places** stores up to six named pins per city in this browser. To save another address, set it using the board's existing Location settings, then choose **Save place**. Saving a pin never changes the board's home-location preference.
- **Check before you leave** links to each city's operators for current service, accessibility, or connection information. Airport shortcuts name their station or terminal explicitly; a rail platform and an airport terminal may require a shuttle or walk between them.

The live board also has a **Travel advisories** card. Choose **Edit** to pin official advisory links and up to two local connection notes for that city. The card includes the same **Plan transit** and temporary **Watch here** actions as City tools. These are links and sourced travel notes; current incident reports still come from the existing live alert cards. The card can be hidden or collapsed using the normal board controls.

In **Settings → Display → Board style**, choose **Paper** for quiet editorial panels or **Signal** for a ruled station timetable. Classic and Atlas remain available. Styles combine with Dark, Black, and Day. Under **Appearance scope**, choose **This city only** to keep this city's theme, accent, row density, and design separate. **Shared look** uses the existing shared defaults; switching back to **This city only** restores the city's last local look. Agency route colours, live/scheduled labels, delay bands, and display-size controls retain their meaning.

## Development and compatibility

There is no new package, build step, API key, or background transit request. Run the project as usual with `python3 feedback-server.py 4173` or a static HTTP server.

- `city-shortcuts-data.js`: eleven city profiles. Every curated destination has a named access point, coordinates, a short connection note, and an official source. Keep fares, frequencies, live disruptions, and guaranteed travel times out of this static data.
- `city-shortcuts.js` / `city-shortcuts.css`: the optional toolkit. It calls existing `applyLoc`, `refreshEverythingForNewLocation`, and map APIs, and stops vehicle follow while switching places. It does not write existing location, commute, licensing, feed, or account settings.
- `board-designs.css`: styles scoped to `data-style="paper"` and `data-style="signal"`, plus the expanded style picker. `theme.css` remains the existing palette source for Classic and Atlas.
- `city-board.js` / `city-board.css`: optional advisory card and its city-specific checklist. Reuses the toolkit's location and routing actions, registers with existing card visibility/collapse controls, and marks its list as scrollable so Atlas keeps all pinned links reachable.
- `city-preferences.js`: synchronous appearance adapter loaded before pre-paint. Shared mode uses the original `tb.theme`, `tb.accent`, `tb.rows`, and `tb.style` keys; local mode reads and writes a separate city look.
- `settings-ui.js`: extends the existing style picker and adds appearance scope; no replacement settings system.
- City HTML edits load the new assets and route appearance reads/writes through the adapter. Existing per-city legacy keys and location/feed logic remain intact. The stencil loads the new designs; a new city needs a profile and the city assets to enable the toolkit and local preferences.

Bookmarks use `tb.cityShortcuts.<page-basename>.places`, separate from all existing keys. Invalid stored entries are ignored. If browser storage is unavailable, bookmarks work for the current visit and the UI says so.

Advisory choices use `tb.cityBoard.<page-basename>.v1`; local appearance uses `tb.cityLook.<page-basename>`. Advisory choices are always per city. Local appearance is opt-in and does not overwrite shared defaults or another city's saved look. No account or server sync is added.

The original `.claude/` configuration, launch setup, project dependencies, deployment workflow, and existing generated schedule formats are unchanged. Development was performed in an isolated checkout; the original Claude checkout contains independent uncommitted work and must not be replaced wholesale. Apply the small patch or merge its branch through the normal Git workflow.

## Verification

Browser validation covers all eleven cities, temporary preview/return with unchanged saved-location keys, bookmark create/remove and escaping, Google Maps transit origins, filtering, modal focus restoration/trapping, TV Up/Down navigation, and the race between a temporary view and a later Settings/GPS change.

Design validation covers all four styles with all three themes at phone, desktop, and TV viewport widths. External feed requests are blocked during these deterministic checks, so these checks verify the UI and offline behavior, not the availability of third-party transit feeds. Live feeds continue to use the existing project integrations.

Live-board checks cover advisory pinning and the two-note limit, reload persistence, direct preview/return, appearance isolation across cities and reloads, restoration when switching scope, and card/editor layout at 375, 1024, 1440, and 1920 pixels across all four styles. Every city is checked for the advisory card and local appearance controls.
