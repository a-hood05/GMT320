
// FARMTECH AFRICA - 3D Digital Twin of the UP Farm (CesiumJS)
// Layers: AOI boundary, buildings, roads, trees, irrigation,
//         rainwater tanks, sensors


//Accessing Cesium using my token
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2NjgyODg4Yy05YTQ2LTQ0MzUtYWZhNC0xMzVmN2Y5MDQ2NGQiLCJpZCI6NDY3MjY4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODY1NTA3MDd9.edF695I1YC6XrJnWxQu4MM-tIul7HmSdsa7VPfABWTE";


// ---------------------------------------------------------------------
// STEP 1 - Create the viewer (the 3D globe)
// ---------------------------------------------------------------------
// Real ground elevation from Cesium ion. If it can't load (no internet, network
// blocks cesium.com), fall back to a flat globe so the map still shows
// instead of an empty black "space" view.
const worldTerrain = Cesium.Terrain.fromWorldTerrain();
worldTerrain.errorEvent.addEventListener((err) => {
  console.warn("World terrain unavailable - using a flat globe", err);
  viewer.scene.setTerrain(new Cesium.Terrain(Promise.resolve(new Cesium.EllipsoidTerrainProvider())));
});

const viewer = new Cesium.Viewer("cesiumContainer", {
  terrain: worldTerrain,   // real ground elevation
  baseLayerPicker: true,   // switch background maps (satellite, streets...)
  geocoder: false,         // hide the search box
  timeline: false,         // hide the time bar
  animation: false,        // hide the clock dial
  sceneModePicker: true,   // 3D / 2D switch
  homeButton: true
});

// Stops buildings/trees from being drawn "through" hills
viewer.scene.globe.depthTestAgainstTerrain = true;

// Only redraw when something changes (camera move, data loaded) instead of
// 60 times a second - much lighter on the graphics card and the laptop's battery/heat.
viewer.scene.requestRenderMode = true;
viewer.scene.maximumRenderTimeChange = Infinity;


// ---------------------------------------------------------------------
// STEP 2 - Your data files (GeoJSON files in src/data)
// ---------------------------------------------------------------------
const FILES = {
  aoi:        "../src/data/UP_farm_aoi.geojson",   // farm boundary (polygon)
  buildings:  "../src/data/building.geojson",      // polygons
  roads:      "../src/data/road.geojson",          // lines
  trees:      "../src/data/tree.geojson",          // points (or polygons)
  irrigation: "../src/data/irrigation.geojson",    // lines
  tanks:      "../src/data/rainwater_tank.geojson",// points (or polygons)
  sensors:    "../src/data/sensor.geojson"         // points
};

// We store every loaded layer here so the checkboxes can show/hide them
const layers = {};


// ---------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------

// Read an attribute from a feature. You can give several possible column
// names; the first one that has a value wins. If none do, we use "fallback".
// Example: getProp(entity, ["Height", "height", "HEIGHT"], 5)
function getProp(entity, names, fallback) {
  if (!entity.properties) return fallback;
  for (const name of names) {
    const prop = entity.properties[name];
    if (prop !== undefined) {
      const value = prop.getValue(Cesium.JulianDate.now());
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return fallback;
}

// Zoom behaviour for dots (sensors, tanks): full size up close, shrinking as you
// zoom out, and hidden beyond POINT_HIDE_M so the farm overview stays readable.
const POINT_SCALE = new Cesium.NearFarScalar(150, 1.0, 1500, 0.4);   // 150 m: 100%, 1.5 km: 40%
const POINT_HIDE_M = 1500;

// Turn the default GeoJSON point pin into a coloured dot stuck to the ground
function stylePoint(entity, color, size) {
  entity.billboard = undefined;                  // remove the default blue pin
  entity.point = {
    pixelSize: size,
    color: color,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 2,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY, // never hidden by terrain
    scaleByDistance: POINT_SCALE,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, POINT_HIDE_M)
  };
}

// Add a text label above a feature (only visible when you zoom in close)
function addLabel(entity, text) {
  entity.label = {
    text: String(text),
    font: "14px sans-serif",
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 3,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    pixelOffset: new Cesium.Cartesian2(0, -20),
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1200),
    disableDepthTestDistance: Number.POSITIVE_INFINITY
  };
}

