// =====================================================================
// FARMTECH AFRICA - small API between the dashboard and the PostGIS database
//
// Browsers can't talk to a database directly, so this server does it:
//   GET /api/health                        -> is the database connected?
//   GET /api/sensors/:id/readings?days=7   -> recordings for one map sensor
//
// Which table belongs to which sensor: server/sensor_tables.js
// Database login: server/.env  (never commit this file)
//
// Start it with:   npm run server
// It also serves the website: http://localhost:3000/src/dashboard.html
// =====================================================================
import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SENSOR_TABLES } from "./sensor_tables.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(__dirname, ".env") });

const env = (...names) => names.map((n) => process.env[n]).find((v) => v !== undefined && v !== "");
const PORT = Number(env("PORT") || 3000);
const DEMO_MODE = (env("DEMO_MODE") || "auto").toLowerCase();   // auto | true | false
const MAX_ROWS = 5000;

// Columns that are never plotted
const SKIP_COLUMNS = new Set(["id", "fid", "gid", "ogc_fid", "record", "geom", "the_geom", "geometry", "wkb_geometry"]);

// Accepts our teammate's names (DB_host ...) or the standard PG names
export const DB_CONFIG = {
  host: env("DB_host", "DB_HOST", "PGHOST") || "localhost",
  port: Number(env("DB_port", "DB_PORT", "PGPORT") || 5432),
  user: env("DB_user", "DB_USER", "PGUSER"),
  password: env("DB_password", "DB_PASSWORD", "PGPASSWORD"),
  database: env("DB_name", "DB_NAME", "PGDATABASE"),
  max: 5,
  connectionTimeoutMillis: 8000,
};

// Safe quoting for table/column names (handles spaces and capitals like "treatment 2_Port1")
export const q = (name) => '"' + String(name).replace(/"/g, '""') + '"';

// SQL for the time of each row
export function timeSql(cfg) {
  if (cfg.timeSql) return cfg.timeSql;
  if (Array.isArray(cfg.time)) {
    const [d, t] = cfg.time;
    return `(${q(d)}::date + ${q(t)}::time)`;
  }
  return `${q(cfg.time || "time")}::timestamp`;
}

const pool = DEMO_MODE === "true" ? null : new pg.Pool(DB_CONFIG);
pool?.on("error", (err) => console.error("Database pool error:", err.message));

const app = express();
app.use(cors());
app.use(express.static(ROOT));   // serves index.html, src/, etc.


// ---------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------
app.get("/api/health", async (req, res) => {
  if (!pool) return res.json({ database: "demo mode" });
  try {
    await pool.query("SELECT 1");
    res.json({ database: "connected", name: DB_CONFIG.database, linkedSensors: Object.keys(SENSOR_TABLES) });
  } catch (err) {
    res.status(500).json({ database: "error", error: err.message });
  }
});


// ---------------------------------------------------------------------
// Recordings for one map sensor
// ?days=1|7|30|all  -> counted back from that sensor's LATEST recording
// ---------------------------------------------------------------------
app.get("/api/sensors/:id/readings", async (req, res) => {
  const sensorId = String(req.params.id);
  const days = req.query.days === "all" ? null : Math.min(Math.max(Number(req.query.days) || 7, 1), 3650);
  const cfg = SENSOR_TABLES[sensorId];

  if (!cfg) {
    return res.json({ source: "none", sensor_id: sensorId, columns: [], rows: [],
                      message: `Sensor ${sensorId} isn't linked to a database table yet.` });
  }
  if (!pool) return res.json(demoReadings(sensorId, days, "DEMO_MODE=true in server/.env"));

  try {
    const T = q(cfg.table), TS = timeSql(cfg);
    const params = [];
    let where = `${TS} IS NOT NULL`;
    if (days) {
      params.push(days);
      where += ` AND ${TS} >= (SELECT max(${TS}) FROM ${T}) - make_interval(days => $1::int)`;
    }
    const sql = `SELECT * FROM (
                   SELECT *, ${TS} AS __time FROM ${T} WHERE ${where} ORDER BY __time DESC LIMIT ${MAX_ROWS}
                 ) recent ORDER BY __time ASC`;
    const result = await pool.query(sql, params);
    res.json(shapeRows(sensorId, cfg, result.rows, result.fields.map((f) => f.name)));
  } catch (err) {
    console.error(`Query for sensor ${sensorId} (${cfg.table}) failed:`, err.message);
    if (DEMO_MODE === "auto") return res.json(demoReadings(sensorId, days, `Database error: ${err.message}`));
    res.status(500).json({ error: err.message });
  }
});


// "12.5", "12,5", "12.5 kPa", 12.5  ->  12.5      ("", "NaN", "error" -> null)
export function toNumber(v) {
  if (v === null || v === undefined || typeof v === "boolean" || v instanceof Date) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).trim().replace(",", ".").match(/^[-+]?\d*\.?\d+(e[-+]?\d+)?/i);
  return m ? Number(m[0]) : null;
}

