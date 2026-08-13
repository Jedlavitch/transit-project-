# Security and personal data

What is protected, what is not, and who has to do what. Written to be honest
rather than reassuring — a document that says everything is fine is no use to
anybody.

---

## 1. Who can change the live site

**Anyone who can push to `main` can change what visitors see, immediately.**
`.github/workflows/pages.yml` deploys on every push to `main`, with no review
step. Repository write access and live-site edit access are the same thing.

Nothing in this repository can change that — it is a GitHub setting. Three
things worth checking, all under **Settings** on the repo:

| Where | What to check |
|---|---|
| Settings → Collaborators and teams | That the list is only people you intend. Anyone here can push. |
| Settings → Branches → Add branch protection rule for `main` | Require a pull request before merging. Turns an accidental or hostile push into something you have to approve. |
| Settings → Developer settings → Personal access tokens (your account) | Old tokens with `repo` scope are push access in a text file. Delete ones you do not recognise. |

The repository is **public**. That is fine for the code, and it is what lets
GitHub Pages serve it on the free plan — but it means everything committed here
is readable by anyone, forever, including in the history. See §3.

## 2. What the pages themselves protect

Nothing on a static site can keep a determined visitor out of the page. Be clear
about what the two gates actually do:

- **`gate.js` (the licence)** decides what a *browser* will show. It is a sales
  mechanism, not a security boundary. Anyone can read the page source.
- **`admin.js` (the admin passphrase)** hides the settings UI behind a SHA-256
  hash held in `localStorage`. It stops a customer stumbling into operator
  settings. It does not stop anybody who opens developer tools, and it is not
  meant to.

Neither protects data, because there is no data behind them — everything the
boards read is either a public transit feed or already in the page.

## 3. Secrets

**`config.js` is served to every visitor.** Anything in it is public. Today it
holds:

- `wmataKey` — a WMATA developer key. Deliberate and documented in the file:
  free, rate-limited per key, rotatable at developer.wmata.com. Worst case is
  throttling. Rotate it if it starts getting hammered.
- Worker URLs — endpoints, not credentials. Each Worker is responsible for its
  own authorisation.

**What must never go in `config.js` or anywhere else in this repo:** Stripe
keys, Resend or other mail API keys, the licence-signing secret, admin
passwords. Those belong in a Worker's encrypted secrets. A secret committed here
is public the moment it is pushed, and stays in git history after it is deleted
— rotating it is the only real fix.

## 4. Personal data

### What is collected

| Data | Where it lives | Leaves the device? |
|---|---|---|
| Location (board's chosen place) | `localStorage` | No |
| Spotter sightings — route, vehicle, place, note, handle, timestamp, lat/lon | `localStorage` | Only if you turn on sharing |
| Email address | The accounts Worker, for sign-in codes | Yes, to that Worker |
| Licence key | `localStorage` | Sent to the licence Worker to verify |

Boards with no sharing configured send **no** personal data anywhere. Transit
feeds are queried by coordinate, which reveals a rough area to the agency's own
API, exactly as any transit app does.

### The share code is a bearer secret — treat it like a password

The default sharing backend is **jsonblob.com**: public, unauthenticated,
no account. That is why it needs no setup, and it is the whole risk. Whoever
holds a share code can:

- **read** every sighting behind it — route, place, your handle, timestamps, and
  the coordinates each was logged at, and
- **overwrite** it, which changes what the Spotted card shows on your boards.

So: do not post a share code publicly, and do not paste one into a screenshot.
If one gets out, generate a new one — the old blob cannot be deleted or locked.

Two mitigations are in the code:

- **Published coordinates are rounded to 2 decimal places** (~1.1 km) even
  though the local log keeps 4 (~11 m). Nothing downstream needs the precision:
  boards scope sightings to 60 miles and the alert watcher to 15 nautical miles.
  A leaked blob shows a neighbourhood, not a doorstep.
- **Everything read back from a feed is treated as hostile** — row count, types
  and string lengths are all capped before rendering, and all text is escaped.
  Verified against a payload of 9,000 rows with prototype-named modes, nested
  objects and an `<img onerror>` route name.

For anything beyond personal use, deploy `spotter-worker.js` and set a feed
secret instead of using jsonblob. That moves the log onto infrastructure you
control.

### Known weakness, not yet fixed

The Worker feed sends its secret as a **query parameter**
(`/feed?s=<secret>`). Query strings turn up in server logs, proxy logs and
`Referer` headers. It should move to an `Authorization` header, which needs the
Worker and the client changed together.

## 5. If something leaks

1. **Share code** — make a new one in the Spotter. The old blob stays readable
   forever; assume anything in it is public.
2. **WMATA key** — rotate at developer.wmata.com, update `config.js`, push.
3. **Anything with real value** (payment, mail, signing keys) — rotate at the
   provider first, then remove from the repo. Deleting the commit is not enough;
   git history keeps it.
4. **Push access** — remove the collaborator or revoke the token, then review
   recent commits on `main` for anything you did not make.