// Load one GeoJSON file, add it to the map, then run a "styler" function
// on every feature in it.
//   key      - short name (used for layers[key] and the checkbox)
//   file     - the .geojson file name
//   styler   - function(entity) that sets colours, heights, etc.
//   options  - extra Cesium load options (e.g. { clampToGround: true })
function loadLayer(key, file, styler, options = {}) {
  return Cesium.GeoJsonDataSource.load(file, options)
    .then((dataSource) => {
      layers[key] = dataSource;
      viewer.dataSources.add(dataSource);

      const entities = dataSource.entities.values;
      console.log(`[${key}] loaded ${entities.length} features`);

      // Print the column names once, so you can see what attributes you have
      if (entities.length > 0 && entities[0].properties) {
        console.log(`[${key}] columns:`, entities[0].properties.propertyNames);
      }

      for (const entity of entities) styler(entity);
      return dataSource;
    })
    .catch((err) => console.error(`Could not load ${file}:`, err));
}


// ---------------------------------------------------------------------
// STEP 3 - Farm boundary (AOI) + automatic camera zoom
// ---------------------------------------------------------------------
loadLayer("aoi", FILES.aoi, (entity) => {
  if (!entity.polygon) return;

  // Ground-clamped polygons can't have outlines in Cesium, so we copy the
  // polygon's corner points into a clamped line and hide the fill.
  const corners = entity.polygon.hierarchy.getValue(Cesium.JulianDate.now()).positions;
  entity.polyline = {
    positions: corners.concat([corners[0]]),   // repeat 1st point to close the loop
    width: 4,
    clampToGround: true,
    material: Cesium.Color.YELLOW
  };
  entity.polygon.material = Cesium.Color.YELLOW.withAlpha(0.05); // faint fill
  entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
}, { clampToGround: true }).then((dataSource) => {
  // Fly to wherever the farm boundary is - no manual coordinates needed!
  if (dataSource) {
    viewer.flyTo(dataSource, {
      duration: 3,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(0),    // facing North
        Cesium.Math.toRadians(-45),  // tilted 45 degrees
        0                            // 0 = auto-pick a distance that fits the farm
      )
    });
  }
});


// ---------------------------------------------------------------------
// STEP 4 - Buildings: walls coloured by building type, plus a separate roof
//          slab coloured by roof material (from the attribute table)
// ---------------------------------------------------------------------
const WALL_COLOURS = {                       // building_t
  greenhouse:   Cesium.Color.WHITE.withAlpha(0.35),       // see-through
  shed:         Cesium.Color.fromCssColorString("#c3c7cb"),
  storage:      Cesium.Color.fromCssColorString("#c3c7cb"),
  warehouse:    Cesium.Color.fromCssColorString("#b8bdc2"),
  parking:      Cesium.Color.fromCssColorString("#b8bdc2"),
  water_storage: Cesium.Color.fromCssColorString("#9fb8c8"),
  hut:          Cesium.Color.fromCssColorString("#a67c52"),
  bridge:       Cesium.Color.fromCssColorString("#9e9e9e"),
};
const DEFAULT_WALL = Cesium.Color.fromCssColorString("#e6dcc6");  // offices, houses, labs ...

const ROOF_COLOURS = {                       // first word of roof_type
  zinc:  Cesium.Color.fromCssColorString("#8d98a3"),      // corrugated metal
  tile:  Cesium.Color.fromCssColorString("#b4532a"),      // terracotta
  pvc:   Cesium.Color.WHITE.withAlpha(0.6),
  glass: Cesium.Color.fromCssColorString("#cfe8f5").withAlpha(0.5),
  grass: Cesium.Color.fromCssColorString("#a08850"),      // thatch
};
const DEFAULT_ROOF = Cesium.Color.fromCssColorString("#6f6f6f");
const ROOF_THICKNESS_M = 0.4;

const roofs = [];   // roof slabs are added once all buildings are loaded

