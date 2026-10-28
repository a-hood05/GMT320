# Dashboard setup (2D / 3D)

## New files
| File | What it does |
|---|---|
| `src/dashboard.html` | The dashboard page, with the 2D Map / 3D Farm switch at the top |
| `src/dashboard.css` | Dashboard styling (same dark green as the 3D map) |
| `src/dashboard_config.js` | **Settings**: API address, sensor id field, NDVI list |
| `src/dashboard.js` | Switching between 2D and 3D (Cesium only loads when you open 3D) |
| `src/dashboard_2d.js` | 2D map (our sem-test dashboard: stats, filters, colour-by, popups, legend) + NDVI/NDRE time slider |
| `src/dashboard_3d.js` | 3D: click a sensor → recordings from PostGIS |
| `src/ndvi/` | NDVI / NDRE / temperature images made by the script, plus `ndvi_manifest.json` |
| `server/server.js` | Small Node server between the dashboard and PostGIS |
| `server/.env.example` | Database settings template → copy to `server/.env` |
| `server/make_vegetation_indices.js` | Calculates NDVI, NDRE and canopy temperature from the drone orthomosaics |

`main_cesium.js` is reused as it is.

## Run it
Just the 2D/3D maps (no database): open `index.html` with Live Server (or `npm run dev`) and click **Open Dashboard**.

With the database API:
```bash
npm install                  # installs express, pg, cors, dotenv
copy server\.env.example server\.env   # then fill in password + table
npm run server
```
Open **http://localhost:3000/src/dashboard.html**

## NDVI / NDRE / canopy temperature from the drone orthomosaics
The orthos are 7-band MicaSense Altum files (Blue, Green, Red, Red-edge, NIR, Thermal, Alpha).
1. Put them in `C:\Users\noesi\Downloads\drone_images` (the date is read from the
   name, e.g. `251209ortho.tif` → 9 Dec 2025).
2. In the project folder:
   ```
   npm install
   npm run indices
   ```
3. Refresh the dashboard - the flights appear on the time slider.

## PostGIS
In `server/.env` set `READINGS_TABLE`, `SENSOR_ID_COLUMN` and `TIME_COLUMN` to your table.
Every numeric column in that table appears as a variable in the sensor panel.
Check the connection at http://localhost:3000/api/health.
If the database can't be reached, the panel shows clearly labelled **demo data**
(set `DEMO_MODE=false` to turn that off for the real demo).
