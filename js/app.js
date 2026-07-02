/* Seoul Dex — app logic (vanilla JS, no build step). */
(function () {
  "use strict";

  var PLACES = window.SEOUL_PLACES || [];
  var HOME = window.SEOUL_HOME;

  // ---- Category metadata ----
  // The first six are a place's PRIMARY category (drives its card color).
  // "photo" and "street" are cross-cutting tags: a place opts in via p.tags,
  // and they appear as extra filter chips.
  var CATS = {
    sight:     { label: "Sights",   color: "#e8542c" },
    food:      { label: "Food",     color: "#f0a020" },
    culture:   { label: "Culture",  color: "#7b5cd6" },
    nature:    { label: "Nature",   color: "#2fa46a" },
    shopping:  { label: "Shopping", color: "#d94f9c" },
    nightlife: { label: "Nightlife",color: "#3a6ea5" },
    photo:     { label: "Photo Spots", color: "#ff477e", tag: true },
    street:    { label: "Street Food", color: "#ef7b2b", tag: true }
  };
  var CHIP_EMOJI = { all: "✨", sight: "🏯", food: "🍜", culture: "🎨", nature: "🌳",
    shopping: "🛍️", nightlife: "🍺", photo: "📸", street: "🌭" };
  // membership: a place belongs to a filter if it's its primary cat OR carries the tag
  function inCat(p, cat) { return cat === "all" || p.cat === cat || (p.tags && p.tags.indexOf(cat) !== -1); }

  // ---- Persistent visited state ----
  var STORE_KEY = "seoulDex.visited.v1";
  var visited = loadVisited();
  function loadVisited() {
    try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveVisited() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify([].concat(Array.from(visited)))); } catch (e) {}
  }

  // ---- Small helpers ----
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function pad3(n) { return ("00" + n).slice(-3); }
  function catColor(c) { return (CATS[c] || {}).color || "#888"; }
  function faceStyle(c) { var col = catColor(c); return "background:linear-gradient(150deg," + col + "," + shade(col, -18) + ")"; }
  function shade(hex, pct) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v + (v * pct) / 100))); };
    return "#" + (0x1000000 + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }
  function haversine(a, b, c, d) {
    var R = 6371, dLat = (c - a) * Math.PI / 180, dLng = (d - b) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmtDist(km) { return km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km"; }

  // index for quick lookup
  var BY_ID = {}; PLACES.forEach(function (p, i) { p._num = i + 1; BY_ID[p.id] = p; });

  // ================= Clock =================
  function tickClock() {
    var now = new Date();
    var t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(now);
    var d = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", day: "numeric", month: "short" }).format(now);
    $("#clock").textContent = "Seoul · " + t + " · " + d;
  }

  // ================= Weather =================
  var WMO = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"],
    51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Drizzle"],
    61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"],
    85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"],
    95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm"], 99: ["⛈️", "Thunderstorm"]
  };
  function wx(code) { return WMO[code] || ["⛅", "—"]; }

  function loadHeaderWeather() {
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem("seoulDex.wx") || "null"); } catch (e) {}
    if (cached) setHeaderWeather(cached.emoji, cached.temp);
    fetchWeather(37.5665, 126.9780).then(function (w) {
      if (!w) return;
      setHeaderWeather(w.emoji, w.temp);
      try { localStorage.setItem("seoulDex.wx", JSON.stringify({ emoji: w.emoji, temp: w.temp })); } catch (e) {}
    });
  }
  function setHeaderWeather(emoji, temp) {
    $("#weatherIcon").textContent = emoji;
    $("#weatherTemp").textContent = (temp == null ? "--" : Math.round(temp)) + "°";
  }
  function fetchWeather(lat, lng) {
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lng +
              "&current=temperature_2m,weather_code&timezone=Asia%2FSeoul";
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var c = j && j.current; if (!c) return null;
      var w = wx(c.weather_code);
      return { temp: c.temperature_2m, emoji: w[0], text: w[1] };
    }).catch(function () { return null; });
  }

  // ================= Dex grid =================
  var state = { cat: "all", q: "" };

  function buildChips() {
    var wrap = $("#chips");
    var chips = [["all", "All"]].concat(Object.keys(CATS).map(function (k) { return [k, CATS[k].label]; }));
    chips.forEach(function (c) {
      var emoji = CHIP_EMOJI[c[0]] ? CHIP_EMOJI[c[0]] + " " : "";
      var b = el("button", "chip" + (c[0] === "all" ? " is-active" : ""), emoji + esc(c[1]));
      b.dataset.cat = c[0];
      b.addEventListener("click", function () {
        state.cat = c[0];
        $$(".chip", wrap).forEach(function (x) { x.classList.toggle("is-active", x === b); });
        renderGrid();
      });
      wrap.appendChild(b);
    });
  }

  function matches(p) {
    if (!inCat(p, state.cat)) return false;
    if (state.q) {
      var tagStr = (p.tags || []).map(function (t) { return (CATS[t] || {}).label || t; }).join(" ");
      var hay = (p.n + " " + p.kr + " " + p.area + " " + CATS[p.cat].label + " " + tagStr + " " + (p.blurb || "")).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function renderGrid() {
    var grid = $("#grid"); grid.innerHTML = "";
    var list = PLACES.filter(matches);
    $("#dexEmpty").hidden = list.length !== 0;
    list.forEach(function (p) {
      var card = el("button", "card" + (visited.has(p.id) ? " visited" : ""));
      card.style.setProperty("--face", "transparent");
      card.innerHTML =
        '<div class="card-face" style="' + faceStyle(p.cat) + '">' +
          '<span class="card-num">#' + pad3(p._num) + '</span>' +
          '<span class="rarity-dot rarity-' + (p.rarity || "common") + '"></span>' +
          '<span class="card-emoji">' + p.emoji + '</span>' +
          '<span class="visited-stamp"><span>SEEN</span></span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-name">' + esc(p.n) + ' ' + tagBadges(p) + '</div>' +
          '<div class="card-meta"><span class="cat-tag" style="color:' + catColor(p.cat) + '">' +
            esc(CATS[p.cat].label) + '</span> · ' + esc(p.area) + '</div>' +
        '</div>';
      card.addEventListener("click", function () { openDetail(p.id); });
      grid.appendChild(card);
    });
    updateProgress();
  }

  function tagBadges(p) {
    if (!p.tags || !p.tags.length) return "";
    return p.tags.map(function (t) { return CHIP_EMOJI[t] || ""; }).join("");
  }

  function updateProgress() {
    var total = PLACES.length, seen = 0;
    PLACES.forEach(function (p) { if (visited.has(p.id)) seen++; });
    var pct = total ? Math.round((seen / total) * 100) : 0;
    $("#progressFill").style.width = pct + "%";
    $("#progressLabel").textContent = seen + " / " + total + " discovered";
  }

  // ================= Detail sheet =================
  var detailMap = null;
  function openDetail(id) {
    var p = BY_ID[id]; if (!p) return;
    var distFromHome = HOME ? haversine(HOME.lat, HOME.lng, p.lat, p.lng) : null;
    var body = $("#detailBody");
    var isSeen = visited.has(id);
    body.innerHTML =
      '<div class="detail-hero" style="' + faceStyle(p.cat) + '">' + p.emoji + '</div>' +
      '<div class="detail-inner">' +
        '<div class="detail-title">' + esc(p.n) + '<span class="detail-kr">' + esc(p.kr) + '</span></div>' +
        '<div class="detail-tags">' +
          '<span class="pill" style="color:' + catColor(p.cat) + '">#' + pad3(p._num) + ' · ' + esc(CATS[p.cat].label) + '</span>' +
          (p.tags || []).map(function (t) { return '<span class="pill" style="color:' + catColor(t) + '">' + (CHIP_EMOJI[t] || "") + ' ' + esc((CATS[t] || {}).label || t) + '</span>'; }).join("") +
          '<span class="pill">' + rarityLabel(p.rarity) + '</span>' +
          '<span class="pill">📍 ' + esc(p.area) + '</span>' +
          (distFromHome != null ? '<span class="pill">🏨 ' + fmtDist(distFromHome) + ' from hotel</span>' : '') +
        '</div>' +
        '<div class="detail-blurb">' + esc(p.blurb) + '</div>' +
        '<div class="pill" style="display:inline-block">🚇 ' + esc(p.subway) + '</div>' +
        '<div class="wx-line" id="detailWx">⛅ Checking weather here…</div>' +
        '<div id="detailMap"></div>' +
        (p.tip ? '<div class="detail-tip"><b>💡 Tip</b>' + esc(p.tip) + '</div>' : '') +
        '<div class="detail-actions">' +
          '<button class="btn visit-toggle full ' + (isSeen ? "on" : "") + '" id="visitBtn">' +
            (isSeen ? "✓ Marked as visited" : "◎ Mark as visited") + '</button>' +
          '<a class="btn btn-primary full" target="_blank" rel="noopener" href="' + appleDir(p) + '">🧭 Directions from hotel (Apple Maps)</a>' +
          '<a class="btn" target="_blank" rel="noopener" href="' + kakaoDir(p) + '">🗺️ KakaoMap</a>' +
          '<a class="btn" target="_blank" rel="noopener" href="' + naverSearch(p) + '">🟢 Naver Map</a>' +
        '</div>' +
      '</div>';

    $("#visitBtn").addEventListener("click", function () {
      if (visited.has(id)) { visited.delete(id); } else { visited.add(id); flash(); }
      saveVisited();
      var on = visited.has(id);
      this.classList.toggle("on", on);
      this.textContent = on ? "✓ Marked as visited" : "◎ Mark as visited";
      renderGrid(); renderNearby(); refreshMarkers();
    });

    var sheet = $("#detail"); sheet.hidden = false;
    document.body.style.overflow = "hidden";

    // mini map
    if (window.L) {
      setTimeout(function () {
        if (detailMap) { detailMap.remove(); detailMap = null; }
        detailMap = L.map("detailMap", { attributionControl: false, zoomControl: false }).setView([p.lat, p.lng], 15);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(detailMap);
        L.marker([p.lat, p.lng], { icon: pinIcon(p, false) }).addTo(detailMap);
        detailMap.invalidateSize();
      }, 60);
    }

    // per-place weather
    fetchWeather(p.lat, p.lng).then(function (w) {
      if (!w) { $("#detailWx") && ($("#detailWx").textContent = "Weather unavailable offline"); return; }
      var e = $("#detailWx"); if (e) e.innerHTML = w.emoji + " " + Math.round(w.temp) + "°C · " + esc(w.text) + " right now";
    });
  }
  function rarityLabel(r) { return r === "legendary" ? "⭐ Legendary" : r === "rare" ? "🔹 Rare" : "⚪ Common"; }
  function closeDetail() {
    $("#detail").hidden = true; document.body.style.overflow = "";
    if (detailMap) { detailMap.remove(); detailMap = null; }
  }
  function flash() {
    // tiny celebratory pulse on the progress bar
    var f = $("#progressFill"); if (!f) return;
    f.style.transition = "none"; f.style.filter = "brightness(1.6)";
    setTimeout(function () { f.style.transition = ""; f.style.filter = ""; }, 180);
  }

  // ---- Directions deep links ----
  function appleDir(p) {
    var saddr = HOME ? "&saddr=" + HOME.lat + "," + HOME.lng : "";
    return "https://maps.apple.com/?daddr=" + p.lat + "," + p.lng + saddr + "&dirflg=r&q=" + encodeURIComponent(p.n);
  }
  function kakaoDir(p) { return "https://map.kakao.com/link/to/" + encodeURIComponent(p.n) + "," + p.lat + "," + p.lng; }
  function naverSearch(p) { return "https://map.naver.com/p/search/" + encodeURIComponent(p.n); }

  // ================= Map view =================
  var map = null, markerLayer = null, homeMarker = null, userMarker = null;
  function pinIcon(p, visitedFlag) {
    var cls = "marker-pin" + (visitedFlag ? " is-visited" : "");
    var inner = visitedFlag ? "" : "<b>" + p.emoji + "</b>";
    return L.divIcon({
      className: "", iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28],
      html: '<div class="' + cls + '" style="background:' + catColor(p.cat) + '">' + inner + '</div>'
    });
  }
  function initMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomControl: true }).setView([37.5563, 126.9950], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap"
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    if (HOME) {
      homeMarker = L.marker([HOME.lat, HOME.lng], {
        icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="home-pin">🏨</div>' })
      }).addTo(map).bindPopup("<b>" + esc(HOME.n) + "</b><br>" + esc(HOME.area));
    }
    refreshMarkers();
  }
  function refreshMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    PLACES.forEach(function (p) {
      var m = L.marker([p.lat, p.lng], { icon: pinIcon(p, visited.has(p.id)) });
      m.bindPopup(
        '<div style="min-width:150px"><b>' + esc(p.n) + '</b><br>' +
        '<span style="color:#888">' + esc(CATS[p.cat].label) + ' · ' + esc(p.area) + '</span><br>' +
        '<a href="#" data-open="' + p.id + '">Open in Dex →</a></div>'
      );
      markerLayer.addLayer(m);
    });
  }
  document.addEventListener("click", function (e) {
    var id = e.target && e.target.getAttribute && e.target.getAttribute("data-open");
    if (id) { e.preventDefault(); openDetail(id); }
  });

  // ================= Nearby =================
  var originPoint = HOME ? { lat: HOME.lat, lng: HOME.lng, label: "Hotel Riviera" } : null;
  function renderNearby() {
    var listEl = $("#nearbyList"); listEl.innerHTML = "";
    if (!originPoint) return;
    var sorted = PLACES.map(function (p) {
      return { p: p, d: haversine(originPoint.lat, originPoint.lng, p.lat, p.lng) };
    }).sort(function (a, b) { return a.d - b.d; });
    sorted.forEach(function (o) {
      var p = o.p;
      var row = el("button", "row" + (visited.has(p.id) ? " visited" : ""));
      row.innerHTML =
        '<div class="row-face" style="' + faceStyle(p.cat) + '">' + p.emoji + '</div>' +
        '<div class="row-main">' +
          '<div class="row-name">' + esc(p.n) + '</div>' +
          '<div class="row-sub">' + esc(CATS[p.cat].label) + ' · ' + esc(p.subway) + '</div>' +
        '</div>' +
        '<div class="row-dist">' + fmtDist(o.d) + '</div>';
      row.addEventListener("click", function () { openDetail(p.id); });
      listEl.appendChild(row);
    });
    $("#nearbyOrigin").textContent = "Sorted by distance from " + originPoint.label;
  }
  function locateMe() {
    if (!navigator.geolocation) { alert("Location not available on this device."); return; }
    var btn = $("#locateBtn"); btn.textContent = "📍 Locating…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      originPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "your location" };
      btn.textContent = "📍 Using your location";
      renderNearby();
      if (map) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([originPoint.lat, originPoint.lng], { radius: 8, color: "#1e88e5", fillColor: "#1e88e5", fillOpacity: .9 })
          .addTo(map).bindPopup("You are here");
      }
    }, function () {
      btn.textContent = "📍 Use my location";
      alert("Couldn't get your location. Showing distances from Hotel Riviera instead.");
    }, { enableHighAccuracy: true, timeout: 8000 });
  }

  // ================= Tabs =================
  function showView(name) {
    $$(".view").forEach(function (v) { v.classList.toggle("is-active", v.id === "view-" + name); });
    $$(".tab").forEach(function (t) { t.classList.toggle("is-active", t.dataset.view === name); });
    if (name === "map") { initMap(); setTimeout(function () { map && map.invalidateSize(); }, 80); }
  }

  // ================= Wire up =================
  function init() {
    buildChips();
    renderGrid();
    renderNearby();
    tickClock(); setInterval(tickClock, 1000);
    loadHeaderWeather();

    $("#search").addEventListener("input", function () { state.q = this.value.trim().toLowerCase(); renderGrid(); });
    $$(".tab").forEach(function (t) { t.addEventListener("click", function () { showView(t.dataset.view); }); });
    $$("[data-close]").forEach(function (b) { b.addEventListener("click", closeDetail); });
    $("#locateBtn").addEventListener("click", locateMe);
    $("#weatherChip").addEventListener("click", loadHeaderWeather);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

    // register service worker (offline)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
