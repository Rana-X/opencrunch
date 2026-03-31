import {
  DEFAULT_GOOGLE_SHEETS_CONFIG,
  MESSAGE_TYPES,
  STORAGE_KEYS
} from "./lib/constants.js";

const scriptUrlInput = document.getElementById("google-script-url");
const spreadsheetIdInput = document.getElementById("google-spreadsheet-id");
const sheetNameInput = document.getElementById("google-sheet-name");
const sharedSecretInput = document.getElementById("google-shared-secret");
const saveButton = document.getElementById("save-settings");
const testButton = document.getElementById("test-connection");
const statusEl = document.getElementById("status");

function currentConfig() {
  return {
    googleScriptUrl:
      scriptUrlInput.value.trim() || DEFAULT_GOOGLE_SHEETS_CONFIG.googleScriptUrl,
    googleSpreadsheetId:
      spreadsheetIdInput.value.trim() || DEFAULT_GOOGLE_SHEETS_CONFIG.googleSpreadsheetId,
    googleSheetName: sheetNameInput.value.trim() || DEFAULT_GOOGLE_SHEETS_CONFIG.googleSheetName,
    googleSharedSecret:
      sharedSecretInput.value.trim() || DEFAULT_GOOGLE_SHEETS_CONFIG.googleSharedSecret
  };
}

function setStatus(lines) {
  statusEl.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines);
}

async function loadSettings() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.GOOGLE_SCRIPT_URL,
    STORAGE_KEYS.GOOGLE_SPREADSHEET_ID,
    STORAGE_KEYS.GOOGLE_SHEET_NAME,
    STORAGE_KEYS.GOOGLE_SHARED_SECRET
  ]);

  scriptUrlInput.value =
    values[STORAGE_KEYS.GOOGLE_SCRIPT_URL] ?? DEFAULT_GOOGLE_SHEETS_CONFIG.googleScriptUrl;
  spreadsheetIdInput.value =
    values[STORAGE_KEYS.GOOGLE_SPREADSHEET_ID] ??
    DEFAULT_GOOGLE_SHEETS_CONFIG.googleSpreadsheetId;
  sheetNameInput.value =
    values[STORAGE_KEYS.GOOGLE_SHEET_NAME] ?? DEFAULT_GOOGLE_SHEETS_CONFIG.googleSheetName;
  sharedSecretInput.value =
    values[STORAGE_KEYS.GOOGLE_SHARED_SECRET] ??
    DEFAULT_GOOGLE_SHEETS_CONFIG.googleSharedSecret;
}

async function saveSettings() {
  const config = currentConfig();

  await chrome.storage.local.set({
    [STORAGE_KEYS.GOOGLE_SCRIPT_URL]: config.googleScriptUrl,
    [STORAGE_KEYS.GOOGLE_SPREADSHEET_ID]: config.googleSpreadsheetId,
    [STORAGE_KEYS.GOOGLE_SHEET_NAME]: config.googleSheetName,
    [STORAGE_KEYS.GOOGLE_SHARED_SECRET]: config.googleSharedSecret
  });

  setStatus("Settings saved.");
}

async function testConnection() {
  setStatus("Testing Google Sheets connection...");

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.TEST_GOOGLE_SHEETS_CONNECTION,
    config: currentConfig()
  });

  if (!response?.ok) {
    setStatus(`Connection failed: ${response?.error?.message || "Unknown error."}`);
    return;
  }

  const result = response.result;
  setStatus([
    "Connection OK.",
    `Spreadsheet: ${result.spreadsheetTitle}`,
    `Sheet: ${result.sheetName}`,
    `Header count: ${result.headerCount}`,
    `Created new sheet: ${result.createdSheet ? "yes" : "no"}`
  ]);
}

saveButton.addEventListener("click", () => {
  saveSettings().catch((error) => {
    setStatus(`Save failed: ${error.message}`);
  });
});

testButton.addEventListener("click", () => {
  testConnection().catch((error) => {
    setStatus(`Connection failed: ${error.message}`);
  });
});

loadSettings().catch((error) => {
  setStatus(`Unable to load settings: ${error.message}`);
});
