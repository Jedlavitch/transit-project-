# Accounts for the Transit Spotter

Sign-in so a buyer's log follows them onto a second device. **Optional and
dormant** — with no server URL configured the app behaves exactly as it always
has: everything on one phone, no server, no account.

There are **no passwords anywhere** in this system. Sign-in emails a six-digit
code. Nothing to hash, nothing to leak, nothing for a customer to reuse from
another site.

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

4. Deploy. `GET /health` should return `{"ok":true,"mail":true}`.
   If `mail` is `false`, `RESEND_KEY` isn't set and sign-in will fail.

### 2. Email sending

Workers can't send email on their own. This uses **Resend** (free tier is
generous, the API is one POST). Create an account, verify your sending domain,
generate an API key.

Any provider works — swap the URL and headers in `sendCode()`. Don't skip domain
verification: unverified senders land in spam, and a sign-in code in spam reads
to the customer as "the product is broken".

### 3. Point the app at it

In the Spotter: **⚙︎ → Account server URL** → paste the Worker URL → **Save**.
Then enter an email, get the code, sign in.

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
- Rate limits: **10 sign-in requests per IP per hour**, **5 per email address per
  hour**. This stops someone using your Worker to mail strangers at your expense.
- Sessions last about **13 months**, then sign in again.
- **5,000 sightings per account**, oldest dropped past that.
- KV is eventually consistent: a sync on a second device within a second or two
  of the first may see slightly stale data. It self-corrects on the next sync,
  and the merge means nothing is lost either way.

## Before you charge money

**This part is not optional, and it isn't something I can do for you.**

- **You become a data controller.** Storing customer email addresses means you
  need a privacy policy saying what you keep, why, and for how long, plus a way to
  delete an account on request. For EU or UK customers that's a GDPR obligation
  with real penalties; California's CCPA is similar. Talk to someone qualified —
  I'm not able to give you legal advice.
- **`/spots` holds location history.** Where somebody was, and when. That is
  sensitive personal data in most jurisdictions and deserves to be treated as such.
- **The account system is not the licence system.** `license-worker.js` decides
  who paid; this decides who they are. Deliberately separate — a refund shouldn't
  destroy someone's log, and a lapsed licence shouldn't lock them out of data
  they created. Wire them together only if you actually want that behaviour.
- **Check your data feeds allow commercial use.** `SELLING.md` covers this and it
  remains the biggest blocker: **airplanes.live prohibits commercial use**, and
  CARTO tiles, Nominatim geocoding and the photo sources all have their own terms.
  Accounts don't change that.
