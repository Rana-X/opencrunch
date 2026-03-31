import { appendRecordsToAirtable, serializeError, testAirtableConnection } from "./lib/airtable.js";
import { MESSAGE_TYPES, STORAGE_KEYS } from "./lib/constants.js";

async function getAirtableConfig() {
  const values = await chrome.storage.local.get([
    STORAGE_KEYS.AIRTABLE_PAT,
    STORAGE_KEYS.AIRTABLE_BASE_ID,
    STORAGE_KEYS.AIRTABLE_TABLE_REF
  ]);

  return {
    airtablePat: String(values[STORAGE_KEYS.AIRTABLE_PAT] ?? "").trim(),
    airtableBaseId: String(values[STORAGE_KEYS.AIRTABLE_BASE_ID] ?? "").trim(),
    airtableTableRef: String(values[STORAGE_KEYS.AIRTABLE_TABLE_REF] ?? "").trim()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MESSAGE_TYPES.TEST_AIRTABLE_CONNECTION) {
    (async () => {
      try {
        const result = await testAirtableConnection(message.config ?? (await getAirtableConfig()));
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: serializeError(error) });
      }
    })();

    return true;
  }

  if (message?.type === MESSAGE_TYPES.APPEND_TO_AIRTABLE) {
    (async () => {
      try {
        const config = await getAirtableConfig();
        const result = await appendRecordsToAirtable(config, message.payload);
        sendResponse({ ok: true, result });
      } catch (error) {
        sendResponse({ ok: false, error: serializeError(error) });
      }
    })();

    return true;
  }

  return false;
});
