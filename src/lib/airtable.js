import {
  AIRTABLE_BASE_URL,
  AIRTABLE_BATCH_DELAY_MS,
  AIRTABLE_BATCH_SIZE,
  ERROR_CODES,
  OPTIONAL_METADATA_FIELDS
} from "./constants.js";
import { chunkArray, sleep } from "./normalize.js";

class ExtensionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ExtensionError";
    this.code = code;
    this.details = details;
  }
}

function assertConfig(config) {
  const missing = [];

  if (!config.airtablePat) {
    missing.push("Airtable PAT");
  }

  if (!config.airtableBaseId) {
    missing.push("Airtable Base ID");
  }

  if (!config.airtableTableRef) {
    missing.push("Airtable Table");
  }

  if (missing.length > 0) {
    throw new ExtensionError(
      ERROR_CODES.MISSING_CONFIG,
      `Missing Airtable configuration: ${missing.join(", ")}`
    );
  }
}

async function airtableRequest(path, { airtablePat, method = "GET", body } = {}) {
  const response = await fetch(`${AIRTABLE_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${airtablePat}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ExtensionError(
        ERROR_CODES.AIRTABLE_AUTH_ERROR,
        payload?.error?.message || "Airtable rejected the request.",
        { status: response.status, payload }
      );
    }

    if (response.status >= 500) {
      throw new ExtensionError(
        ERROR_CODES.NETWORK_ERROR,
        payload?.error?.message || "Airtable returned a server error.",
        { status: response.status, payload }
      );
    }

    throw new ExtensionError(
      ERROR_CODES.NETWORK_ERROR,
      payload?.error?.message || "Airtable request failed.",
      { status: response.status, payload }
    );
  }

  return payload;
}

export async function getBaseTables(config) {
  assertConfig(config);

  const payload = await airtableRequest(`/v0/meta/bases/${config.airtableBaseId}/tables`, {
    airtablePat: config.airtablePat
  });

  return payload.tables ?? [];
}

export function resolveTargetTable(tables, tableRef) {
  const normalized = String(tableRef ?? "").trim();

  if (!normalized) {
    return null;
  }

  return (
    tables.find((table) => table.id === normalized) ??
    tables.find((table) => table.name === normalized) ??
    null
  );
}

export async function testAirtableConnection(config) {
  const tables = await getBaseTables(config);
  const table = resolveTargetTable(tables, config.airtableTableRef);

  if (!table) {
    throw new ExtensionError(
      ERROR_CODES.TABLE_NOT_FOUND,
      `Could not find Airtable table "${config.airtableTableRef}".`
    );
  }

  return {
    tableId: table.id,
    tableName: table.name,
    fieldCount: table.fields?.length ?? 0
  };
}

function buildRecordFields(row, allowedFieldNames) {
  const fields = {};

  for (const [header, value] of Object.entries(row.cells ?? {})) {
    if (value == null || !allowedFieldNames.has(header)) {
      continue;
    }

    fields[header] = value;
  }

  if (row.recordUrl && allowedFieldNames.has(OPTIONAL_METADATA_FIELDS.CRUNCHBASE_URL)) {
    fields[OPTIONAL_METADATA_FIELDS.CRUNCHBASE_URL] = row.recordUrl;
  }

  if (
    row.sourcePageUrl &&
    allowedFieldNames.has(OPTIONAL_METADATA_FIELDS.SOURCE_PAGE_URL)
  ) {
    fields[OPTIONAL_METADATA_FIELDS.SOURCE_PAGE_URL] = row.sourcePageUrl;
  }

  if (row.scrapedAt && allowedFieldNames.has(OPTIONAL_METADATA_FIELDS.SCRAPED_AT)) {
    fields[OPTIONAL_METADATA_FIELDS.SCRAPED_AT] = row.scrapedAt;
  }

  return fields;
}

export async function appendRecordsToAirtable(config, scrapePayload) {
  assertConfig(config);

  if (!Array.isArray(scrapePayload?.rows) || scrapePayload.rows.length === 0) {
    throw new ExtensionError(ERROR_CODES.EMPTY_RESULTS, "No rows were scraped from the page.");
  }

  const tables = await getBaseTables(config);
  const table = resolveTargetTable(tables, config.airtableTableRef);

  if (!table) {
    throw new ExtensionError(
      ERROR_CODES.TABLE_NOT_FOUND,
      `Could not find Airtable table "${config.airtableTableRef}".`
    );
  }

  const fieldNames = new Set((table.fields ?? []).map((field) => field.name));
  const missingFields = (scrapePayload.headers ?? []).filter((header) => !fieldNames.has(header));

  if (missingFields.length > 0) {
    return {
      rowCount: scrapePayload.rowCount ?? scrapePayload.rows.length,
      appendedCount: 0,
      missingFields,
      failures: []
    };
  }

  const failures = [];
  const records = scrapePayload.rows.reduce((accumulator, row, rowIndex) => {
    const fields = buildRecordFields(row, fieldNames);

    if (Object.keys(fields).length === 0) {
      failures.push({
        batchIndex: -1,
        message: "Row had no mapped Airtable fields after normalization.",
        rowIndexes: [rowIndex]
      });
      return accumulator;
    }

    accumulator.push({
      fields,
      _rowIndex: rowIndex
    });

    return accumulator;
  }, []);

  const batchedRecords = chunkArray(records, AIRTABLE_BATCH_SIZE);
  let appendedCount = 0;

  for (let batchIndex = 0; batchIndex < batchedRecords.length; batchIndex += 1) {
    const batch = batchedRecords[batchIndex];

    try {
      const payload = await airtableRequest(
        `/v0/${config.airtableBaseId}/${encodeURIComponent(table.id)}`,
        {
          airtablePat: config.airtablePat,
          method: "POST",
          body: {
            records: batch.map((record) => ({ fields: record.fields }))
          }
        }
      );

      appendedCount += payload.records?.length ?? batch.length;

      if (batchIndex < batchedRecords.length - 1) {
        await sleep(AIRTABLE_BATCH_DELAY_MS);
      }
    } catch (error) {
      failures.push({
        batchIndex,
        message: error.message,
        rowIndexes: batch.map((record) => record._rowIndex)
      });
    }
  }

  return {
    rowCount: scrapePayload.rowCount ?? scrapePayload.rows.length,
    appendedCount,
    missingFields: [],
    failures
  };
}

export function serializeError(error) {
  if (error instanceof ExtensionError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }

  return {
    code: ERROR_CODES.NETWORK_ERROR,
    message: error?.message || "Unexpected error."
  };
}
