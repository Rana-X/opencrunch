import {
  DEFAULT_GOOGLE_SHEETS_CONFIG,
  MESSAGE_TYPES,
  STORAGE_KEYS,
  SUPPORTED_HOST
} from "./lib/constants.js";

const pageStatusEl = document.getElementById("page-status");
const targetStatusEl = document.getElementById("target-status");
const attachButtonEl = document.getElementById("attach-button");
const scrapeButtonEl = document.getElementById("scrape-button");
const debugButtonEl = document.getElementById("debug-button");
const openOptionsEl = document.getElementById("open-options");
const runSummaryEl = document.getElementById("run-summary");

let targetTabId = null;
let refreshTimerId = null;

function renderSummary(lines) {
  runSummaryEl.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines);
}

function setButtonState(button, label, disabled) {
  button.textContent = label;
  button.disabled = disabled;
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

function setTargetStatus(message) {
  targetStatusEl.textContent = message;
}

function formatError(error) {
  if (!error) {
    return "Unknown error.";
  }

  return error.message || error.code || "Unknown error.";
}

function safeHostname(urlString) {
  try {
    return new URL(urlString).hostname;
  } catch {
    return "";
  }
}

function isCrunchbaseTab(tab) {
  return Boolean(tab?.url && safeHostname(tab.url) === SUPPORTED_HOST);
}

function getTabLabel(tab, context) {
  if (context?.pageType) {
    return `${context.pageType} on "${tab?.title || "Crunchbase"}"`;
  }

  return tab?.title || "Crunchbase tab";
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
      values[STORAGE_KEYS.LAST_PAGE_STATUS] ?? "Checking the current tab…",
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
  targetTabId = tabId;
  await persistPopupState({
    [STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]: tabId
  });
}

async function clearPinnedCrunchbaseTab() {
  targetTabId = null;
  await removePopupState([STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]);
}

async function getSupportedActiveCrunchbaseState() {
  const activeTab = await getActiveTab();

  if (!activeTab?.id || !isCrunchbaseTab(activeTab)) {
    throw new Error("Open a supported Crunchbase results tab first.");
  }

  const response = await getTabContext(activeTab.id);

  if (!response?.ok || !response.context?.supported) {
    throw new Error(
      response?.context?.reason ||
        response?.error?.message ||
        "No Crunchbase results table detected on the current tab."
    );
  }

  return {
    tab: activeTab,
    context: response.context
  };
}

async function attachCurrentTab() {
  const activeState = await getSupportedActiveCrunchbaseState();
  await pinCrunchbaseTab(activeState.tab.id);
  setTargetStatus(`Locked to ${getTabLabel(activeState.tab, activeState.context)}.`);
  setPageStatus("Attached to the current Crunchbase tab.");
  await loadPageContext({ preserveStatus: true });
}

async function resolvePanelState() {
  const stored = await getStoredConfig();
  const activeTab = await getActiveTab();
  let lockedTabId = Number.isInteger(stored[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID])
    ? stored[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]
    : null;
  let lockedTab = null;
  let lockedContext = null;

  if (lockedTabId != null) {
    lockedTab = await getTabById(lockedTabId);

    if (!lockedTab || !isCrunchbaseTab(lockedTab)) {
      await clearPinnedCrunchbaseTab();
      lockedTabId = null;
      lockedTab = null;
    } else {
      lockedContext = await getTabContext(lockedTabId);
      targetTabId = lockedTabId;
    }
  }

  let activeContext = null;

  if (activeTab?.id && isCrunchbaseTab(activeTab)) {
    activeContext = await getTabContext(activeTab.id);
  }

  return {
    stored,
    activeTab,
    activeContext,
    lockedTabId,
    lockedTab,
    lockedContext
  };
}

function applyButtonState(state) {
  const activeSupported = Boolean(state.activeContext?.ok && state.activeContext.context?.supported);
  const activeCrunchbase = isCrunchbaseTab(state.activeTab);
  const hasLockedTab = Number.isInteger(state.lockedTabId);
  const isLockedToCurrent = hasLockedTab && state.activeTab?.id === state.lockedTabId;

  if (activeSupported) {
    if (isLockedToCurrent) {
      setButtonState(attachButtonEl, "Attached to Current Tab", true);
      setButtonState(scrapeButtonEl, "Scrape Current Page", false);
    } else {
      setButtonState(
        attachButtonEl,
        hasLockedTab ? "Attach Current Tab Instead" : "Attach Current Tab",
        false
      );
      setButtonState(scrapeButtonEl, "Attach & Scrape Current Tab", false);
    }
  } else {
    setButtonState(attachButtonEl, "Attach Current Tab", true);
    setButtonState(
      scrapeButtonEl,
      hasLockedTab ? "Scrape Current Page" : "Attach & Scrape Current Tab",
      true
    );
  }

  debugButtonEl.disabled = !(hasLockedTab || activeCrunchbase);
}

function describePageStatus(state) {
  const activeSupported = Boolean(state.activeContext?.ok && state.activeContext.context?.supported);
  const activeCrunchbase = isCrunchbaseTab(state.activeTab);
  const lockedSupported = Boolean(state.lockedContext?.ok && state.lockedContext.context?.supported);
  const hasLockedTab = Number.isInteger(state.lockedTabId);
  const isLockedToCurrent = hasLockedTab && state.activeTab?.id === state.lockedTabId;

  if (!hasLockedTab) {
    setTargetStatus(
      activeSupported
        ? "Not attached yet. The current Crunchbase tab is ready."
        : "Not attached to a Crunchbase tab yet."
    );

    if (activeSupported) {
      const { pageType, headerCount, rowCountEstimate } = state.activeContext.context;
      return `Current tab is ready on ${pageType}. Detected ${headerCount} headers and ${rowCountEstimate} visible rows.`;
    }

    if (activeCrunchbase) {
      return (
        state.activeContext?.context?.reason ||
        state.activeContext?.error?.message ||
        "No Crunchbase results table detected on the current tab."
      );
    }

    return "Open a Crunchbase results page, then attach or scrape to start.";
  }

  setTargetStatus(`Locked to ${getTabLabel(state.lockedTab, state.lockedContext?.context)}.`);

  if (isLockedToCurrent && lockedSupported) {
    const { pageType, headerCount, rowCountEstimate } = state.lockedContext.context;
    return `Ready on locked ${pageType} tab. Detected ${headerCount} headers and ${rowCountEstimate} visible rows.`;
  }

  if (activeSupported && !isLockedToCurrent) {
    return "Panel is locked to another Crunchbase tab. Attach or scrape the current tab to switch.";
  }

  if (activeCrunchbase && !activeSupported) {
    return (
      state.activeContext?.context?.reason ||
      state.activeContext?.error?.message ||
      "The current Crunchbase tab is not a supported results table. The panel remains locked to the other tab."
    );
  }

  if (isLockedToCurrent && !lockedSupported) {
    return (
      state.lockedContext?.context?.reason ||
      state.lockedContext?.error?.message ||
      "The locked tab is open, but no supported Crunchbase results table is detected."
    );
  }

  return "Panel is locked to another Crunchbase tab. Switch back or attach a new tab.";
}

async function loadPageContext({ preserveStatus = false, useCachedState = false } = {}) {
  const stored = await getStoredConfig();

  if (useCachedState) {
    renderSummary(stored[STORAGE_KEYS.LAST_RUN_SUMMARY]);
    pageStatusEl.textContent = stored[STORAGE_KEYS.LAST_PAGE_STATUS];
  }

  if (
    !stored[STORAGE_KEYS.GOOGLE_SCRIPT_URL] ||
    !stored[STORAGE_KEYS.GOOGLE_SPREADSHEET_ID] ||
    !stored[STORAGE_KEYS.GOOGLE_SHEET_NAME]
  ) {
    setTargetStatus("Google Sheets is not configured.");
    if (!preserveStatus) {
      setPageStatus("Use Google Sheets Settings before scraping.");
    }
    setButtonState(attachButtonEl, "Attach Current Tab", true);
    setButtonState(scrapeButtonEl, "Attach & Scrape Current Tab", true);
    debugButtonEl.disabled = true;
    return;
  }

  const state = await resolvePanelState();

  if (!state.activeTab?.id) {
    setTargetStatus("No active browser tab.");
    if (!preserveStatus) {
      setPageStatus("No active browser tab found.");
    }
    setButtonState(attachButtonEl, "Attach Current Tab", true);
    setButtonState(scrapeButtonEl, "Attach & Scrape Current Tab", true);
    debugButtonEl.disabled = true;
    return;
  }

  applyButtonState(state);

  if (!preserveStatus) {
    setPageStatus(describePageStatus(state));
  } else {
    describePageStatus(state);
  }
}

function scheduleRefresh({ preserveStatus = false } = {}) {
  clearTimeout(refreshTimerId);
  refreshTimerId = setTimeout(() => {
    loadPageContext({ preserveStatus }).catch((error) => {
      setPageStatus("Unable to inspect the current tab.");
      renderSummary(`Error: ${error.message}`);
    });
  }, 120);
}

async function runScrape() {
  let activeState;

  try {
    activeState = await getSupportedActiveCrunchbaseState();
  } catch (error) {
    setPageStatus("Scrape failed.");
    const summary = `Error: ${error.message}`;
    renderSummary(summary);
    await persistPopupState({
      [STORAGE_KEYS.LAST_RUN_SUMMARY]: summary
    });
    return;
  }

  const stored = await getStoredConfig();
  const currentLockedTabId = Number.isInteger(stored[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID])
    ? stored[STORAGE_KEYS.PINNED_CRUNCHBASE_TAB_ID]
    : null;
  const isRetarget = currentLockedTabId !== activeState.tab.id;

  if (isRetarget) {
    await pinCrunchbaseTab(activeState.tab.id);
    setTargetStatus(`Locked to ${getTabLabel(activeState.tab, activeState.context)}.`);
  }

  attachButtonEl.disabled = true;
  scrapeButtonEl.disabled = true;
  setPageStatus(isRetarget ? "Attached to current tab. Scraping…" : "Scraping the attached tab…");
  renderSummary("Collecting rendered Crunchbase rows and sending them to Google Sheets...");
  await persistPopupState({
    [STORAGE_KEYS.LAST_RUN_SUMMARY]:
      "Collecting rendered Crunchbase rows and sending them to Google Sheets..."
  });

  try {
    const scrapeResponse = await chrome.tabs.sendMessage(activeState.tab.id, {
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

    setPageStatus(
      result.failures.length > 0
        ? result.appendedCount > 0
          ? "Scrape finished with partial failures."
          : "Scrape failed."
        : "Scrape finished."
    );
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
  let tabId = targetTabId;

  if (!tabId) {
    const activeTab = await getActiveTab();

    if (!activeTab?.id || !isCrunchbaseTab(activeTab)) {
      throw new Error("Open or attach a Crunchbase tab before capturing debug data.");
    }

    tabId = activeTab.id;
  }

  debugButtonEl.disabled = true;
  setPageStatus("Capturing debug snapshot…");

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
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

    const preview =
      json.length > 4000 ? `${json.slice(0, 4000)}\n... [truncated in panel]` : json;
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

attachButtonEl.addEventListener("click", () => {
  attachCurrentTab().catch((error) => {
    setPageStatus("Attach failed.");
    const summary = `Error: ${error.message}`;
    renderSummary(summary);
    persistPopupState({
      [STORAGE_KEYS.LAST_RUN_SUMMARY]: summary
    }).catch(() => {});
  });
});

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

chrome.tabs.onActivated.addListener(() => {
  scheduleRefresh();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === targetTabId) {
    scheduleRefresh();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.status && !changeInfo.url) {
    return;
  }

  if (tabId === targetTabId || tab?.active) {
    scheduleRefresh();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  scheduleRefresh();
});

loadPageContext({ useCachedState: true }).catch((error) => {
  setTargetStatus("Unable to inspect the panel state.");
  setPageStatus("Unable to inspect the current tab.");
  const summary = `Error: ${error.message}`;
  renderSummary(summary);
  persistPopupState({
    [STORAGE_KEYS.LAST_RUN_SUMMARY]: summary
  }).catch(() => {});
});
