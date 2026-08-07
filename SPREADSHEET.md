# Logging every sighting to a Google Sheet

The Spotter can append a row to your own Google Sheet each time you log something.

Google has no keyless way to write to a Sheet, and I'm not going to ask you for
account credentials — so **you** create the endpoint once and paste its URL into
the app. It takes about two minutes.

## Setup

1. Make a new Google Sheet (or open an existing one).
2. **Extensions → Apps Script**.
3. Delete whatever is in the editor and paste this:

```javascript
// Appends one row per sighting sent by the Transit Spotter app.
const HEADERS = ["when","mode","route","vehicle","place","ridden",
                 "note","lat","lon","source","first","by","id"];

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  // Write the header row once, on the first sighting.
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);

  const d = JSON.parse(e.postData.contents);

  // Re-sending the same sighting (the "Send all" button) must not duplicate it.
  const ids = sheet.getRange(1, HEADERS.indexOf("id") + 1, Math.max(sheet.getLastRow(), 1), 1)
                   .getValues().flat();
  if (d.id && ids.indexOf(d.id) !== -1) return ok("duplicate");

  sheet.appendRow(HEADERS.map(h => d[h] !== undefined ? d[h] : ""));
  return ok("added");
}

function ok(status) {
  return ContentService.createTextOutput(JSON.stringify({ status: status }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Serves the log back, so the BOARDS can show sightings logged on your phone.
// Returned as JSONP: Apps Script sends no CORS headers, so a browser can never
// fetch() this — but a <script> tag isn't subject to CORS, and that is what the
// boards use. No Cloudflare, no Worker, no key.
function doGet(e) {
  const p = (e && e.parameter) || {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const last = sheet.getLastRow();
  let spots = [];
  if (last > 1) {
    const limit = Math.min(Number(p.limit) || 60, 200);
    const start = Math.max(2, last - limit + 1);
    spots = sheet.getRange(start, 1, last - start + 1, HEADERS.length).getValues()
      .map(function (r) {
        const o = {}; HEADERS.forEach(function (h, i) { o[h] = r[i]; });
        // Sheets converts the ISO timestamp the app sends into a real Date value,
        // and Date.parse() of a Date is NaN — so handle both, or every row looks
        // undated and disappears.
        var t = o.when instanceof Date ? o.when.getTime() : Date.parse(o.when);
        return {
          id: String(o.id || ""),
          ts: t > 0 ? t : 0,
          mode: String(o.mode || ""), route: String(o.route || ""),
          vehicle: String(o.vehicle || ""), place: String(o.place || ""),
          note: String(o.note || ""), by: String(o.by || ""),
          ridden: o.ridden === "yes" || o.ridden === true,
          lat: o.lat === "" || o.lat == null ? null : Number(o.lat),
          lon: o.lon === "" || o.lon == null ? null : Number(o.lon)
        };
      })
      .filter(function (s) { return s.id; });   // an undated row is still a sighting
  }
  const body = JSON.stringify({ ok: true, spots: spots });
  return p.callback
    ? ContentService.createTextOutput(p.callback + "(" + body + ")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT)
    : ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}
```

4. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Copy the deployment URL — it ends in `/exec`.
6. In the Spotter: **⚙︎ → Google Sheet web-app URL**, paste, **Save**.
7. Tap **Send all to Sheet** to backfill everything already in your log.
8. On each board you want the sightings to appear on: **Spotted card → ⇄**, paste
   the *same* URL, **Save**. That's the whole cross-device setup — the Sheet is
   the shared feed, so no Cloudflare Worker is involved.

> **Already had this script deployed before `doGet` existed?** Paste the new
> function in, then **Deploy → Manage deployments → ✏️ edit → Version: New
> version → Deploy**. The URL stays the same. Saving the code alone does *not*
> update a live deployment — this is the single most common reason a Sheet URL
> "doesn't work" after an edit.

## What you should know

- **The app can't tell whether a row actually landed.** Apps Script web apps send
  no CORS headers, so the request goes out `no-cors` and the browser hands back an
  opaque response with no status. A sighting is therefore never blocked or lost if
  the mirror fails — your local log stays the source of truth, and **Send all** can
  re-mirror at any time. The `id` check above makes that safe to repeat.
- **"Anyone" access means anyone with the URL can append rows.** The URL is
  effectively a secret. Treat it like one, and re-deploy to rotate it if it leaks.
- Offline sightings are not queued for the Sheet (unlike the shared feed). They
  stay in your log, and **Send all** catches them up.
- Prefer a file? **Export CSV** in the same settings sheet needs no setup at all.
