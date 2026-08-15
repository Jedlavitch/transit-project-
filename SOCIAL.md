# The daily post

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

Two halves, and the second is the one that makes this worth reading.

**Universal** — things that are notable anywhere, scored from the first day:
an emergency squawk, an A380, a 747, a C-17, an aircraft built in 1968, a train
ninety minutes late, one of Amtrak's long-distance trains, 124 mph.

**Learned** — each board keeps a private thirty-day tally of what it has
actually seen, so "rare" means rare *here*. A tram type that is ordinary in
Cologne and an airline that turns up twice a month in Boston are both scored
against that board's own history, not a list someone wrote in advance.

The learned half is damped while a board is new. On day one everything is a
first sighting, and a leaderboard that says so is worthless — it reaches full
weight after about a week of watching. So this gets better the longer you leave
your screens on, which is the point.

**Aircraft scope.** By default only scheduled airline flights are scored: things
with a flight number, a city pair and an operator people recognise. Switch it to
*anything that flies* on the leaderboard page and helicopters, private jets,
survey aircraft and military traffic come back in — genuinely the rarer
sightings, and what an actual spotter wants. Buses are never scored; the ask was
planes and trains.

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
