FarmTech Africa – Smart Irrigation Dashboard

A web-based decision-support system for the pecan orchard on the University of Pretoria Experimental Farm. It combines soil-moisture sensors, rainwater tank levels, weather data and drone imagery, and recommends per irrigation row whether to irrigate, monitor, postpone or not irrigate.

GMT 320 group project, 2026 – Anoeska Hood, Rynhard Britz and Osimele Mkhize

Features
- Project website with the solution, a fieldwork blog and a dashboard walkthrough video
- 2D map (Leaflet): farm layers, filters, statistics, popups, drone image time slider (NDVI, NDRE, canopy temperature)
- 3D digital twin (CesiumJS): buildings by roof type, trees, tanks, soil-moisture pillars, weather station rings
- Live sensor readings from PostgreSQL with charts
- Smart irrigation decision per row (IDW soil dryness + current weather, forecast, ETo and tank levels)
- Sign-in per role (public, farm staff, farm manager, researcher, admin)
- Guided tour for first-time users

Built with
HTML, CSS and JavaScript only
Node.js + Express connect to PostgreSQL (via Tailscale)
Leaflet, CesiumJS, Open-Meteo · QGIS (static maps)

Getting started
Requirements
- Node.js
- Internet connection (maps, 3D terrain, libraries)
- Tailscale access to the team database (for live data; without it the dashboard shows labelled demo data)
See setup.html for the full guide to see dashboard

Project structure
index.html, setup.html: website home page and setup guide
website: website styling and blog pages
dashboard/: 2D map, 3D twin, decision, sign-in, tour
dashboard/config/: settings: decision thresholds, roles, data files that can be chnaged after callibration
server/: Node.js API between the dashboard and PostgreSQL
scripts/: drone index script, database check
src/: images, videos, GeoJSON layers, drone index images

Data sources
- Chameleon and TEROS 21 soil-moisture sensors, SIEMENS tank-level recorder
- Automatic Weather Station (Department of Geography, Geoinformatics and Meteorology)
- Open-Meteo forecast
- MicaSense Altum drone flights (Dec 2025 – Jan 2026)
- Field data collected with Mergin Maps and QField

Known limitations
- Live data needs the team's Tailscale network
- No real-time data
- Decision thresholds are placeholders until
