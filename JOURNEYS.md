# Trip planning and journey guidance

The live city boards have a **Plan trip** control for comparing public-transport journeys, keeping regular destinations handy, and following a selected journey one leg at a time. The planner opens over the board and scrolls within its own panel; the departure board keeps its existing layout and feeds.

## Plan and save a trip

Choose a start and destination, then search for journeys. The start can use the board's current location. Use **Find** beside an address or station field, then select a result before routing. **Leave now**, **Leave at**, and **Arrive by** use the device timezone named in the panel. Compare routes by shortest trip, less walking, or fewer transfers.

Home, Work, and custom saved places make repeated trips easier. Choose a destination and expand **Save this destination**. Saving an existing name updates that place; each city can hold twelve saved places. A saved place becomes the destination when selected; **Swap places** can then use it as the origin. City-toolkit destinations and existing city bookmarks can be reused without replacing the toolkit's saved-location preferences.

Compare departure and arrival times, total journey time, walking, transfers, and the individual legs. A live label means the routing response supplies a real-time update; scheduled legs remain labelled as scheduled. A route is an option from the routing provider, not a guarantee that every operator, service disruption, fare, or accessibility constraint is represented. Google Maps transit directions provide an alternative when the routing service has no suitable result or is unavailable.

Saved places belong to this browser and city. They are not account-synced. Clearing browser site data removes them. If browser storage is unavailable, the planner explains that changes last for the current visit. Places use `tb.journeys.<city>.v1`; the selected journey and manual step use `tb.journeys.<city>.v1.active`. Existing `tb.cityShortcuts.<city>.places` bookmarks are read without being rewritten.

## Follow a journey

Start guidance on a selected journey to see the current leg, departure timing, boarding or transfer details, and the destination stop. Use the previous and next controls to move between legs. Stop lists and displayed times come from the plan response.

Guidance is a foreground trip companion. Keep the page open. **Continue trip** returns to guidance after the panel is closed. It is not a background navigation service and does not promise lock-screen, audio, push, or get-off notifications. Times are a snapshot of the selected plan; **Replan trip** searches again, using a recent, sufficiently accurate GPS position if one is available, otherwise the original start.

**Use my location** starts only after an explicit user action and the browser's permission prompt. GPS proximity is approximate and must not be presented as a confirmed vehicle position or automatic proof that a stop has been reached. Location sharing pauses when the page becomes hidden; turn it on again to resume. Ending the journey stops the location watch.

## Source and configuration

- `trip-core.js` handles location search, routing requests, cancellation, timeout, and normalization of provider responses.
- `trip-planner.js` owns the planner, its local saved places, and foreground guidance.
- `trip-planner.css` scopes the planner's presentation and responsive layout.
- The eleven city HTML pages load these shared assets. `stencil.html` loads them for future city boards; it must also work without a city-toolkit profile.

The current city pages are `dc.html`, `philadelphia.html`, `nyc.html`, `boston.html`, `newjersey.html`, `losangeles.html`, `sanfrancisco.html`, `amsterdam.html`, `zurich.html`, `cologne.html`, and `stuttgart.html`.

The default routing provider is Transitous, using the MOTIS API. An operator can supply another compatible MOTIS instance through `window.TB_CONFIG.journeyApi` in `config.js`, for example:

```js
journeyApi: "https://your-routing-service.example",
journeyProviderName: "Your service",
journeyProviderUrl: "https://your-routing-service.example/about",
```

Use a browser-accessible HTTPS endpoint that permits requests from the board's origin. Do not place private API credentials in `config.js`; it is public site source. Custom providers display their configured plain-text name and HTTPS attribution link, or a neutral service label. The core accepts a host base, an `/api` base, or a full `/api/v6/plan` URL. Search uses `/api/v1/geocode`; journey planning uses `/api/v6/plan`. When switching to an independent provider, update the visible routing attribution to match that deployment's data sources and conditions. No new package, build system, database, account system, or Worker is required for the client itself.

Requests are user-initiated. Do not turn the planner into a polling loop or fetch a route per departure on the board. Abandon stale requests when inputs change, the panel closes, or a newer search starts. Treat no results, invalid responses, cancellation, rate limits, offline state, and timeout as recoverable states. Never manufacture an itinerary or convert a missing real-time field into a live prediction.

### Transitous service conditions

[Transitous API policy](https://transitous.org/api/) permits light, noncommercial, open-source use and allows light prototype testing before code publication. Its public service does **not** permit commercial use. Before charging for a product that relies on this planner, use an appropriately licensed and provisioned routing service or self-hosted MOTIS deployment. Do not redirect production requests to Transitous staging or internal servers.

Keep visible attribution links to [Transitous data sources](https://transitous.org/sources/) and [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), and provide a visible way to contact the application operator. In a browser the site's Referer can substitute for a custom application User-Agent. Review the provider's current policy before a production rollout or a material increase in traffic; its volunteer service provides no availability guarantee.

Search text and chosen origin/destination coordinates are sent to the configured routing provider when the user searches or plans. Explain this at the point of use. Local saved-place storage does not itself require sending places to a server. GPS watches must be stopped when the user ends location sharing or ends the journey; do not request location automatically on load or reload.

## Compatibility and verification

Keep all new storage keys separate from existing board location, appearance, commute, feed, account, and licensing keys. Read the board's lexical `state` variable where necessary; it is not necessarily a `window.state` property. Do not change the board's `applyLoc` or saved home-location state merely to plan a trip.

Only one modal should own focus and inert background elements at a time. Close the city toolkit through `TBCityToolkit.close()` before opening this planner. Trap Tab within the active dialog, support Escape, restore focus on close, and keep all controls reachable on phone and TV layouts. Do not remove `inert` attributes that another component already owned.

Check the client at phone, tablet, desktop, and TV sizes and with all existing styles and themes. Verify saved-place isolation and reload, malformed or unavailable storage, stale response cancellation, origin/destination changes, scheduled and real-time mixtures, cancelled trips, no results, network failure, provider timeout, manual guidance progress, and geolocation denial. Deterministic fixture tests validate behavior; they do not establish third-party feed availability or complete routing coverage.
