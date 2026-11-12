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
// It also serves the website: http://localhost:3000/dashboard/dashboard.html
// =====================================================================
import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { SENSOR_TABLES, TANK1, TANK2 } from "./sensor_tables.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(__dirname, ".env") });

const env = (...names) => names.map((n) => process.env[n]).find((v) => v !== undefined && v !== "");
const PORT = Number(env("PORT") || 3000);
const DEMO_MODE = (env("DEMO_MODE") || "auto").toLowerCase();   // auto | true | false
const MAX_ROWS = 5000;

// Columns that are never plotted
const SKIP_COLUMNS = new Set(["id", "fid", "gid", "ogc_fid", "record", "geom", "the_geom", "geometry", "wkb_geometry",
                              "battery (v)", "link"]);

// Accepts our teammate's names (DB_host ...) or the standard PG names
export const DB_CONFIG = {
  host: env("DB_host", "DB_HOST", "PGHOST") || "localhost",
  port: Number(env("DB_port", "DB_PORT", "PGPORT") || 5432),
  user: env("DB_user", "DB_USER", "PGUSER"),
  password: env("DB_password", "DB_PASSWORD", "PGPASSWORD"),
  database: env("DB_name", "DB_NAME", "PGDATABASE"),
  max: 5,
  connectionTimeoutMillis: 20000,   // Tailscale can take a few seconds to wake up
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
app.use(express.json());
app.use(express.static(ROOT));   // serves index.html, src/, etc.


// ---------------------------------------------------------------------
// ROLE-BASED ACCESS CONTROL
// Who may see what: dashboard/config/roles_config.js (the same file the dashboard uses).
// Passwords: server/.env -> PASS_STAFF, PASS_MANAGER, PASS_RESEARCHER, PASS_ADMIN
// Signing in returns a token (signed with AUTH_SECRET, valid 8 h). The browser sends
// it with every request, and each endpoint checks the role's permissions,
// so typing an API address into the browser can't get around the rules.
// ---------------------------------------------------------------------
const { ROLES_CONFIG: ROLES, PERMISSION_LABELS } = new Function(
  fs.readFileSync(path.join(ROOT, "dashboard", "config", "roles_config.js"), "utf8") + "; return { ROLES_CONFIG, PERMISSION_LABELS };")();
export { ROLES };
const DEMO_PASSWORDS = { PASS_STAFF: "staff2026", PASS_MANAGER: "manager2026", PASS_RESEARCHER: "research2026", PASS_ADMIN: "admin2026" };
const AUTH_SECRET = env("AUTH_SECRET") || crypto.randomBytes(32).toString("hex");   // random = everyone signs in again after a restart
const TOKEN_HOURS = 8;
const usingDemoPasswords = Object.keys(DEMO_PASSWORDS).filter((k) => !env(k));
if (usingDemoPasswords.length) {
  console.warn(`! No ${usingDemoPasswords.join(", ")} in server/.env - using the demo passwords from server/.env.example`);
}

const sign = (data) => crypto.createHmac("sha256", AUTH_SECRET).update(data).digest("base64url");
const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function makeToken(role, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ role, exp: now + TOKEN_HOURS * 3600000 })).toString("base64url");
  return body + "." + sign(body);
}

