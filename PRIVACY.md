# Privacy Policy — Transit Spotter

**Last updated: 7 August 2026**

> **Still not legal advice.** I'm not a lawyer. The blanks are filled in now —
> controller, contact address, and the map and geocoding providers the code
> actually calls — but filling blanks is not the same as being reviewed. You are
> charging money, so have someone qualified read this, particularly if you sell
> to customers in the EU, the UK or California.
>
> Two gaps this does **not** close, both in the operator notes at the bottom:
> it describes the Spotter app rather than the city boards that are the product
> being sold, and it does not name the transit and aircraft feeds that receive
> a user's location.

---

## Who is responsible for your data

Transit Spotter is operated by **Jack Edlavitch**, contactable at
**info@transitproject.online**. Under UK/EU data protection law we are the "data
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
| **CARTO** (`basemaps.cartocdn.com`) | Draws the map background | Your IP address, and which map areas you view |
| **OpenStreetMap Nominatim** | Turns an address into coordinates, and back | The address or coordinates you look up |

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

Email **info@transitproject.online**. We'll respond within 30 days. If you're in the
UK or EU, you may also complain to your data protection authority.

**To delete everything yourself:** sign out and clear the site's data in your
browser, then email us to remove the server-side copy.

## Children

Not intended for children under 13 (16 in parts of the EU). We don't knowingly
collect their data. If you believe a child has given us information, email us and
we'll delete it.

## Where the data lives

On Cloudflare's global network, which means it may be stored or processed outside
your country, including in the United States.

Where data is transferred out of the UK or European Economic Area, the transfer
relies on the **Standard Contractual Clauses** in the data processing agreements
published by our processors — Cloudflare, which runs the servers, and Resend,
which sends sign-in emails.

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

1. ~~Fill every `[BRACKET]`.~~ Done — controller, contact address, tile and
   geocoding providers are all named from what the code actually calls.
   **Confirm the controller name.** It is written as a natural person; if you
   trade through a company, that company is the controller and this must say so.
2. ~~Name the actual map tile and geocoding providers.~~ Done: CARTO and
   OpenStreetMap Nominatim. **The terms check is still outstanding and now
   urgent** — you are charging money. Nominatim's usage policy is strict and
   explicitly aimed at low-volume, non-commercial use; a paid kiosk geocoding on
   every location change can breach it. CARTO's free basemap tier likewise has
   limits and an attribution requirement. Check both before volume arrives.
3. You need a **route to delete an account**. The Worker has no `/delete`
   endpoint yet — a right-to-erasure request currently means editing KV by hand.
   Build it before volume makes that impractical.
4. **The EU/UK transfer wording now claims Standard Contractual Clauses, so go
   and accept them.** The policy states the mechanism because you ship
   Amsterdam, Cologne and Stuttgart boards — EU customers are the target, not a
   hypothetical — but stating it does not create it. Accept Cloudflare's DPA
   (dashboard → account settings) and Resend's, both of which incorporate the
   SCCs. Until you do, that paragraph describes something that is not true. You
   may also need a record of processing activities.
5. Link this from `buy.html` and from the app's settings. A privacy policy nobody
   can find doesn't count.
6. **This document covers the Spotter, not the boards.** The title, and most of
   what follows, is about the phone app and its accounts. The thing customers
   are buying is the city boards, and those have their own story: no account, no
   server, everything in the browser — which is a *better* story, and it is not
   told here. A buyer reading this learns about a feature they may never open.
7. **The transit and aircraft feeds are missing from the third-party table**
   above. Every board sends the viewer's coordinates to whichever agency serves
   that city — WMATA, MTA, SEPTA, MBTA, BART, NJ Transit, transitous — plus
   airplanes.live and amtraker, and adsbdb for flight routes. That is
   unavoidable, since asking "what is near me" means saying where you are, and
   the site's own FAQ already says so. The policy should say it too.
