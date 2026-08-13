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

## 0. Where things stand today

The domain already exists: **`transitproject.online`**, set as the GitHub Pages
custom domain in `CNAME`. Checked live — it resolves to GitHub's Pages addresses
(`185.199.108–111.153`) and answers `server: GitHub.com`, so **Cloudflare is not
in front of it yet**. Nothing is gated: that domain, `jedlavitch.github.io`, and
the public repo all serve the site to anyone.

That gives you two routes, and they are not either/or — the first is a step
toward the second.

### Route A — proxy what you already have (about 15 minutes)

Keep GitHub Pages exactly as it is and put Cloudflare in front of the domain.
Deploys keep working unchanged. Gets a login on `transitproject.online` today.

Does **not** close `jedlavitch.github.io/transit-project-/` or the public repo,
so it gates the front door while the back door stays open. Worth doing anyway if
you want the gate working now: everything in it carries over to Route B.

### Route B — move to Cloudflare Pages (about 45 minutes)

Serve the site from Cloudflare Pages and make the repo private, which closes the
`github.io` copy and the readable source as well. This is the one that actually
matches "they cannot view it without purchasing".

**Do A first if you want it working today, then B when you have an hour.** Steps
1–2 differ per route; from step 5 they are identical.

---

## 1. Put the domain on Cloudflare (both routes)

**dash.cloudflare.com → Add a site → `transitproject.online`** → Free plan.

Cloudflare scans your existing DNS and shows you two nameservers. Those replace
the ones you have now.

> **Your registrar is IONOS** — checked live: the domain answers from
> `ns1072.ui-dns.com`, `ns1058.ui-dns.de`, `ns1049.ui-dns.org`,
> `ns1063.ui-dns.biz`, which is IONOS's set. In their panel:
> **Domains & SSL → transitproject.online → DNS → Nameserver → Use custom
> nameservers**, then paste Cloudflare's two and remove IONOS's four. IONOS
> shows a warning about losing their DNS features; that is expected, Cloudflare
> is taking the zone over.

Propagation is usually under an hour, sometimes up to 24.

**Before you switch, note what has to survive the move.** Cloudflare's scan
usually copies these, but check them afterwards — if they are missing, the site
goes down until you add them back:

| Type | Name | Value |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Those are GitHub Pages' four addresses, and they are what the domain resolves to
right now. Leave the `CNAME` file in the repo alone — GitHub reads it to know the
domain is legitimately yours, and deleting it un-configures Pages.

When it's done, check the existing records survived the import: you want the four
`A` records to `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`, and they
must be **proxied** — the cloud icon orange, not grey. Grey means Cloudflare is
only doing DNS and Access can't see the traffic at all.

> **Set SSL/TLS → Overview → Full (strict).** GitHub Pages serves a valid
> certificate for your domain, so strict works. Leaving it on **Flexible** causes
> an infinite redirect loop with Pages — the single most common way this setup
> appears broken.

**On Route A, skip to step 5.** Steps 2–4 are Route B only.

## 2. Make the repo private *(Route B)*

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

## 3. Deploy on Cloudflare Pages (free) *(Route B)*

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

## 4. Point your domain at it *(Route B)*

**Your Pages project → Custom domains → Set up a custom domain** → enter your
domain. Cloudflare adds the DNS record itself. Wait for it to go green.

## 5. Turn on Access *(both routes)*

**dash.cloudflare.com → Zero Trust.** First visit asks you to pick a team name
and a plan — choose **Free** (up to 50 users, no card).

**Access → Applications → Add an application → Self-hosted:**

| Field | Value |
|---|---|
| Application name | Transit boards |
| Session duration | 1 month *(how often a customer re-verifies)* |
| Domain | `transitproject.online` |

Add a second subdomain entry for `www.transitproject.online` if you use it —
Access matches the exact hostname, so an ungated `www` is a way straight in.

Then **Add policy**:

| Field | Value |
|---|---|
| Policy name | Paid customers |
| Action | **Allow** |
| Include | **Emails** → paste your customers' addresses |

Under login methods, leave **One-time PIN** enabled. That's what lets a customer
in with a code sent to their email, with nothing to sign up for.

Save. Open your domain in a private window — you should get a login page.

## 6. Close the side doors *(Route B)*

On Route A, `jedlavitch.github.io/transit-project-/` and the public repo are
still wide open — that route only gates the domain. Route B closes them, and
until you do, treat the gate as a courtesy rather than a paywall.

On Route B, two more URLs still serve the site ungated until you deal with them:

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

**Licensing the screen itself is a third thing again, and it no longer means
typing a key on a remote** — the board's licence wall offers *Unlock from my
phone*, which shows a QR the owner's phone scans to hand its licence over. See
`PAIRING.md`. The Access login above still has to be done on the screen; that
one is Cloudflare's and takes an emailed code, which is why the long session
duration matters.

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
out. Change the admin login (open `admin.html` → **Forget this login** → create a
new one) once the site is private.
