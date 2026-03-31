const SHARED_SECRET = "";
const NULL_SENTINEL = "NULL";

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (SHARED_SECRET && body.sharedSecret !== SHARED_SECRET) {
      return jsonResponse({ ok: false, error: "Invalid shared secret." });
    }

    const spreadsheetId = String(body.spreadsheetId || "").trim();
    const requestedSheetName = String(body.sheetName || "OpenCrunch").trim();

    if (!spreadsheetId) {
      return jsonResponse({ ok: false, error: "Missing spreadsheetId." });
    }

    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheetState = getOrCreateSheet(spreadsheet, requestedSheetName);
    const sheet = sheetState.sheet;

    if (body.action === "test") {
      const headers = getHeaders(sheet);
      return jsonResponse({
        ok: true,
        spreadsheetTitle: spreadsheet.getName(),
        sheetName: sheet.getName(),
        headerCount: headers.length,
        createdSheet: sheetState.created
      });
    }

    if (body.action !== "append") {
      return jsonResponse({ ok: false, error: "Unsupported action." });
    }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    const headers = Array.isArray(body.headers) ? body.headers.filter(Boolean) : [];

    if (rows.length === 0 || headers.length === 0) {
      return jsonResponse({ ok: false, error: "Missing rows or headers." });
    }

    const finalHeaders = ensureHeaders(sheet, headers, rows);
    const values = rows.map((row) => buildSheetRow(finalHeaders, row));
    const startRow = Math.max(sheet.getLastRow(), 1) + 1;

    sheet.getRange(startRow, 1, values.length, finalHeaders.length).setValues(values);

    return jsonResponse({
      ok: true,
      spreadsheetTitle: spreadsheet.getName(),
      sheetName: sheet.getName(),
      headerCount: finalHeaders.length,
      appendedCount: values.length,
      createdSheet: sheetState.created
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function getOrCreateSheet(spreadsheet, sheetName) {
  let sheet = spreadsheet.getSheetByName(sheetName);
  let created = false;

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    created = true;
  }

  return { sheet: sheet, created: created };
}

function getHeaders(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    return [];
  }

  return sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (value) {
      return String(value || "").trim();
    })
    .filter(Boolean);
}

function ensureHeaders(sheet, incomingHeaders, rows) {
  const metadataHeaders = [];

  if (rows.some(function (row) { return row.recordUrl; })) {
    metadataHeaders.push("Crunchbase URL");
  }

  if (rows.some(function (row) { return row.sourcePageUrl; })) {
    metadataHeaders.push("Source Page URL");
  }

  if (rows.some(function (row) { return row.scrapedAt; })) {
    metadataHeaders.push("Scraped At");
  }

  const existingHeaders = getHeaders(sheet);
  const finalHeaders = existingHeaders.slice();

  incomingHeaders.concat(metadataHeaders).forEach(function (header) {
    if (finalHeaders.indexOf(header) === -1) {
      finalHeaders.push(header);
    }
  });

  if (finalHeaders.length > 0) {
    sheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  }

  return finalHeaders;
}

function buildSheetRow(headers, row) {
  const source = Object.assign({}, row.cells || {});

  if (row.recordUrl) {
    source["Crunchbase URL"] = row.recordUrl;
  }

  if (row.sourcePageUrl) {
    source["Source Page URL"] = row.sourcePageUrl;
  }

  if (row.scrapedAt) {
    source["Scraped At"] = row.scrapedAt;
  }

  return headers.map(function (header) {
    if (!Object.prototype.hasOwnProperty.call(source, header)) {
      return NULL_SENTINEL;
    }

    const value = source[header];
    return value == null ? NULL_SENTINEL : value;
  });
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