loadLayer("buildings", FILES.buildings, (entity) => {
  if (!entity.polygon) return;

  // building height in metres ("height" column); flat/missing heights get 2.5 m
  const height = Math.max(Number(getProp(entity, ["height", "Height", "HEIGHT"], 0)) || 0, 2.5);
  const type = String(getProp(entity, ["building_t"], "")).trim().toLowerCase();
  const roof = String(getProp(entity, ["roof_type"], "")).trim().toLowerCase().split(/[\s&]+/)[0];

  // walls
  entity.polygon.height = 0;
  entity.polygon.extrudedHeight = height;
  entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
  entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
  entity.polygon.material = WALL_COLOURS[type] || DEFAULT_WALL;
  entity.polygon.outline = false;

  // roof slab sitting on top of the walls (water tanks have no roof)
  if (roof !== "n/a" && type !== "water_storage") {
    roofs.push({
      name: entity.name,
      properties: entity.properties,
      polygon: {
        hierarchy: entity.polygon.hierarchy,
        height: height,
        extrudedHeight: height + ROOF_THICKNESS_M,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        material: ROOF_COLOURS[roof] || DEFAULT_ROOF,
      },
    });
  }
}).then((dataSource) => {
  // added to the same layer, so the "Buildings" checkbox hides walls and roofs together
  if (dataSource) roofs.forEach((r) => dataSource.entities.add(r));
});


// ---------------------------------------------------------------------
// STEP 5 - Roads (lines draped over the terrain)
// ---------------------------------------------------------------------
loadLayer("roads", FILES.roads, (entity) => {
  if (!entity.polyline) return;

  // Colour by surface type (column "road_type1")
  const type = getProp(entity, ["road_type1"], "other");
  const colours = {
    "Asphalt":            Cesium.Color.WHITE,
    "Brick":              Cesium.Color.INDIANRED,
    "Informal dirt road": Cesium.Color.SANDYBROWN
  };

  // Main roads are drawn thicker than field tracks
  const use = getProp(entity, ["road_use_1"], "");
  const width = use === "Main road" ? 7 : 4;

  entity.polyline.clampToGround = true;
  entity.polyline.width = width;
  entity.polyline.material = colours[type] || Cesium.Color.LIGHTGREY;
}, { clampToGround: true });

// ---------------------------------------------------------------------
// STEP 6 - Irrigation lines (pipes / canals)
// ---------------------------------------------------------------------
loadLayer("irrigation", FILES.irrigation, (entity) => {
  if (!entity.polyline) return;
  entity.polyline.clampToGround = true;
  entity.polyline.width = 3;
  entity.polyline.material = Cesium.Color.DEEPSKYBLUE;
}, { clampToGround: true });


// ---------------------------------------------------------------------
// STEP 7 - Trees: simple 3D trees built from Cesium's own shapes
//          (cylinder trunk + ellipsoid crown) - no model file needed.
//          Close up: 3D trees. Further than TREE_3D_M: a green dot per tree.
//          Set USE_3D_TREES = false to show only the dots.
// ---------------------------------------------------------------------
const USE_3D_TREES = true;
const TREE_3D_M = 800;

