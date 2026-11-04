# City discovery and passport

Choose **Explore** in any city board's header, or open its **Explore [city]** card. The first collection includes 36 places across twelve cities: three places and one two-stop outing per city.

- Browse food, culture, and outdoor picks, search by name or description, and keep a Saved list.
- **Go by transit** and **Walk** open Google Maps using the board's current pin as the origin. The second outing leg starts at the first destination. Distances are approximate straight-line distances, not walking times or transit estimates.
- **Surprise me** chooses from the current search/filter, preferring unvisited places and avoiding the previous pick when possible.
- **I visited · collect stamp** records a self-reported visit. **My passport** shows dated stamps and milestones for a first visit, completing the two-stop outing, and visiting the collection. Visits can be undone.
- **Copy link** shares a city and destination. Board query parameters, saved location, and passport progress are excluded. A selectable link appears if clipboard access is unavailable.

Visitor links go to the destination or an official city/tourism source. Check those pages for current opening hours, accessibility, and tickets; the board does not claim live availability, free admission, or verified visits. The guide is a small curated starting collection, not an exhaustive nearby-place search.

The board card participates in Smart board rotation and supports the existing hide/collapse controls. Smart rotation holds while Explore is open. The guide scrolls inside its dialog; it does not enlarge the departure board. It supports keyboard focus trapping, Escape, tab switching with Left/Right, and TV Up/Down navigation.

## Implementation and compatibility

`city-discovery-data.js` contains the catalogue and official source URLs. Keep each place's ID stable: saved places, stamps, and shared links refer to it. Each place requires `id`, `name`, `kind` (`outdoors`, `culture`, or `food`), approximate coordinates, a specific address, a short description, an exploration prompt, and an official HTTPS URL. Outing stop IDs must exist in the same city's catalogue. Names and addresses, rather than approximate coordinates, identify destinations in Google Maps links.

`city-discovery.js` and `city-discovery.css` provide the interface. Load them after the existing city profile data and before `smart-board.js`. The twelve city HTML files only add asset imports and update the Smart board cache version. New cities need an entry in both `TBCityShortcutsData` and `TBCityDiscoveryData` before loading this feature; the blank stencil has no discovery catalogue.

Preferences use `tb.discovery.<city>.v1`, containing `saved` (known place IDs) and `visits` (known IDs mapped to ISO timestamps). Unknown IDs and invalid dates are discarded. No account sync is provided. Blocked storage falls back to memory with a visible message. Progress is local to this browser and origin; clearing site data removes it.

The module reads the board's existing location and registers one card. It does not change the pin, location preferences, transit fetchers, schedules, authentication, service workers, or Claude configuration. It introduces no dependency, API key, background place API, or build step. External navigation only happens when a visitor follows a link.

## Verification

Chrome checks cover all eleven catalogues and isolated passports; filters, search, save/unsave, routing origins and outing legs; visits, undo and milestones; surprise selection; sharing privacy and clipboard fallback; keyboard focus; reload and deep links; malformed and unavailable storage; and saved-location preservation. Layout checks cover four board styles, Dark and Day themes, and 375/768/1440-pixel widths, including the map-open board after closing Explore. External transit requests are blocked for deterministic UI checks; provider availability is not part of these checks.
