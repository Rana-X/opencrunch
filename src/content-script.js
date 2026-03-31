(function () {
  const MESSAGE_TYPES = {
    GET_PAGE_CONTEXT: "GET_PAGE_CONTEXT",
    SCRAPE_CURRENT_PAGE: "SCRAPE_CURRENT_PAGE"
  };

  const PAGE_TYPES = {
    ORGANIZATIONS: "organizations",
    FUNDING_ROUNDS: "funding_rounds",
    ACQUISITIONS: "acquisitions",
    UNKNOWN: "unknown"
  };

  const STABLE_WINDOW_MS = 600;
  const MAX_STABLE_WAIT_MS = 10000;
  const SCROLL_SETTLE_MS = 100;

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function collapseWhitespace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
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

  function getHeaderModel(root) {
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

    return headerElements.map((element, index) => ({
      index,
      name: normalizeCellValue(element.innerText || element.textContent || "")
    }));
  }

  function getBodyRows(root) {
    let rows = Array.from(root.querySelectorAll('[role="row"]')).filter((row) => {
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
    let cells = Array.from(row.querySelectorAll('[role="gridcell"]')).filter(isVisible);

    if (cells.length === 0) {
      cells = Array.from(row.querySelectorAll("td")).filter(isVisible);
    }

    if (cells.length === 0) {
      cells = Array.from(row.children).filter(isVisible);
    }

    return cells;
  }

  function extractRowIdentifier(row, rowData, fallbackIndex) {
    const indexedAttributes = ["aria-rowindex", "data-rowindex", "row-index", "data-index"];

    for (const attribute of indexedAttributes) {
      const value = Number.parseInt(row.getAttribute(attribute), 10);

      if (Number.isFinite(value)) {
        return `row-index:${value}`;
      }
    }

    if (rowData.recordUrl) {
      return `url:${rowData.recordUrl}`;
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
    const visibleText = normalizeCellValue(cell.innerText || cell.textContent || "");
    const titleText = normalizeCellValue(directTitle);
    const ariaText = normalizeCellValue(ariaLabel);
    const anchorText = normalizeCellValue(anchor?.innerText || anchor?.textContent || "");
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

  function extractRowsFromRoot(root, state, fallbackOffset) {
    const headerModel = getHeaderModel(root);
    const rows = getBodyRows(root);

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

      if (!rowData.recordUrl) {
        const rowAnchor = row.querySelector("a[href]");
        rowData.recordUrl = getCrunchbaseUrlFromAnchor(rowAnchor);
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

    const pageText = document.body.innerText.match(/(\d+)\s*-\s*(\d+)\s+(?:Next|of)/i);

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

    return false;
  });
})();
