export const MESSAGE_TYPES = {
  GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
  SCRAPE_CURRENT_PAGE: "SCRAPE_CURRENT_PAGE",
  CAPTURE_DEBUG_SNAPSHOT: "CAPTURE_DEBUG_SNAPSHOT",
  APPEND_TO_GOOGLE_SHEETS: "APPEND_TO_GOOGLE_SHEETS",
  TEST_GOOGLE_SHEETS_CONNECTION: "TEST_GOOGLE_SHEETS_CONNECTION"
};

export const STORAGE_KEYS = {
  GOOGLE_SCRIPT_URL: "googleScriptUrl",
  GOOGLE_SPREADSHEET_ID: "googleSpreadsheetId",
  GOOGLE_SHEET_NAME: "googleSheetName",
  GOOGLE_SHARED_SECRET: "googleSharedSecret",
  PINNED_CRUNCHBASE_TAB_ID: "pinnedCrunchbaseTabId",
  LAST_RUN_SUMMARY: "lastRunSummary",
  LAST_PAGE_STATUS: "lastPageStatus",
  LAST_DEBUG_SNAPSHOT: "lastDebugSnapshot"
};

export const DEFAULT_GOOGLE_SHEETS_CONFIG = {
  googleScriptUrl:
    "https://script.google.com/macros/s/AKfycbx3eL-zfjXRaEy1QVwFi6caEeHxA86TKFJfACuE8i6ct0mIT4LkmtAkizsFp95pV8VF/exec",
  googleSpreadsheetId: "13fL3BRtmmbT_MWTFItCbGCqcM4SxgLUlSDgYGAEqUrc",
  googleSheetName: "Sheet1",
  googleSharedSecret: ""
};

export const ERROR_CODES = {
  UNSUPPORTED_PAGE: "UNSUPPORTED_PAGE",
  TABLE_NOT_FOUND: "TABLE_NOT_FOUND",
  TABLE_NOT_READY: "TABLE_NOT_READY",
  EMPTY_RESULTS: "EMPTY_RESULTS",
  MISSING_CONFIG: "MISSING_CONFIG",
  NETWORK_ERROR: "NETWORK_ERROR"
};

export const PAGE_TYPES = {
  ORGANIZATIONS: "organizations",
  FUNDING_ROUNDS: "funding_rounds",
  ACQUISITIONS: "acquisitions",
  UNKNOWN: "unknown"
};

export const SUPPORTED_HOST = "www.crunchbase.com";
