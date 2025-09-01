js
/* ------------------------------------------------------------------ */
/*  DarkFlix – SPA (router, fetch, cache, UI, watch‑time, preferiti) */
/* ------------------------------------------------------------------ */

import { TMDB_API_KEY, TMDB_BASE_URL, TMDB_IMG_BASE, TMDB_IMG_ORIGINAL, CACHE_TTL } from "./config.js";
import { Player } from "./player.js";

/* ------------ HELPERS DOM ------------ */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

/* ------------ LOCAL STORAGE ------------ */
const LS_FAV = "darkflix_fav";
const LS_PROGRESS = "darkflix_progress";

function getFavorites() { return JSON.parse(localStorage.getItem(LS_FAV) || "[]"); }
function toggleFav(id) {
  const fav = getFavorites();
  const idx = fav.indexOf(id);
  idx === -1 ? fav.push(id) : fav.splice(idx, 1);
  localStorage.setItem(LS_FAV, JSON.stringify(fav));
}
function isFav(id) { return getFavorites().includes(id); }

function saveProgress(id, secs) {
  const prog = JSON.parse(localStorage.getItem(LS_PROGRESS) || "{}");
  prog[id] = secs;
  localStorage.setItem(LS_PROGRESS, JSON.stringify(prog));
}
function getProgress(id) { return (JSON.parse(localStorage.getItem(LS_PROGRESS) || "{}"))[id] || 0; }

/* ------------ CACHE (localStorage) ------------ */
function getCache(key) {
  const raw = localStorage.getItem("tmdb_" + key);
  if (!raw) return null;
  const { ts, data } = JSON.parse(raw);
  if (Date.now() - ts > CACHE_TTL) return null;
  return data;
}
function setCache(key, data) {
  localStorage.setItem("tmdb_" + key, JSON.stringify({ ts: Date.now(), data }));
}

