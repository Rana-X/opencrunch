import { MESSAGE_TYPES, STORAGE_KEYS, SUPPORTED_HOST } from "./lib/constants.js";

const pageStatusEl = document.getElementById("page-status");
const scrapeButtonEl = document.getElementById("scrape-button");
const openOptionsEl = document.getElementById("open-options");
const runSummaryEl = document.getElementById("run-summary");

let activeTabId = null;

function renderSummary(lines) {
  runSummaryEl.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines);
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
  return chrome.storage.local.get([
    STORAGE_KEYS.AIRTABLE_PAT,
    STORAGE_KEYS.AIRTABLE_BASE_ID,
    STORAGE_KEYS.AIRTABLE_TABLE_REF
  ]);
}

async function loadPageContext({ preserveStatus = false } = {}) {
  const tab = await getActiveTab();

  if (!tab?.id) {
    pageStatusEl.textContent = "No active browser tab found.";
    scrapeButtonEl.disabled = true;
    return;
  }

  activeTabId = tab.id;

  if (!tab.url || new URL(tab.url).hostname !== SUPPORTED_HOST) {
    pageStatusEl.textContent = "Open a Crunchbase results page in the active tab.";
    scrapeButtonEl.disabled = true;
    return;
  }

  const config = await getStoredConfig();

  if (!config[STORAGE_KEYS.AIRTABLE_PAT] || !config[STORAGE_KEYS.AIRTABLE_BASE_ID] || !config[STORAGE_KEYS.AIRTABLE_TABLE_REF]) {
    pageStatusEl.textContent = "Airtable is not configured yet. Use Airtable Settings first.";
    scrapeButtonEl.disabled = true;
    return;
  }

  let response;

  try {
    response = await chrome.tabs.sendMessage(activeTabId, {
      type: MESSAGE_TYPES.GET_PAGE_CONTEXT
    });
  } catch (error) {
    pageStatusEl.textContent = `Unable to reach the page: ${error.message}`;
    scrapeButtonEl.disabled = true;
    return;
  }

  if (!response?.ok || !response.context?.supported) {
    pageStatusEl.textContent = response?.context?.reason || response?.error?.message || "No supported Crunchbase results table was detected.";
    scrapeButtonEl.disabled = true;
    return;
  }

  const { pageType, headerCount, rowCountEstimate } = response.context;
  if (!preserveStatus) {
    pageStatusEl.textContent = `Ready on ${pageType}. Detected ${headerCount} headers and ${rowCountEstimate} visible rows.`;
  }

  scrapeButtonEl.disabled = false;
}

async function runScrape() {
  if (!activeTabId) {
    return;
  }

  scrapeButtonEl.disabled = true;
  pageStatusEl.textContent = "Scraping the active page…";
  renderSummary("Collecting rendered Crunchbase rows and sending them to Airtable...");

  try {
    const scrapeResponse = await chrome.tabs.sendMessage(activeTabId, {
      type: MESSAGE_TYPES.SCRAPE_CURRENT_PAGE
    });

    if (!scrapeResponse?.ok) {
      throw new Error(scrapeResponse?.error?.message || "Scrape failed.");
    }

    pageStatusEl.textContent = "Writing rows to Airtable...";

    const writeResponse = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.APPEND_TO_AIRTABLE,
      payload: scrapeResponse.payload
    });

    if (!writeResponse?.ok) {
      throw new Error(formatError(writeResponse?.error));
    }

    const result = writeResponse.result;
    const lines = [
      `Rows scraped: ${result.rowCount}`,
      `Rows appended: ${result.appendedCount}`,
      `Missing Airtable fields: ${result.missingFields.length ? result.missingFields.join(", ") : "none"}`,
      `Failed batches: ${result.failures.length}`
    ];

    for (const failure of result.failures) {
      lines.push(`Batch ${failure.batchIndex}: ${failure.message}`);
    }

    renderSummary(lines);

    if (result.missingFields.length > 0) {
      pageStatusEl.textContent = "Write blocked by Airtable schema mismatch.";
    } else if (result.failures.length > 0) {
      pageStatusEl.textContent =
        result.appendedCount > 0 ? "Scrape finished with partial failures." : "Scrape failed.";
    } else {
      pageStatusEl.textContent = "Scrape finished.";
    }
  } catch (error) {
    pageStatusEl.textContent = "Scrape failed.";
    renderSummary(`Error: ${error.message}`);
  } finally {
    await loadPageContext({ preserveStatus: true }).catch(() => {});
  }
}

scrapeButtonEl.addEventListener("click", () => {
  runScrape();
});

openOptionsEl.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

loadPageContext().catch((error) => {
  pageStatusEl.textContent = "Unable to inspect the active tab.";
  renderSummary(`Error: ${error.message}`);
});
