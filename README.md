# OpenCrunch

Chromium Manifest V3 extension that scrapes the currently open Crunchbase results page and appends the visible rows into Google Sheets through a Google Apps Script web app.

## Load the extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/Users/ranax/Downloads/opencrunch`

## Google Sheets setup

1. Create a Google Apps Script project.
2. Paste in the script from `apps-script/Code.gs`.
3. Deploy it as a web app that your extension can call.
4. Set access so the web app accepts requests from the extension.
5. If you expose it broadly, set a non-empty `SHARED_SECRET` in `apps-script/Code.gs`.
6. Copy the deployed web app URL.
7. In the extension options page, save:
   - Apps Script Web App URL
   - Spreadsheet ID
   - Sheet Name
   - Shared secret, if you enabled one in the Apps Script file

## Use it

1. Open a Crunchbase results page that already shows the rows and columns you want.
2. Open the extension popup.
3. Click `Scrape Current Page`.

The extension appends the currently rendered page only. It does not paginate automatically in v1.
