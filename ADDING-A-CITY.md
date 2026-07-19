# Adding a new city

This project has no build step and no shared framework — each city is one standalone
HTML file. **`stencil.html`** is a clean, ready-to-run starting point: out of the box it
shows Amtrak trains + planes overhead near one location (both work anywhere in the US,
no key, no setup), plus all the shared machinery (map, themes, accent color, address
search, "show on board" toggles, smooth vehicle animation).

Two ways to start:
- **From the stencil** — cleanest. Copy `stencil.html`, then add only the systems your
  city has. Nothing to strip out.
- **From an existing board** — if your city closely matches one that exists
  (`index.html` Bethesda, `philadelphia.html` Philly, `nyc.html` New York), copy the
  closest one and swap its systems. Faster if there's a lot of overlap, but you'll have
  to delete the systems you don't want.

The three real boards are the best reference for *how* to wire a specific kind of
system — copy from whichever is closest to what you're adding.

---

## 1. Name and place the city

Copy the stencil and open it:

```bash
cp stencil.html <yourcity>.html
```

Then change the spots marked **`[CITY-SETUP]`** (grep for them):

```bash
grep -n '\[CITY-SETUP\]' <yourcity>.html
```

- **`const CITY_ID = "mycity";`** — a short unique id (letters only). *Every* localStorage
  key derives from it, so this one line keeps your board's saved location/theme/toggles
  from colliding with the other boards'. Change it and you're done — no other keys to edit.
- **`CFG.defaultLoc`** — the map's default center + label (your downtown or main station).
- The page **`<title>`** and the header **title** line.
- The header **nav links** (commented out) — uncomment and point them at your sibling
  boards once you've registered the city in night/flipboard (step 4).

At this point the board already runs: `python3 -m http.server 4173`, open
`http://localhost:4173/<yourcity>.html`, and you'll see live Amtrak + planes.

---

## 2. Find each system's data source

For every transit system you want to add, figure out which of three shapes it is
(check with `curl -sI <url>` for CORS + status, and `curl -s <url> | head` for format):

