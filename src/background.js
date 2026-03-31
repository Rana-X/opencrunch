import {
  appendRowsToGoogleSheets,
  serializeError,
  testGoogleSheetsConnection
} from "./lib/google-sheets.js";
import {
  DEFAULT_GOOGLE_SHEETS_CONFIG,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  SUPPORTED_HOST
} from "./lib/constants.js";

async function enableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    return;
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {
    // Ignore browsers that expose the API but reject the behavior update.
  }
}

async function getGoogleSheetsConfig() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.GOOGLE_SCRIPT_URL,
    STORAGE_KEYS.GOOGLE_SPREADSHEET_ID,
    STORAGE_KEYS.GOOGLE_SHEET_NAME,
    STORAGE_KEYS.GOOGLE_SHARED_SECRET
  ]);

  return {
    googleScriptUrl: String(
      values[STORAGE_KEYS.GOOGLE_SCRIPT_URL] ?? DEFAULT_GOOGLE_SHEETS_CONFIG.googleScriptUrl
    ).trim(),
    googleSpreadsheetId: String(
      values[STORAGE_KEYS.GOOGLE_SPREADSHEET_ID] ??
        DEFAULT_GOOGLE_SHEETS_CONFIG.googleSpreadsheetId
    ).trim(),
    googleSheetName: String(
      values[STORAGE_KEYS.GOOGLE_SHEET_NAME] ?? DEFAULT_GOOGLE_SHEETS_CONFIG.googleSheetName
    ).trim(),
    googleSharedSecret: String(
      values[STORAGE_KEYS.GOOGLE_SHARED_SECRET] ??
        DEFAULT_GOOGLE_SHEETS_CONFIG.googleSharedSecret
    ).trim()
  };
}

async function clearLockedCrunchbaseTabIfMatches(tabId) {
  const values = await chrome.storage.local.get([STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]);

  if (values[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID] !== tabId) {
    return;
  }

  await chrome.storage.local.remove([STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]);
}

enableSidePanelOnActionClick();

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanelOnActionClick();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanelOnActionClick();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearLockedCrunchbaseTabIfMatches(tabId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab?.url) {
    return;
  }

  let hostname = "";

  try {
    hostname = new URL(tab.url).hostname;
  } catch {
    hostname = "";
  }

  if (hostname === SUPPORTED_HOST) {
    return;
  }

  clearLockedCrunchbaseTabIfMatches(tabId).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.TEST_GOOGLE_SHEETS_CONNECTION) {
    (async () => {
      try {
        const result = await testGoogleSheetsConnection(
          message.config ?? (await getGoogleSheetsConfig())
        );
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: serializeError(error) });
      }
    })();

    return true;
  }

  if (message?.type === MESSAGE_TYPES.APPEND_TO_GOOGLE_SHEETS) {
    (async () => {
      try {
        const config = await getGoogleSheetsConfig();
        const result = await appendRowsToGoogleSheets(config, message.payload);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: serializeError(error) });
      }
    })();

    return true;
  }

  return false;
});
