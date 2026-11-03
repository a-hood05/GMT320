// =====================================================================
// SMART IRRIGATION DECISION - SETTINGS
// Every number the decision uses lives here, so the team can adjust the
// rules without touching the code. The decision panel in the 3D farm
// prints the values it used.
//
// !! PLACEHOLDERS: agree on these as a team and note your source !!
// =====================================================================
const DECISION_CONFIG = {

  // Step 1 - dryness score per sensor
  // Each Chameleon reports Wet / Moist / Dry per depth (manufacturer classes).
  STATUS_SCORE: { wet: 0, moist: 1, dry: 2 },
  // How much each depth counts (root-zone weighting) - placeholder
  DEPTH_WEIGHTS: { "20 cm": 0.5, "50 cm": 0.3, "80 cm": 0.2 },

  // Step 2 - interpolation across the orchard (Inverse Distance Weighting)
  IDW_POWER: 2,            // 2 = standard IDW
  GRID_CELL_M: 2,          // size of one cell of the dryness surface (metres)
  SAMPLES_PER_ROW: 60,     // points sampled along each irrigation line

  // Step 3 - soil decision from the row's average dryness (0 = wet ... 2 = dry)
  MONITOR_FROM: 0.67,      // below this: no irrigation needed
  IRRIGATE_FROM: 1.33,     // from this: irrigate

  // Step 4 - weather
  RAIN_POSTPONE_MM: 10,    // rain expected in the next 48 h that postpones irrigation - placeholder
  HIGH_ETO_MM: 5,          // daily ETo (AWS) that pushes "monitor" rows to "irrigate" - placeholder
  // Current weather on the farm: AWS (measured) first, Open-Meteo "weather_current" if the AWS is
  // older than 6 h; ignored completely when older than 24 h (set in server/server.js, pickCurrent)
  RAIN_RECENT_MM: 5,       // rain in the last 24 h that postpones irrigation - placeholder

  // Step 5 - rainwater tanks
  TANK_FULL_LEVEL: 100,    // the level sensors report % full (100 = full; can read above 100 when overfilled)
  TANK_LOW_PERCENT: 20,    // below this the decision is flagged "insufficient rainwater"
};
