# Privacy Policy — Transit Spotter

**Last updated: 7 August 2026**

> **This is a starting draft, not legal advice.** I'm not a lawyer and can't give
> you legal advice. Before you charge anyone, have someone qualified review this —
> particularly if you sell to customers in the EU, the UK or California. The
> placeholders in `[BRACKETS]` must be filled in; several of them are legally
> required, not cosmetic.

---

## Who is responsible for your data

Transit Spotter is operated by **[YOUR NAME OR COMPANY]**, contactable at
**[YOUR CONTACT EMAIL]**. Under UK/EU data protection law we are the "data
controller" for the information described below.

## The short version

The app works without an account, and if you never sign in, **nothing about you
ever leaves your device**. Your sightings live in your browser's local storage
and we cannot see them.

If you choose to create an account, we store your email address and the sightings
you log, so the same log appears on your other devices. That's the whole purpose.
We don't sell it, share it, or advertise against it.

## What we collect, and only if you sign in

| What | Why | How long |
|---|---|---|
| Your email address | To sign you in and to send sign-in codes | Until you delete your account |
| Your sightings — vehicle, route, place, note, and **the location where you logged it** | To sync your log between your devices | Until you delete them, or your account |
| A session token | To keep you signed in | About 13 months, then it expires |
| Temporary sign-in codes | To verify it's you | 15 minutes |
| Rate-limiting counters, tied to a hashed email or IP | To stop abuse of the sign-in system | Up to 1 hour |

**Your location history deserves calling out.** A sighting can include the
coordinates where you logged it. Taken together, that is a record of places you
have been. We treat it as sensitive. It is only ever stored if you are signed in,
only ever readable by your own account, and it is never shared with anyone.

## What we do not collect

- No passwords. Sign-in is a code sent to your email — there is no password to
  store, lose, or have stolen.
- No analytics, tracking pixels, advertising identifiers, or third-party
  trackers.
- No payment details. Payments are handled entirely by Stripe; we never see or
  store your card number.

## Who else is involved

| Service | What it does | What it sees |
|---|---|---|
| **Cloudflare** | Runs the servers that store accounts | Your email, sightings, IP address |
| **Resend** | Sends sign-in code emails | Your email address |
| **Stripe** | Takes payment | Your payment details — we never receive them |
| **[MAP TILE PROVIDER]** | Draws the maps | Your IP address, and which map areas you view |
| **[GEOCODER]** | Turns coordinates into a place name | The coordinates you look up |

The last two are used **whether or not you have an account**, because drawing a
map requires asking someone for map images. They see your IP address, as any web
request does.

## Your rights

You can ask us at any time to:

- **See** everything we hold about you
- **Correct** anything wrong
- **Delete** your account and all its data
- **Export** your data — the app also has built-in CSV and JSON export, no need
  to ask
- **Object** to how we use it, or withdraw consent

Email **[YOUR CONTACT EMAIL]**. We'll respond within 30 days. If you're in the
UK or EU, you may also complain to your data protection authority.

**To delete everything yourself:** sign out and clear the site's data in your
browser, then email us to remove the server-side copy.

## Children

Not intended for children under 13 (16 in parts of the EU). We don't knowingly
collect their data. If you believe a child has given us information, email us and
we'll delete it.

## Where the data lives

On Cloudflare's global network, which means it may be stored or processed outside
your country, including in the United States. **[IF YOU HAVE EU CUSTOMERS: state
your transfer mechanism — Standard Contractual Clauses — here.]**

## Security, honestly stated

Sign-in codes and session tokens are stored hashed, and account identifiers are
derived from a salted hash of your email rather than the address itself. There
are no passwords in the system at all.

That said: no service is perfectly secure, and this one is run by an individual
rather than a security team. If we ever discover a breach affecting your data,
we'll tell you and the relevant regulator within 72 hours.

## Changes

If we change this policy in a way that matters, we'll say so in the app before it
takes effect.

---

## Notes for the operator — delete this section before publishing

1. Fill every `[BRACKET]`. `[YOUR CONTACT EMAIL]` is legally required — there
   must be a working way to reach you.
2. Name the actual map tile and geocoding providers you ship with, and check
   their terms allow commercial use. Nominatim's usage policy is strict and a
   paid product can breach it easily.
3. You need a **route to delete an account**. The Worker has no `/delete`
   endpoint yet — a right-to-erasure request currently means editing KV by hand.
   Build it before volume makes that impractical.
4. If you sell into the EU/UK you may also need a record of processing
   activities, and a Data Processing Agreement with Cloudflare and Resend (both
   publish standard ones).
5. Link this from `buy.html` and from the app's settings. A privacy policy nobody
   can find doesn't count.
