import { MESSAGE_TYPES, STORAGE_KEYS } from "./lib/constants.js";

const patInput = document.getElementById("airtable-pat");
const baseIdInput = document.getElementById("airtable-base-id");
const tableRefInput = document.getElementById("airtable-table-ref");
const saveButton = document.getElementById("save-settings");
const testButton = document.getElementById("test-connection");
const statusEl = document.getElementById("status");

function currentConfig() {
  return {
    airtablePat: patInput.value.trim(),
    airtableBaseId: baseIdInput.value.trim(),
    airtableTableRef: tableRefInput.value.trim()
  };
}

function setStatus(lines) {
  statusEl.textContent = Array.isArray(lines) ? lines.join("\n") : String(lines);
}

async function loadSettings() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.AIRTABLE_PAT,
    STORAGE_KEYS.AIRTABLE_BASE_ID,
    STORAGE_KEYS.AIRTABLE_TABLE_REF
  ]);

  patInput.value = values[STORAGE_KEYS.AIRTABLE_PAT] ?? "";
  baseIdInput.value = values[STORAGE_KEYS.AIRTABLE_BASE_ID] ?? "";
  tableRefInput.value = values[STORAGE_KEYS.AIRTABLE_TABLE_REF] ?? "";
}

async function saveSettings() {
  const config = currentConfig();

  await chrome.storage.local.set({
    [STORAGE_KEYS.AIRTABLE_PAT]: config.airtablePat,
    [STORAGE_KEYS.AIRTABLE_BASE_ID]: config.airtableBaseId,
    [STORAGE_KEYS.AIRTABLE_TABLE_REF]: config.airtableTableRef
  });

  setStatus("Settings saved.");
}

async function testConnection() {
  setStatus("Testing Airtable connection...");

  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.TEST_AIRTABLE_CONNECTION,
    config: currentConfig()
  });

  if (!response?.ok) {
    setStatus(`Connection failed: ${response?.error?.message || "Unknown error."}`);
    return;
  }

  const result = response.result;
  setStatus([
    "Connection OK.",
    `Table name: ${result.tableName}`,
    `Table id: ${result.tableId}`,
    `Fields: ${result.fieldCount}`
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
