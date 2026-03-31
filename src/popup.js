import {
  DEFAULT_GOOGLE_SHEETS_CONFIG,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  SUPPORTED_HOST
} from "./lib/constants.js";

const pageStatusEl = document.getElementById("page-status");
const scrapeButtonEl = document.getElementById("scrape-button");
const debugButtonEl = document.getElementById("debug-button");
const openOptionsEl = document.getElementById("open-options");
const runSummaryEl = document.getElementById("run-summary");

let targetTabId = null;

function renderSummary(lines) {
  runSummaryEl.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines);
}

async function persistPopupState(updates) {
  await chrome.storage.local.set(updates);
}

async function removePopupState(keys) {
  await chrome.storage.local.remove(keys);
}

function setPageStatus(message) {
  pageStatusEl.textContent = message;
  persistPopupState({
    [STORAGE_KEYS.LAST_PAGE_STATUS]: message
  }).catch(() => {});
}

function formatError(error) {
  if (!error) {
    return "Unknown error.";
  }

  return error.message || error.code || "Unknown error.";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function getStoredConfig() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.GOOGLE_SCRIPT_URL,
    STORAGE_KEYS.GOOGLE_SPREADSHEET_ID,
    STORAGE_KEYS.GOOGLE_SHEET_NAME,
    STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID,
    STORAGE_KEYS.LAST_RUN_SUMMARY,
    STORAGE_KEYS.LAST_PAGE_STATUS,
    STORAGE_KEYS.LAST_DEBUG_SNAPSHOT
  ]);

  return {
    [STORAGE_KEYS.GOOGLE_SCRIPT_URL]:
      values[STORAGE_KEYS.GOOGLE_SCRIPT_URL] ?? DEFAULT_GOOGLE_SHEETS_CONFIG.googleScriptUrl,
    [STORAGE_KEYS.GOOGLE_SPREADSHEET_ID]:
      values[STORAGE_KEYS.GOOGLE_SPREADSHEET_ID] ??
      DEFAULT_GOOGLE_SHEETS_CONFIG.googleSpreadsheetId,
    [STORAGE_KEYS.GOOGLE_SHEET_NAME]:
      values[STORAGE_KEYS.GOOGLE_SHEET_NAME] ?? DEFAULT_GOOGLE_SHEETS_CONFIG.googleSheetName,
    [STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]:
      values[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID] ?? null,
    [STORAGE_KEYS.LAST_RUN_SUMMARY]:
      values[STORAGE_KEYS.LAST_RUN_SUMMARY] ?? "No scrape has been run yet.",
    [STORAGE_KEYS.LAST_PAGE_STATUS]:
      values[STORAGE_KEYS.LAST_PAGE_STATUS] ?? "Checking the active tab…",
    [STORAGE_KEYS.LAST_DEBUG_SNAPSHOT]: values[STORAGE_KEYS.LAST_DEBUG_SNAPSHOT] ?? ""
  };
}

async function getTabContext(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.GET_PAGE_CONTEXT
    });
  } catch (error) {
    return {
      ok: false,
      error: { message: error.message }
    };
  }
}

