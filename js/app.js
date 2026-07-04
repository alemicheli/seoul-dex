/* Seoul Dex — app logic (vanilla JS, no build step). */
(function () {
  "use strict";

  var PLACES = window.SEOUL_PLACES || [];
  var HOME = window.SEOUL_HOME;
  var CONF = window.SEOUL_CONF;

  // ---- Category metadata ----
  // First six are a place's PRIMARY category (drives its card color). The rest
  // ("photo", "street", "booking") are cross-cutting tags a place opts into via p.tags.
  var CATS = {
    sight:     { label: "Sights",   color: "#e8542c" },
    food:      { label: "Food",     color: "#f0a020" },
    culture:   { label: "Culture",  color: "#7b5cd6" },
    nature:    { label: "Nature",   color: "#2fa46a" },
    shopping:  { label: "Shopping", color: "#d94f9c" },
    nightlife: { label: "Nightlife",color: "#3a6ea5" },
    photo:     { label: "Photo Spots", color: "#ff477e", tag: true },
    street:    { label: "Street Food", color: "#ef7b2b", tag: true },
    bbq:       { label: "Korean BBQ", color: "#a1502e", tag: true },
    booking:   { label: "Requires Booking", color: "#0e9aa7", tag: true },
    morning:   { label: "Morning",   color: "#f6a94b", tag: true, daypart: true },
    afternoon: { label: "Afternoon", color: "#2f9bd6", tag: true, daypart: true },
    evening:   { label: "Evening",   color: "#6b4fb3", tag: true, daypart: true }
  };
  var CHIP_EMOJI = { all: "✨", sight: "🏯", food: "🍜", culture: "🎨", nature: "🌳",
    shopping: "🛍️", nightlife: "🍺", photo: "📸", street: "🌭", bbq: "🥩", booking: "🎟️",
    morning: "🌅", afternoon: "☀️", evening: "🌙" };
  // a place matches a filter if it's its primary cat, carries the tag, OR is tagged for that time of day
  function inCat(p, cat) { return cat === "all" || p.cat === cat || (p.tags && p.tags.indexOf(cat) !== -1) || (p.time && p.time.indexOf(cat) !== -1); }

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

  // photo face: emoji sits behind; the real photo covers it, and falls back to the
  // emoji if the image 404s / fails to load (onerror hides the <img>).
  function faceHTML(p) {
    return '<span class="face-emoji">' + p.emoji + '</span>' +
      '<img class="face-img" alt="" loading="lazy" src="img/' + p.id + '.jpg" onerror="this.classList.add(\'hide\')">';
  }

  // index for quick lookup
  var BY_ID = {}; PLACES.forEach(function (p, i) { p._num = i + 1; BY_ID[p.id] = p; });

  // ================= Seoul time / open-now =================
  var DAYNAMES = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function seoulNow() {
    var d = new Date();
    var hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
    var wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(d);
    var h = parseInt(hm.slice(0, 2), 10) % 24, m = parseInt(hm.slice(3, 5), 10);
    return { min: h * 60 + m, day: DAYNAMES[wd] };
  }
  function hm2min(s) { return parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10); }
  // returns { state:"open"|"closed"|"unknown", label, cls }
  function openStatus(p, now) {
    var h = p.hours;
    if (!h) return { state: "unknown", label: "🕓 Hours vary", cls: "st-unknown" };
    if (h.always) return { state: "open", label: "🟢 Open 24 hrs", cls: "st-open" };
    now = now || seoulNow();
    if (h.x && h.x.indexOf(now.day) !== -1) return { state: "closed", label: "🔴 Closed today", cls: "st-closed" };
    var o = hm2min(h.o), c = hm2min(h.c), open;
    if (c > o) open = now.min >= o && now.min < c; else open = now.min >= o || now.min < c; // crosses midnight
    if (open) return { state: "open", label: "🟢 Open · until " + h.c, cls: "st-open" };
    return { state: "closed", label: "🔴 Closed · " + h.o + "–" + h.c, cls: "st-closed" };
  }
  function mealLabel(m) { return ({ lunch: "🥢 Best for lunch", dinner: "🌙 Best for dinner", both: "🍽️ Lunch or dinner", coffee: "☕ Coffee & snacks" })[m] || ""; }
  function mealShort(m) { return ({ lunch: "🥢 Lunch", dinner: "🌙 Dinner", both: "🍽️ L/D", coffee: "☕ Café" })[m] || ""; }

  // ---- Time of day ----
  var DAYPART_META = { morning: { e: "🌅", label: "Morning" }, afternoon: { e: "☀️", label: "Afternoon" }, evening: { e: "🌙", label: "Evening" } };
  function currentDaypart(min) { if (min >= 300 && min < 720) return "morning"; if (min >= 720 && min < 1080) return "afternoon"; return "evening"; }
  function timeEmojis(p) { if (!p.time) return ""; if (p.time.length === 3) return "🕒"; return p.time.map(function (d) { return DAYPART_META[d].e; }).join(""); }
  function bestTimeLabel(p) { if (!p.time) return ""; if (p.time.length === 3) return "🕒 Anytime"; return p.time.map(function (d) { return DAYPART_META[d].e + " " + DAYPART_META[d].label; }).join(" / "); }
  function bestTimeMini(p) { if (!p.time) return ""; if (p.time.length === 3) return "🕒 Anytime"; return p.time.map(function (d) { return DAYPART_META[d].e; }).join("") + " " + p.time.map(function (d) { return DAYPART_META[d].label; }).join("/"); }

  // ================= Clock =================
  function tickClock() {
    var now = new Date();
    var t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }).format(now);
    var d = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short", day: "numeric", month: "short" }).format(now);
    $("#clock").textContent = "Seoul · " + t + " · " + d + " " + DAYPART_META[currentDaypart(seoulNow().min)].e;
  }

  // ================= Weather =================
  var WMO = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"], 51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Drizzle"],
    61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"],
    71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"],
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

  function buildChipsInto(wrap, current, onPick) {
    wrap.innerHTML = "";
    var chips = [["all", "All"]].concat(Object.keys(CATS).map(function (k) { return [k, CATS[k].label]; }));
    chips.forEach(function (c) {
      var emoji = CHIP_EMOJI[c[0]] ? CHIP_EMOJI[c[0]] + " " : "";
      var b = el("button", "chip" + (c[0] === current() ? " is-active" : ""), emoji + esc(c[1]));
      b.dataset.cat = c[0];
      b.addEventListener("click", function () {
        onPick(c[0]);
        $$(".chip", wrap).forEach(function (x) { x.classList.toggle("is-active", x === b); });
      });
      wrap.appendChild(b);
    });
  }

  function matches(p) {
    if (!inCat(p, state.cat)) return false;
    if (state.q) {
      var tagStr = (p.tags || []).map(function (t) { return (CATS[t] || {}).label || t; }).join(" ");
      var timeStr = (p.time || []).map(function (t) { return (DAYPART_META[t] || {}).label || t; }).join(" ");
      var hay = (p.n + " " + p.kr + " " + p.area + " " + CATS[p.cat].label + " " + tagStr + " " + timeStr + " " + (p.blurb || "")).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function tagBadges(p) {
    if (!p.tags || !p.tags.length) return "";
    return p.tags.map(function (t) { return CHIP_EMOJI[t] || ""; }).join("");
  }

  function renderGrid() {
    var grid = $("#grid"); grid.innerHTML = "";
    var list = PLACES.filter(matches);
    $("#dexEmpty").hidden = list.length !== 0;
    list.forEach(function (p) {
      var card = el("button", "card" + (visited.has(p.id) ? " visited" : ""));
      card.innerHTML =
        '<div class="card-face" style="' + faceStyle(p.cat) + '">' +
          faceHTML(p) +
          '<span class="card-num">#' + pad3(p._num) + '</span>' +
          '<span class="rarity-dot rarity-' + (p.rarity || "common") + '"></span>' +
          '<span class="visited-stamp"><span>SEEN</span></span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="card-name">' + esc(p.n) + ' ' + tagBadges(p) + '</div>' +
          '<div class="card-meta"><span class="cat-tag" style="--acc:' + catColor(p.cat) + '">' +
            esc(CATS[p.cat].label) + '</span> · ' + esc(p.area) + ' <span class="dp" title="Best time to go">' + timeEmojis(p) + '</span></div>' +
        '</div>';
      card.addEventListener("click", function () { openDetail(p.id); });
      grid.appendChild(card);
    });
    updateProgress();
  }

  function updateProgress() {
    var total = PLACES.length, seen = 0;
    PLACES.forEach(function (p) { if (visited.has(p.id)) seen++; });
    var pct = total ? Math.round((seen / total) * 100) : 0;
    $("#progressFill").style.width = pct + "%";
    $("#progressLabel").textContent = seen + " / " + total + " discovered";
  }

  // ================= Detail sheet =================
  var detailMap = null, detailSeq = 0;
  function openDetail(id) {
    var p = BY_ID[id]; if (!p) return;
    var mySeq = ++detailSeq;
    var dHome = HOME ? haversine(HOME.lat, HOME.lng, p.lat, p.lng) : null;
    var dConf = CONF ? haversine(CONF.lat, CONF.lng, p.lat, p.lng) : null;
    var st = openStatus(p);
    var body = $("#detailBody");
    var isSeen = visited.has(id);
    body.innerHTML =
      '<div class="detail-hero" style="' + faceStyle(p.cat) + '">' + faceHTML(p) + '</div>' +
      '<div class="detail-inner">' +
        '<div class="detail-title">' + esc(p.n) + '<span class="detail-kr">' + esc(p.kr) + '</span></div>' +
        '<div class="detail-tags">' +
          '<span class="pill" style="--acc:' + catColor(p.cat) + '">#' + pad3(p._num) + ' · ' + esc(CATS[p.cat].label) + '</span>' +
          '<span class="pill ' + st.cls + '">' + st.label + '</span>' +
          (p.meal ? '<span class="pill">' + mealLabel(p.meal) + '</span>' : '') +
          '<span class="pill">🕒 ' + bestTimeLabel(p).replace(/🌅 |☀️ |🌙 |🕒 /g, "") + '</span>' +
          (p.tags || []).map(function (t) { return '<span class="pill" style="--acc:' + catColor(t) + '">' + (CHIP_EMOJI[t] || "") + ' ' + esc((CATS[t] || {}).label || t) + '</span>'; }).join("") +
          '<span class="pill">' + rarityLabel(p.rarity) + '</span>' +
          '<span class="pill">📍 ' + esc(p.area) + '</span>' +
        '</div>' +
        (p.pick ? '<div class="detail-why">⭐ <b>Top pick:</b> ' + esc(p.why) + '</div>' : '') +
        '<div class="detail-blurb">' + esc(p.blurb) + '</div>' +
        '<div class="detail-facts">' +
          '<span class="pill">🚇 ' + esc(p.subway) + '</span>' +
          (dHome != null ? '<span class="pill">🏨 ' + fmtDist(dHome) + ' from hotel</span>' : '') +
          (dConf != null ? '<span class="pill">🎪 ' + fmtDist(dConf) + ' from ICML</span>' : '') +
        '</div>' +
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
      renderGrid(); renderPicks(); refreshMarkers();
    });

    var sheet = $("#detail"); sheet.hidden = false;
    var card = $(".sheet-card", sheet); if (card) card.scrollTop = 0; // reset scroll on (re)open
    document.body.style.overflow = "hidden";

    if (window.L) {
      setTimeout(function () {
        if (mySeq !== detailSeq) return;
        if (detailMap) { detailMap.remove(); detailMap = null; }
        detailMap = L.map("detailMap", { attributionControl: false, zoomControl: false }).setView([p.lat, p.lng], 15);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, crossOrigin: "anonymous" }).addTo(detailMap);
        L.marker([p.lat, p.lng], { icon: pinIcon(p, false) }).addTo(detailMap);
        detailMap.invalidateSize();
      }, 60);
    }

    fetchWeather(p.lat, p.lng).then(function (w) {
      if (mySeq !== detailSeq) return; // a newer detail was opened; ignore stale result
      var e = $("#detailWx"); if (!e) return;
      if (!w) { e.textContent = "Weather unavailable offline"; return; }
      e.innerHTML = w.emoji + " " + Math.round(w.temp) + "°C · " + esc(w.text) + " right now";
    });
  }
  function rarityLabel(r) { return r === "legendary" ? "⭐ Legendary" : r === "rare" ? "🔹 Rare" : "⚪ Common"; }
  function closeDetail() {
    $("#detail").hidden = true; document.body.style.overflow = "";
    if (detailMap) { detailMap.remove(); detailMap = null; }
  }
  function flash() {
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
  function naverSearch(p) { return "https://map.naver.com/p/search/" + encodeURIComponent(p.kr || p.n); }

  // ================= Map view =================
  var map = null, markerLayer = null, homeMarker = null, confMarker = null, userMarker = null;
  var mapCat = "all";
  function pinIcon(p, visitedFlag) {
    var cls = "marker-pin" + (visitedFlag ? " is-visited" : "");
    var inner = visitedFlag ? "" : "<b>" + p.emoji + "</b>";
    return L.divIcon({
      className: "", iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -24],
      html: '<div class="' + cls + '" style="background:' + catColor(p.cat) + '">' + inner + '</div>'
    });
  }
  function initMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomControl: true }).setView([37.5563, 126.9950], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap", crossOrigin: "anonymous"
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    if (HOME) homeMarker = L.marker([HOME.lat, HOME.lng], { icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="home-pin">🏨</div>' }) })
      .addTo(map).bindPopup("<b>" + esc(HOME.n) + "</b><br>Your hotel · " + esc(HOME.area));
    if (CONF) confMarker = L.marker([CONF.lat, CONF.lng], { icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="conf-pin">🎪</div>' }) })
      .addTo(map).bindPopup("<b>ICML · COEX</b><br>The conference · " + esc(CONF.area));
    buildChipsInto($("#mapFilter"), function () { return mapCat; }, function (c) { mapCat = c; refreshMarkers(); });
    refreshMarkers();
  }
  function refreshMarkers() {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    var shown = 0;
    PLACES.forEach(function (p) {
      if (!inCat(p, mapCat)) return;
      shown++;
      var m = L.marker([p.lat, p.lng], { icon: pinIcon(p, visited.has(p.id)) });
      m.bindPopup(
        '<div style="min-width:150px"><b>' + esc(p.n) + '</b><br>' +
        '<span style="color:#888">' + esc(CATS[p.cat].label) + ' · ' + esc(p.area) + '</span><br>' +
        '<a href="#" data-open="' + p.id + '">Open in Dex →</a></div>'
      );
      markerLayer.addLayer(m);
    });
    var cl = $("#mapCount"); if (cl) cl.textContent = shown + " / " + PLACES.length + " shown";
  }
  document.addEventListener("click", function (e) {
    var id = e.target && e.target.getAttribute && e.target.getAttribute("data-open");
    if (id) { e.preventDefault(); if (map) map.closePopup(); openDetail(id); }
  });

  // ================= Picks (recommended) =================
  // mode: "top" (curated) | "near" (from your location / hotel) | "conf" (food near ICML)
  var picks = { mode: "top", cat: "all", openNow: false };
  var userGeo = null;
  var RARITY_RANK = { legendary: 0, rare: 1, common: 2 };

  function picksOrigin() {
    if (picks.mode === "conf") return { lat: CONF.lat, lng: CONF.lng, label: "COEX / ICML" };
    if (picks.mode === "near" || picks.mode === "now") return userGeo || { lat: HOME.lat, lng: HOME.lng, label: "Hotel Riviera" };
    return null;
  }

  function renderPicks() {
    var listEl = $("#picksList"); if (!listEl) return;
    var now = seoulNow();
    var dp = currentDaypart(now.min);
    var origin = picksOrigin();
    var nowFallback = false;
    var list = PLACES.filter(function (p) { return inCat(p, picks.cat); });
    if (picks.openNow && picks.mode !== "now") list = list.filter(function (p) { return openStatus(p, now).state === "open"; });

    if (picks.mode === "top") {
      list = list.filter(function (p) { return p.pick; });
      list.sort(function (a, b) { return (RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]) || a._num - b._num; });
    } else if (picks.mode === "conf") {
      list = list.filter(function (p) { return p.cat === "food" || (p.tags && p.tags.indexOf("street") !== -1); });
    } else if (picks.mode === "now") {
      // what's good for the current time of day AND open right now
      var timed = list.filter(function (p) { return p.time && p.time.indexOf(dp) !== -1 && openStatus(p, now).state === "open"; });
      if (!timed.length) { nowFallback = true; timed = list.filter(function (p) { return openStatus(p, now).state === "open"; }); }
      list = timed;
    }
    // distance annotate + sort for location modes
    if (origin) {
      list = list.map(function (p) { return { p: p, d: haversine(origin.lat, origin.lng, p.lat, p.lng) }; })
                 .sort(function (a, b) { return a.d - b.d; });
    } else {
      list = list.map(function (p) { return { p: p, d: HOME ? haversine(HOME.lat, HOME.lng, p.lat, p.lng) : null }; });
    }

    listEl.innerHTML = "";
    $("#picksEmpty").hidden = list.length !== 0;
    list.forEach(function (o) {
      var p = o.p, st = openStatus(p, now);
      var sub = picks.mode === "top" ? p.why : (p.subway);
      var badges = '<span class="mini ' + st.cls + '">' + st.label.replace("· until", "till") + '</span>' +
                   '<span class="mini dp">' + bestTimeMini(p) + '</span>' +
                   (p.meal ? '<span class="mini">' + mealShort(p.meal) + '</span>' : '') +
                   ((p.tags && p.tags.indexOf("booking") !== -1) ? '<span class="mini st-book">🎟️ Book</span>' : '');
      var row = el("button", "row" + (visited.has(p.id) ? " visited" : ""));
      row.innerHTML =
        '<div class="row-face" style="' + faceStyle(p.cat) + '">' + faceHTML(p) + '</div>' +
        '<div class="row-main">' +
          '<div class="row-name">' + esc(p.n) + ' ' + tagBadges(p) + '</div>' +
          '<div class="row-sub">' + esc(sub) + '</div>' +
          '<div class="row-badges">' + badges + '</div>' +
        '</div>' +
        (o.d != null ? '<div class="row-dist">' + fmtDist(o.d) + '</div>' : '');
      row.addEventListener("click", function () { openDetail(p.id); });
      listEl.appendChild(row);
    });

    // origin caption + locate button visibility
    var cap = $("#picksOrigin");
    if (picks.mode === "now") cap.textContent = nowFallback
      ? "Nothing tagged for the " + DAYPART_META[dp].label.toLowerCase() + " is open now — showing what's open, nearest first"
      : "Good for right now (" + DAYPART_META[dp].e + " " + DAYPART_META[dp].label.toLowerCase() + ") · open & nearest first";
    else if (picks.mode === "top") cap.textContent = "Our hand-picked highlights" + (picks.openNow ? " that are open now" : "");
    else if (picks.mode === "conf") cap.textContent = "Food & street eats sorted by distance from COEX / ICML";
    else cap.textContent = "Sorted by distance from " + (origin ? origin.label : "Hotel Riviera");
    $("#picksLocate").hidden = !(picks.mode === "near" || picks.mode === "now");
    $("#openNowToggle").style.display = picks.mode === "now" ? "none" : "";
  }

  function locateMe(cb) {
    if (!navigator.geolocation) { alert("Location not available on this device."); return; }
    var btn = $("#picksLocate"); if (btn) btn.textContent = "📍 Locating…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      userGeo = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "your location" };
      if (btn) btn.textContent = "📍 Using your location";
      renderPicks();
      if (map) {
        if (userMarker) map.removeLayer(userMarker);
        userMarker = L.circleMarker([userGeo.lat, userGeo.lng], { radius: 8, color: "#1e88e5", fillColor: "#1e88e5", fillOpacity: .9 })
          .addTo(map).bindPopup("You are here");
      }
      if (cb) cb();
    }, function () {
      if (btn) btn.textContent = "📍 Use my location";
      alert("Couldn't get your location. Showing distances from Hotel Riviera instead.");
    }, { enableHighAccuracy: true, timeout: 8000 });
  }

  // ================= Tabs =================
  function showView(name) {
    $$(".view").forEach(function (v) { v.classList.toggle("is-active", v.id === "view-" + name); });
    $$(".tab").forEach(function (t) { t.classList.toggle("is-active", t.dataset.view === name); });
    if (name === "map") { initMap(); setTimeout(function () { map && map.invalidateSize(); }, 80); }
    if (name === "picks") renderPicks();
  }

  // ================= Wire up =================
  function init() {
    buildChipsInto($("#chips"), function () { return state.cat; }, function (c) { state.cat = c; renderGrid(); });
    buildChipsInto($("#picksChips"), function () { return picks.cat; }, function (c) { picks.cat = c; renderPicks(); });
    renderGrid();
    renderPicks();
    tickClock(); setInterval(tickClock, 1000);
    setInterval(function () { if ($("#view-picks").classList.contains("is-active")) renderPicks(); }, 60000); // refresh open-now
    loadHeaderWeather();

    $("#search").addEventListener("input", function () { state.q = this.value.trim().toLowerCase(); renderGrid(); });
    $$(".tab").forEach(function (t) { t.addEventListener("click", function () { showView(t.dataset.view); }); });
    $$("[data-close]").forEach(function (b) { b.addEventListener("click", closeDetail); });
    $$(".seg").forEach(function (s) {
      s.addEventListener("click", function () {
        picks.mode = s.dataset.mode;
        $$(".seg").forEach(function (x) { x.classList.toggle("is-active", x === s); });
        if ((picks.mode === "near" || picks.mode === "now") && !userGeo) locateMe();
        renderPicks();
      });
    });
    $("#openNowToggle").addEventListener("click", function () {
      picks.openNow = !picks.openNow;
      this.classList.toggle("on", picks.openNow);
      renderPicks();
    });
    $("#picksLocate").addEventListener("click", function () { locateMe(); });
    $("#weatherChip").addEventListener("click", loadHeaderWeather);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDetail(); });

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
