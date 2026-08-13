# Pairing a television from a phone

Nobody should have to type `TB-M4K7Q-2XPRW-9TN5V-HB3ZC` with a TV remote.

A television shows a six-character code and a QR of the same thing. The owner's
phone — which already holds the licence, because that is where the purchase
email was opened — scans it and taps once. The television, which has been
polling, receives the key and unlocks itself.

This is the **device authorisation flow**, the same exchange a television uses
to sign in to any streaming service. It is not a new idea and that is the point:
it is what people already know how to do.

---

## What a customer does

1. On the television, open any board. When the licence wall appears, press
   **Unlock from my phone**.
2. Scan the QR with the phone camera. (No camera, or the camera will not focus
   on a bright screen? Go to **transitproject.online/pair** and type the six
   characters instead.)
3. Tap **Unlock that screen**.

The television unlocks within about three seconds. Nothing is typed on the
television at any point.

If the phone has no licence saved, step 3 asks for the key once — on a phone
keyboard, where pasting from the purchase email works — and remembers it, so
the next screen in the house is a single tap.

---

## Deploying it

**The Worker is done — deployed 12 August 2026 as version `4ce15fb3`** (it was
`9b2203cc`, which is the rollback point if one is ever needed: Workers → Deployments
→ that version → Rollback). No new secrets and no new bindings; it uses the
`LICENSES` KV namespace that was already there.

That redeploy also shipped the commit `/health` had been waiting on, so it now
tests the Stripe key rather than noticing one is set. It currently reports
`"mode":"live"` and `"ok":true`, which is what you want to see.

**The site half is live too**, as of the same day: `pair.html`, `pair-tv.js`,
`pair-qr.js` and `/pair/` all serve, the boards ask for `license.js?v=2` and
`gate.js?v=2`, and `gate.js` carries the button. Both halves are up, so the
feature works end to end.

Deploy the Worker **before** pushing the site when a change spans both. In that
order the new routes simply sit unused and nothing already live changes; the
other way round, every board offers a button that reports it cannot reach the
licence server.

Re-check the Worker any time with:

```bash
curl -s -X POST https://tblicense.jacklemonade2.workers.dev/pair/start -H 'content-type: application/json' -d '{"device":"test"}'
```

You want `{"ok":true,"code":"…","secret":"…","interval":3,"expiresIn":600}`. A
`not_found` means something has been redeployed over it.

> **Redeploy this Worker whenever `license-worker.js` changes.** It is the one
> piece that does not travel with a `git push`, which is exactly how it came to
> be a commit behind without anyone noticing.

---

## How it works

```
television                    licence Worker                   phone
    |                               |                            |
    |-- POST /pair/start ---------->|                            |
    |<-- code + secret -------------|                            |
    |   (shows code + QR)           |                            |
    |                               |<-- GET /pair/check --------|  is it live?
    |                               |<-- POST /pair/claim -------|  code + key
    |                               |    (registers the TV's     |
    |                               |     device id)             |
    |-- GET /pair/poll ------------>|                            |
    |<-- the key -------------------|                            |
```

**The code and the secret are two different values, deliberately.** The code is
on a screen, and a screen may be in a shop window. Collecting the key requires
the `secret`, which the Worker hands only to the device that started the
pairing and which is never displayed. Somebody who reads the code off a screen
can reach `/pair/claim` — and all that does is let them *give a licence away*,
which is nobody's idea of an attack.

**The television's device id is registered, not the phone's.** The five-device
ceiling is much the likeliest reason a genuine pairing fails, so it fails on the
phone, where somebody can read the message, rather than silently on the
television after the key has arrived. A refused pairing leaves the code usable,
so freeing a slot and tapping again works.

**Codes last ten minutes** and can be claimed once.

**Polling writes nothing to KV.** A television polls every three seconds for up
to ten minutes; a write per poll would empty the free plan's thousand daily
writes in a handful of pairings and take `/verify` down with it.

---

## The weakness, stated plainly

Somebody talked into approving a code they did not generate themselves hands
over their licence key. That is the standing weakness of every device flow —
streaming services included — and it is not fully solvable in this shape.

What it is worth:

- `pair.html` says, before the button, that unlocking sends your licence to
  whichever screen asked for it, and asks you to confirm the code is on a screen
  **in front of you right now**. Keep that wording if the page is ever rewritten;
  it is the actual defence, not decoration.
- Codes die after ten minutes.
- The prize is a $19 licence that already runs on five devices, and the owner
  can see the device count in Profile.

---

## Things worth knowing

- **The QR is drawn on the television, not fetched.** `pair-qr.js` is a QR
  encoder of about four hundred lines. An image service would have meant posting
  the pairing code to a third party to have a picture drawn, and a broken image
  on any wall display with a flaky connection.
- **It is always black on white**, whatever theme the board is running. A QR
  inverted to match a dark board is one a good half of phone cameras will not
  read.
