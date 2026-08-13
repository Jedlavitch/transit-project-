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

## What you have to do

**Redeploy `license-worker.js`.** The pairing routes live in it, and until the
Worker is redeployed the button appears and reports that it cannot reach the
licence server.

Cloudflare → your `tb-license` Worker → **Edit Code** → paste the current
`license-worker.js` → **Deploy**. No new secrets, no new bindings; it uses the
`LICENSES` KV namespace that is already bound.

Check it took:

```bash
curl -s -X POST https://tblicense.jacklemonade2.workers.dev/pair/start -H 'content-type: application/json' -d '{"device":"test"}'
```

You want `{"ok":true,"code":"…","secret":"…","interval":3,"expiresIn":600}`. A
`not_found` means the paste did not land.

> **The deployed Worker was already behind the repo** before this change —
> `/health` was answering without the `stripeCheck` field that
> `Make /health test the Stripe key instead of noticing one exists` added. So
> this redeploy ships that commit too. Worth a look at `/health` afterwards:
> it will start telling you whether the Stripe key actually works.

Nothing else changes. The site files are static, so they go live with the next
push like everything else.

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

## What is not built

- **No way to remove a device.** Profile shows "3 of 5" but cannot free a slot,
  so a customer who reaches five is stuck asking you. That was true before
  pairing; pairing just makes it easier to reach five.
- **Pairing carries the licence, not the account.** The Spotter log
  (`ACCOUNTS.md`) is a separate system and a wall display has no use for it.
