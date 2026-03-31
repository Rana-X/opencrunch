# OpenCrunch

Chromium Manifest V3 extension that scrapes the currently open Crunchbase results page and appends the visible rows into Airtable.

## Load the extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/Users/ranax/Downloads/o1 dating/opencrunch`

## Configure Airtable

1. Open the extension options page.
2. Save:
   - Airtable personal access token
   - Base ID
   - Table name or table ID
3. Click `Test Connection`.

The Airtable table must already contain fields whose names match the visible Crunchbase column headers exactly.

Optional metadata fields:

- `Crunchbase URL`
- `Source Page URL`
- `Scraped At`

If those fields exist, OpenCrunch will populate them automatically.

## Use it

1. Open a Crunchbase results page that already shows the rows and columns you want.
2. Open the extension popup.
3. Click `Scrape Current Page`.

The extension appends the currently rendered page only. It does not paginate automatically in v1.
