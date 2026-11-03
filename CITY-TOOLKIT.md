# City toolkit and board designs

Open **City tools** beside Settings on any of the eleven city boards.

- **Plan transit** opens Google Maps with the board's location as the origin and the selected airport or station as the destination. When watching another place temporarily, the original location remains the trip origin.
- **Watch here** temporarily moves the board's pin and refreshes its existing feeds. **Back to my location** restores the original pin and map view. Reloading also returns to the board's normal location. A later GPS or Settings location choice takes precedence.
- **My places** stores up to six named pins per city in this browser. To save another address, set it using the board's existing Location settings, then choose **Save place**. Saving a pin never changes the board's home-location preference.
- **Check before you leave** links to each city's operators for current service, accessibility, or connection information. Airport shortcuts name their station or terminal explicitly; a rail platform and an airport terminal may require a shuttle or walk between them.

In **Settings → Display → Board style**, choose **Paper** for quiet editorial panels or **Signal** for a ruled station timetable. Classic and Atlas remain available. Styles combine with Dark, Black, and Day, and the choice follows you across city boards. Agency route colours, live/scheduled labels, delay bands, row density, and display-size controls retain their meaning.

## Development and compatibility

There is no new package, build step, API key, or background transit request. Run the project as usual with `python3 feedback-server.py 4173` or a static HTTP server.

- `city-shortcuts-data.js`: eleven city profiles. Every curated destination has a named access point, coordinates, a short connection note, and an official source. Keep fares, frequencies, live disruptions, and guaranteed travel times out of this static data.
- `city-shortcuts.js` / `city-shortcuts.css`: the optional toolkit. It calls existing `applyLoc`, `refreshEverythingForNewLocation`, and map APIs, and stops vehicle follow while switching places. It does not write existing location, commute, licensing, feed, or account settings.
- `board-designs.css`: styles scoped to `data-style="paper"` and `data-style="signal"`, plus the expanded style picker. `theme.css` remains the existing palette source for Classic and Atlas.
- `settings-ui.js`: extends the existing `tb.style` picker; no replacement settings system.
- City HTML edits only add the new assets and bump the settings script version. The stencil also loads the new designs so new city boards inherit them.

Bookmarks use `tb.cityShortcuts.<page-basename>.places`, separate from all existing keys. Invalid stored entries are ignored. If browser storage is unavailable, bookmarks work for the current visit and the UI says so.

The original `.claude/` configuration, launch setup, project dependencies, deployment workflow, and existing generated schedule formats are unchanged. Development was performed in an isolated checkout; the original Claude checkout contains independent uncommitted work and must not be replaced wholesale. Apply the small patch or merge its branch through the normal Git workflow.

## Verification

Browser validation covers all eleven cities, temporary preview/return with unchanged saved-location keys, bookmark create/remove and escaping, Google Maps transit origins, filtering, modal focus restoration/trapping, TV Up/Down navigation, and the race between a temporary view and a later Settings/GPS change.

Design validation covers all four styles with all three themes at phone, desktop, and TV viewport widths. External feed requests are blocked during these deterministic checks, so these checks verify the UI and offline behavior, not the availability of third-party transit feeds. Live feeds continue to use the existing project integrations.
