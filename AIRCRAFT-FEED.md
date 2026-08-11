# Aircraft feed — set up your own

Your board ships **without** an aircraft feed. Trains, buses and trams work out
of the box; the "Planes overhead" card stays empty until you point it at a feed
you run.

That is deliberate, and it is worth thirty seconds of explanation.

## Why you have to do this bit

Live aircraft positions come from ADS-B networks run largely by volunteers. The
easiest of them, `airplanes.live`, is free and works straight from a browser —
and its terms **prohibit commercial use**. Shipping it inside a product you paid
for would put whoever sold it to you in breach, and quietly make you part of
that. Making the plane feature free inside a paid product does not change it;
the use is still commercial.

The alternative feeds that *do* allow commercial use — chiefly **adsb.lol**,
published under the Open Database Licence — send no CORS headers, so a web page
cannot call them directly. They need a small proxy in between.

So: you run the proxy, on your machine, under whatever terms you agree with the
provider. Nobody is speaking for you, and no licence is being stretched.

## What you need

- Any always-on machine with a public address. A $4–5/month VPS is plenty
  (Hetzner, DigitalOcean, Vultr). A Raspberry Pi at home works if you can reach
  it from outside.
- A subdomain pointing at it, e.g. `adsb.yourdomain.com`.
- About five minutes.

`adsb-proxy.py` in this repo is the proxy. Python 3, standard library only —
nothing to install, nothing to break while you are not looking.

## Setup

    sudo apt update && sudo apt install -y python3 caddy
    sudo mkdir -p /opt/adsb
    # copy adsb-proxy.py to /opt/adsb/

    sudo tee /etc/systemd/system/adsb-proxy.service >/dev/null <<'UNIT'
    [Unit]
    Description=ADS-B caching proxy
    After=network-online.target
    [Service]
    ExecStart=/usr/bin/python3 /opt/adsb/adsb-proxy.py
    Environment=PORT=8080
    Restart=always
    RestartSec=3
    User=nobody
    [Install]
    WantedBy=multi-user.target
    UNIT

    sudo systemctl enable --now adsb-proxy

TLS is not optional: the board is served over https and a browser will refuse to
fetch http from it. Caddy gets a certificate on its own.

    echo 'adsb.yourdomain.com { reverse_proxy localhost:8080 }' | sudo tee /etc/caddy/Caddyfile
    sudo systemctl restart caddy

Check it:

    curl https://adsb.yourdomain.com/health
    # {"ok": true, "upstream": "https://api.adsb.lol/v2", ...}

Then open your board, **⚙ Settings → Aircraft feed**, paste
`https://adsb.yourdomain.com`, and press Save. It verifies the URL before
storing it, so a typo tells you immediately rather than showing an empty card
later. Reload and the aircraft appear.

## Attribution is a condition, not a courtesy

adsb.lol's data is ODbL. Commercial use is permitted **provided you credit the
source**. The boards do this for you — a small "Aircraft data adsb.lol (ODbL)"
line appears whenever a feed is configured. Do not remove it. If you point the
proxy at a different provider, check what that provider requires and make sure
it is shown.

## If you would rather not

Leave the field empty. The plane card explains itself and every other system —
all the city boards, the departure boards, the metro displays — works exactly as
before. Aircraft are the only feature with this constraint.

## Notes from running it

- **Rate limits are per IP.** This is why a shared platform is a poor host for
  the proxy: Cloudflare Workers egress from a pool of addresses shared with
  everyone else's Workers, and adsb.lol answered one deployed there with `429`
  three times running while serving a laptop `200` with 44 aircraft. Your own
  box has its own address and its own allowance.
- **The proxy caches by area, not by person.** Coordinates snap to a ~11km grid,
  so several screens in one city cost a single upstream call. Concurrent misses
  for the same area collapse into one request rather than a burst.
- **It serves stale data rather than nothing.** If the feed throttles or hiccups
  — measured latency spiked to 4.6s on one call in three — the last good answer
  is replayed, flagged with its age, and refused entirely past ten minutes.
- **Feeding data back earns you a better allowance.** adsb.lol raises limits for
  contributors. An RTL-SDR dongle and a Pi make you one, and it is the most
  durable fix if you are running several screens.
- **`desc` and `ownOp` are not in the ADS-B feed.** Aircraft type and operator
  come from a separate callsign lookup (adsbdb), so those show regardless of
  which provider is behind the proxy.