| The feed is… | Do this | Copy from |
|---|---|---|
| A **real-time feed you can fetch from the browser** (returns `access-control-allow-origin: *`) | Fetch + decode client-side, no Worker | `nyc.html` (Subway/LIRR/Metro-North — GTFS-Realtime protobuf, with a browser-side decoder) |
| A **real-time feed with no CORS** | Add a tiny Cloudflare Worker to re-serve it with CORS | `septa-worker.js` (plain JSON) or `mta-bus-worker.js` (binary protobuf) |
| **No real-time feed** (or you don't need live) | Bundle its published GTFS schedule | `gen-stencil-schedule.py` → a `*-schedule.json`, then wire like below |

**GTFS-Realtime gotchas learned the hard way** (all handled in `nyc.html`'s decoder):
- Some systems report **no GPS at all** (NYC subway — track-circuit signaled,
  underground). Place those vehicles at their current/next stop's coordinate instead of
  a lat/lon field.
- `route_id` is sometimes on the `TripUpdate` but not the `VehiclePosition` — fall back.
- Use **BigInt** for varint decoding, not `Number` + `Math.pow`, or negative delay
  values (sign-extended 64-bit varints) silently corrupt.

**Third-party GTFS mirror gotcha:** if a bundled system's card is unexpectedly always
empty, check whether its `calendar.txt` `end_date` has simply **expired** (some mirrors
go stale) before assuming a decode bug — see `gen-path-schedule.py`'s far-future-end fix.

---

## 3. Add each system to the board

Every spot you touch to add one system is marked **`[ADD-A-SYSTEM]`**. See them all:

```bash
grep -n '\[ADD-A-SYSTEM\]' <yourcity>.html
```

There are ~10, in this order: legend swatch · card HTML · `CFG` refresh interval ·
`state` layers · `initMap()` layer groups · `state.fleets` + `fleetLayer()` · `fitAll()` ·
`CARD_DEFS` + `CARD_LAYERS` · your fetch/render/draw functions · `refreshEverythingForNewLocation()`
call · `boot()` interval.

### Worked example: a bundled-schedule system ("Foo Rail")

Say you generated `foo-schedule.json` (via `gen-stencil-schedule.py`). Here's every edit:

**HTML — card** (in `.cards`, before the Amtrak card):
```html
<div class="card" id="fooCard">
  <h2><span class="icon">🚆</span> Foo Rail <span class="count" id="fooCount"></span></h2>
  <div class="list" id="fooList"><div class="empty">Loading Foo schedule…</div></div>
</div>
```

**HTML — legend swatch:** `<span style="color:#c0392b">▦ Foo Rail</span>`

**`CFG`:** `fooEveryMs: 15000,`

**`state` layers:** add `fooLayer: null, fooRouteLayer: null,`

**`initMap()`:** (route layer first so it draws under vehicles)
```js
state.fooRouteLayer = L.layerGroup().addTo(state.map);
state.fooLayer      = L.layerGroup().addTo(state.map);
```

**`state.fleets`:** add `foo:{},` — **`fleetLayer()`:** add `foo:state.fooLayer,`

**`fitAll()`:** add `"#fooList"` to the list.

**`CARD_DEFS`:** add `{id:"fooCard", label:"Foo Rail"},`
**`CARD_LAYERS`:** add `fooCard: ["fooLayer","fooRouteLayer"],`

**Functions** (in the `[ADD-A-SYSTEM]` functions section — this uses the shared helpers
already in the stencil: `activeServices`, `groupDepsByDirection`, `drawScheduleRouteLines`,
`schedClock`):
```js
const FOO_COL = "#c0392b";
async function ensureFooSchedule(){
  if(state.fooSched) return state.fooSched;
  try{
    const s=await getJSON("foo-schedule.json", 20000);
    s._coord={}; (s.stations||[]).forEach(st=>{ s._coord[st.id]=[st.lat,st.lon]; });
    s._dep={};
    (s.trips||[]).forEach(tr=>tr.st.forEach(([sid,min])=>{ (s._dep[sid]=s._dep[sid]||[]).push({line:tr.line, hs:tr.hs, s:tr.s, t:min}); }));
    state.fooSched=s;
    drawScheduleRouteLines(s, state.fooRouteLayer, ()=>FOO_COL);   // route lines, drawn once
  }catch(e){}
  return state.fooSched;
}
async function refreshFoo(){
  const s=await ensureFooSchedule(); const box=$("#fooList"); if(!box) return;
  if(!s){ box.innerHTML=""; box.appendChild(el("div","empty","Foo schedule unavailable.")); return; }
  const here=state.loc, now=new Date(), nowMin=now.getHours()*60+now.getMinutes();
  const active=activeServices(s, now);
  const near=s.stations.map(st=>({st, mi:kmToMi(haversine(here,{lat:st.lat,lon:st.lon}))})).sort((a,b)=>a.mi-b.mi);
  box.innerHTML=""; let shown=0, used=0;
  for(const {st,mi} of near){
    if(used>=2) break;
    const deps=(s._dep[st.id]||[]).filter(d=>active.has(d.s)).map(d=>({...d, min:d.t})).filter(d=>d.min>=nowMin);
    if(!deps.length) continue;
    used++;
    box.appendChild(el("div","stop-label","◼ "+st.name+`  ·  ${mi.toFixed(1)} mi`));
    groupDepsByDirection(deps).forEach(group=>{
      box.appendChild(el("div","dir-label","→ "+(group[0].hs||group[0].line)));
      group.forEach(d=>{
        const row=el("div","row");
        const b=el("div","badge rail", d.line); b.style.background=FOO_COL;
        const mid=el("div"); mid.appendChild(el("div","dest", d.hs||d.line));
        const rel=d.min-nowMin;
        mid.appendChild(el("div","sub", d.line+" · "+(rel<=0?"now":rel<60?`in ${rel} min`:`in ${Math.floor(rel/60)}h ${String(rel%60).padStart(2,"0")}m`)));
        const times=el("div","times");
        const t=el("div","live"); t.style.color=FOO_COL; t.textContent=schedClock(d.t);
        times.append(t, el("div","sched","scheduled"));
        row.append(b, mid, el("div"), times);
        box.appendChild(row); shown++;
      });
    });
  }
  if(!shown) box.appendChild(el("div","empty","No more Foo trains today at nearby stations."));
  $("#fooCount").textContent="scheduled";
  fitList(box);
}
// Place vehicles on the map by interpolating each running trip between stops.
async function drawFooScheduledMap(){
  const s=await ensureFooSchedule(); if(!s || !s.trips) return;
  const now=new Date(), nowMin=now.getHours()*60+now.getMinutes(), active=activeServices(s, now);
  const items=[];
  s.trips.forEach((tr,i)=>{
    if(!active.has(tr.s)) return;
    const seq=tr.st; if(seq.length<2) return;
    for(const nm of [nowMin, nowMin+1440]){        // also catch after-midnight trips
      if(nm < seq[0][1] || nm > seq[seq.length-1][1]) continue;
      let k=0; while(k<seq.length-1 && seq[k+1][1] <= nm) k++;
      const a=seq[k], b=seq[Math.min(k+1,seq.length-1)];
      const ca=s._coord[a[0]], cb=s._coord[b[0]]; if(!ca||!cb) break;
      const f = b[1]>a[1] ? (nm-a[1])/(b[1]-a[1]) : 0;
      items.push({ id:"foo"+i, lat:ca[0]+(cb[0]-ca[0])*f, lon:ca[1]+(cb[1]-ca[1])*f,
        icon:()=>labelIcon(FOO_COL, `${tr.line} → ${tr.hs}`), ik:"foo-"+tr.line+"-"+i,
        tip:`Foo ${tr.line} → ${tr.hs} (scheduled)` });
      break;
    }
  });
  updateFleet("foo", items, CFG.fooEveryMs);
}
```

**`refreshEverythingForNewLocation()`:** add `refreshFoo(); drawFooScheduledMap();`

**`boot()` intervals:**
```js
setInterval(refreshFoo, 30000);
setInterval(drawFooScheduledMap, CFG.fooEveryMs);
```

That's the whole system. For a **live** system instead, the same ~10 touch points apply —
just swap the fetch/render/draw functions for `nyc.html`'s live-decode versions.

---

## 4. Register the city in night mode + the departure board

`night.html` (nearest-vehicle kiosk) and `flipboard.html` (split-flap board) are shared by
every city via a `?city=<CITY_ID>` link. Add your city to both so those links work:

- **`night.html`** — add a `<CITY_ID>: {...}` entry to `CITY_CONFIG` (copy the `nyc` entry
  and adjust `defaultLoc`, the `transitboard<CITY_ID>.*` localStorage keys, `cityLabel`,
  and the bus/rail labels). If your city has a live rail feed you want in "nearest train",
  see how `nyc` sets `nycRail:true` and `produceNycRailTrain()`.
- **`flipboard.html`** — add a `<CITY_ID>: {...}` entry to `CITY_CONFIG` **and** a
  `<CITY_ID>: [...]` entry to `SYSTEM_DEFS_BY_CITY` (list each system's `collectScheduleRows`
  call, pointing at your bundled JSONs — flipboard reads bundled schedules, not live feeds).

Both files already fall back to Bethesda for an unrecognized `?city=`, so nothing breaks
until you add your entry — the link just shows the wrong city until then.

---

## 5. Verify, then deploy

- Open `<yourcity>.html` locally and confirm: no console errors, each card populates,
  and each "show on board" toggle hides both the card **and** its map markers/lines.
- Add the new `.html` + every new `*-schedule.json` (and any `*-worker.js`) to the
  GitHub Pages upload list — see the README's deploy section.
