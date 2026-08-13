# Accounts for the Transit Spotter

Sign-in so a buyer's log follows them onto a second device. **Optional and
dormant** — with no server URL configured the app behaves exactly as it always
has: everything on one phone, no server, no account.

There are four ways in, and each one is switched on by its own settings. The app
asks the Worker which are live (`GET /health`) and only draws the buttons it can
actually deliver, so a half-configured server never shows a door that leads
nowhere.

| Way in | Needs | What the customer does |
|---|---|---|
| Six-digit code | `RESEND_KEY` | types their address, reads the code out of email |
| Email + password | nothing — always on | types both |
| Continue with Google | `GOOGLE_CLIENT_ID/SECRET` | one tap |
| Continue with Apple | four `APPLE_*` variables | one tap |

**They are all the same account.** The account id is derived from the *verified*
email address and nothing else, so setting a password today and using Google next
week lands you in the same log. There is no "link my accounts" screen, because
there is nothing to link.

The corollary, stated plainly: **anyone who can sign in to an email address can
reach the account behind it.** That is true of every "forgot password" link ever
written, and it is why the address is the identity here rather than any one
credential.

## About the passwords

Earlier versions of this stored none, and said so proudly. That was a real
security property and it has been given up deliberately, so it is worth being
straight about the trade:

- **What it costs.** A breach of the KV namespace now leaks something customers
  reuse on other sites. An emailed code never did. Hashing (PBKDF2-HMAC-SHA256,
  100,000 rounds, per-password salt) makes the leak expensive to exploit rather
  than harmless.
- **What it buys.** Signing in without waiting on an email — on a train, in a
  tunnel, on the device already in your hand. For an app whose entire job is
  logging a train while it is in front of you, that is not a small thing.
- **Nobody is forced to have one.** An account with no password is a normal
  account; it signs in by code or provider. Passwords can be removed again from
  **Your account**, which puts things back exactly as they were.

The round count travels inside the stored hash (`pbkdf2$100000$…`), so it can be
raised later without locking anyone out — an old hash keeps verifying at the
count it was made with and re-hashes when that password next changes.

**One thing to watch on Cloudflare.** Hashing is the only CPU-heavy thing this
Worker does. The free plan allows about 10ms of CPU per request and 100k rounds
will likely exceed it; the paid plan ($5/mo, 30s) does not notice. If sign-in
starts failing with error 1102 "exceeded CPU", that is this — move to the paid
plan, or lower `PBKDF2_ROUNDS`.

## What you have to do yourself

I can't create accounts on your behalf or handle your API keys — you set these up
and paste the secrets in.

### 1. The account Worker

1. Cloudflare → Workers → create from the **Hello World** template, then use
   **Edit Code** to paste in `account-worker.js`.
   *(Creating a worker with pasted code sometimes gets flagged; the template-then-edit
   path works — same trick the SEPTA worker needed.)*
2. **KV** → create a namespace → bind it to the worker as **`ACCOUNTS`**.
3. Settings → Variables → add as **Secrets**, not plaintext variables:

   | Name | What it is |
   |---|---|
   | `RESEND_KEY` | API key from your email provider |
   | `MAIL_FROM` | e.g. `Transit Spotter <login@yourdomain.com>` |
   | `ID_SALT` | any long random string — changing it orphans every existing account |

4. Deploy. `GET /health` should return `{"ok":true,"mail":true,"methods":{…}}`.
   `methods` is what the app reads to decide which buttons to draw.

### 2. Email sending

Workers can't send email on their own. This uses **Resend** (free tier is
generous, the API is one POST). Create an account, verify your sending domain,
generate an API key.

Any provider works — swap the URL and headers in `sendCode()`. Don't skip domain
verification: unverified senders land in spam, and a sign-in code in spam reads
to the customer as "the product is broken".

### 3. Where sign-ins are allowed to land — do this before either provider

`ALLOWED_ORIGINS`, comma-separated, e.g.
`https://transitproject.online,http://localhost:4173`.

The Worker refuses to start a provider sign-in whose return address is not on
this list. **This is the one setting you cannot afford to get loose.** Without
the check, anyone could send someone through your Worker and have the finished
session handed to a site they control. There is a sensible default baked in
(`DEFAULT_ORIGINS`) but set this explicitly for your own domains.

### 4. Google (free)

1. Google Cloud Console → **APIs & Services → Credentials** → Create
   credentials → **OAuth client ID** → type **Web application**.
2. Under *Authorised redirect URIs* add exactly:
   `https://YOUR-WORKER.workers.dev/auth/google/callback`
3. Fill in the **OAuth consent screen**. While it is in "testing" only the
   accounts you list can sign in — publish it before customers arrive.
4. Worker secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Google's verified `email_verified` flag is required, not merely read: an
unverified Google address is refused, because otherwise someone could sign up to
Google with a stranger's address and inherit the stranger's account.

### 5. Apple (needs a paid Apple Developer account, $99/year)

