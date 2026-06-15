(function () {
  "use strict";
  const OMDB_API_KEY = "";    // Insert your OMDb API key here, 1000 requests per day with the OMDb free API key
  const SETTINGS = {
  // MOVIES
    movies: {
      enableCountry: true,            // "true" or "false" - Show Movie country of origin
      enableAwards: true,             // "true" or "false" - Show Movie awards information
      enableBoxOffice: true,          // "true" or "false" - Show Movie box office data (Movies only)
      awardsLinkSourceMovies: "imdb", // "imdb" or "tmdb" (Movies only) - Open the IMDb or TMDb awards website on click (TMDb needs TMDb ID in Jellyfin DB)
      enableClickableLink: true,      // "true" or "false" - Movies enable / disable clickable links
      rowOrder: ["country", "awards", "boxoffice"] 
      // Movie Row display order, e.g ["awards", "boxoffice", "country"]; (1st placed after Studios, Writer, Director, Genres - if available; if Row not used disable to false or remove from this order list)
    },
  // TV SHOWS (only on MAIN level, not on Season or Episode level)
    tvShows: {
      enableCountry: true,            // "true" or "false" - Show TV Show country of origin
      enableAwards: true,             // "true" or "false" - Show TV Show awards information
      enableClickableLink: true,      // "true" or "false" - TV Shows enable / disable clickable links
      rowOrder: ["country", "awards"] 
      // TV Show Row display order, e.g ["awards", "country"];  (1st placed after Studios, Genres - if available; if Row not used disable to false or remove from this order list)
    }
  };
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function getBaseUrl() {
    return window.location.origin;
  }
  function getItemIdFromUrl() {
    const url = new URL(window.location.href);
    const id = url.searchParams.get("id");
    if (id) return id;
    const hash = url.hash || "";
    const m = hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function getAccessToken() {
    try {
      const raw = localStorage.getItem("jellyfin_credentials");
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const server = obj?.Servers?.find((s) => s.AccessToken);
      return server?.AccessToken || null;
    } catch {
      return null;
    }
  }
  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() > obj.expires) return null;
      return obj.value;
    } catch {
      return null;
    }
  }
  function cacheSet(key, value) {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ value, expires: Date.now() + CACHE_TTL_MS })
      );
    } catch {}
  }
  async function fetchItem(itemId) {
    const token = getAccessToken();
    if (!token) return null;
    const res = await fetch(
      `${getBaseUrl()}/Items/${itemId}?Fields=ProviderIds`,
      { headers: { "X-Emby-Token": token } }
    );
    if (!res.ok) return null;
    return res.json();
  }
  async function fetchOmdb(imdbId) {
    const cacheKey = "omdb_full_" + imdbId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const res = await fetch(
      `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(
        OMDB_API_KEY
      )}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    cacheSet(cacheKey, data);
    return data;
  }
  function normalizeValue(v) {
    if (!v) return "";
    const s = String(v).trim();
    if (!s || s.toUpperCase() === "N/A") return "";
    return s;
  }
  function findDetailsBox() {
    return document.querySelector(".itemDetailsGroup");
  }
  function getProviderId(item, wantedKey) {
    const ids = item?.ProviderIds;
    if (!ids) return "";
    const target = String(wantedKey).toLowerCase();
    for (const k of Object.keys(ids)) {
      if (String(k).toLowerCase() === target) return String(ids[k] || "");
    }
    return "";
  }
  function uniqueOrder(order) {
    const out = [];
    const seen = new Set();
    for (const k of order || []) {
      const key = String(k).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    return out;
  }
  function normalizeRowOrderForMode(modeKey, order) {
    const base = uniqueOrder(order);
    const allowed =
      modeKey === "movie"
        ? ["country", "awards", "boxoffice"]
        : ["country", "awards"];
    return base.filter((k) => allowed.includes(k));
  }
  function buildLinkUrl(key, ids, modeKey, modeSettings) {
    if (!modeSettings.enableClickableLink) return "";
    const imdbId = ids.imdbId;
    const tmdbId = ids.tmdbId;
    if (key === "country") {
      if (!imdbId) return "";
      return `https://www.imdb.com/title/${imdbId}/locations/`;
    }
    if (key === "awards") {
      if (
        modeKey === "movie" &&
        modeSettings.awardsLinkSourceMovies === "tmdb" &&
        tmdbId
      ) {
        return `https://www.themoviedb.org/movie/${tmdbId}/awards`;
      }
      if (!imdbId) return "";
      return `https://www.imdb.com/title/${imdbId}/awards/`;
    }
    if (key === "boxoffice") {
      if (!imdbId) return "";
      return `https://www.boxofficemojo.com/title/${imdbId}`;
    }
    return "";
  }
  function applyLinkStyling(a, enabled) {
    if (!enabled) {
      a.removeAttribute("href");
      a.removeAttribute("target");
      a.removeAttribute("rel");
      a.style.pointerEvents = "none";
      a.style.color = "inherit";
      a.style.fontWeight = "600";
      a.style.cursor = "default";
      a.style.textDecoration = "none";
      return;
    }
    a.style.pointerEvents = "auto";
    a.style.fontWeight = "600";
    a.style.color = "inherit";
    a.style.textDecoration = "none";
    a.style.cursor = "pointer";
    a.style.display = "inline";
    a.style.whiteSpace = "normal";
    a.style.overflowWrap = "anywhere";
    a.style.wordBreak = "break-word";
    a.style.lineHeight = "1.2";
    a.style.padding = "0";
    a.style.margin = "0";
    if (!a.dataset.hoverUnderlineBound) {
      a.addEventListener("mouseenter", () => {
        a.style.textDecoration = "underline";
      });
      a.addEventListener("mouseleave", () => {
        a.style.textDecoration = "none";
      });
      a.dataset.hoverUnderlineBound = "true";
    }
  }
  function getOrCreateRow(box, key, labelText, href, clickable) {
    const selector = `[data-omdb-row="${key}"]`;
    let row = box.querySelector(selector);
    if (row) return row;
    row = document.createElement("div");
    row.className = "detailsGroupItem";
    row.dataset.omdbRow = key;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = labelText;
    const content = document.createElement("div");
    content.className = "content focuscontainer-x";
    const link = document.createElement("a");
    link.className = "button-link emby-button";
    if (clickable && href) {
      link.setAttribute("href", href);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    applyLinkStyling(link, clickable);
    content.appendChild(link);
    row.appendChild(label);
    row.appendChild(content);
    return row;
  }
  function upsertRow(box, key, labelText, valueText, href, clickable) {
    const value = normalizeValue(valueText);
    const existing = box.querySelector(`[data-omdb-row="${key}"]`);
    if (!value) {
      if (existing) existing.remove();
      return null;
    }
    const row = existing || getOrCreateRow(box, key, labelText, href, clickable);
    const link = row.querySelector(".content a");
    if (link) {
      link.textContent = value;
      if (clickable && href) link.setAttribute("href", href);
      else link.removeAttribute("href");
      applyLinkStyling(link, clickable);
    }
    return row;
  }
  function removeRow(box, key) {
    const row = box.querySelector(`[data-omdb-row="${key}"]`);
    if (row) row.remove();
  }
  function appendInOrder(box, rowsByKey, orderKeys) {
    for (const key of orderKeys) {
      const row = rowsByKey[key];
      if (row) box.appendChild(row);
    }
  }
  function modeFromOmdbType(type) {
    if (type === "movie") return "movie";
    if (type === "series") return "tv";
    return "";
  }
  function getModeSettings(modeKey) {
    return modeKey === "movie" ? SETTINGS.movies : SETTINGS.tvShows;
  }
  function isRowEnabled(modeKey, modeSettings, orderSet, rowKey) {
    if (!orderSet.has(rowKey)) return false;
    if (rowKey === "country") return !!modeSettings.enableCountry;
    if (rowKey === "awards") return !!modeSettings.enableAwards;
    if (rowKey === "boxoffice") return modeKey === "movie" && !!modeSettings.enableBoxOffice;
    return false;
  }
  const STATE = {
    currentItemId: "",
    currentItem: null,
    currentOmdb: null,
    currentModeKey: "",
    currentRowsSignature: "",
    currentExpectedRows: null,
    itemPromises: new Map(),
    omdbPromises: new Map(),
    runToken: 0,
    lastScanAt: 0
  };

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findDetailsBoxes() {
    return Array.from(document.querySelectorAll(".itemDetailsGroup")).filter(isVisible);
  }

  function findBestDetailsBox() {
    const boxes = findDetailsBoxes();
    if (!boxes.length) return null;
    return boxes[boxes.length - 1];
  }

  function removeAllOmdbRows(box) {
    if (!box) return;
    box.querySelectorAll('[data-omdb-row]').forEach((row) => row.remove());
  }

  function removeOmdbRowsFromAllBoxes() {
    for (const box of findDetailsBoxes()) removeAllOmdbRows(box);
  }

  async function fetchItemCachedStable(itemId) {
    if (!itemId) return null;
    const key = String(itemId);
    if (STATE.currentItemId === key && STATE.currentItem) return STATE.currentItem;
    if (STATE.itemPromises.has(key)) return STATE.itemPromises.get(key);
    const promise = fetchItem(key).finally(() => STATE.itemPromises.delete(key));
    STATE.itemPromises.set(key, promise);
    return promise;
  }

  async function fetchOmdbStable(imdbId) {
    if (!imdbId) return null;
    const key = String(imdbId);
    if (STATE.omdbPromises.has(key)) return STATE.omdbPromises.get(key);
    const promise = fetchOmdb(key).finally(() => STATE.omdbPromises.delete(key));
    STATE.omdbPromises.set(key, promise);
    return promise;
  }

  function buildExpectedRows(modeKey, modeSettings, order, omdb, ids) {
    const orderSet = new Set(order);
    const clickable = !!modeSettings.enableClickableLink;
    const rows = {};

    if (isRowEnabled(modeKey, modeSettings, orderSet, "country")) {
      const value = normalizeValue(omdb.Country);
      if (value) {
        rows.country = {
          key: "country",
          label: "Country",
          value,
          href: buildLinkUrl("country", ids, modeKey, modeSettings),
          clickable
        };
      }
    }

    if (isRowEnabled(modeKey, modeSettings, orderSet, "awards")) {
      const value = normalizeValue(omdb.Awards);
      if (value) {
        rows.awards = {
          key: "awards",
          label: "Awards",
          value,
          href: buildLinkUrl("awards", ids, modeKey, modeSettings),
          clickable
        };
      }
    }

    if (isRowEnabled(modeKey, modeSettings, orderSet, "boxoffice")) {
      const value = normalizeValue(omdb.BoxOffice);
      if (value) {
        rows.boxoffice = {
          key: "boxoffice",
          label: "Box Office",
          value,
          href: buildLinkUrl("boxoffice", ids, modeKey, modeSettings),
          clickable
        };
      }
    }

    return rows;
  }

  function makeRowsSignature(rows, order) {
    return order
      .map((key) => {
        const row = rows[key];
        if (!row) return "";
        return `${row.key}:${row.label}:${row.value}:${row.href || ""}:${row.clickable ? "1" : "0"}`;
      })
      .filter(Boolean)
      .join("|");
  }

  function hasCorrectOmdbRows(box) {
    if (!box || !STATE.currentItemId) return false;

    const rows = STATE.currentExpectedRows || {};
    const order = STATE.currentOrder || [];
    const expectedKeys = order.filter((key) => rows[key]);

    for (const key of expectedKeys) {
      const row = box.querySelector(`[data-omdb-row="${key}"]`);
      if (!row) return false;
      if (row.dataset.omdbForItemId !== String(STATE.currentItemId)) return false;
      if (row.dataset.omdbSignature !== String(STATE.currentRowsSignature)) return false;
      const link = row.querySelector(".content a");
      if (!link || normalizeValue(link.textContent) !== rows[key].value) return false;
    }

    const existing = Array.from(box.querySelectorAll('[data-omdb-row]'));
    for (const row of existing) {
      const key = row.dataset.omdbRow;
      if (!expectedKeys.includes(key)) return false;
    }

    return true;
  }

  function markOmdbRows(box) {
    if (!box) return;
    box.querySelectorAll('[data-omdb-row]').forEach((row) => {
      row.dataset.omdbForItemId = String(STATE.currentItemId || "");
      row.dataset.omdbSignature = String(STATE.currentRowsSignature || "");
    });
  }

  async function prepareStateForCurrentRoute() {
    const itemId = getItemIdFromUrl();

    if (!itemId) {
      STATE.currentItemId = "";
      STATE.currentItem = null;
      STATE.currentOmdb = null;
      STATE.currentModeKey = "";
      STATE.currentRowsSignature = "";
      STATE.currentExpectedRows = null;
      STATE.currentOrder = [];
      return false;
    }

    if (STATE.currentItemId !== itemId) {
      STATE.currentItemId = itemId;
      STATE.currentItem = null;
      STATE.currentOmdb = null;
      STATE.currentModeKey = "";
      STATE.currentRowsSignature = "";
      STATE.currentExpectedRows = null;
      STATE.currentOrder = [];
    }

    const item = await fetchItemCachedStable(itemId);
    if (STATE.currentItemId !== itemId) return false;

    if (!item) return false;
    STATE.currentItem = item;

    const imdbId = getProviderId(item, "imdb");
    if (!imdbId) {
      removeOmdbRowsFromAllBoxes();
      STATE.currentExpectedRows = {};
      STATE.currentRowsSignature = "";
      STATE.currentOrder = [];
      return false;
    }

    const tmdbId = getProviderId(item, "tmdb");
    const omdb = await fetchOmdbStable(imdbId);
    if (STATE.currentItemId !== itemId) return false;
    if (!omdb) return false;

    const modeKey = modeFromOmdbType(omdb.Type);
    if (!modeKey) {
      removeOmdbRowsFromAllBoxes();
      STATE.currentExpectedRows = {};
      STATE.currentRowsSignature = "";
      STATE.currentOrder = [];
      return false;
    }

    const modeSettings = getModeSettings(modeKey);
    const order = normalizeRowOrderForMode(modeKey, modeSettings.rowOrder);
    const ids = { imdbId, tmdbId };
    const rows = buildExpectedRows(modeKey, modeSettings, order, omdb, ids);

    STATE.currentOmdb = omdb;
    STATE.currentModeKey = modeKey;
    STATE.currentOrder = order;
    STATE.currentExpectedRows = rows;
    STATE.currentRowsSignature = makeRowsSignature(rows, order);

    return true;
  }

  function applyCurrentOmdbRowsToDom() {
    const box = findBestDetailsBox();
    if (!box) return false;

    const rows = STATE.currentExpectedRows || {};
    const order = STATE.currentOrder || [];

    if (!STATE.currentItemId) {
      removeAllOmdbRows(box);
      return false;
    }

    if (!STATE.currentRowsSignature) {
      removeAllOmdbRows(box);
      return true;
    }

    if (hasCorrectOmdbRows(box)) return true;

    for (const key of ["country", "awards", "boxoffice"]) {
      if (!rows[key]) removeRow(box, key);
    }

    const inserted = {};
    for (const key of order) {
      const row = rows[key];
      if (!row) continue;
      inserted[key] = upsertRow(box, row.key, row.label, row.value, row.href, row.clickable);
    }

    appendInOrder(box, inserted, order);
    markOmdbRows(box);
    return true;
  }

  async function scanAndReconcile() {
    const token = ++STATE.runToken;
    const ready = await prepareStateForCurrentRoute();
    if (token !== STATE.runToken) return;
    if (!ready) return;
    applyCurrentOmdbRowsToDom();
  }

  function scheduleScan(delay = 100) {
    clearTimeout(scheduleScan._t);
    scheduleScan._t = setTimeout(scanAndReconcile, delay);
  }

  function bootScanBurst() {
    scheduleScan(50);
    setTimeout(scanAndReconcile, 250);
    setTimeout(scanAndReconcile, 700);
    setTimeout(scanAndReconcile, 1500);
    setTimeout(scanAndReconcile, 3000);
    setTimeout(scanAndReconcile, 5000);
  }

  let lastRouteKey = "";

  function getRouteKey() {
    return getItemIdFromUrl() || "";
  }

  new MutationObserver(() => {
    const routeKey = getRouteKey();

    if (routeKey !== lastRouteKey) {
      lastRouteKey = routeKey;
      bootScanBurst();
      return;
    }

    const now = Date.now();
    if (now - STATE.lastScanAt > 250) {
      STATE.lastScanAt = now;
      scheduleScan(150);
    }
  }).observe(document.body, {
    childList: true,
    subtree: true
  });

  setInterval(() => {
    const routeKey = getRouteKey();

    if (routeKey !== lastRouteKey) {
      lastRouteKey = routeKey;
      bootScanBurst();
      return;
    }

    if (!applyCurrentOmdbRowsToDom()) {
      scanAndReconcile();
    }
  }, 750);

  window.addEventListener("hashchange", bootScanBurst);
  window.addEventListener("popstate", bootScanBurst);

  lastRouteKey = getRouteKey();
  bootScanBurst();
})();
