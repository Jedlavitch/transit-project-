# Go-live checklist

Everything is built. Nothing is configured. This is the ordered list of what's
left, split by who can actually do it.

Tick these in order — later steps depend on earlier ones.

---

## 1. Email that reaches the inbox — **you**

Sign-in codes currently arrive in spam, because they're sent from
`onboarding@resend.dev`, a shared address every Resend account uses. A customer
who can't find their code assumes the product is broken.

You already have a domain, so this is DNS, not a purchase.

1. **resend.com → Domains → Add Domain** → enter your domain
2. Resend shows a set of DNS records — typically a **DKIM** `TXT`, an **SPF**
   `TXT`, and often a **DMARC** `TXT`
3. Add them at your DNS host. If the domain is on Cloudflare: **DNS → Records →
   Add record** for each. **Set DKIM/SPF records to "DNS only" (grey cloud), not
   proxied** — proxying breaks mail records.
4. Wait for Resend to show **Verified** (usually minutes)
5. Cloudflare → `tbaccounts` worker → **Settings → Variables and Secrets** →
   edit `MAIL_FROM` to `Transit Spotter <login@yourdomain.com>` → **Deploy**

Those records are what proves to Gmail that mail claiming to be from your domain
really is. Without them, nothing else on this list matters — customers can't get in.

---

## 2. A plane feed you're allowed to sell — **you**

`airplanes.live` prohibits commercial use. This isn't a judgement call, it's
someone else's licence. `adsb-worker.js` is written and waiting.

1. Cloudflare → **Workers → Create → Hello World → Deploy**, name it `tb-adsb`
2. **Edit Code** → paste `adsb-worker.js` → **Deploy**
3. Check `https://tb-adsb.<you>.workers.dev/health` returns `{"ok":true,...}`
4. Tell me the URL and I'll bake it in

It defaults to **adsb.lol**, which publishes under ODbL — commercial use is
permitted **with attribution**. Confirm their current terms yourself, and credit
them visibly.

---

## 3. Taking money — **you**

1. **stripe.com** → create an account, complete identity/bank details
2. **Products** → new product, e.g. "Transit Project — licence", one-time, $19
3. **Payment Links** → create a link for it
4. Under **After payment**, set the redirect to
   `https://yourdomain.com/activate.html?session_id={CHECKOUT_SESSION_ID}`
   — the `{CHECKOUT_SESSION_ID}` placeholder is literal, Stripe substitutes it
5. Send me the Payment Link URL

I can't create a Stripe account or handle payment setup on your behalf.

---

## 4. Licence checking — **you deploy, I configure**

1. Workers → new worker `tb-license`, paste `license-worker.js`
2. **KV** → namespace bound as **`LICENSES`**
3. Secrets: **`STRIPE_SECRET`** (the `sk_live_…` from Stripe → Developers → API
   keys), `ADMIN_SECRET` (any long random string, for issuing keys by hand)
   — the name has to be exactly `STRIPE_SECRET`; that is what the Worker reads,
   and a secret stored under any other name leaves it looking unconfigured, so
   every real purchase would take the money and then fail to hand over a key
4. Send me the URL — the worker URL is not a secret. **The `sk_live_…` key is:
   it goes into the Cloudflare dashboard only, never into this repo and never
   into a chat.**

---

## 5. Wiring it together — **me, once you send URLs**

| File | Field | Waiting on |
|---|---|---|
| `account.js` | `CFG.workerUrl` | ready now — say the word |
| `license.js` | `cfg.workerUrl` | step 4 |
| `buy.html` | `PAYMENT_LINK` | step 3 |
| — | `tb.adsbUrl` | step 2 |

**`account.js` is deliberately still blank.** The moment it's filled in, your live
site demands sign-in from everyone — including you, on any device without a
session. Fine once step 1 is done; painful before, since the code lands in spam.

---

## 6. Privacy policy — **drafted, needs you**

`PRIVACY.md` is written. Fill in every `[BRACKET]`, have someone qualified review
it, and link it from `buy.html` and the app settings.

One gap it names: **there is no account-deletion endpoint yet.** A
right-to-erasure request means editing KV by hand. Ask me to build `/account/delete`
before you have real volume.

---

## 7. Test it yourself, properly — **you**

Buy your own product with a real card. All the way through: pay → land on
`activate.html` → get a key → unlock the app → sign in on a second device → see
your log. Refund yourself afterwards in Stripe.

Every payment system has a step that only breaks with real money.

---

## Known and accepted

- **The lock is a soft one.** The site is static files on public GitHub Pages —
  anyone can view source, delete the gate in devtools, or fetch the 54MB of
  timetables directly. Shipping this way was a deliberate decision. The real fix
  is serving the app and bundles from a Worker behind auth.
- **CARTO map tiles and Nominatim geocoding** still have unexamined terms.
  Nominatim's usage policy is strict and a commercial product can breach it.
  Check both before charging.
