
// FARMTECH AFRICA - 3D Digital Twin of the UP Farm (CesiumJS)
// Layers: AOI boundary, buildings, roads, trees, irrigation,
//         rainwater tanks, sensors


//Accessing Cesium using my token
Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2NjgyODg4Yy05YTQ2LTQ0MzUtYWZhNC0xMzVmN2Y5MDQ2NGQiLCJpZCI6NDY3MjY4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODY1NTA3MDd9.edF695I1YC6XrJnWxQu4MM-tIul7HmSdsa7VPfABWTE";


// ---------------------------------------------------------------------
// STEP 1 - Create the viewer (the 3D globe)
// ---------------------------------------------------------------------
const viewer = new Cesium.Viewer("cesiumContainer", {
  terrain: Cesium.Terrain.fromWorldTerrain(), // real ground elevation
  baseLayerPicker: true,   // switch background maps (satellite, streets...)
  geocoder: false,         // hide the search box
  timeline: false,         // hide the time bar
  animation: false,        // hide the clock dial
  sceneModePicker: true,   // 3D / 2D switch
  homeButton: true
});

// Stops buildings/trees from being drawn "through" hills
viewer.scene.globe.depthTestAgainstTerrain = true;


// ---------------------------------------------------------------------
// STEP 2 - Your data files (must be in the same folder as index.html)
// ---------------------------------------------------------------------
const FILES = {
  aoi:        "data/UP_farm_aoi.geojson",   // farm boundary (polygon)
  buildings:  "data/building.geojson",      // polygons
  roads:      "data/road.geojson",          // lines
  trees:      "data/tree.geojson",          // points (or polygons)
  irrigation: "data/irrigation.geojson",    // lines
  tanks:      "data/rainwater_tank.geojson",// points (or polygons)
  sensors:    "data/sensor.geojson"         // points
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

// Turn the default GeoJSON point pin into a coloured dot stuck to the ground
function stylePoint(entity, color, size) {
  entity.billboard = undefined;                  // remove the default blue pin
  entity.point = {
    pixelSize: size,
    color: color,
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 2,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY // never hidden by terrain
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
// STEP 4 - Buildings (polygons -> 3D extruded boxes)
// ---------------------------------------------------------------------
loadLayer("buildings", FILES.buildings, (entity) => {
  if (!entity.polygon) return;

  // Look for a height column under a few common names; default 5 m.
  // !! Change these names to match YOUR attribute table !!
  const raw = getProp(entity, ["Height", "height", "HEIGHT", "Heigh", "levels"], 5);
  const height = Number(raw) || 5;

  entity.polygon.height = 0;                    // base on the ground
  entity.polygon.extrudedHeight = height;       // top = height metres up
  entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
  entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND;
  entity.polygon.material = Cesium.Color.ORANGE;
  entity.polygon.outline = true;
  entity.polygon.outlineColor = Cesium.Color.BLACK;
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
// STEP 7 - Trees (points -> green dots, or polygons -> green canopy)
// ---------------------------------------------------------------------
// STEP 7 - Trees (3D models instead of dots)
let treeCount = 0;   // counts trees, used for the 10-tree test below

loadLayer("trees", FILES.trees, (entity) => {
  // Trees stored as polygons: just colour them green
  if (entity.polygon) {
    entity.polygon.material = Cesium.Color.FORESTGREEN.withAlpha(0.8);
    entity.polygon.classificationType = Cesium.ClassificationType.TERRAIN;
    return;
  }

  entity.billboard = undefined;   // remove the default pin
  treeCount++;

  // Simple green dot, shown when the camera is far away (over 300 m)
  entity.point = {
    pixelSize: 6,
    color: Cesium.Color.FORESTGREEN,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(300, Number.POSITIVE_INFINITY)
  };

  // TEST: only the first 10 trees get a 3D model.
  // Once it runs smoothly, change 10 to 168 (or delete this if-line).
  if (treeCount > 10) return;

  // Random rotation so the trees don't all look identical
  const position = entity.position.getValue(Cesium.JulianDate.now());
  entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(Math.random() * Math.PI * 2, 0, 0)
  );

  // The 3D tree, only drawn when the camera is within 300 m
  entity.model = {
    uri: "models/trees/scene.gltf",     // folder is "trees" (with an s)
    scale: 1,                           // change if trees look too big or small
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 300)
  };
}, { clampToGround: true });

// ---------------------------------------------------------------------
// STEP 8 - Rainwater tanks (JoJo-style tanks)
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
  // Tank stored as a point -> show a 3D JoJo tank model instead of a dot
  entity.billboard = undefined;
  entity.point = undefined;
  entity.model = {
    uri: "models/jojo_tank/scene.gltf",
    scale: 3.0,
    minimumPixelSize: 80,
    maximumScale: 200,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    color: Cesium.Color.DARKGREEN,
colorBlendMode: Cesium.ColorBlendMode.MIX,
colorBlendAmount: 0.5,
  };
}

  // Label it with a name/ID column if you have one (change names if needed)
  const name = getProp(entity, ["Name", "name", "ID", "id", "Tank_ID"], null);
  if (name !== null) addLabel(entity, name);
});


// ---------------------------------------------------------------------
// STEP 9 - Sensors (soil moisture, weather, etc.)
// ---------------------------------------------------------------------
loadLayer("sensors", FILES.sensors, (entity) => {
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
  });
});

// "Zoom to farm" button
const zoomBtn = document.getElementById("btn-zoom");
if (zoomBtn) {
  zoomBtn.addEventListener("click", () => {
    if (layers.aoi) viewer.flyTo(layers.aoi, { duration: 2 });
  });
}
