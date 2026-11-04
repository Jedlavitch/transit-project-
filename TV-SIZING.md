# TV sizing correction

A TV browser reporting 960×540 previously used the tablet breakpoint. Its header, statistics and full-width map left 26 pixels for departure cards. The fix keeps map and departures side by side on recognized landscape TVs, including Fire TV/Silk, webOS and Tizen.

`fit-cards.js` measures a 1280×720 TV layout inside the existing edge inset. It permits scaling down on small reported viewports as well as scaling up on 1080p/4K screens. A saved manual size is respected up to a limit that leaves a usable 1080×620 layout; the saved value is retained and the Display settings explain when it is limited. Auto continues to follow resizes. Desktop, phone and tablet presentation remains separate. Touch-device detection excludes common mobile/tablet user agents unless the user agent explicitly identifies a TV.

TV chrome is compact. The map receives roughly 40% of the usable width and departures 60%. Smart board shows at most two rows of cards, using one or two columns according to the available local width. Departure text and countdowns are larger within those cards. The existing fitter still measures their heights and preserves complete rows. Optional designs keep their colors and use the same TV geometry.

`smart-board.js` keeps one available departure panel on screen while other useful panels rotate. Reliability history is classified as an extra, not as a departure feed. Active alerts and existing pinned panels retain their priorities. User-hidden cards and feeds are unchanged. The explicit All panels mode continues to allow scrolling.

Only these two shared scripts and their cache-version references in the twelve live boards plus stencil are changed for this correction. Existing city inline logic, feed workers, saved city locations, timetable bundles and Claude setup are untouched. The separate detailed-map change is included in this release and retains its own documented compatibility contract.

Validation: TV browser emulation at 960×540, 1280×720, 1920×1080 and 3840×2160; oversized saved zoom; edge inset; Auto resize; all twelve cities; Classic, Atlas, Paper and Signal; desktop and phone regression checks; panel rotation retains a departure. This is browser emulation, not a claim to have remotely operated the physical TV. Deployment should be followed by a reload on the actual TV.