// Repeatable "random" number per tree, so the orchard looks the same on every reload
function treeRandom(id, salt) {
  const x = Math.sin((Number(id) || 0) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const tree3d = new Cesium.CustomDataSource("trees3d");
viewer.dataSources.add(tree3d);

loadLayer("trees", FILES.trees, (entity) => {
  // Trees stored as polygons: just colour them green
  if (entity.polygon) {
    entity.polygon.material = Cesium.Color.FORESTGREEN.withAlpha(0.8);
    entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
    return;
  }
  entity.billboard = undefined;   // remove the default pin
  entity.point = {
    pixelSize: 5,
    color: Cesium.Color.fromCssColorString("#2f6b25"),
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(USE_3D_TREES ? TREE_3D_M : 0, 6000)
  };
}, { clampToGround: true }).then((dataSource) => {
  if (dataSource && USE_3D_TREES) build3DTrees(dataSource).catch((err) => console.warn("3D trees skipped:", err));
});

async function build3DTrees(dataSource) {
  const now = Cesium.JulianDate.now();
  const trees = dataSource.entities.values.filter((e) => e.position).map((e) => ({
    id: getProp(e, ["id", "fid"], 0),
    carto: Cesium.Cartographic.fromCartesian(e.position.getValue(now)),
  }));

  // real ground height under every tree (terrain is ~1360 m above sea level)
  for (let i = 0; i < 80 && viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider; i++) {
    await new Promise((r) => setTimeout(r, 250));      // wait for the world terrain to be ready
  }
  await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, trees.map((t) => t.carto));

  const show = new Cesium.DistanceDisplayCondition(0, TREE_3D_M);
  const trunkColour = Cesium.Color.fromCssColorString("#5c4029");
  for (const { id, carto } of trees) {
    const ground = carto.height;
    if (!Number.isFinite(ground)) continue;            // never add a tree without a valid height
    const lon = carto.longitude, lat = carto.latitude;
    const size = 0.85 + treeRandom(id, 2) * 0.3;       // 85% - 115%
    const trunkH = 2.4 * size, crownR = 2.5 * size, crownH = 2.1 * size;
    const green = Cesium.Color.fromHsl(0.27 + treeRandom(id, 3) * 0.04, 0.45, 0.28 + treeRandom(id, 4) * 0.08);

    tree3d.entities.add({
      position: Cesium.Cartesian3.fromRadians(lon, lat, ground + trunkH / 2),
      cylinder: { length: trunkH, topRadius: 0.2 * size, bottomRadius: 0.28 * size,
                  material: trunkColour, slices: 8, distanceDisplayCondition: show },
    });
    tree3d.entities.add({
      position: Cesium.Cartesian3.fromRadians(lon, lat, ground + trunkH + crownH * 0.7),
      ellipsoid: { radii: new Cesium.Cartesian3(crownR, crownR, crownH),
                   material: green, slicePartitions: 10, stackPartitions: 8, distanceDisplayCondition: show },
    });
  }
  tree3d.show = !document.getElementById("toggle-trees") || document.getElementById("toggle-trees").checked;
  viewer.scene.requestRender();
}

// The "Trees" checkbox also hides the 3D trees
const treesBox = document.getElementById("toggle-trees");
if (treesBox) treesBox.addEventListener("change", () => { tree3d.show = treesBox.checked; viewer.scene.requestRender(); });

// ---------------------------------------------------------------------
// STEP 8 - Rainwater tanks
// ---------------------------------------------------------------------
loadLayer("tanks", FILES.tanks, (entity) => {
  if (entity.polygon) {
    // Tank footprint drawn as a polygon: extrude it so it looks like a tank
    const h = Number(getProp(entity, ["Height", "height", "HEIGHT"], 2.5)) || 2.5;
    entity.polygon.height = 0;
    entity.polygon.extrudedHeight = h;
    entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
    entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
    entity.polygon.material = Cesium.Color.DODGERBLUE;
    entity.polygon.outline = true;
    entity.polygon.outlineColor = Cesium.Color.BLACK;
  } else {
    // Tank stored as a point -> blue dot, bigger dot = bigger capacity
    // (same style as the 2D map; the 3D JoJo model was removed)
    const capacity = Number(getProp(entity, ["capacity_l"], 0)) || 0;
    stylePoint(entity, Cesium.Color.fromCssColorString("#0d6efd"), 7 + Math.sqrt(capacity) / 20);
  }

  // Label it with a name/ID column if you have one (change names if needed)
  const name = getProp(entity, ["Name", "name", "ID", "id", "Tank_ID"], null);
  if (name !== null) addLabel(entity, name);
});


// ---------------------------------------------------------------------
// STEP 9 - Sensors (soil moisture, weather, etc.)
// ---------------------------------------------------------------------
// RBAC (auth.js / roles_config.js): the public doesn't see where the sensors are
if (typeof AUTH === "undefined" || AUTH.can("locations")) loadLayer("sensors", FILES.sensors, (entity) => {
  stylePoint(entity, Cesium.Color.RED, 12);

  const name = getProp(entity, ["Name", "name", "ID", "id", "Sensor_ID", "type"], null);
  if (name !== null) addLabel(entity, name);

  // Clicking any feature opens Cesium's info box with ALL its attributes.
  // Later you can connect live sensor readings here.
}, { clampToGround: true });


// ---------------------------------------------------------------------
// STEP 10 - Controls (checkboxes + zoom button from index.html)
// ---------------------------------------------------------------------
// Each checkbox has id="toggle-<layerKey>", e.g. "toggle-roads"
Object.keys(FILES).forEach((key) => {
  const box = document.getElementById("toggle-" + key);
  if (!box) return;
  box.addEventListener("change", () => {
    if (layers[key]) layers[key].show = box.checked;  // show or hide the layer
    viewer.scene.requestRender();
  });
});

// "Zoom to farm" button
const zoomBtn = document.getElementById("btn-zoom");
if (zoomBtn) {
  zoomBtn.addEventListener("click", () => {
    if (layers.aoi) viewer.flyTo(layers.aoi, { duration: 2 });
  });
}
