(function () {
  const MESSAGE_TYPES = {
    GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
    SCRAPE_CURRENT_PAGE: "SCRAPE_CURRENT_PAGE",
    CAPTURE_DEBUG_SNAPSHOT: "CAPTURE_DEBUG_SNAPSHOT"
  };

  const PAGE_TYPES = {
    ORGANIZATIONS: "organizations",
    FUNDING_ROUNDS: "funding_rounds",
    ACQUISITIONS: "acquisitions",
    UNKNOWN: "unknown"
  };

  const STABLE_WINDOW_MS = 600;
  const MAX_STABLE_WAIT_MS = 10000;
  const SCROLL_SETTLE_MS = 180;
  const KNOWN_HEADER_LABELS = new Set([
    "Organization Name",
    "Total Funding Amount",
    "Stage",
    "Industries",
    "Headquarters Location",
    "Description",
    "CB Rank",
    "Founded Date",
    "Last Funding Type",
    "Last Funding Date",
    "Last Funding Amount",
    "Number of Investors",
    "Funding Round Name",
    "Announced Date",
    "Money Raised",
    "Lead Investors",
    "Investor Names",
    "Acquired Organization Name",
    "Acquiring Organization Name",
    "Acquisition Date",
    "Transaction Name"
  ]);

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function collapseWhitespace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function safeTextContent(element) {
    if (!element) {
      return "";
    }

    try {
      return element.innerText || element.textContent || "";
    } catch {
      try {
        return element.textContent || "";
      } catch {
        return "";
      }
    }
  }

  function safeOuterHtml(element, maxLength = 2000) {
    if (!element) {
      return "";
    }

    try {
      return String(element.outerHTML || "").slice(0, maxLength);
    } catch {
      return "";
    }
  }

  function normalizeCellValue(value) {
    const normalized = collapseWhitespace(value);

    if (!normalized) {
      return null;
    }

    if (/^[—–-]+$/.test(normalized)) {
      return null;
    }

    return normalized;
  }

  function isVisible(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const style = window.getComputedStyle(element);

    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function inferPageType() {
    const pathname = window.location.pathname.toLowerCase();

    if (pathname.includes("funding_round") || pathname.includes("funding-round")) {
      return PAGE_TYPES.FUNDING_ROUNDS;
    }

    if (pathname.includes("acquisition")) {
      return PAGE_TYPES.ACQUISITIONS;
    }

    if (pathname.includes("organization") || pathname.includes("companies")) {
      return PAGE_TYPES.ORGANIZATIONS;
    }

    return PAGE_TYPES.UNKNOWN;
  }

  function getCrunchbaseUrlFromAnchor(anchor) {
    const href = anchor?.getAttribute?.("href");

    if (!href || href.startsWith("#")) {
      return null;
    }

    try {
      const url = new URL(href, window.location.origin);

      if (url.hostname !== window.location.hostname) {
        return null;
      }

      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function getEntityPathType(urlString) {
    try {
      const url = new URL(urlString, window.location.origin);
      const pathname = url.pathname.toLowerCase();

      if (/^\/organization\/[^/]+/.test(pathname)) {
        return "organization";
      }

      if (/^\/funding[_-]round\/[^/]+/.test(pathname)) {
        return "funding_round";
      }

      if (/^\/acquisition\/[^/]+/.test(pathname)) {
        return "acquisition";
      }

      return null;
    } catch {
      return null;
    }
  }

  function getElementCenterX(element) {
    const rect = element.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function getKnownHeaderElements(root) {
    return Array.from(root.querySelectorAll("*")).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const text = normalizeCellValue(safeTextContent(element));
      return Boolean(text && KNOWN_HEADER_LABELS.has(text));
    });
  }

  function getKnownHeaderModel(root) {
    const headerElements = getKnownHeaderElements(root);

    if (headerElements.length === 0) {
      return [];
    }

    const ordered = headerElements
      .map((element) => ({
        element,
        name: normalizeCellValue(safeTextContent(element)),
        xCenter: getElementCenterX(element),
        top: element.getBoundingClientRect().top
      }))
      .sort((left, right) => {
        if (Math.abs(left.top - right.top) > 12) {
          return left.top - right.top;
        }

        return left.xCenter - right.xCenter;
      });

    const deduped = [];
    const seen = new Set();

    for (const header of ordered) {
      if (seen.has(header.name)) {
        continue;
      }

      seen.add(header.name);
      deduped.push({
        index: deduped.length,
        name: header.name,
        xCenter: header.xCenter,
        source: "known"
      });
    }

    return deduped;
  }

  function getGridColumnId(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const explicitValue = element.getAttribute("data-columnid") || element.getAttribute("columnid");

    if (explicitValue) {
      return explicitValue;
    }

    const className = typeof element.className === "string" ? element.className : "";
    const match = className.match(/column-id-([a-z0-9_-]+)/i);

    return match ? match[1] : null;
  }

  function getHeaderTextFromGridColumnHeader(headerElement) {
    if (!(headerElement instanceof Element)) {
      return null;
    }

    const selectors = [
      ".header-contents",
      ".main-content",
      ".component--field-formatter",
      ".field-label",
      ".label"
    ];

    for (const selector of selectors) {
      const target = headerElement.querySelector(selector);
      const text = normalizeCellValue(safeTextContent(target));

      if (text) {
        return text;
      }
    }

    return normalizeCellValue(safeTextContent(headerElement));
  }

  function getGridHeaderModel(root) {
    const headerElements = Array.from(root.querySelectorAll("grid-header grid-column-header")).filter(isVisible);

    if (headerElements.length === 0) {
      return [];
    }

    const mappedHeaders = headerElements
      .map((element, index) => {
        const columnId = getGridColumnId(element);
        const name = getHeaderTextFromGridColumnHeader(element);

        if (!name || !columnId || columnId === "select") {
          return null;
        }

        return {
          index,
          columnId,
          name,
          xCenter: getElementCenterX(element),
          source: "grid"
        };
      })
      .filter(Boolean);

    if (mappedHeaders.length === 0) {
      return [];
    }

    const seenNames = new Set();
    return mappedHeaders.filter((header) => {
      if (seenNames.has(header.name)) {
        return false;
      }

      seenNames.add(header.name);
      return true;
    });
  }

  function getHeaderModel(root) {
    const gridHeaders = getGridHeaderModel(root);

    if (gridHeaders.length > 0) {
      return gridHeaders;
    }

    let headerElements = Array.from(root.querySelectorAll('[role="columnheader"]')).filter(isVisible);

    if (headerElements.length === 0) {
      headerElements = Array.from(root.querySelectorAll("thead th")).filter(isVisible);
    }

    if (headerElements.length === 0) {
      const firstRow = Array.from(root.querySelectorAll('[role="row"]')).find((row) =>
        Array.from(row.querySelectorAll('[role="columnheader"]')).length > 0
      );

      if (firstRow) {
        headerElements = Array.from(firstRow.children).filter(isVisible);
      }
    }

    if (headerElements.length === 0) {
      return getKnownHeaderModel(root);
    }

    return headerElements.map((element, index) => ({
      index,
      name: normalizeCellValue(safeTextContent(element)),
      xCenter: getElementCenterX(element),
      source: "structural"
    }));
  }

  function isPotentialEntityLink(anchor) {
    const href = anchor?.getAttribute?.("href") || "";
    return Boolean(getEntityPathType(href));
  }

  function getHeuristicRowRoot(anchor, root) {
    let current = anchor;
    const rootRect = root.getBoundingClientRect();

    while (current && current !== root) {
      const rect = current.getBoundingClientRect();
      const text = normalizeCellValue(safeTextContent(current));

      if (
        rect.width >= rootRect.width * 0.55 &&
        rect.height >= 36 &&
        rect.height <= 260 &&
        text &&
        text.length > 8
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return anchor.closest("tr") || anchor.parentElement;
  }

  function getHeuristicRows(root) {
    const anchors = Array.from(root.querySelectorAll("a[href]")).filter(
      (anchor) => isVisible(anchor) && isPotentialEntityLink(anchor)
    );
    const rows = [];
    const seen = new Set();
    const headerElements = getKnownHeaderElements(root);
    const headerBottom =
      headerElements.length > 0
        ? Math.max(...headerElements.map((element) => element.getBoundingClientRect().bottom))
        : Number.NEGATIVE_INFINITY;

    for (const anchor of anchors) {
      const row = getHeuristicRowRoot(anchor, root);

      if (!row || seen.has(row)) {
        continue;
      }

       if (row.getBoundingClientRect().top <= headerBottom + 8) {
        continue;
      }

      seen.add(row);
      rows.push(row);
    }

    return rows.sort((left, right) => {
      return left.getBoundingClientRect().top - right.getBoundingClientRect().top;
    });
  }

  function getBodyRows(root) {
    let rows = Array.from(root.querySelectorAll("grid-row")).filter((row) => {
      return isVisible(row) && row.querySelector("grid-cell") !== null;
    });

    if (rows.length > 0) {
      return rows;
    }

    rows = Array.from(root.querySelectorAll('[role="row"]')).filter((row) => {
      if (!isVisible(row)) {
        return false;
      }

      if (row.querySelector('[role="columnheader"]')) {
        return false;
      }

      return row.querySelector('[role="gridcell"], td') !== null;
    });

    if (rows.length === 0) {
      rows = Array.from(root.querySelectorAll("tbody tr")).filter((row) => {
        return isVisible(row) && row.querySelector("td") !== null;
      });
    }

    if (rows.length === 0) {
      rows = getHeuristicRows(root);
    }

    return rows;
  }

  function scoreCandidate(root) {
    if (!isVisible(root)) {
      return -1;
    }

    const headers = getHeaderModel(root).filter((header) => header.name).length;
    const rows = getBodyRows(root).length;

    if (headers < 2 || rows < 1) {
      return -1;
    }

    return headers * 100 + rows;
  }

  function findBestGridRoot() {
    const selectors = [
      "sheet-grid",
      ".results-grid",
      ".grid-container",
      '[class*="grid-id-"]',
      '[role="grid"]',
      '[role="table"]',
      "table",
      "multi-search-results",
      '[data-testid*="grid"]',
      '[data-testid*="table"]'
    ];

    const candidates = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }

    getKnownHeaderElements(document.body).forEach((headerElement) => {
      let current = headerElement.parentElement;
      let depth = 0;

      while (current && current !== document.body && depth < 8) {
        candidates.add(current);
        current = current.parentElement;
        depth += 1;
      }
    });

    let best = null;
    let bestScore = -1;

    for (const candidate of candidates) {
      const score = scoreCandidate(candidate);

      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  function describeElement(element) {
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || "",
      className: typeof element.className === "string" ? element.className : "",
      role: element.getAttribute("role") || "",
      dataTestId: element.getAttribute("data-testid") || "",
      textSnippet: collapseWhitespace(safeTextContent(element)).slice(0, 240),
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      htmlSnippet: safeOuterHtml(element, 2000)
    };
  }

  function getCandidateDebugInfo() {
    const selectors = [
      "sheet-grid",
      ".results-grid",
      ".grid-container",
      '[class*="grid-id-"]',
      '[role="grid"]',
      '[role="table"]',
      "table",
      "multi-search-results",
      '[data-testid*="grid"]',
      '[data-testid*="table"]'
    ];
    const candidates = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }

    getKnownHeaderElements(document.body).forEach((headerElement) => {
      let current = headerElement.parentElement;
      let depth = 0;

      while (current && current !== document.body && depth < 8) {
        candidates.add(current);
        current = current.parentElement;
        depth += 1;
      }
    });

    return Array.from(candidates)
      .map((candidate) => {
        const headerModel = getHeaderModel(candidate).filter((header) => header.name);
        const rows = getBodyRows(candidate);

        return {
          score: scoreCandidate(candidate),
          descriptor: describeElement(candidate),
          headerNames: headerModel.map((header) => header.name).slice(0, 20),
          rowCount: rows.length
        };
      })
      .filter((candidate) => candidate.score >= 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
  }

  function waitForDomStability() {
    return new Promise((resolve) => {
      let idleTimer = null;
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        observer.disconnect();
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        resolve();
      };

      const scheduleIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, STABLE_WINDOW_MS);
      };

      const observer = new MutationObserver(() => {
        scheduleIdle();
      });

      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true
      });

      const maxTimer = setTimeout(finish, MAX_STABLE_WAIT_MS);
      scheduleIdle();
    });
  }

  async function getStableGridRoot() {
    await waitForDomStability();
    return findBestGridRoot();
  }

  function findScrollableAncestor(startElement, axis) {
    const property = axis === "x" ? "overflowX" : "overflowY";
    const sizeProperty = axis === "x" ? ["scrollWidth", "clientWidth"] : ["scrollHeight", "clientHeight"];

    let current = startElement;

    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowValue = style[property];

      if (
        /(auto|scroll)/.test(overflowValue) &&
        current[sizeProperty[0]] > current[sizeProperty[1]] + 4
      ) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function buildScrollPositions(container, axis) {
    if (!container) {
      return [0];
    }

    const max =
      axis === "x"
        ? Math.max(0, container.scrollWidth - container.clientWidth)
        : Math.max(0, container.scrollHeight - container.clientHeight);

    if (max <= 0) {
      return [0];
    }

    const viewport = axis === "x" ? container.clientWidth : container.clientHeight;
    const step = Math.max(Math.floor(viewport * 0.8), 1);
    const positions = [0];

    for (let position = step; position < max; position += step) {
      positions.push(position);
    }

    positions.push(max);

    return Array.from(new Set(positions));
  }

  function setScrollPosition(container, axis, value) {
    if (!container) {
      return;
    }

    if (axis === "x") {
      container.scrollLeft = value;
    } else {
      container.scrollTop = value;
    }
  }

  function getCellElements(row) {
    let cells = Array.from(row.querySelectorAll(":scope > grid-cell")).filter(isVisible);

    if (cells.length > 0) {
      return cells;
    }

    cells = Array.from(row.querySelectorAll('[role="gridcell"]')).filter(isVisible);

    if (cells.length === 0) {
      cells = Array.from(row.querySelectorAll("td")).filter(isVisible);
    }

    if (cells.length === 0) {
      cells = Array.from(row.children).filter(isVisible);
    }

    return cells;
  }

  function getLeafTextElements(row) {
    return Array.from(row.querySelectorAll("a, span, div, p")).filter((element) => {
      if (!isVisible(element)) {
        return false;
      }

      const text = normalizeCellValue(safeTextContent(element));

      if (!text || text.length < 2) {
        return false;
      }

      const rect = element.getBoundingClientRect();

      if (rect.height > 180 || rect.width > row.getBoundingClientRect().width * 0.9) {
        return false;
      }

      for (const child of Array.from(element.children)) {
        if (!isVisible(child)) {
          continue;
        }

        const childText = normalizeCellValue(safeTextContent(child));

        if (childText && childText === text) {
          return false;
        }
      }

      return true;
    });
  }

  function extractCellsByGeometry(row, headerModel) {
    const grouped = new Map();
    const textElements = getLeafTextElements(row);

    for (const element of textElements) {
      const payload = extractCellPayload(element);

      if (!payload.value) {
        continue;
      }

      let nearestHeader = null;
      let nearestDistance = Number.POSITIVE_INFINITY;
      const xCenter = getElementCenterX(element);

      for (const header of headerModel) {
        if (!header.name || typeof header.xCenter !== "number") {
          continue;
        }

        const distance = Math.abs(header.xCenter - xCenter);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestHeader = header;
        }
      }

      if (!nearestHeader) {
        continue;
      }

      const existing = grouped.get(nearestHeader.name) ?? [];

      if (!existing.includes(payload.value)) {
        existing.push(payload.value);
        grouped.set(nearestHeader.name, existing);
      }
    }

    const cells = {};

    for (const [header, values] of grouped.entries()) {
      const merged = normalizeCellValue(values.join(" | "));

      if (merged) {
        cells[header] = merged;
      }
    }

    return cells;
  }

  function extractRowIdentifier(row, rowData, fallbackIndex) {
    if (rowData.recordUrl) {
      return `url:${rowData.recordUrl}`;
    }

    const indexedAttributes = ["aria-rowindex", "data-rowindex", "row-index", "data-index"];

    for (const attribute of indexedAttributes) {
      const value = Number.parseInt(row.getAttribute(attribute), 10);

      if (Number.isFinite(value)) {
        return `row-index:${value}`;
      }
    }

    const signature = Object.values(rowData.cells).slice(0, 3).join("|");

    if (signature) {
      return `values:${signature}`;
    }

    return `fallback:${fallbackIndex}`;
  }

  function extractCellPayload(cell) {
    const anchor = cell.querySelector("a[href]");
    const directTitle = cell.getAttribute("title");
    const ariaLabel = cell.getAttribute("aria-label");
    const visibleText = normalizeCellValue(safeTextContent(cell));
    const titleText = normalizeCellValue(directTitle);
    const ariaText = normalizeCellValue(ariaLabel);
    const anchorText = normalizeCellValue(safeTextContent(anchor));
    const value = visibleText || titleText || ariaText || anchorText || null;

    return {
      value,
      recordUrl: getCrunchbaseUrlFromAnchor(anchor)
    };
  }

  function mergeRow(existingRow, incomingRow) {
    if (!existingRow.recordUrl && incomingRow.recordUrl) {
      existingRow.recordUrl = incomingRow.recordUrl;
    }

    for (const [header, value] of Object.entries(incomingRow.cells)) {
      if (!(header in existingRow.cells) && value != null) {
        existingRow.cells[header] = value;
      }
    }
  }

  function getPrimaryHeaderNames(pageType) {
    if (pageType === PAGE_TYPES.ORGANIZATIONS) {
      return ["Organization Name"];
    }

    if (pageType === PAGE_TYPES.FUNDING_ROUNDS) {
      return ["Funding Round Name"];
    }

    if (pageType === PAGE_TYPES.ACQUISITIONS) {
      return ["Transaction Name", "Acquired Organization Name", "Acquiring Organization Name"];
    }

    return [];
  }

  function hasPrimaryEntityCell(rowData, pageType) {
    const candidates = getPrimaryHeaderNames(pageType);

    if (candidates.length === 0) {
      return Object.keys(rowData.cells).length >= 2;
    }

    return candidates.some((header) => normalizeCellValue(rowData.cells[header]));
  }

  function extractRowsFromRoot(root, state, fallbackOffset) {
    const headerModel = getHeaderModel(root);
    const rows = getBodyRows(root);
    const headerByColumnId = new Map(
      headerModel
        .filter((header) => header?.columnId && header?.name)
        .map((header) => [header.columnId, header])
    );

    for (const header of headerModel) {
      if (header.name && !state.headerSet.has(header.name)) {
        state.headerSet.add(header.name);
        state.headers.push(header.name);
      }
    }

    rows.forEach((row, rowIndex) => {
      const cells = getCellElements(row);
      const rowData = {
        cells: {},
        recordUrl: null,
        sourcePageUrl: state.pageUrl,
        scrapedAt: state.scrapedAt
      };
      const hasGridCellMapping = cells.some((cell) => {
        const columnId = getGridColumnId(cell);
        return Boolean(columnId && headerByColumnId.has(columnId));
      });

      const shouldUseGeometryFallback =
        !hasGridCellMapping &&
        (
          headerModel.some((header) => header?.source === "known") ||
          cells.length === 0 ||
          (headerModel.length >= 4 && cells.length < Math.ceil(headerModel.length / 2))
        );

      if (hasGridCellMapping) {
        for (const cell of cells) {
          const columnId = getGridColumnId(cell);

          if (!columnId || columnId === "select") {
            continue;
          }

          const header = headerByColumnId.get(columnId);

          if (!header?.name) {
            continue;
          }

          const cellPayload = extractCellPayload(cell);

          if (cellPayload.value != null) {
            rowData.cells[header.name] = cellPayload.value;
          }

          if (!rowData.recordUrl && cellPayload.recordUrl) {
            rowData.recordUrl = cellPayload.recordUrl;
          }
        }
      } else if (shouldUseGeometryFallback) {
        rowData.cells = extractCellsByGeometry(row, headerModel);
      } else {
        for (let cellIndex = 0; cellIndex < Math.min(cells.length, headerModel.length); cellIndex += 1) {
          const header = headerModel[cellIndex];

          if (!header?.name) {
            continue;
          }

          const cellPayload = extractCellPayload(cells[cellIndex]);

          if (cellPayload.value != null) {
            rowData.cells[header.name] = cellPayload.value;
          }

          if (!rowData.recordUrl && cellPayload.recordUrl) {
            rowData.recordUrl = cellPayload.recordUrl;
          }
        }
      }

      if (!rowData.recordUrl) {
        const rowAnchor = row.querySelector("a[href]");
        rowData.recordUrl = getCrunchbaseUrlFromAnchor(rowAnchor);
      }

      if (!rowData.recordUrl || !getEntityPathType(rowData.recordUrl)) {
        return;
      }

      if (rowData.recordUrl === state.pageUrl || rowData.recordUrl.includes("/discover/")) {
        return;
      }

      if (!hasPrimaryEntityCell(rowData, state.pageType)) {
        return;
      }

      if (Object.keys(rowData.cells).length < 2) {
        return;
      }

      const rowKey = extractRowIdentifier(row, rowData, fallbackOffset + rowIndex);
      const existing = state.rows.get(rowKey);

      if (existing) {
        mergeRow(existing, rowData);
      } else {
        state.rows.set(rowKey, rowData);
      }
    });
  }

  function extractPageNumber() {
    const searchParams = new URLSearchParams(window.location.search);
    const directPage = Number.parseInt(searchParams.get("page"), 10);

    if (Number.isFinite(directPage) && directPage > 0) {
      return directPage;
    }

    const pageText = safeTextContent(document.body).match(/(\d+)\s*-\s*(\d+)\s+(?:Next|of)/i);

    if (!pageText) {
      return 1;
    }

    const start = Number.parseInt(pageText[1], 10);
    const end = Number.parseInt(pageText[2], 10);
    const pageSize = Math.max(1, end - start + 1);

    return Math.floor((start - 1) / pageSize) + 1;
  }

  async function collectScrapePayload() {
    const initialRoot = await getStableGridRoot();

    if (!initialRoot) {
      throw new Error("Could not find a Crunchbase results table on this page.");
    }

    const verticalContainer = findScrollableAncestor(initialRoot, "y");
    const horizontalContainer = findScrollableAncestor(initialRoot, "x");
    const verticalOrigin = verticalContainer ? verticalContainer.scrollTop : 0;
    const horizontalOrigin = horizontalContainer ? horizontalContainer.scrollLeft : 0;
    const horizontalPositions = buildScrollPositions(horizontalContainer, "x");
    const verticalPositions = buildScrollPositions(verticalContainer, "y");
    const scrapeState = {
      headers: [],
      headerSet: new Set(),
      pageType: inferPageType(),
      pageUrl: window.location.href,
      rows: new Map(),
      scrapedAt: new Date().toISOString()
    };

    try {
      let fallbackOffset = 0;

      for (const x of horizontalPositions) {
        setScrollPosition(horizontalContainer, "x", x);
        await sleep(SCROLL_SETTLE_MS);

        for (const y of verticalPositions) {
          setScrollPosition(verticalContainer, "y", y);
          await sleep(SCROLL_SETTLE_MS);

          const currentRoot = findBestGridRoot();

          if (!currentRoot) {
            continue;
          }

          extractRowsFromRoot(currentRoot, scrapeState, fallbackOffset);
          fallbackOffset += 500;
        }
      }
    } finally {
      setScrollPosition(verticalContainer, "y", verticalOrigin);
      setScrollPosition(horizontalContainer, "x", horizontalOrigin);
    }

    const rows = Array.from(scrapeState.rows.values());

    if (rows.length === 0 || scrapeState.headers.length < 2) {
      throw new Error("The Crunchbase results table did not yield any scrapeable rows.");
    }

    return {
      pageType: scrapeState.pageType,
      pageUrl: scrapeState.pageUrl,
      headers: scrapeState.headers,
      rows,
      rowCount: rows.length,
      pageNumber: extractPageNumber()
    };
  }

  async function getPageContext() {
    const root = await getStableGridRoot();

    if (!root) {
      return {
        supported: false,
        reason: "No Crunchbase results table detected.",
        pageType: inferPageType(),
        pageUrl: window.location.href,
        headerCount: 0,
        rowCountEstimate: 0
      };
    }

    return {
      supported: true,
      reason: "",
      pageType: inferPageType(),
      pageUrl: window.location.href,
      headerCount: getHeaderModel(root).filter((header) => header.name).length,
      rowCountEstimate: getBodyRows(root).length
    };
  }

  async function captureDebugSnapshot() {
    const root = await getStableGridRoot();
    const headerModel = root ? getHeaderModel(root).filter((header) => header.name) : [];
    const rows = root ? getBodyRows(root) : [];
    const verticalContainer = root ? findScrollableAncestor(root, "y") : null;
    const horizontalContainer = root ? findScrollableAncestor(root, "x") : null;

    return {
      generatedAt: new Date().toISOString(),
      pageUrl: window.location.href,
      pageTitle: document.title,
      pageType: inferPageType(),
      supported: Boolean(root),
      headerCount: headerModel.length,
      rowCountEstimate: rows.length,
      selectedRoot: describeElement(root),
      verticalScrollContainer: describeElement(verticalContainer),
      horizontalScrollContainer: describeElement(horizontalContainer),
      headers: headerModel.slice(0, 40).map((header) => ({
        name: header.name,
        source: header.source || "",
        xCenter: typeof header.xCenter === "number" ? Math.round(header.xCenter) : null
      })),
      sampleRows: rows.slice(0, 5).map((row) => {
        const anchor = row.querySelector("a[href]");
        return {
          recordUrl: getCrunchbaseUrlFromAnchor(anchor),
          descriptor: describeElement(row)
        };
      }),
      candidateRoots: getCandidateDebugInfo(),
      knownHeaderTexts: getKnownHeaderElements(document.body)
        .map((element) => normalizeCellValue(safeTextContent(element)))
        .filter(Boolean)
        .slice(0, 30)
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === MESSAGE_TYPES.GET_PAGE_CONTEXT) {
      getPageContext()
        .then((context) => sendResponse({ ok: true, context }))
        .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));

      return true;
    }

    if (message?.type === MESSAGE_TYPES.SCRAPE_CURRENT_PAGE) {
      collectScrapePayload()
        .then((payload) => sendResponse({ ok: true, payload }))
        .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));

      return true;
    }

    if (message?.type === MESSAGE_TYPES.CAPTURE_DEBUG_SNAPSHOT) {
      captureDebugSnapshot()
        .then((snapshot) => sendResponse({ ok: true, snapshot }))
        .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));

      return true;
    }

    return false;
  });
})();
