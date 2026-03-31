import { ERROR_CODES } from "./constants.js";

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

  if (!config.googleScriptUrl) {
    missing.push("Apps Script Web App URL");
  }

  if (!config.googleSpreadsheetId) {
    missing.push("Spreadsheet ID");
  }

  if (!config.googleSheetName) {
    missing.push("Sheet Name");
  }

  if (missing.length > 0) {
    throw new ExtensionError(
      ERROR_CODES.MISSING_CONFIG,
      `Missing Google Sheets configuration: ${missing.join(", ")}`
    );
  }
}

async function googleSheetsRequest(config, body) {
  const response = await fetch(config.googleScriptUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      spreadsheetId: config.googleSpreadsheetId,
      sheetName: config.googleSheetName,
      sharedSecret: config.googleSharedSecret || "",
      ...body
    })
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ExtensionError(
      ERROR_CODES.NETWORK_ERROR,
      payload?.error || "Google Sheets request failed.",
      { status: response.status, payload }
    );
  }

  if (!payload?.ok) {
    throw new ExtensionError(
      ERROR_CODES.NETWORK_ERROR,
      payload?.error || "Google Sheets endpoint returned an error.",
      { payload }
    );
  }

  return payload;
}

export async function testGoogleSheetsConnection(config) {
  assertConfig(config);

  const payload = await googleSheetsRequest(config, {
    action: "test"
  });

  return {
    spreadsheetTitle: payload.spreadsheetTitle,
    sheetName: payload.sheetName,
    headerCount: payload.headerCount ?? 0,
    createdSheet: Boolean(payload.createdSheet)
  };
}

export async function appendRowsToGoogleSheets(config, scrapePayload) {
  assertConfig(config);

  if (!Array.isArray(scrapePayload?.rows) || scrapePayload.rows.length === 0) {
    throw new ExtensionError(ERROR_CODES.EMPTY_RESULTS, "No rows were scraped from the page.");
  }

  const payload = await googleSheetsRequest(config, {
    action: "append",
    pageType: scrapePayload.pageType,
    pageUrl: scrapePayload.pageUrl,
    pageNumber: scrapePayload.pageNumber,
    headers: scrapePayload.headers,
    rows: scrapePayload.rows
  });

  return {
    rowCount: scrapePayload.rowCount ?? scrapePayload.rows.length,
    appendedCount: payload.appendedCount ?? 0,
    sheetName: payload.sheetName,
    headerCount: payload.headerCount ?? scrapePayload.headers?.length ?? 0,
    createdSheet: Boolean(payload.createdSheet),
    failures: []
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
