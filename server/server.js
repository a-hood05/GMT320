// =====================================================================
// FARMTECH AFRICA - small API between the dashboard and PostGIS
//
// Browsers can't talk to a database directly, so this server does it:
//   GET /api/health                       -> is the database connected?
//   GET /api/sensors/:id/readings?days=7  -> recordings for one sensor
//
// It also serves the website, so you can open:
//   http://localhost:3000                 (website)
//   http://localhost:3000/src/dashboard.html
//
// Start it with:   npm run server
// Settings live in server/.env (copy server/.env.example)
// =====================================================================
import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(__dirname, ".env") });

const PORT = Number(process.env.PORT || 3000);
const TABLE = process.env.READINGS_TABLE || "sensor_readings";
const SENSOR_COL = process.env.SENSOR_ID_COLUMN || "sensor_id";
const TIME_COL = process.env.TIME_COLUMN || "recorded_at";
const DEMO_MODE = (process.env.DEMO_MODE || "auto").toLowerCase();   // auto | true | false
const MAX_ROWS = 5000;

// Columns that are never plotted
const SKIP_COLUMNS = new Set([
  SENSOR_COL, TIME_COL, "id", "fid", "gid", "ogc_fid",
  "geom", "the_geom", "geometry", "wkb_geometry"
]);

// --- Protect against SQL injection in the table/column names from .env ---
function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(name)) {
    throw new Error(`Invalid table/column name in .env: "${name}"`);
  }
  return name.split(".").map((part) => `"${part}"`).join(".");
}
const T = ident(TABLE), S = ident(SENSOR_COL), TC = ident(TIME_COL);

// --- Database connection (PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD) ---
const pool = DEMO_MODE === "true" ? null : new pg.Pool({ max: 5, connectionTimeoutMillis: 4000 });
pool?.on("error", (err) => console.error("PostGIS pool error:", err.message));

const app = express();
app.use(cors());
app.use(express.static(ROOT));   // serves index.html, src/, etc.


// ---------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------
app.get("/api/health", async (req, res) => {
  if (!pool) return res.json({ database: "demo mode", table: TABLE });
  try {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${T}`);
    res.json({ database: "connected", table: TABLE, rows: r.rows[0].n });
  } catch (err) {
    res.status(500).json({ database: "error", table: TABLE, error: err.message });
  }
});


// ---------------------------------------------------------------------
// Recordings for one sensor
// ?days=1|7|30|all  -> period, counted back from that sensor's LATEST
//                      recording (so older downloaded data still shows)
// ---------------------------------------------------------------------
app.get("/api/sensors/:id/readings", async (req, res) => {
  const sensorId = String(req.params.id);
  const days = req.query.days === "all" ? null : Math.min(Math.max(Number(req.query.days) || 7, 1), 3650);

  if (!pool) return res.json(demoReadings(sensorId, days, "DEMO_MODE=true in server/.env"));

  try {
    const params = [sensorId];
    let where = `${S}::text = $1`;
    if (days) {
      params.push(days);
      where += ` AND ${TC} >= (SELECT max(${TC}) FROM ${T} WHERE ${S}::text = $1) - make_interval(days => $2::int)`;
    }
    const sql = `SELECT * FROM (
                   SELECT * FROM ${T} WHERE ${where} ORDER BY ${TC} DESC LIMIT ${MAX_ROWS}
                 ) recent ORDER BY ${TC} ASC`;
    const result = await pool.query(sql, params);
    res.json(shapeRows(sensorId, result.rows, result.fields.map((f) => f.name)));
  } catch (err) {
    console.error(`Query for sensor ${sensorId} failed:`, err.message);
    if (DEMO_MODE === "auto") {
      return res.json(demoReadings(sensorId, days, `Database error: ${err.message}`));
    }
    res.status(500).json({ error: err.message });
  }
});


// Turn database rows into { time, <numeric columns> } for the chart
function shapeRows(sensorId, rows, fieldNames) {
  const candidates = fieldNames.filter((f) => !SKIP_COLUMNS.has(f));

  // keep only columns where every value is a number (pg returns NUMERIC as text)
  const numeric = candidates.filter((col) => {
    const values = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
    return values.length > 0 && values.every((v) => typeof v !== "boolean" && Number.isFinite(Number(v)));
  });

  return {
    source: "postgis",
    table: TABLE,
    sensor_id: sensorId,
    time_column: TIME_COL,
    columns: numeric,
    rows: rows.map((r) => {
      const out = { time: r[TIME_COL] instanceof Date ? r[TIME_COL].toISOString() : r[TIME_COL] };
      for (const c of numeric) out[c] = r[c] === null ? null : Number(r[c]);
      return out;
    }),
    message: rows.length ? undefined : `No recordings for sensor ${sensorId} in ${TABLE}.`
  };
}


// ---------------------------------------------------------------------
// Demo data - only used when the database is not reachable,
// and clearly marked as "Demo data" in the dashboard.
// ---------------------------------------------------------------------
let sensorTypes = {};
try {
  const gj = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/sensor.geojson"), "utf8"));
  for (const f of gj.features) sensorTypes[String(f.properties.id)] = String(f.properties.sensor_typ || "").trim();
} catch { /* fine - demo data just won't know the sensor type */ }

function demoReadings(sensorId, days, reason) {
  const type = sensorTypes[sensorId] || "";
  const hours = (days || 30) * 24;
  const step = hours > 24 * 7 ? 3 : 1;       // hourly, or 3-hourly for long periods
  const seed = [...sensorId].reduce((s, c) => s + c.charCodeAt(0), 0);
  const now = Date.now() - (Date.now() % 3600000);
  const rows = [];

  for (let h = hours; h >= 0; h -= step) {
    const t = now - h * 3600000;
    const hourOfDay = new Date(t).getHours();
    const daily = Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI);
    const noise = Math.sin(seed * 12.9898 + h * 78.233) * 0.5;

    if (/water/i.test(type) || /siemens/i.test(type)) {
      // tank slowly empties, refilled every ~5 days
      const cycle = (h % 120) / 120;
      rows.push({ time: new Date(t).toISOString(), water_level_m: +(0.4 + 1.6 * cycle + noise * 0.02).toFixed(3) });
    } else {
      // soil moisture dries out, jumps up after "irrigation" every 3 days
      const sinceIrrigation = h % 72;
      const vwc = 32 - sinceIrrigation * 0.12 + noise + (seed % 5);
      rows.push({
        time: new Date(t).toISOString(),
        soil_moisture_vwc: +vwc.toFixed(2),
        soil_temperature_c: +(19 + 4 * daily + noise).toFixed(2)
      });
    }
  }

  return {
    source: "demo",
    table: null,
    sensor_id: sensorId,
    columns: Object.keys(rows[0]).filter((k) => k !== "time"),
    rows,
    message: reason
  };
}


app.listen(PORT, async () => {
  console.log(`\nFarmTech Africa server running:`);
  console.log(`  Website:    http://localhost:${PORT}`);
  console.log(`  Dashboard:  http://localhost:${PORT}/src/dashboard.html\n`);
  if (!pool) return console.log("DEMO_MODE=true - not connecting to PostGIS.");
  try {
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${T}`);
    console.log(`PostGIS connected: ${process.env.PGDATABASE} / ${TABLE} (${r.rows[0].n} rows)`);
  } catch (err) {
    console.warn(`PostGIS NOT connected (${err.message}).`);
    console.warn(DEMO_MODE === "auto"
      ? "The dashboard will show demo data until this is fixed - check server/.env"
      : "Sensor readings will fail until this is fixed - check server/.env");
  }
});
