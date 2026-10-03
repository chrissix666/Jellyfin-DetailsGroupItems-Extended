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
    },
  // ROW LABELS (shown in front of the values; e.g. German: "Land", "Auszeichnungen", "Einspielergebnis")
    labels: {
      country: "Country",
      awards: "Awards",
      boxoffice: "Box Office"
    }
  };
  const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
  // A failed OMDb answer (no/invalid key, daily limit, network) is not asked
  // again for this long; a failed Jellyfin item request for FAIL_ITEM_MS.
  const FAIL_OMDB_MS = 1000 * 60 * 10;
  const FAIL_ITEM_MS = 1000 * 30;
  // Server address of the running web client, incl. a base URL such as
  // "/jellyfin" (window.ApiClient: 10.10.x components/ServerConnections.js:88,
  // 12.x lib/jellyfin-apiclient/ServerConnections.js:95). Same as the page
  // origin on a server without a base URL.
  function getBaseUrl() {
    try {
      const api = window.ApiClient;
      const addr = api && typeof api.serverAddress === "function" && api.serverAddress();
      if (addr) return String(addr).replace(/\/+$/, "");
    } catch (e) { /* ignore */ }
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
  // Token of the server this page is connected to: ApiClient first; the saved
  // credentials only as a fallback (there: the current server's entry, else
  // the first one with a token, as before).
  function getAccessToken() {
    try {
      const api = window.ApiClient;
      const t = api && typeof api.accessToken === "function" && api.accessToken();
      if (t) return t;
    } catch (e) { /* ignore */ }
    try {
      const raw = localStorage.getItem("jellyfin_credentials");
      if (!raw) return null;
      const obj = JSON.parse(raw);
      const servers = (obj && obj.Servers) || [];
      let serverId = "";
      try {
        const api = window.ApiClient;
        serverId = (api && typeof api.serverId === "function" && api.serverId()) || "";
      } catch (e) { /* ignore */ }
      const server =
        (serverId && servers.find((s) => s.Id === serverId && s.AccessToken)) ||
        servers.find((s) => s.AccessToken);
      return (server && server.AccessToken) || null;
    } catch (e) {
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
    } catch (e) {
      return null;
    }
  }
  function cacheSet(key, value) {
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ value, expires: Date.now() + CACHE_TTL_MS })
      );
    } catch (e) { /* ignore */ }
  }
  async function fetchItem(itemId) {
    const token = getAccessToken();
    if (!token) return null;
    const res = await fetch(
      `${getBaseUrl()}/Items/${itemId}?Fields=ProviderIds`,
      // Authorization header: Jellyfin 12.x ignores X-Emby-Token unless legacy
      // authorization is switched on; this form works in 10.10.x and 12.x.
      { headers: { Authorization: `MediaBrowser Token="${token}"` } }
    );
    if (!res.ok) return null;
    return res.json();
  }
  // Failed OMDb lookups per IMDb id (time of the failure). Without this every
  // DOM change on the page started a new request for as long as it was open.
  const omdbFailedAt = new Map();
  let warnedNoKey = false;
  async function fetchOmdb(imdbId) {
    const cacheKey = "omdb_full_" + imdbId;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    if (!OMDB_API_KEY) {
      if (!warnedNoKey) {
        warnedNoKey = true;
        console.warn("[DetailsGroupItems-Extended] OMDB_API_KEY is empty - no OMDb rows.");
      }
      return null;
    }
    const failedAt = omdbFailedAt.get(imdbId);
    if (failedAt && Date.now() - failedAt < FAIL_OMDB_MS) return null;
    try {
      const res = await fetch(
        `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(
          OMDB_API_KEY
        )}`
      );
      if (!res.ok) {
        omdbFailedAt.set(imdbId, Date.now());
        return null;
      }
      const data = await res.json();
      omdbFailedAt.delete(imdbId);
      cacheSet(cacheKey, data);
      return data;
    } catch (e) {
      omdbFailedAt.set(imdbId, Date.now());
      return null;
    }
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
    const ids = item && item.ProviderIds;
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
  // Text metrics of Jellyfin's own row labels in this box: a plain div in
  // 10.10.x (same values as ours, so nothing changes there), an MUI
  // Typography <p> in 12.x (body1: own font size, line height 1.5, letter
  // spacing 0.00938em; components/itemDetails/ItemDetailsMetadataList.tsx:30).
  // Without the line height our rows sat 2px lower than the native ones; the
  // other values keep the label text itself identical (E-A7).
  const LABEL_METRICS = ["lineHeight", "fontSize", "letterSpacing", "fontWeight", "fontFamily"];
  function matchNativeLabel(box, label) {
    const native = box && box.querySelector(
      ".detailsGroupItem:not([data-omdb-row]):not([data-collection-row]) .label"
    );
    if (!native) return;
    const cs = getComputedStyle(native);
    LABEL_METRICS.forEach((prop) => {
      if (cs[prop]) label.style[prop] = cs[prop];
    });
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
    matchNativeLabel(box, label);
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

  // Recently shown items (5 min, at most 20), so going back to a page puts
  // its rows back without a server round trip; failures wait FAIL_ITEM_MS.
  const ITEM_CACHE_MS = 1000 * 60 * 5;
  const itemCache = new Map();
  const itemFailedAt = new Map();

  async function fetchItemCachedStable(itemId) {
    if (!itemId) return null;
    const key = String(itemId);
    if (STATE.currentItemId === key && STATE.currentItem) return STATE.currentItem;
    const hit = itemCache.get(key);
    if (hit && Date.now() - hit.t < ITEM_CACHE_MS) return hit.item;
    const failedAt = itemFailedAt.get(key);
    if (failedAt && Date.now() - failedAt < FAIL_ITEM_MS) return null;
    if (STATE.itemPromises.has(key)) return STATE.itemPromises.get(key);
    const promise = fetchItem(key)
      .catch(() => null)
      .then((item) => {
        if (item) {
          itemFailedAt.delete(key);
          itemCache.delete(key);
          itemCache.set(key, { t: Date.now(), item });
          if (itemCache.size > 20) itemCache.delete(itemCache.keys().next().value);
        } else if (getAccessToken()) {
          // (no token yet = not logged in: try again with the next scan)
          itemFailedAt.set(key, Date.now());
        }
        return item;
      })
      .finally(() => STATE.itemPromises.delete(key));
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

  // Jellyfin renders no external links in the TV layout (itemDetails/index.js
  // 10.10.x:1085, 12.x:1037: !layoutManager.tv); our rows show plain text there.
  function isTvLayout() {
    return document.documentElement.classList.contains("layout-tv");
  }

  function getLabel(key, fallback) {
    const labels = SETTINGS.labels || {};
    return normalizeValue(labels[key]) || fallback;
  }

  function buildExpectedRows(modeKey, modeSettings, order, omdb, ids) {
    const orderSet = new Set(order);
    const clickable = !!modeSettings.enableClickableLink && !isTvLayout();
    const rows = {};

    if (isRowEnabled(modeKey, modeSettings, orderSet, "country")) {
      const value = normalizeValue(omdb.Country);
      if (value) {
        rows.country = {
          key: "country",
          label: getLabel("country", "Country"),
          value,
          href: clickable ? buildLinkUrl("country", ids, modeKey, modeSettings) : "",
          clickable
        };
      }
    }

    if (isRowEnabled(modeKey, modeSettings, orderSet, "awards")) {
      const value = normalizeValue(omdb.Awards);
      if (value) {
        rows.awards = {
          key: "awards",
          label: getLabel("awards", "Awards"),
          value,
          href: clickable ? buildLinkUrl("awards", ids, modeKey, modeSettings) : "",
          clickable
        };
      }
    }

    if (isRowEnabled(modeKey, modeSettings, orderSet, "boxoffice")) {
      const value = normalizeValue(omdb.BoxOffice);
      if (value) {
        rows.boxoffice = {
          key: "boxoffice",
          label: getLabel("boxoffice", "Box Office"),
          value,
          href: clickable ? buildLinkUrl("boxoffice", ids, modeKey, modeSettings) : "",
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

    // Only title ids can give rows: a Person (IMDb "nm" id) and an Episode
    // (OMDb Type "episode") never do, so they cost no OMDb quota.
    let imdbId = getProviderId(item, "imdb");
    if (!/^tt\d+$/i.test(imdbId) || item.Type === "Episode" || item.Type === "Season") imdbId = "";
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
    // The state may still belong to the previous page (any detail -> detail
    // navigation): never paint it into the new one; the caller rescans.
    if ((getItemIdFromUrl() || "") !== STATE.currentItemId) return false;
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
    try {
      const token = ++STATE.runToken;
      const ready = await prepareStateForCurrentRoute();
      if (token !== STATE.runToken) return;
      if (!ready) return;
      applyCurrentOmdbRowsToDom();
    } catch (e) {
      console.warn("[DetailsGroupItems-Extended]", e);
    }
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

  // 12.1 empties .itemDetailsGroup on every render of the page and React fills
  // it again a moment later (apps/legacy/controllers/itemDetails/index.js
  // 1001-1022); the throttled scan below then brought our rows back up to
  // 750 ms later (flicker, E-A7). When a mutation removes one of our rows, the
  // rows are re-applied inside the observer itself (before the next paint) for
  // ROW_LOST_WINDOW_MS after the loss, at most ROW_LOST_MAX_APPLIES times (our
  // own moves also remove nodes; the cap keeps that from looping before a
  // paint). The throttled scan and the interval stay as the fallback.
  // 10.10.7 does not re-render the box (static rows); there this path only
  // re-checks what is already in place (same result, found earlier).
  const ROW_LOST_WINDOW_MS = 2000;
  const ROW_LOST_MAX_APPLIES = 10;
  let rowLostAt = 0;
  let rowLostApplies = 0;
  function removedOwnRow(records) {
    for (const rec of records) {
      for (const n of rec.removedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches("[data-omdb-row]") || n.querySelector("[data-omdb-row]")) return true;
      }
    }
    return false;
  }

  new MutationObserver((records) => {
    const routeKey = getRouteKey();

    if (routeKey !== lastRouteKey) {
      lastRouteKey = routeKey;
      bootScanBurst();
      return;
    }

    const lostNow = Date.now();
    if (removedOwnRow(records) && lostNow - rowLostAt >= ROW_LOST_WINDOW_MS) {
      rowLostAt = lostNow;
      rowLostApplies = 0;
    }
    if (lostNow - rowLostAt < ROW_LOST_WINDOW_MS && rowLostApplies < ROW_LOST_MAX_APPLIES) {
      rowLostApplies++;
      try {
        applyCurrentOmdbRowsToDom();
      } catch (e) {
        console.warn("[DetailsGroupItems-Extended]", e);
      }
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
