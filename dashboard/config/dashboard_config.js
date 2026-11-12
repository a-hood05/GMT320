// =====================================================================
// DASHBOARD SETTINGS - the only file you should need to edit
// =====================================================================
const DASHBOARD_CONFIG = {

  // Where the PostgreSQL API (server/server.js) is running.
  // Empty when the page comes from our own server (port 3000), otherwise port 3000.
  API_BASE: (location.port === "3000") ? "" : "http://localhost:3000",

  // Which attribute in sensor.geojson matches the sensor id in the database.
  // sensor.geojson has: fid, id, sensor_typ, installDat
  SENSOR_ID_FIELD: "id",

  // NDVI images: a list of the images with their dates.
  // See src/ndvi/ndvi_manifest.json for the format.
  NDVI_MANIFEST: "../src/ndvi/ndvi_manifest.json",
  // The image paths inside the manifest start from the src folder (ndvi/...).
  SRC_FOLDER: "../src/",

  // GeoJSON layers (same files as the 3D map uses)
  FILES: {
    aoi:        "../src/data/UP_farm_aoi.geojson",
    buildings:  "../src/data/building.geojson",
    roads:      "../src/data/road.geojson",
    trees:      "../src/data/tree.geojson",
    irrigation: "../src/data/irrigation.geojson",
    tanks:      "../src/data/rainwater_tank.geojson",
    sensors:    "../src/data/sensor.geojson",
    aws:        "../src/data/aws.geojson"          // Davis Vantage Pro2 weather station
  },

  // Weather station representativeness rings - how far the AWS weather applies.
  // Source: WMO Guide to Instruments and Methods of Observation (WMO-No. 8),
  // Volume I, Chapter 1, section 1.1.2 "Representativeness":
  //   microscale < 100 m (agricultural meteorology, e.g. evaporation)
  //   toposcale / local scale 100 m - 3 km
  AWS_RINGS: [
    { m: 100,  label: "100 m – microscale (WMO-No. 8)" },
    { m: 3000, label: "3 km – local scale (WMO-No. 8)" },
  ],
  AWS_RANGE_LABEL: "Representative area: microscale < 100 m, local scale up to 3 km (WMO-No. 8, §1.1.2)"
};
