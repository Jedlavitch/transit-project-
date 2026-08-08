# Locking the boards behind a login (Cloudflare Access)

Selling access means people who haven't paid can't load the site at all. That
cannot be done on GitHub Pages: Pages serves your files to anyone who asks for
them, and any lock written in JavaScript runs *after* the browser already has the
file. Someone can `curl` the URL or turn JavaScript off and read everything.

This moves the site somewhere a real gate can sit in front of it. Everything here
is dashboard clicks — **no Workers, no KV bindings**, which is the part that went
badly before. The only cost is a domain, about $10/year.

**Time:** ~45 minutes, most of it waiting for DNS.

---

## What you end up with

```
customer  ->  yourdomain.com  ->  Cloudflare Access  ->  Cloudflare Pages
                                  (is this email on      (your boards)
                                   the paid list?)
```

Anyone not on your list gets a login page and never receives a single file.
Customers get a six-digit code by email — no account to create, no password.

---

## 1. Get a domain (~$10/yr)

Any registrar. Cloudflare Registrar sells at cost and skips a step later, since
the domain is already on Cloudflare.

If you buy elsewhere: add the domain at **dash.cloudflare.com → Add a site**,
then change the nameservers at your registrar to the two Cloudflare gives you.
Propagation is usually under an hour.

## 2. Make the repo private

This is what stops the free copies. While the repo is public, your source and
your bundled timetables are downloadable from github.com no matter what sits in
front of the site.

**GitHub → your repo → Settings → General → Danger Zone → Change visibility →
Private.**

On a free GitHub account this also switches GitHub Pages off, which is what you
want — it stops `jedlavitch.github.io` serving a second, ungated copy. Cloudflare
Pages reads private repos on its free plan, so nothing is lost.

You can also delete `.github/workflows/pages.yml` afterwards; it has nothing left
to deploy.

## 3. Deploy on Cloudflare Pages (free)

**dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git.**

Authorise the Cloudflare GitHub app for this repo, then:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *(leave empty)* |
| Build output directory | `/` |

There's no build step — it's a static site, so Pages just publishes the files.
Every push to `main` redeploys, same as now.

You'll get `your-project.pages.dev`. Check the boards work there before going on.

## 4. Point your domain at it

**Your Pages project → Custom domains → Set up a custom domain** → enter your
domain. Cloudflare adds the DNS record itself. Wait for it to go green.

## 5. Turn on Access

**dash.cloudflare.com → Zero Trust.** First visit asks you to pick a team name
and a plan — choose **Free** (up to 50 users, no card).

**Access → Applications → Add an application → Self-hosted:**

| Field | Value |
|---|---|
| Application name | Transit boards |
| Session duration | 1 month *(how often a customer re-verifies)* |
| Domain | your domain |

Then **Add policy**:

| Field | Value |
|---|---|
| Policy name | Paid customers |
| Action | **Allow** |
| Include | **Emails** → paste your customers' addresses |

Under login methods, leave **One-time PIN** enabled. That's what lets a customer
in with a code sent to their email, with nothing to sign up for.

Save. Open your domain in a private window — you should get a login page.

## 6. Close the side doors

Two URLs still serve the site ungated until you deal with them:

- **`your-project.pages.dev`** — Pages' own hostname. Add a second Access
  application for it, with the same policy. Easy to forget, and it's a complete
  bypass of everything above.
- **Preview deployments** (`<hash>.your-project.pages.dev`) — Pages project →
  Settings → Builds & deployments → turn **preview deployments** off, or gate
  `*.your-project.pages.dev` in Access too.

---

## Running the boards yourself

You're on the list like everyone else, so a kiosk will hit the login page. Set
**session duration to 1 month** (or longer) so a wall display isn't asking for a
code every week. Sign in once on each screen after it's set up.

The admin passphrase is separate and still applies: Access decides *who gets in*,
`admin.js` decides *who sees the setup fields*. A customer who is legitimately
logged in still shouldn't be editing Worker URLs.

## Adding and removing customers

Access → your application → policy → edit the email list. Removal takes effect
on their next session, so a shorter session duration means faster cut-off after a
refund or a lapsed subscription. That's the trade-off against kiosks needing to
re-authenticate more often.

There's no self-serve signup here: you add each buyer by hand. That's fine at
hobbyist scale and it's why the free plan's 50-user cap is not the limit you'll
hit first.

---

## What this does and doesn't do

**Does:** stop unpaid people loading the site, the JavaScript, or the bundled
GTFS timetables. Requests are rejected at Cloudflare's edge, before anything
reaches them.

**Doesn't:** stop a paying customer who is already inside from saving the files
and running their own copy. Everything the browser receives is theirs. If that
matters, the live feeds need to move behind a licensed proxy so a saved copy has
no data to show — the layer we haven't built yet, and the only one a copied build
can't defeat.

**Doesn't:** protect anything already public. Your repo has been public and the
boards have been served openly, so treat anything currently in them as already
out. Rotate the admin passphrase (`TBAdmin.hash(...)` → `ADMIN_SHA256` in
`admin.js`) once the site is private.
