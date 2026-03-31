export function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeCellValue(value) {
  const normalized = collapseWhitespace(value);

  if (!normalized) {
    return null;
  }

  if (/^[—–-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function chunkArray(items, chunkSize) {
  const chunks = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function uniqueOrdered(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (seen.has(item)) {
      continue;
    }

    seen.add(item);
    result.push(item);
  }

  return result;
}
