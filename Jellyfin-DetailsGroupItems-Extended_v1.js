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
  async function run() {
    const itemId = getItemIdFromUrl();
    if (!itemId) return;
    for (let i = 0; i < 40; i++) {
      if (findDetailsBox()) break;
      await sleep(150);
    }
    const box = findDetailsBox();
    if (!box) return;
    const item = await fetchItem(itemId);
    const imdbId = getProviderId(item, "imdb");
    if (!imdbId) return;
    const tmdbId = getProviderId(item, "tmdb");
    const omdb = await fetchOmdb(imdbId);
    if (!omdb) return;
    const modeKey = modeFromOmdbType(omdb.Type);
    if (!modeKey) return;
    const modeSettings = getModeSettings(modeKey);
    const order = normalizeRowOrderForMode(modeKey, modeSettings.rowOrder);
    const orderSet = new Set(order);
    const ids = { imdbId, tmdbId };
    const rows = {};
    const clickable = !!modeSettings.enableClickableLink;

    if (isRowEnabled(modeKey, modeSettings, orderSet, "country")) {
      rows.country = upsertRow(
        box,
        "country",
        "Country",
        omdb.Country,
        buildLinkUrl("country", ids, modeKey, modeSettings),
        clickable
      );
    } else {
      removeRow(box, "country");
    }
    if (isRowEnabled(modeKey, modeSettings, orderSet, "awards")) {
      rows.awards = upsertRow(
        box,
        "awards",
        "Awards",
        omdb.Awards,
        buildLinkUrl("awards", ids, modeKey, modeSettings),
        clickable
      );
    } else {
      removeRow(box, "awards");
    }
    if (isRowEnabled(modeKey, modeSettings, orderSet, "boxoffice")) {
      rows.boxoffice = upsertRow(
        box,
        "boxoffice",
        "Box Office",
        omdb.BoxOffice,
        buildLinkUrl("boxoffice", ids, modeKey, modeSettings),
        clickable
      );
    } else {
      removeRow(box, "boxoffice");
    }
    appendInOrder(box, rows, order);
  }
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(run, 300);
    }
  }).observe(document.body, { childList: true, subtree: true });
  run();
})();