- **The panel is loaded on demand.** `pair-qr.js` and `pair-tv.js` are fetched
  when somebody presses the button, so a licensed kiosk never downloads them.
- **The phone is sent to this screen's own address** — so a board served from a
  Pi on the LAN sends the phone to that Pi. Only `file://` and loopback fall back
  to `transitproject.online`, and that still works, because the phone and the
  television never talk to each other: everything goes through the Worker.
- **`O`, `I` and `L` are folded to `0` and `1`** when a code is typed, on both
  the phone and the Worker. Those are the three characters people substitute by
  eye, and the key alphabet excludes them for exactly that reason.

## The files

| File | What it is |
|---|---|
| `license-worker.js` | `/pair/start`, `/pair/check`, `/pair/claim`, `/pair/poll` |
| `pair-tv.js` | the television's panel: code, QR, polling |
| `pair-qr.js` | the QR encoder — no dependencies, no network |
| `pair.html` | the phone's approval page |
| `pair/index.html` | forwards `/pair` to `/pair.html`, keeping the code |
| `gate.js`, `license.js` | offer the panel on the wall and in the chip's dialog |

---

# Signing in a screen from a phone

The same exchange, pointed at the **account** instead of the licence — this is
what the old "what is not built" note below used to say was missing.

A screen that is awkward to type on shows a code and a QR. A phone that is
**already signed in** scans it and taps once. The screen, which has been polling,
receives a session of its own.

## What a customer does

1. On the awkward screen, open the Spotter. On the sign-in door press
   **Sign in from my phone instead**.
2. Scan the QR with the phone camera. (No camera? On the phone go to
   **transitproject.online/signin** and type the six characters.)
3. Tap **Sign in that screen**.

## The one difference that matters

The television flow takes a licence **key** from the phone, so anybody holding a
key can donate one. This takes a **session**, and `/auth/pair/approve` requires
one — so you can only ever grant access to an account you are already inside.
That is why the approval page has nothing to type in: if the phone is signed
out, the answer is to sign in first (password, Google, Apple, or a code) and come
back, not to paste a credential.

Everything else is deliberately identical, because the reasoning transferred
intact: the code and the `secret` are separate values, polling writes nothing,
approving does not extend the ten minutes, and `O`/`I`/`L` fold to `0`/`1`.

## Where it is different from the licence flow on purpose

- **The session handed over is a NEW one**, never a copy of the phone's. Sharing
  one would mean signing out on the phone silently signing out the screen.
- **The record is deleted the moment it is collected.** Everything else in the
  account Worker stores session tokens hashed; a pairing record briefly holds a
  live one in the clear, and that is the single place a KV dump would yield
  working sessions. The cost is that a poll response lost in transit means
  scanning again instead of retrying.
- **A QR-granted session may not change an existing password.** This is the part
  worth keeping if any of this is ever rewritten. Somebody talked into approving
  a code they did not generate has given away a session — bad, and recoverable,
  because the owner can change their password and sign every other device out.
  If a QR session could change the password, the intruder would do it first and
  the owner would lose the account outright. The list that decides this is
  `PROVES_OWNERSHIP` in `account-worker.js`; `"qr"` is deliberately not on it.
- **`/auth/pair/check` reports which device is asking**, so the approval page can
  name it. Naming the screen you are letting in is the defence; withholding it
  would only make approval blinder.

## The weakness, stated plainly (again)

Same as the television flow, and the same wording earns its keep: `signin.html`
says what approving grants, and asks you to confirm the code is on a screen
**in front of you right now**. Keep it if the page is rewritten.

## The files

| File | What it is |
|---|---|
| `account-worker.js` | `/auth/pair/start`, `/check`, `/approve`, `/deny`, `/poll` |
| `spot.html` | the waiting screen's panel, in the sign-in door |
| `signin.html` | the phone's approval page |
| `signin/index.html` | forwards `/signin` to `/signin.html`, keeping the code |
| `pair-qr.js` | the same QR encoder, loaded on demand |

## Testing it without two phones

Two browser tabs will not do on their own: same origin means shared
`localStorage`, so the "phone" tab's session and `config.js`'s `acctUrl` leak
into the "screen" tab and it appears to sign in when nothing happened. Put them
on **different origins** — `localhost` for one and `127.0.0.1` for the other —
and they get separate storage while still reaching the same server.

That is not a hypothetical: it produced a completely convincing false pass.

---

## What is not built

- **No way to remove a device.** Profile shows "3 of 5" but cannot free a slot,
  so a customer who reaches five is stuck asking you. That was true before
  pairing; pairing just makes it easier to reach five.
- **No list of signed-in devices, and no way to sign one out remotely.**
  Changing the password is the blunt instrument that covers it. Sessions are
  stored keyed by a hash of their own token with no index back to the account,
  which is good for a KV dump and bad for building this — it would need a second
  index per account.
