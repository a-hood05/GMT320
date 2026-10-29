// =====================================================================
// WHICH DATABASE TABLE BELONGS TO WHICH SENSOR ON THE MAP
//
// The key is the sensor "id" in src/data/sensor.geojson (1-21).
//   table   - table name in the ftagisdatabase (exactly as in pgAdmin)
//   time    - the time column, or ["date column", "time column"] when the
//             date and time are stored separately
//   columns - (optional) only show these columns; leave out to show every
//             numeric column in the table
//
// Sensors that are not in this list show "not linked to the database yet".
// Run  npm run dbcheck  to see every table and its columns.
// =====================================================================

// " 9/22/2026" + "13:45:00"  ->  2026-09-22 13:45
const WATER_TIME = `(to_date(NULLIF(trim("date"), ''), 'MM/DD/YYYY') + NULLIF(trim("loc time"), '')::time)`;

export const SENSOR_TABLES = {

  // ---------- Water-level sensors at the JoJo tanks (confirmed) ----------
  // The logger stores the date month-first with a leading space (" 9/22/2026"),
  // so we tell the database exactly how to read it.
  "19": { table: "water_sensors_data", time: ["date", "loc time"], timeSql: WATER_TIME, columns: ["level1"] },
  "20": { table: "water_sensors_data", time: ["date", "loc time"], timeSql: WATER_TIME, columns: ["level2"] },
  "21": { table: "water_sensors_data", time: ["date", "loc time"], timeSql: WATER_TIME, columns: ["level1", "level2"] },

  // ---------- Chameleon soil-moisture sensors (serial numbers from the team) ----------
  // NOTE: D967 was given as point 2, but point 2 is a TEROS 21 on the map and
  // point 3 is the Chameleon not otherwise listed - so D967 is linked to 3.
  "1":  { table: "chameleon_19DD", time: "time" },
  "3":  { table: "chameleon_D967", time: "time" },
  "5":  { table: "chameleon_010A", time: "time" },
  "6":  { table: "chameleon_09CC", time: "time" },
  "7":  { table: "chameleon_77E5", time: "time" },
  "8":  { table: "chameleon_8AB2", time: "time" },
  "9":  { table: "chameleon_712B", time: "time" },
  "10": { table: "chameleon_C2BA", time: "time" },
  "11": { table: "chameleon_1184", time: "time" },
  "12": { table: "chameleon_9387", time: "time" },
  "13": { table: "chameleon_7AD3", time: "time" },
  "14": { table: "chameleon_B779", time: "time" },
  "15": { table: "chameleon_EDD5", time: "time" },
  "16": { table: "chameleon_34CC", time: "time" },

  // ---------- TEROS 21 sensors (treatment loggers) ----------
  // e.g. "2": { table: "treatment 2_Port1", time: "timestamps" },
  // Tables available: "treatment 2_Port1" .. "treatment 2_Port4",
  // "Treatment 3_port1", "Treatment 3_port2"
  // Map points that are TEROS 21: 2, 4, 18
};