/* ------------ TMDB GET (con cache) ------------ */
async function tmdbGet(path, params = {}) {
  const url = new URL(TMDB_BASE_URL + path);
  url.searchParams.set("api_key", TMDB_API_KEY);
  url.searchParams.set("language", "it-IT");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const cacheKey = url.pathname + "?" + url.searchParams.toString();
  const cached = getCache(cacheKey);
  if (cached) return cached;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TMDB error ${resp.status} ${url}`);
  const data = await resp.json();
  setCache(cacheKey, data);
  return data;
}

/* ------------ DATA LOADING ------------ */
async function loadMovies() {
  const list = await fetch("assets/data/filmids.json").then(r => r.json()); // [{tmdb_id:…}]
  return list.map(item => ({ type: "movie", tmdbId: item.tmdb_id }));
}
async function loadSeriesEpisodes() {
  const episodes = await fetch("assets/data/serietv.json").then(r => r.json()); // [{tmdb_id,s,e}]
  // raggruppiamo per serie (tmdb_id)
  const map = {};
  episodes.forEach(ep => {
    const key = ep.tmdb_id;
    if (!map[key]) map[key] = [];
    map[key].push({ season: ep.s, episode: ep.e });
  });
  // ritorniamo una lista di serie (senza duplicati) + le info di episodi
  return Object.entries(map).map(([tmdbId, eps]) => ({
    type: "series",
    tmdbId: Number(tmdbId),
    episodes: eps
  }));
}

/* ------------ CATALOG (movies + series) ------------ */
async function loadCatalog() {
  const movies = await loadMovies();               // array di oggetti {type:"movie", tmdbId}
  const series = await loadSeriesEpisodes();       // array di oggetti {type:"series", tmdbId, episodes}
  return [...movies, ...series];
}

/* ------------ CARD MARKUP (home / archive) ------------ */
function cardFromTvData(item, tvData) {
  const title = item.type === "movie" ? tvData.title : tvData.name;
  const posterPath = tvData.poster_path;
  const posterUrl = posterPath ? TMDB_IMG_BASE + posterPath : "https://via.placeholder.com/300x450?text=No+Poster";
  const slug = title.toLowerCase().replace(/\s+/g, "-");
  const url = `/titles/${tvData.id}-${slug}`;
  return `
    <a href="${url}" class="card" data-id="${tvData.id}">
      <img src="${posterUrl}" alt="${title}">
      <div class="info"><h3>${title}</h3></div>
    </a>`;
}

/* ------------ RENDER: HOME ------------ */
async function renderHome() {
  const catalog = await loadCatalog();

  // 1️⃣ CONTINUA A GUARDARE
  renderContinueSection();

  // 2️⃣ PREFERITI
  renderFavoritesSection();

  // 3️⃣ TUTTI I TITOLI
  const grid = $("#titles-grid");
  const cards = await Promise.all(
    catalog.map(async it => {
      const data = it.type === "movie"
        ? await tmdbGet(`/movie/${it.tmdbId}`)
        : await tmdbGet(`/tv/${it.tmdbId}`);
      return cardFromTvData(it, data);
    })
  );
  grid.innerHTML = cards.join("");
}

/* ------------ CONTINUE SECTION ------------ */
function renderContinueSection() {
  const container = $("#continue-grid");
  const prog = JSON.parse(localStorage.getItem(LS_PROGRESS) || "{}");
  const entries = Object.entries(prog).filter(([, sec]) => sec > 0);
  if (!entries.length) {
    container.innerHTML = `<p style="color:#777;">Nessun video in riproduzione.</p>`;
    return;
  }

  // Per ciascun id recuperiamo i dati TMDB (film o serie)
  const promises = entries.map(async ([id, sec]) => {
    // proviamo prima come film, se fallisce proviamo serie
    let data;
    try {
      data = await tmdbGet(`/movie/${id}`);
    } catch (e) {
      data = await tmdbGet(`/tv/${id}`);
    }
    return { data, sec };
  });

  Promise.all(promises).then(results => {
    const html = results.map(({ data, sec }) => {
      const title = data.title || data.name;
      const poster = data.poster_path ? TMDB_IMG_BASE + data.poster_path : "https://via.placeholder.com/300x450?text=No+Poster";
      const slug = title.toLowerCase().replace(/\s+/g, "-");
      const url = `/titles/${data.id}-${slug}`;
      return `
        <a href="${url}" class="card">
          <img src="${poster}" alt="${title}">
          <div class="info"><h3>${title}</h3><small>Riprendi da ${fmtTime(sec)}</small></div>
        </a>`;
    }).join("");
    container.innerHTML = html;
  });
}

/* ------------ FAVORITES SECTION ------------ */
async function renderFavoritesSection() {
  const container = $("#favorites-grid");
  const favIds = getFavorites();
  if (!favIds.length) {
    container.innerHTML = `<p style="color:#777;">Nessun preferito aggiunto.</p>`;
    return;
  }

  const cards = await Promise.all(
    favIds.map(async id => {
      let data;
      try {
        data = await tmdbGet(`/movie/${id}`);
      } catch (e) {
        data = await tmdbGet(`/tv/${id}`);
      }
      const title = data.title || data.name;
      const poster = data.poster_path ? TMDB_IMG_BASE + data.poster_path : "https://via.placeholder.com/300x450?text=No+Poster";
      const slug = title.toLowerCase().replace(/\s+/g, "-");
      const url = `/titles/${data.id}-${slug}`;
      return `
        <a href="${url}" class="card">
          <img src="${poster}" alt="${title}">
          <div class="info"><h3>${title}</h3></div>
        </a>`;
    })
  );
  container.innerHTML = cards.join("");
}

/* ------------ HELPERS ------------ */
function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

/* ------------ RENDER: ARCHIVE (movie / series) ------------ */
async function renderArchive(type) {
  const catalog = await loadCatalog();
  const filtered = catalog.filter(it => it.type === type);
  const title = type === "movie" ? "Film" : "Serie TV";
  $("#archive-title").textContent = title;

  const cards = await Promise.all(
    filtered.map(async it => {
      const data = it.type === "movie"
        ? await tmdbGet(`/movie/${it.tmdbId}`)
        : await tmdbGet(`/tv/${it.tmdbId}`);
      return cardFromTvData(it, data);
    })
  );
  $("#archive-grid").innerHTML = cards.join("");
}

/* ------------ RENDER: SINGLE TITLE PAGE ------------ */
async function renderTitlePage(path) {
  const match = path.match(/^\/titles\/(\d+)-?.*/);
  if (!match) return renderNotFound();
  const tmdbId = Number(match[1]);

  // Determiniamo se è un film o una serie
  let isSeries = false;
  let tvData;
  try {
    tvData = await tmdbGet(`/movie/${tmdbId}`);
  } catch (e) {
    tvData = await tmdbGet(`/tv/${tmdbId}`);
    isSeries = true;
  }

  // Carichiamo il layout della pagina titolo
  const tmpl = await fetch("title.html").then(r => r.text());
  $("main").innerHTML = tmpl;

  // POPOLAMENTO METADATI
  const posterUrl = tvData.poster_path ? TMDB_IMG_ORIGINAL + tvData.poster_path : "https://via.placeholder.com/500x750?text=No+Poster";
  $("#poster").src = posterUrl;
  $("#title").textContent = tvData.title || tvData.name;
  $("#description").textContent = tvData.overview || "Nessuna descrizione disponibile.";

  // PULSANTI FAVORITI / CONTINUA
  const favBtn = $("#btn-fav");
  const updateFav = () => favBtn.textContent = isFav(tmdbId) ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti";
  updateFav();
  favBtn.onclick = () => { toggleFav(tmdbId); updateFav(); };

  $("#btn-continue").onclick = () => {
    const pos = getProgress(tmdbId);
    player.seek(pos);
    player.play();
  };

  // PLAYER (placeholder video per ora)
  const player = new Player("#video-player", { autoplay: false, muted: false });

  // SEZIONE SERIE (se applicable)
  if (isSeries) {
    $("#episode-section").style.display = "block";

    // Carichiamo gli episodi dal serietv.json
    const episodesList = await fetch("assets/data/serietv.json").then(r => r.json());
    const epsForShow = episodesList.filter(e => e.tmdb_id === tmdbId);
    if (!epsForShow.length) {
      // non ci sono episodi di test → mostriamo solo la frase
      $("#episode-section").innerHTML = `<p style="color:#777;">Nessun episodio di test disponibile.</p>`;
    } else {
      // raggruppiamo per stagione
      const seasonsMap = {};
      epsForShow.forEach(e => {
        if (!seasonsMap[e.s]) seasonsMap[e.s] = [];
        seasonsMap[e.s].push(e);
      });
      const seasons = Object.keys(seasonsMap).sort((a, b) => a - b);

      // POPOLIAMO SELECT STAGIONE
      const seasonSel = $("#season-select");
      seasons.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = `Stagione ${s}`;
        seasonSel.appendChild(opt);
      });

      const episodeSel = $("#episode-select");

      const loadEpisodes = async seasonNumber => {
        episodeSel.innerHTML = "";
        const eps = seasonsMap[seasonNumber];
        // Ordiniamo per numero episodio
        eps.sort((a, b) => a.e - b.e);
        for (const ep of eps) {
          // Recuperiamo le info dell'episodio da TMDB (nome, still)
          const epData = await tmdbGet(`/tv/${tmdbId}/season/${seasonNumber}/episode/${ep.e}`);
          const opt = document.createElement("option");
          opt.value = `${seasonNumber}-${ep.e}`;
          // usiamo il titolo dell'episodio in TMDB se presente
          const epTitle = epData.name || `Episodio ${ep.e}`;
          opt.textContent = `Episodio ${ep.e}: ${epTitle}`;
          // video placeholder (puoi sostituirlo con il reale file)
          opt.dataset.video = "https://sample-videos.com/video123/mp4/720/big_buck_bunny_720p_1mb.mp4";
          episodeSel.appendChild(opt);
        }
        // Carica il primo episodio di default
        if (episodeSel.options.length) episodeSel.dispatchEvent(new Event("change"));
      };

      // Event listeners
      seasonSel.onchange = () => loadEpisodes(seasonSel.value);
      episodeSel.onchange = () => {
        const url = episodeSel.selectedOptions[0].dataset.video;
        player.load(url);
      };

      // Inizializza con la prima stagione
      if (seasons.length) {
        seasonSel.value = seasons[0];
        loadEpisodes(seasons[0]);
      }
    }
  }

  // Salvataggio del watch‑time (ogni 5 sec è gestito dal Player)
  player.onTimeUpdate = seconds => saveProgress(tmdbId, seconds);
}

/* ------------ NOT FOUND ------------ */
function renderNotFound() {
  $("main").innerHTML = `<h2 style="text-align:center;margin-top:2rem;">Pagina non trovata</h2>`;
}

/* ------------ ROUTER ------------ */
function setActive(linkPath) {
  $$("nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === linkPath));
}
function router() {
  const path = window.location.pathname;

  if (path === "/" || path === "/index.html") {
    setActive("/");
    document.title = "DarkFlix – Home";
    renderHome();
    return;
  }

  if (path === "/movies") {
    setActive("/movies");
    document.title = "DarkFlix – Film";
    fetch("archive.html").then(r => r.text()).then(html => {
      $("main").innerHTML = html;
      renderArchive("movie");
    });
    return;
  }

  if (path === "/series") {
    setActive("/series");
    document.title = "DarkFlix – Serie TV";
    fetch("archive.html").then(r => r.text()).then(html => {
      $("main").innerHTML = html;
      renderArchive("series");
    });
    return;
  }

  if (path.startsWith("/titles/")) {
    setActive(null);
    renderTitlePage(path);
    return;
  }

  renderNotFound();
}

/* ------------ INIZIALIZZAZIONE ------------ */
window.addEventListener("popstate", router);
document.addEventListener("DOMContentLoaded", () => {
  // SPA navigation – intercetta tutti i click su <a> interne
  document.body.addEventListener("click", e => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.origin === location.origin) {
      e.preventDefault();
      history.pushState(null, "", a.href);
      router();
    }
  });
  router();   // avvia la prima pagina
});