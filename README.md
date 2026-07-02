# Seoul Dex 📕

A Pokédex-style travel companion for Seoul, built as an installable PWA. Browse
sights, food, photo spots and street food; see them on a map; check the live
Seoul time & weather; get directions from your hotel; and "catch" each place by
marking it visited.

Built for a trip to **ICML in Seoul** (hotel base: **Hotel Riviera**, Cheongdam).

## Features
- **Dex** — 48 curated places, filterable by Sights / Food / Culture / Nature /
  Shopping / Nightlife plus cross-cutting **📸 Photo Spots** and **🌭 Street Food**.
- **Map** — all places pinned by category, your hotel marked, tap a pin to open it.
- **Nearby** — everything sorted by distance from your hotel (or your live GPS).
- **Live Seoul clock + weather** (free Open-Meteo API, no key).
- **Mark as visited** — progress bar tracks your Dex completion; saved on-device.
- **Directions** — one tap to Apple Maps (transit from the hotel), KakaoMap or
  Naver Map (best for Korea).
- **Works offline** — service worker caches the app and any map tiles you've
  viewed, so it keeps working with no data / roaming.

## Tech
Plain HTML/CSS/JS — no build step. Maps via Leaflet + OpenStreetMap. PWA
manifest + service worker for offline + home-screen install.

## Run locally
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Install on iPhone
Open the site in **Safari** → Share → **Add to Home Screen**. It launches
full-screen like a native app.

## Customize
- Places live in [`js/data.js`](js/data.js) — edit or add entries.
- Your hotel/home base is `SEOUL_HOME` at the top of that file.
