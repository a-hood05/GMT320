// =====================================================================
// ROLE-BASED ACCESS CONTROL (RBAC) - WHO MAY SEE WHAT
// One table for the whole project: the dashboard uses it to show/hide
// layers and panels, and server/server.js reads this SAME file to decide
// which recordings it may send back. Change a role here and both follow.
//
// Permissions:
//   locations - where the sensors and the weather station (AWS) are
//   soil      - soil-moisture recordings, soil pillars, dryness surface
//   imagery   - drone NDVI / NDRE / temperature images
//   water     - SIEMENS recorder: tank levels, municipal vs harvested water
//   aws       - weather station (AWS) recordings
//
// Everyone (also the public) sees the farm layout and the irrigation decision.
// Passwords are NOT here: they live in server/.env (PASS_STAFF, ...).
// =====================================================================
const ROLES_CONFIG = {
  public:     { label: "Public",                short: "Public",       passwordKey: null,              can: [] },
  staff:      { label: "Farm operations staff", short: "Farm staff",   passwordKey: "PASS_STAFF",      can: ["locations", "water"] },
  manager:    { label: "Farm manager",          short: "Farm manager", passwordKey: "PASS_MANAGER",    can: ["locations", "water", "aws"] },
  researcher: { label: "Researcher",            short: "Researcher",   passwordKey: "PASS_RESEARCHER", can: ["locations", "soil", "imagery", "aws"] },
  admin:      { label: "Master admin",          short: "Admin",        passwordKey: "PASS_ADMIN",      can: ["locations", "soil", "imagery", "water", "aws"] },
};

// What each permission is called on screen (used in the "locked" messages)
const PERMISSION_LABELS = {
  locations: "sensor and weather-station locations",
  soil: "soil-moisture recordings",
  imagery: "drone NDVI / NDRE / temperature images",
  water: "SIEMENS water recordings (tank levels)",
  aws: "weather-station recordings",
};