// Turn database rows into { time, <numeric columns> } for the chart
export function shapeRows(sensorId, cfg, rows, fieldNames) {
  const timeCols = new Set([].concat(cfg.time || "time"));
  const candidates = cfg.columns || fieldNames.filter((f) => f !== "__time" && !SKIP_COLUMNS.has(f.toLowerCase()) && !timeCols.has(f));

  // a column is plotted if most of its filled-in values are numbers
  // (text like "12,5" or "12.5 kPa" is converted; blanks and "NaN" are skipped)
  const numeric = candidates.filter((col) => {
    const filled = rows.map((r) => r[col])
      .filter((v) => v !== null && v !== undefined && !/^(|nan|null|none|n\/a|-)$/i.test(String(v).trim()));
    if (!filled.length || filled.every((v) => v instanceof Date)) return false;
    const ok = filled.filter((v) => toNumber(v) !== null).length;
    return ok / filled.length >= 0.8;
  });

  return {
    source: "postgis",
    table: cfg.table,
    sensor_id: sensorId,
    columns: numeric,
    rows: rows.map((r) => {
      const t = r.__time;
      const out = { time: t instanceof Date ? t.toISOString() : t };
      for (const c of numeric) out[c] = toNumber(r[c]);
      return out;
    }),
    message: rows.length
      ? (numeric.length ? undefined : `Found ${rows.length} recordings, but no number columns in ${cfg.table} (columns: ${candidates.join(", ")}).`)
      : `No recordings in ${cfg.table} for this period.`,
  };
}


// ---------------------------------------------------------------------
// Demo data - only used when the database can't be reached,
// and clearly marked as "Demo data" in the dashboard.
// ---------------------------------------------------------------------
let sensorTypes = {};
try {
  const gj = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/sensor.geojson"), "utf8"));
  for (const f of gj.features) sensorTypes[String(f.properties.id)] = String(f.properties.sensor_typ || "").trim();
} catch { /* demo data just won't know the sensor type */ }

function demoReadings(sensorId, days, reason) {
  const type = sensorTypes[sensorId] || "";
  const hours = (days || 30) * 24;
  const step = hours > 24 * 7 ? 3 : 1;
  const seed = [...sensorId].reduce((s, c) => s + c.charCodeAt(0), 0);
  const now = Date.now() - (Date.now() % 3600000);
  const rows = [];
  for (let h = hours; h >= 0; h -= step) {
    const t = now - h * 3600000;
    const noise = Math.sin(seed * 12.9898 + h * 78.233) * 0.5;
    if (/water|siemens/i.test(type)) {
      rows.push({ time: new Date(t).toISOString(), level: +(0.4 + 1.6 * ((h % 120) / 120) + noise * 0.02).toFixed(3) });
    } else {
      rows.push({ time: new Date(t).toISOString(), soil_moisture: +(32 - (h % 72) * 0.12 + noise + (seed % 5)).toFixed(2) });
    }
  }
  return { source: "demo", table: null, sensor_id: sensorId, columns: Object.keys(rows[0]).filter((k) => k !== "time"), rows, message: reason };
}


if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, async () => {
    console.log(`\nFarmTech Africa server running:`);
    console.log(`  Website:    http://localhost:${PORT}`);
    console.log(`  Dashboard:  http://localhost:${PORT}/src/dashboard.html\n`);
    if (!pool) return console.log("DEMO_MODE=true - not connecting to the database.");
    try {
      await pool.query("SELECT 1");
      console.log(`Database connected: ${DB_CONFIG.database} on ${DB_CONFIG.host}`);
      console.log(`Sensors linked to tables: ${Object.keys(SENSOR_TABLES).join(", ") || "none yet"}`);
    } catch (err) {
      console.warn(`Database NOT connected (${err.message}).`);
      console.warn("Check server/.env, and that this laptop is on the Tailscale network.");
    }
  });
}