// -> role name ("public" when there is no valid token)
export function roleOf(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const [body, sig] = token.split(".");
  if (!body || !sig || !sameText(sig, sign(body))) return "public";
  try {
    const { role, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
    return ROLES[role] && exp > Date.now() ? role : "public";
  } catch { return "public"; }
}
export const can = (role, permission) => (ROLES[role]?.can || []).includes(permission);

// Stop the request with 403 when the role lacks the permission
function allowed(req, res, permission) {
  const role = roleOf(req);
  if (can(role, permission)) return true;
  res.status(403).json({ error: `Signed in as ${ROLES[role].label}: you don't have access to ${PERMISSION_LABELS[permission]}.`, locked: true, role });
  return false;
}

app.post("/api/login", (req, res) => {
  const { role, password } = req.body || {};
  const r = ROLES[role];
  if (!r || !r.passwordKey) return res.status(400).json({ error: "Choose a role to sign in as." });
  const expected = env(r.passwordKey) || DEMO_PASSWORDS[r.passwordKey];
  if (!sameText(password || "", expected)) return res.status(401).json({ error: "Wrong password for " + r.label + "." });
  res.json({ role, label: r.label, can: r.can, token: makeToken(role), hours: TOKEN_HOURS });
});

app.get("/api/me", (req, res) => {
  const role = roleOf(req);
  res.json({ role, label: ROLES[role].label, can: ROLES[role].can });
});

// Which permission a sensor's recordings need: the SIEMENS water table -> "water", the rest -> "soil"
export const permissionForSensor = (id) => (SENSOR_TABLES[id]?.table === "water_sensors_data" ? "water" : "soil");


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
// Latest recording of EVERY linked sensor (used to colour the 3D sensors)
// -> [{ id, table, time, statuses: {"20 cm status": "Dry"...}, values: {...} }]
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Sensors whose recordings are spread over several tables, one per logger port
// (the TEROS 21 "treatment" loggers). Each table is read, its time column is
// parsed in JavaScript (any date format: "08/19/2026", "08/19/2026 1:30 PM", a
// real timestamp...), and the ports are joined on time with columns named
// "Port 1 · <column>", so the dashboard can chart them like any other sensor.
// ---------------------------------------------------------------------
export function mergePorts(cfg, perTable) {
  const timeCol = String(cfg.time || "timestamps");
  const byTime = new Map(), fieldNames = [];
  perTable.forEach(({ label, rows, fields }) => {
    const cols = fields.filter((f) => f !== timeCol && !SKIP_COLUMNS.has(f.toLowerCase()) && !/^(id|fid|record)$/i.test(f));
    cols.forEach((c) => fieldNames.push(`${label} · ${c}`));
    for (const r of rows) {
      const raw = r[timeCol];
      const t = raw instanceof Date ? raw : parseDate(raw, cfg.dayFirst);
      if (!t || isNaN(t)) continue;
      const key = +t;
      if (!byTime.has(key)) byTime.set(key, { __time: t });
      const row = byTime.get(key);
      for (const c of cols) row[`${label} · ${c}`] = r[c];
    }
  });
  const rows = [...byTime.values()].sort((a, b) => a.__time - b.__time);
  return { rows, fieldNames };
}

async function readPorts(cfg, days) {
  const perTable = await Promise.all(cfg.tables.map(async ({ table, label }) => {
    const r = await pool.query(`SELECT * FROM ${q(table)}`);
    return { label, rows: r.rows, fields: r.fields.map((f) => f.name) };
  }));
  let { rows, fieldNames } = mergePorts(cfg, perTable);
  if (days && rows.length) {
    const from = +rows[rows.length - 1].__time - days * 86400000;
    rows = rows.filter((r) => +r.__time >= from);
  }
  return { rows: rows.slice(-MAX_ROWS), fieldNames };
}

const tableName = (cfg) => cfg.table || (cfg.tables || []).map((t) => t.table).join(" + ");

async function latestOfAllSensors() {
  return Promise.all(Object.entries(SENSOR_TABLES).map(async ([id, cfg]) => {
    try {
      if (cfg.tables) {
        const { rows, fieldNames } = await readPorts(cfg, null);
        if (!rows.length) return { id, table: tableName(cfg), empty: true };
        const shaped = shapeRows(id, { ...cfg, table: tableName(cfg), time: "__time" }, rows.slice(-1), fieldNames);
        return { id, table: tableName(cfg), time: shaped.rows[0].time, statuses: shaped.statuses, values: shaped.rows[0] };
      }
      const TS = timeSql(cfg);
      // the last 50 recordings, so one blank row from the logger doesn't hide the latest value
      const r = await pool.query(`SELECT *, ${TS} AS __time FROM ${q(cfg.table)} WHERE ${TS} IS NOT NULL ORDER BY __time DESC LIMIT 50`);
      if (!r.rows.length) return { id, table: cfg.table, empty: true };
      const shaped = shapeRows(id, cfg, r.rows.reverse(), r.fields.map((f) => f.name));
      const values = {};
      let time = null;
      for (const row of shaped.rows) {
        for (const c of shaped.columns) if (row[c] !== null && row[c] !== undefined) { values[c] = row[c]; time = row.time; }
      }
      if (!time) time = shaped.rows[shaped.rows.length - 1]?.time;
      return { id, table: cfg.table, time, statuses: shaped.statuses, values: { time, ...values } };
    } catch (err) {
      return { id, table: tableName(cfg), error: err.message };
    }
  }));
}

app.get("/api/sensors/latest", async (req, res) => {
  if (!allowed(req, res, "soil")) return;
  if (!pool) return res.json({ source: "demo", sensors: [] });
  res.json({ source: "postgis", sensors: await latestOfAllSensors() });
});


// ---------------------------------------------------------------------
// Everything the irrigation decision needs, in one request:
//   sensors  - latest Wet/Moist/Dry status of every soil sensor
//   forecast - rain expected in the next 48 h (weather_forecast_7days)
//   eto      - latest daily ETo + rainfall (AWS Field Trial Section)
//   tanks    - latest tank water levels
// Each part fails on its own, so one missing table never blocks the rest.
// ---------------------------------------------------------------------
const FORECAST_TABLE = "weather_forecast_7days";
const ETO_TABLE = "AWS_Table2_Field_Trial_Section";

// "2026-10-29T13:00", "2026-10-29 13:00", "10/29/2026", "29/10/2026" -> Date
export function parseDate(text, dayFirst = false) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    const [day, month] = dayFirst ? [a, b] : [b, a];
    let hour = +(m[4] || 0);
    if (m[7]) hour = (hour % 12) + (/p/i.test(m[7]) ? 12 : 0);   // 1:30 PM -> 13:30
    return new Date(+m[3], month - 1, day, hour, +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(t);
  return isNaN(d) ? null : d;
}

export function rainNext48h(rows, now = new Date()) {
  const parsed = rows.map((r) => ({ t: parseDate(r.time), mm: toNumber(r.precipitation), p: toNumber(r.precipitation_probability) }))
                     .filter((r) => r.t && r.mm !== null).sort((a, b) => a.t - b.t);
  if (!parsed.length) return null;
  // use the forecast from "now"; if the table is older than that, use its last 48 h and say so
  let start = parsed.find((r) => r.t >= now)?.t;
  const stale = !start;
  if (stale) start = new Date(parsed[parsed.length - 1].t - 47 * 3600000);
  const end = new Date(+start + 48 * 3600000);
  const window = parsed.filter((r) => r.t >= start && r.t < end);
  return {
    mm: Math.round(window.reduce((s, r) => s + r.mm, 0) * 10) / 10,
    maxProbability: window.reduce((m, r) => Math.max(m, r.p ?? 0), 0),
    from: start.toISOString(), to: end.toISOString(), stale,
  };
}

export function latestEto(rows) {
  // decide whether the dates are day-first: any first number above 12 means DD/MM
  const dayFirst = rows.some((r) => { const m = String(r.date ?? "").trim().match(/^(\d{1,2})[-/.]/); return m && +m[1] > 12; });
  const parsed = rows.map((r) => ({ d: parseDate(r.date, dayFirst), eto: toNumber(r["daily eto mm"]), rain: toNumber(r["total rainfall mm"]) }))
                     .filter((r) => r.d && r.eto !== null).sort((a, b) => a.d - b.d);
  const last = parsed[parsed.length - 1];
  return last ? { date: last.d.toISOString(), eto: last.eto, rainfall: last.rain } : null;
}

// ---- Current weather on the farm ----
// 1st choice: the AWS on the farm (measured). 2nd: Open-Meteo "weather_current" (modelled).
// Each gives: when, raining now?, rain in the 24 h before that moment, temperature.
const CURRENT_TABLE = "weather_current";

export function currentFromAws(rows) {
  if (!rows.length) return null;
  const last = rows[rows.length - 1], t = new Date(last.time);
  const day = rows.filter((r) => new Date(r.time) > new Date(+t - 24 * 3600000));
  const temps = [last["high temp"], last["low temp"]].filter((v) => typeof v === "number");
  return {
    source: "AWS (measured on the farm)",
    time: last.time,
    rainingNow: (last["rain rate"] ?? 0) > 0 || (last.rain ?? 0) > 0,
    rain24h: Math.round(day.reduce((s, r) => s + (r.rain ?? 0), 0) * 10) / 10,
    temperature: temps.length ? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10 : null,
  };
}

export function currentFromModel(rows) {
  const parsed = rows.map((r) => ({
    t: parseDate(r.date_time),
    rain: toNumber(r.precipitation) ?? toNumber(r.rain),
    temp: toNumber(r.temperature_2m),
  })).filter((r) => r.t).sort((a, b) => a.t - b.t);
  if (!parsed.length) return null;
  const last = parsed[parsed.length - 1];
  const day = parsed.filter((r) => r.t > new Date(+last.t - 24 * 3600000));
  return {
    source: "Open-Meteo (modelled)",
    time: last.t.toISOString(),
    rainingNow: (last.rain ?? 0) > 0,
    rain24h: Math.round(day.reduce((s, r) => s + (r.rain ?? 0), 0) * 10) / 10,
    temperature: last.temp,
  };
}

// Prefer the newest AWS reading if it is fresh enough, otherwise the model;
// mark it "tooOld" if even the best one is older than 24 h, so the decision ignores it.
export function pickCurrent(aws, model, now = new Date()) {
  const age = (c) => (c ? (now - new Date(c.time)) / 3600000 : Infinity);
  const fresh = 6;   // hours
  let best = null;
  if (aws && age(aws) <= fresh) best = aws;
  else if (model && age(model) <= fresh) best = model;
  else best = [aws, model].filter(Boolean).sort((a, b) => age(a) - age(b))[0] || null;
  if (!best) return null;
  return { ...best, ageHours: Math.round(age(best) * 10) / 10, tooOld: age(best) > 24 };
}

app.get("/api/decision-inputs", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Database not connected (DEMO_MODE=true)" });
  const part = async (fn) => { try { return await fn(); } catch (err) { return { error: err.message }; } };

  const [sensors, forecast, eto, awsNow, modelNow] = await Promise.all([
    latestOfAllSensors(),
    part(async () => rainNext48h((await pool.query(`SELECT * FROM ${q(FORECAST_TABLE)}`)).rows)),
    part(async () => latestEto((await pool.query(`SELECT * FROM ${q(ETO_TABLE)}`)).rows)),
    part(async () => currentFromAws(awsRows((await pool.query(`SELECT * FROM ${q(AWS_TABLE)}`)).rows))),
    part(async () => currentFromModel((await pool.query(`SELECT * FROM ${q(CURRENT_TABLE)}`)).rows)),
  ]);
  const current = pickCurrent(awsNow && !awsNow.error ? awsNow : null, modelNow && !modelNow.error ? modelNow : null)
               || { error: [awsNow?.error, modelNow?.error].filter(Boolean).join("; ") || "no current weather data" };
  const waterRows = sensors.filter((s) => SENSOR_TABLES[s.id]?.table === "water_sensors_data" && s.values);
  const nk = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "");
  const pick = (k) => waterRows.map((s) => Object.entries(s.values).find(([c]) => nk(c) === nk(k))?.[1])
                               .find((v) => v !== undefined && v !== null) ?? null;
  const tanks = waterRows.length ? { time: waterRows[0].time, level1: pick(TANK1.label), level2: pick(TANK2.label) }
                                 : { error: sensors.find((s) => SENSOR_TABLES[s.id]?.table === "water_sensors_data")?.error || "no tank data" };

  // Everyone sees the decision, but only the inputs their role allows:
  // without "soil" only the Wet/Moist/Dry status per sensor is sent (what the decision needs),
  // without "water" only the tanks' average % (for the "insufficient rainwater" flag).
  const role = roleOf(req);
  const soilOk = can(role, "soil"), waterOk = can(role, "water");
  const sensorsOut = sensors
    .filter((s) => permissionForSensor(s.id) === "soil")
    .map((s) => (soilOk ? s : { id: s.id, time: s.time, statuses: s.statuses, error: s.error ? "unavailable" : undefined }));
  const tankLevels = [tanks.level1, tanks.level2].filter((v) => typeof v === "number");
  const tanksOut = waterOk || tanks.error ? tanks
    : { time: tanks.time, percent: tankLevels.length ? tankLevels.reduce((a, b) => a + b, 0) / tankLevels.length : null, locked: true };
  res.json({ source: "postgis", generated: new Date().toISOString(), role,
             sensors: sensorsOut, forecast, eto, tanks: tanksOut, current });
});


