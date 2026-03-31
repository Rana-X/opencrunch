# OpenCrunch

Chromium Manifest V3 extension that opens in a Chrome side panel, locks to one Crunchbase tab at a time, and appends the visible results rows into Google Sheets through a Google Apps Script web app.

## Load the extension

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `/Users/ranax/Downloads/opencrunch`
5. Click the OpenCrunch toolbar icon to open the side panel.

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
2. Open the OpenCrunch side panel from the toolbar icon.
3. Click `Attach Current Tab` or `Attach & Scrape Current Tab`.

The extension appends the currently rendered page only. It does not paginate automatically in v1.
Missing values are written to Google Sheets as literal `NULL`.

## After changing the Apps Script

If you change `apps-script/Code.gs`, redeploy the Google Apps Script web app so the live endpoint picks up the new behavior.
