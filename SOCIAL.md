# The daily post

> **Two bots now.** This page describes `post-daily.py`, which posts what your
> *browsers* saw. There is also **`roundup.py`** — a standalone bot that gathers
> its own data for all eleven cities and posts one round-up to Threads, Mastodon
> and Bluesky, whether or not any board is open. See [The round-up bot](#the-round-up-bot)
> at the bottom. Both can run; neither depends on the other.


Every board scores the planes and trains it shows. At the end of the day the
strangest one wins, and this posts it.

```
your screens               a shared list            GitHub, once a day
┌──────────────┐  PUT      ┌────────────┐   GET     ┌──────────────────┐
│ dc.html      │──────────▶│            │◀──────────│ post-daily.py    │
│ nyc.html     │           │  jsonblob  │           │  draws the card  │
│ amsterdam…   │           │            │           │  posts it        │
└──────────────┘           └────────────┘           └──────────────────┘
```

Nothing here runs until you set it up, and every step is reversible.

---

## 1. What counts as interesting

**The aeroplane itself comes first** — what type it is, and whose colours it is
in. Speed and altitude score, but barely: they say what a flight is *doing*, not
what it *is*, and this is a leaderboard about the aircraft.

Two halves, and the second is what makes it worth reading a month from now.

**Universal** — notable anywhere, scored from the first day: an emergency
squawk, an A380, a 747, a C-17, a DC-3, an aircraft built in 1968, a widebody, a
train ninety minutes late, one of Amtrak's long-distance trains.

**Learned** — each board keeps a private thirty-day tally of what it has
actually seen, so "rare" means rare *here*. A tram type that is ordinary in
Cologne and an airline that turns up twice a month in Boston are both scored
against that board's own history, not a list someone wrote in advance. Type
carries the heaviest learned weight of anything.

The learned half is damped while a board is new. On day one everything is a
first sighting, and a leaderboard that says so is worthless — it reaches full
weight after about a week of watching. So this gets better the longer you leave
your screens on, which is the point.

### About livery

**Nothing broadcasts it.** ADS-B carries a type code, a registration and a
callsign. There is no paint field, no free API that maps a registration to a
special scheme, and the boards will not pretend otherwise — a "retro livery
detected!" badge would be invented, and inventing it is exactly what makes a
daily account worth ignoring.

What is real, and is what the scorer uses:

* **Operator rarity.** An airline this board seldom sees is a colour scheme
  seldom seen over this city. That is the same sighting, and the reason text
  says it in those words: *"Finnair colours over this board, for the first time"*.
* **The photograph.** Every winner is shown with a picture — the exact airframe
  where planespotters.net has one for that hex, a representative photo of the
  type otherwise, labelled as such either way. That is where the paint is
  actually visible, which is why the card leads with it rather than with text.

### Aircraft scope

By default the board scores **scheduled airline flights, plus any aircraft
remarkable in its own right**. Left to itself the scorer kept handing the day to
a county police helicopter, which is genuinely the odd thing overhead and a poor
post — so non-airline aircraft have to earn their place.

The test is deliberately *not* "is it an airline?". It is whether the aircraft
scores highly on signals that need no history: a B-17, a DC-3, an An-124, a
Special Air Mission, a C-17, anything squawking 7700. Those are in. A police
helicopter, a news helicopter, a survey aircraft, a flight-school Cessna and an
ordinary bizjet are out.

That distinction matters. An earlier version filtered by category instead, and
because every military and every vintage type flies on a tail number rather than
a flight number, it silently discarded the most interesting aeroplane that can
appear over anybody's board — about 60% of the aircraft scoring table was
unreachable. Interest, not category, is the right cut.

Switch to *anything that flies* on the leaderboard page and the everyday
helicopters, private jets and survey aircraft come back too — what an actual
spotter wants. One control, no code change.

Buses are never scored; the ask was planes and trains.

---

## 2. Pool your screens

Every board is on one origin, so a screen that shows Washington in the morning
and New York at night already builds the **All cities** list on its own. Nothing
to configure, nothing leaves the device.

A share code is only needed to join **different devices** — and to give the
daily post something to read.

1. Open any board → **Best** → *Pool your screens* → **Create a new one**.
2. Copy the code. Paste it into the same box on your other screens.
3. Keep a copy: it goes in a GitHub secret in the next step.

> The code is the only access control and jsonblob.com is a public store, so
> anyone holding it can read your list. That is the same trade the Spotter's
> share code makes. Nothing is published until you set one.

---

## 3. Turn on the daily post

**Settings → Secrets and variables → Actions → New repository secret.**

| Secret | Needed for | Where it comes from |
|---|---|---|
| `LEADER_BLOB` | **everything** | the share code from step 2 |
| `BSKY_HANDLE`, `BSKY_APP_PASSWORD` | Bluesky | Settings → Privacy and security → App passwords |
| `MASTODON_BASE_URL`, `MASTODON_TOKEN` | Mastodon | your server → Preferences → Development → New application, scope `write:statuses` + `write:media` |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X | developer.x.com → your app → Keys and tokens. The access token must be **Read and write** |
| `DISCORD_WEBHOOK` | Discord | channel → Edit Channel → Integrations → Webhooks |

Set as many or as few as you like. A network with no credentials is skipped.
With none set at all, the job draws the card, prints the caption and stops.

**Create these accounts yourself.** Signing up and generating tokens is not
something to hand to an assistant, and none of these values should ever be
pasted into a chat window — they go straight into the GitHub secrets box, which
hides them from logs.

### Which network to start with

**Bluesky.** An app password takes about a minute, no developer account, no
review, no approval queue. X needs a developer account and its free tier caps
writes at 500 a month — fine for one post a day, but it is the longest setup of
the four. Instagram is deliberately not supported: it requires a Business
account, a Facebook app and a review process, for one image a day.

---

## 4. Try it before it says anything in public

**Actions → Daily post → Run workflow**, leave *dry run* ticked.

The log prints the winner, the caption and where the card was written. Read it.
Do that for a few days if you like — the schedule will not post anything while
your credentials are unset either way.

When you are happy, untick *dry run* for a manual run, or just leave the daily
schedule to it.

---

## 5. Posting by hand instead

The leaderboard page has the whole thing without any of the above: **Best →
Share it**. It draws the same card in the browser (square for Instagram, wide
for X and Bluesky), writes the caption, and offers *Share…*, *Copy caption* and
*Download image*. On a phone, *Share…* opens the real share sheet and drops the
image straight into whichever app you pick.

Nothing on that page is sent anywhere. It is a drawing and some text.

---

## Getting rid of the box

`interesting.js` injects a **Today's best** card into each board's grid, and it
registers itself in that board's own *Show on board* list — so it has a
checkbox in ⚙ Settings exactly like Metrorail or Planes, and an **×** in its own
header for getting rid of it on the spot. Either one persists, and the checkbox
brings it back.

## Photographs are not yours

The card the daily job posts carries a photograph taken by somebody else:
planespotters.net images are used under their API's terms with the
photographer's credit drawn onto the card, and Wikimedia Commons images under
their own licences with the author credited the same way. Credit is rendered
into the image itself precisely because a caption gets stripped when a post is
re-shared.

If you would rather post a card that is entirely your own data, set the
`CARD_PHOTO` repository secret (or environment variable) to `0` and the card is
drawn type-only.

One practical limit: planespotters' public API returns at most a 497px-wide
thumbnail, so filling a 1080px card upscales it about 2× and a light sharpen is
applied. It is a little soft at full size. A slightly soft photograph of the
actual aircraft beats a sharp one of a different airframe.

## What it will not do

**Post on a day nothing was watched.** If no board was running, the shared list
is empty or from an earlier date, and the job exits without posting. A daily
account that goes quiet on a quiet day is honest; one that posts a made-up
aircraft is finished the first time somebody checks the tail number.

**Post more than once.** One run a day, at 23:10 UTC — evening in the US, so a
full day has been watched. GitHub's scheduled runs are best-effort and can be
5–15 minutes late; for this it does not matter.

**Claim things it cannot know.** Every line on the card is derived from a field
in a feed: the score is a sum of stated reasons, and the reasons say which. If
adsbdb's route for a callsign fails the plausibility check the boards already
apply, the route is not shown at all rather than guessed.

---

## Files

| File | What it is |
|---|---|
| `interesting.js` | the scorer, on every board — one script tag, no per-city code |
| `leaderboard.html` | the page: per-city and all-cities, the card, the caption |
| `post-daily.py` | reads the shared list, draws the card, posts it |
| `.github/workflows/daily-post.yml` | the once-a-day run |
| `shots/leaderboard-latest*.png` | the last card, committed so link previews work |

Run the poster anywhere, not just on GitHub:

```bash
LEADER_BLOB=<your-share-code> DRY_RUN=1 python3 post-daily.py
```

---

# The round-up bot

`roundup.py` is the standalone one. It needs no browser, no share code and no board
open anywhere: it gathers its own data for all eleven cities, scores **aircraft and
trains separately**, and posts one card a day.

```
ADS-B proxy (per city)  ─┐
amtraker (one national)  ├─►  roundup.py  ─►  card  ─►  push  ─►  Threads
GTFS bundles (on disk)  ─┘                      └────────────────►  Mastodon, Bluesky
```

## What it can and cannot see

| | source | delays? |
|---|---|---|
| Aircraft, all 11 cities | your ADS-B proxy | n/a |
| Amtrak, the 7 US cities | amtraker, live | **yes** |
| Metro, tram, regional rail | GTFS bundles in this repo | **no** |
| Zurich, Cologne, Stuttgart rail | *nothing* — those boards use live transitous, which has no bundle | — |

Be clear-eyed about the bottom two rows. A bundled timetable carries no delays and
no vehicle identity, so those trains are scored on which line and destination is
running and how rarely the bot has seen it. And the three German-speaking cities
produce **aircraft only**. The card renders that as an absent train, never as
"feed unavailable" — a missing timetable and a broken feed are different claims.

## Setup

**Settings → Secrets and variables → Actions.**

| Secret | For |
|---|---|
| `ADSB_URL` | **required** — your ADS-B proxy. Without it there is nothing to score. |
| `BSKY_HANDLE`, `BSKY_APP_PASSWORD` | Bluesky — one app password, a minute's work |
| `MASTODON_BASE_URL`, `MASTODON_TOKEN` | Mastodon — one token, scopes `write:statuses` + `write:media` |
| `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN` | Threads — see below |
| `CARD_PHOTO` | set to `0` to draw the card without a photograph |

Then **Actions → Daily round-up → Run workflow** with *dry run* ticked. It prints the
winners and all three captions and posts nothing.

## Threads is the awkward one

Two facts shape the whole design, both verified against Meta's docs:

**There is no byte upload.** Meta cURLs the image from a public HTTPS URL. So the bot
renders the card, commits and pushes it to `shots/daily/YYYY-MM-DD.png`, waits for
Pages to serve it, and only then calls Threads. A dated path is used deliberately: a
URL that has never existed cannot be served stale by Meta's fetcher or the CDN.

**The token expires every 60 days.** Getting one is a three-leg OAuth flow in a
browser: create a Meta app with the Threads use case, authorise with scopes
`threads_basic` and `threads_content_publish`, exchange the code for a short-lived
token, then exchange that for a long-lived one *within the hour*. The `user_id` comes
back in leg 2 — save it then. The bot does **not** auto-rotate: that needs a PAT and
libsodium, and this repo is stdlib-only. Instead it fails loudly on Graph error 190
so you know to redo it. Put a reminder in your calendar for ~55 days.

## What it refuses to do

**Post a thin day.** If fewer than four cities produce data, it says nothing. A league
table that is mostly empty is worse than silence.

**Report a lapsed timetable as a quiet railway.** Bundles carry the agency's own
service calendar and expire. An expired bundle is skipped and logged, never counted as
zero trains.

**Run twice.** Scoring, drawing, pushing and posting are one invocation. An earlier
draft split render and post across two workflow steps, which re-scored from scratch
and handed Meta the URL of a card built from a different snapshot of the sky.

## Running it yourself

```bash
DRY_RUN=1 CITIES=dc,nyc python3 roundup.py
```

`CITIES` limits the run; leave it out for all eleven. Note the loop paces itself ~3.5s
per city — the proxy returns empty for rapid successive calls, and without the pause
the bot concludes most of the world has an empty sky.