There is no free path here — Sign in with Apple requires the paid membership.

1. Developer portal → **Identifiers** → register an **App ID**, then a
   **Services ID** (this is your `APPLE_CLIENT_ID`, e.g.
   `online.transitproject.signin`).
2. Configure the Services ID: add your domain and the return URL
   `https://YOUR-WORKER.workers.dev/auth/apple/callback`.
3. **Keys** → create a key with *Sign in with Apple* enabled → download the
   `.p8`. **You get one download, ever.**
4. Worker secrets: `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and
   `APPLE_PRIVATE_KEY` (the whole contents of the `.p8`, `BEGIN`/`END` lines and
   all — escaped `\n` or the bare base64 are also accepted).

Apple does not issue a client secret; the Worker signs its own ES256 assertion
from the `.p8` and caches it for four months, which is inside Apple's six-month
cap. Nothing to rotate by hand.

Two Apple behaviours worth knowing before customers hit them:

- **The address arrives once.** Apple sends the email on the *first*
  authorisation only; after that you get an opaque `sub`. The Worker stores the
  `sub → address` mapping the first time and reads it back afterwards. Wipe the
  KV namespace and returning Apple customers land in fresh empty accounts.
- **Hide My Email is a different account.** The relay address Apple invents is a
  perfectly good stable identity, but it is not the customer's real inbox — so
  the same person using Hide My Email on Apple and their real address elsewhere
  has two accounts. There is no way around this and it is worth a line in your
  support notes.

### 6. Point the app at it

In the Spotter: **⚙︎ → Account server URL** → paste the Worker URL → **Save**.
Or bake it into `acctUrl` in `config.js` before shipping a paid copy. Then the
sign-in screen fills itself in with whatever you configured above.

## How the syncing behaves

- **Merge, never replace.** Two devices offline at once each have sightings the
  other has never seen; whoever syncs second must not wipe the first. Union by
  sighting id, and if both hold the same id the newer edit wins. Enforced on the
  client *and* again in the Worker, so a stale client can't overwrite good data.
- **Reads are keyed by the session's own account**, never by an id from the
  request — there's no parameter to tamper with to read someone else's log.
- **Signing out leaves the local log alone.** It isn't "delete my data", and
  someone signing out on a borrowed phone shouldn't lose their sightings.
- A new sighting syncs immediately; there's also a manual **Sync now**.

## Limits worth knowing

- Codes expire after **15 minutes**, five wrong tries burns the attempt.
- Rate limits: **10 code requests per IP per hour**, **5 per email address per
  hour**. This stops someone using your Worker to mail strangers at your expense.
- Password attempts are limited harder, because a password is worth guessing
  forever where a code is dead in fifteen minutes: **30 per IP per hour**,
  **8 per address per hour**.
- Sessions last about **13 months**, then sign in again.
- Provider sign-ins have **10 minutes** to complete, and the ticket handed back
  to the app is good for **90 seconds and one use**.
- **5,000 sightings per account**, oldest dropped past that.
- KV is eventually consistent: a sync on a second device within a second or two
  of the first may see slightly stale data. It self-corrects on the next sync,
  and the merge means nothing is lost either way.

## Changing a password

Changing it normally requires the current one. There is one exception, and it is
deliberate: a session created by **emailed code, Google or Apple** may set a new
password without producing the old one, because that session has just proved
control of the address itself — a strictly stronger claim than knowing the old
password. Without the exception, forgetting your password would mean no way back
in at all.

A session created *by* a password does not get the shortcut, so a borrowed phone
can't be used to quietly take an account over.

## Before you charge money

**This part is not optional, and it isn't something I can do for you.**

- **You become a data controller.** Storing customer email addresses means you
  need a privacy policy saying what you keep, why, and for how long, plus a way to
  delete an account on request. For EU or UK customers that's a GDPR obligation
  with real penalties; California's CCPA is similar. Talk to someone qualified —
  I'm not able to give you legal advice.
- **You now store password hashes too.** That raises the stakes on a breach and
  belongs in the privacy policy and in whatever you tell customers. `PRIVACY.md`
  has been updated; read it and make sure it is still true of you.
- **Google and Apple become part of your data flow.** A customer who signs in
  with either has told them they use your product. Name them in the privacy
  policy.
- **`/spots` holds location history.** Where somebody was, and when. That is
  sensitive personal data in most jurisdictions and deserves to be treated as such.
- **The account system is not the licence system.** `license-worker.js` decides
  who paid; this decides who they are. Deliberately separate — a refund shouldn't
  destroy someone's log, and a lapsed licence shouldn't lock them out of data
  they created. Wire them together only if you actually want that behaviour.
- **Check your data feeds allow commercial use.** `SELLING.md` covers this and it
  is resolved: the aircraft feed runs through our own proxy on adsb.lol under
  ODbL, with attribution rendered. What remains is that
  CARTO tiles, Nominatim geocoding and the photo sources all have their own terms.
  Accounts don't change that.
