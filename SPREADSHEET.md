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
```

4. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
5. Copy the deployment URL — it ends in `/exec`.
6. In the Spotter: **⚙︎ → Google Sheet web-app URL**, paste, **Save**.
7. Tap **Send all to Sheet** to backfill everything already in your log.

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