// ---------------------------------------------------------------------
// Weather station (Davis Vantage Pro2, AWS_Table1_Phytotron_D_Section_Davis)
//   GET /api/aws/readings?days=7  -> same shape as a sensor's readings
// Dates/times are text in the database, so they are read here in JavaScript.
// ---------------------------------------------------------------------
const AWS_TABLE = "AWS_Table1_Phytotron_D_Section_Davis";
const AWS_COLUMNS = ["high temp", "low temp", "rain", "rain rate"];

// "1:30a", "1:30 PM", "13:30" -> [hours, minutes]
export function parseClock(text) {
  const m = String(text ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?/i);
  if (!m) return [0, 0];
  let h = +m[1];
  if (m[3]) { const pm = m[3].toLowerCase() === "p"; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return [h, +m[2]];
}

export function awsRows(rows) {
  const dayFirst = rows.some((r) => { const m = String(r.date ?? "").trim().match(/^(\d{1,2})[-/.]/); return m && +m[1] > 12; });
  return rows.map((r) => {
    const d = parseDate(r.date, dayFirst);
    if (!d) return null;
    const [h, min] = parseClock(r.time);
    d.setHours(h, min, 0, 0);
    const out = { time: d.toISOString() };
    for (const c of AWS_COLUMNS) out[c] = toNumber(r[c]);
    return out;
  }).filter(Boolean).sort((a, b) => a.time.localeCompare(b.time));
}

app.get("/api/aws/readings", async (req, res) => {
  if (!allowed(req, res, "aws")) return;
  if (!pool) return res.status(503).json({ error: "Database not connected" });
  const days = req.query.days === "all" ? null : Math.min(Math.max(Number(req.query.days) || 7, 1), 3650);
  try {
    const all = awsRows((await pool.query(`SELECT * FROM ${q(AWS_TABLE)}`)).rows);
    const last = all.length ? new Date(all[all.length - 1].time) : null;
    const rows = days && last ? all.filter((r) => new Date(r.time) >= new Date(+last - days * 86400000)) : all;
    const columns = AWS_COLUMNS.filter((c) => rows.some((r) => r[c] !== null));
    res.json({ source: "postgis", table: AWS_TABLE, sensor_id: "aws", statuses: {}, columns,
               rows: rows.slice(-MAX_ROWS), message: rows.length ? undefined : "No weather station records." });
  } catch (err) {
    console.error("AWS query failed:", err.message);
    res.status(500).json({ error: err.message });
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
  if (!allowed(req, res, permissionForSensor(sensorId))) return;

  if (!cfg) {
    return res.json({ source: "none", sensor_id: sensorId, columns: [], rows: [],
                      message: `Sensor ${sensorId} isn't linked to a database table yet.` });
  }
  if (!pool) return res.json(demoReadings(sensorId, days, "DEMO_MODE=true in server/.env"));

  try {
    if (cfg.tables) {
      const { rows, fieldNames } = await readPorts(cfg, days);
      return res.json(shapeRows(sensorId, { ...cfg, table: tableName(cfg), time: "__time" }, rows, fieldNames));
    }
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
    console.error(`Query for sensor ${sensorId} (${tableName(cfg)}) failed:`, err.message);
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
  // configured columns are matched loosely ("level1" also finds "Level1" or "level 1")
  const norm = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, "");
  // A configured column is a name, or { label, names: [...] } to accept several spellings
  // and show a friendly name (e.g. the logger writes "leve1 (as %)" -> "Tank 1 level (%)").
  const labelOf = {};
  const candidates = cfg.columns
    ? cfg.columns.map((c) => {
        const names = typeof c === "string" ? [c] : c.names;
        const found = fieldNames.find((f) => names.some((n) => norm(f) === norm(n))) || names[0];
        labelOf[found] = typeof c === "string" ? found : c.label;
        return found;
      })
    : fieldNames.filter((f) => f !== "__time" && !SKIP_COLUMNS.has(f.toLowerCase()) && !timeCols.has(f));

  // a column is plotted if most of its filled-in values are numbers
  // (text like "12,5" or "12.5 kPa" is converted; blanks and "NaN" are skipped)
  const numeric = candidates.filter((col) => {
    const filled = rows.map((r) => r[col])
      .filter((v) => v !== null && v !== undefined && !/^(|nan|null|none|n\/a|-)$/i.test(String(v).trim()));
    if (!filled.length || filled.every((v) => v instanceof Date)) return false;
    const ok = filled.filter((v) => toNumber(v) !== null).length;
    return ok / filled.length >= 0.8;
  });

  // text status columns (e.g. Chameleon "20 cm status": Wet / Moist / Dry) from the latest row
  const last = rows[rows.length - 1] || {};
  const statuses = Object.fromEntries(fieldNames.filter((f) => /status/i.test(f)).map((f) => [f, last[f] ?? null]));

  return {
    source: "postgis",
    table: cfg.table,
    sensor_id: sensorId,
    statuses,
    columns: numeric.map((c) => labelOf[c] || c),
    rows: rows.map((r) => {
      const t = r.__time;
      const out = { time: t instanceof Date ? t.toISOString() : t };
      for (const c of numeric) out[labelOf[c] || c] = toNumber(r[c]);
      return out;
    }),
    message: rows.length
      ? (numeric.length ? undefined : `Found ${rows.length} recordings, but ${cfg.columns ? cfg.columns.map((c) => (typeof c === "string" ? c : c.label)).join(" / ") : "the columns"} have no numbers in this period. Columns in ${cfg.table}: ${fieldNames.filter((f) => f !== "__time").join(", ")}.`)
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
    console.log(`  Dashboard:  http://localhost:${PORT}/dashboard/dashboard.html\n`);
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