async function getTabById(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function pinCrunchbaseTab(tabId) {
  await persistPopupState({
    [STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]: tabId
  });
}

async function clearPinnedCrunchbaseTab() {
  targetTabId = null;
  await removePopupState([STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]);
}

async function useResolvedContext(tabId, context, message, { preserveStatus = false } = {}) {
  targetTabId = tabId;
  scrapeButtonEl.disabled = false;
  debugButtonEl.disabled = false;
  await pinCrunchbaseTab(tabId);

  if (!preserveStatus) {
    setPageStatus(message);
  }
}

async function loadPageContext({ preserveStatus = false, useCachedState = false } = {}) {
  const stored = await getStoredConfig();
  const tab = await getActiveTab();
  let crunchbaseTabId = null;

  if (useCachedState) {
    renderSummary(stored[STORAGE_KEYS.LAST_RUN_SUMMARY]);
    pageStatusEl.textContent = stored[STORAGE_KEYS.LAST_PAGE_STATUS];
  }

  if (!tab?.id) {
    setPageStatus("No active browser tab found.");
    scrapeButtonEl.disabled = true;
    debugButtonEl.disabled = true;
    return;
  }

  if (
    !stored[STORAGE_KEYS.GOOGLE_SCRIPT_URL] ||
    !stored[STORAGE_KEYS.GOOGLE_SPREADSHEET_ID] ||
    !stored[STORAGE_KEYS.GOOGLE_SHEET_NAME]
  ) {
    setPageStatus("Google Sheets is not configured yet. Use Google Sheets Settings first.");
    scrapeButtonEl.disabled = true;
    debugButtonEl.disabled = true;
    return;
  }

  if (tab.url) {
    const activeHostname = new URL(tab.url).hostname;

    if (activeHostname === SUPPORTED_HOST) {
      crunchbaseTabId = tab.id;
      const response = await getTabContext(tab.id);

      if (response?.ok && response.context?.supported) {
        const { pageType, headerCount, rowCountEstimate } = response.context;
        await useResolvedContext(
          tab.id,
          response.context,
          `Ready on ${pageType}. Detected ${headerCount} headers and ${rowCountEstimate} visible rows.`,
          { preserveStatus }
        );
        debugButtonEl.disabled = false;
        return;
      }
    }
  }

  const pinnedTabId = stored[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID];

  if (Number.isInteger(pinnedTabId)) {
    const pinnedTab = await getTabById(pinnedTabId);

    if (pinnedTab?.url && new URL(pinnedTab.url).hostname === SUPPORTED_HOST) {
      crunchbaseTabId = pinnedTabId;
      const response = await getTabContext(pinnedTabId);

      if (response?.ok && response.context?.supported) {
        const { pageType, headerCount, rowCountEstimate } = response.context;
        await useResolvedContext(
          pinnedTabId,
          response.context,
          `Using saved Crunchbase tab on ${pageType}. Detected ${headerCount} headers and ${rowCountEstimate} visible rows.`,
          { preserveStatus }
        );
        debugButtonEl.disabled = false;
        return;
      }
    }

    await clearPinnedCrunchbaseTab();
  }

  if (crunchbaseTabId != null) {
    targetTabId = crunchbaseTabId;
    debugButtonEl.disabled = false;
  } else {
    targetTabId = null;
    debugButtonEl.disabled = true;
  }

  setPageStatus("No Crunchbase results table detected.");
  scrapeButtonEl.disabled = true;
}

async function runScrape() {
  if (!targetTabId) {
    return;
  }

  scrapeButtonEl.disabled = true;
  setPageStatus("Scraping the active page…");
  renderSummary("Collecting rendered Crunchbase rows and sending them to Google Sheets...");
  await persistPopupState({
    [STORAGE_KEYS.LAST_RUN_SUMMARY]:
      "Collecting rendered Crunchbase rows and sending them to Google Sheets..."
  });

  try {
    const scrapeResponse = await chrome.tabs.sendMessage(targetTabId, {
      type: MESSAGE_TYPES.SCRAPE_CURRENT_PAGE
    });

    if (!scrapeResponse?.ok) {
      throw new Error(scrapeResponse?.error?.message || "Scrape failed.");
    }

    setPageStatus("Writing rows to Google Sheets...");

    const writeResponse = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.APPEND_TO_GOOGLE_SHEETS,
      payload: scrapeResponse.payload
    });

    if (!writeResponse?.ok) {
      throw new Error(formatError(writeResponse?.error));
    }

    const result = writeResponse.result;
    const lines = [
      `Rows scraped: ${result.rowCount}`,
      `Rows appended: ${result.appendedCount}`,
      `Sheet: ${result.sheetName}`,
      `Header count: ${result.headerCount}`,
      `Created new sheet: ${result.createdSheet ? "yes" : "no"}`,
      `Failures: ${result.failures.length}`
    ];

    for (const failure of result.failures) {
      lines.push(`Failure: ${failure.message}`);
    }

    renderSummary(lines);
    await persistPopupState({
      [STORAGE_KEYS.LAST_RUN_SUMMARY]: lines.join("\n")
    });

    if (result.failures.length > 0) {
      setPageStatus(
        result.appendedCount > 0
          ? "Scrape finished with partial failures."
          : "Scrape failed."
      );
    } else {
      setPageStatus("Scrape finished.");
    }
  } catch (error) {
    setPageStatus("Scrape failed.");
    const summary = `Error: ${error.message}`;
    renderSummary(summary);
    await persistPopupState({
      [STORAGE_KEYS.LAST_RUN_SUMMARY]: summary
    });
  } finally {
    await loadPageContext({ preserveStatus: true }).catch(() => {});
  }
}

async function captureDebugSnapshot() {
  if (!targetTabId) {
    const activeTab = await getActiveTab();

    if (!activeTab?.id) {
      throw new Error("No tab is available for debug capture.");
    }

    targetTabId = activeTab.id;
  }

  debugButtonEl.disabled = true;
  setPageStatus("Capturing debug snapshot…");

  try {
    const response = await chrome.tabs.sendMessage(targetTabId, {
      type: MESSAGE_TYPES.CAPTURE_DEBUG_SNAPSHOT
    });

    if (!response?.ok) {
      throw new Error(response?.error?.message || "Debug capture failed.");
    }

    const json = JSON.stringify(response.snapshot, null, 2);
    let copied = false;

    try {
      await navigator.clipboard.writeText(json);
      copied = true;
    } catch {
      copied = false;
    }

    const preview = json.length > 4000 ? `${json.slice(0, 4000)}\n... [truncated in popup]` : json;
    renderSummary(preview);
    await persistPopupState({
      [STORAGE_KEYS.LAST_RUN_SUMMARY]: preview,
      [STORAGE_KEYS.LAST_DEBUG_SNAPSHOT]: json
    });

    setPageStatus(
      copied
        ? "Debug snapshot copied to clipboard."
        : "Debug snapshot captured. Copy it from the summary panel."
    );
  } finally {
    debugButtonEl.disabled = false;
  }
}

scrapeButtonEl.addEventListener("click", () => {
  runScrape();
});

debugButtonEl.addEventListener("click", () => {
  captureDebugSnapshot().catch((error) => {
    setPageStatus("Debug capture failed.");
    const summary = `Error: ${error.message}`;
    renderSummary(summary);
    persistPopupState({
      [STORAGE_KEYS.LAST_RUN_SUMMARY]: summary
    }).catch(() => {});
  });
});

openOptionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadPageContext({ useCachedState: true }).catch((error) => {
  setPageStatus("Unable to inspect the active tab.");
  const summary = `Error: ${error.message}`;
  renderSummary(summary);
  persistPopupState({
    [STORAGE_KEYS.LAST_RUN_SUMMARY]: summary
  }).catch(() => {});
});
