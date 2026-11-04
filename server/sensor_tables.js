// =====================================================================
// WHICH DATABASE TABLE BELONGS TO WHICH SENSOR ON THE MAP
//
// The key is the sensor "id" in src/data/sensor.geojson (1-21).
//   table   - table name in the ftagisdatabase (exactly as in pgAdmin)
//   time    - the time column, or ["date column", "time column"] when the
//             date and time are stored separately
//   tables  - (instead of table) several tables, one per logger port, joined on time
//   columns - (optional) only show these columns; leave out to show every
//             numeric column in the table
//
// Sensors that are not in this list show "not linked to the database yet".
// Run  npm run dbcheck  to see every table and its columns.
// =====================================================================

// " 9/22/2026" + "13:45:00"  ->  2026-09-22 13:45
const WATER_TIME = `(to_date(NULLIF(trim("date"), ''), 'MM/DD/YYYY') + NULLIF(trim("loc time"), '')::time)`;

// Tank level columns. The logger has used different names over time
// ("level1", and now "leve1 (as %)" / "level2 (as %)"), so every spelling is accepted.
export const TANK1 = { label: "Tank 1 level (%)", names: ["leve1 (as %)", "level1 (as %)", "level1", "leve1"] };
export const TANK2 = { label: "Tank 2 level (%)", names: ["level2 (as %)", "leve2 (as %)", "level2", "leve2"] };

export const SENSOR_TABLES = {

  // ---------- Water-level sensors at the JoJo tanks (confirmed) ----------
  // The logger stores the date month-first with a leading space (" 9/22/2026"),
  // so we tell the database exactly how to read it.
  "19": { table: "water_sensors_data", time: ["date", "loc time"], timeSql: WATER_TIME, columns: [TANK1] },
  "20": { table: "water_sensors_data", time: ["date", "loc time"], timeSql: WATER_TIME, columns: [TANK2] },
  "21": { table: "water_sensors_data", time: ["date", "loc time"], timeSql: WATER_TIME, columns: [TANK1, TANK2] },

  // ---------- Chameleon soil-moisture sensors (serial numbers from the team) ----------
  // D967 is at map point 3 (confirmed by the team, Nov 2026).
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

  // ---------- TEROS 21 sensors (treatment loggers, confirmed by the team, Nov 2026) ----------
  // Each logger stores every port in its own table; the dashboard joins them on time
  // and shows the columns as "Port 1 · ...", "Port 2 · ...".
  // Map point 2 (the single TEROS in its row) = Treatment 3,
  // map point 4 (the top one of the pair) = Treatment 2. Point 18 was removed from the map.
  "4": {
    time: "timestamps",
    tables: [
      { table: "treatment 2_Port1", label: "Port 1" },
      { table: "treatment 2_Port2", label: "Port 2" },
      { table: "treatment 2_Port3", label: "Port 3" },
      { table: "treatment 2_Port4", label: "Port 4" },
    ],
  },
  "2": {
    time: "timestamps",
    tables: [
      { table: "Treatment 3_port1", label: "Port 1" },
      { table: "Treatment 3_port2", label: "Port 2" },
    ],
  },
};
