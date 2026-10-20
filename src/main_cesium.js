// Step 1: Create Terrain View 
Cesium.Ion.defaultAccessToken = 
'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2NjgyODg4Yy05YTQ2LTQ0MzUtYWZhNC0xMzVmN2Y5MDQ2NGQiLCJpZCI6NDY3MjY4LCJpc3MiOiJodHRwczovL2FwaS5jZXNpdW0uY29tIiwiYXVkIjoidW5kZWZpbmVkX2RlZmF1bHQiLCJpYXQiOjE3ODY1NTA3MDd9.edF695I1YC6XrJnWxQu4MM-tIul7HmSdsa7VPfABWTE'

//Step 1b: moving the camera to the farm 
viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
        28.256747, -25.748994, 300
    ),
    orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-35)
    }
});
// Step 2: Create the main Cesium viewer inside the HTML element
// whose ID is "cesiumContainer".

const viewer = new Cesium.Viewer("cesiumContainer", {

    // Display 3D terrain representing the Earth's surface.
    terrain: Cesium.Terrain.fromWorldTerrain(),
    baseLayerPicker: true, // Allow the user to switch available base-map layers.
    geocoder: false,
    timeline: false,
    animation: false,
    sceneModePicker: true,
    infoBox: false
});

// Step 3: These paths assume the files are in public/data/ in Vite.
const farmLayers = [

    {
        name: "Farm Roads",
        url: "/data/roads.geojson",
        type: "road"
    },

    {
        name: "Farm Buildings",
        url: "/data/buildings.geojson",
        type: "building"
    },

    {
        name: "Farm Rooftops",
        url: "/data/rooftops.geojson",
        type: "rooftop"
    },

    {
        name: "JoJo Water Tanks",
        url: "/data/jojo-tanks.geojson",
        type: "tank"
    }

];
// STEP 4: KEEP TRACK OF OUR LOADED DATA
// This array will store datasets after Cesium loads them.
const loadedFarmLayers = [];


// STEP 5: LOAD AND DISPLAY A DATASET
async function loadFarmLayer(layer) {

    try {

        // Load the GeoJSON file from the specified URL.
        const dataSource =
            await Cesium.GeoJsonDataSource.load(layer.url);

        viewer.dataSources.add(dataSource);
        loadedFarmLayers.push(dataSource);
        const entities = dataSource.entities.values;

        // Process each feature separately.
        for (const entity of entities) {

            // Use the feature's existing name when available.
            // Otherwise, use the dataset name.
            entity.name = entity.name || layer.name;


            // STEP 5A: STYLE FARM ROADS

            // The roads must be GeoJSON features
            if (layer.type === "road" && entity.polyline) {
                entity.polyline.width = 4; //setting the road thickness
                entity.polyline.material =
                    Cesium.Color.ORANGE;
            }

             // STEP 5B: STYLE BUILDINGS
            if (
                layer.type === "building" &&
                entity.polygon
            ) {

                // Giving the building footprints a brown colour.
                entity.polygon.material =
                    Cesium.Color.SANDYBROWN.withAlpha(0.9);
                entity.polygon.outline = true;

                entity.polygon.outlineColor =
                    Cesium.Color.WHITE;
            }
            // STEP 5C: STYLE SENSORS

            // rooftops must be polygon features.
            if (
                layer.type === "sensors" &&
                entity.polygon
            ) {

                // setting the colour for rooftops.
                entity.polygon.material =
                    Cesium.Color.DARKSLATEGRAY.withAlpha(0.95);
                entity.polygon.outline = true;
                entity.polygon.outlineColor =
                    Cesium.Color.WHITE;
            }

            // STEP 5D: DISPLAY JOJO TANK LOCATIONS
            // The jojo tanks are point features
            if (
                layer.type === "tank" &&
                entity.position
            ) {

                // Display a blue marker for each water tank.
                entity.point = new Cesium.PointGraphics({
                    pixelSize: 12,
                    color: Cesium.Color.DODGERBLUE,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2
                });
            }

        }


        // Print the number of features loaded.
        console.log(
            `${layer.name}: ${entities.length} features loaded.`
        );

        // Return the successfully loaded dataset.
        return dataSource;


    } catch (error) {

        // Report a useful error if the file cannot load.
        console.error(
            `Error loading ${layer.name}:`,
            error
        );

        // Return null so the application can continue
        // loading the other datasets.
        return null;
    }
}

// STEP 6: LOAD ALL FARM INFRASTRUCTURE

async function loadFarmData() {

    // Loading the four datasets.
    const results = await Promise.all(
        farmLayers.map(layer => loadFarmLayer(layer))
    );
    // Keep only datasets that loaded successfully.
    const successfulLayers = results.filter(
        dataSource => dataSource !== null
    );

    // STEP 6A: ZOOM TO OUR ACTUAL FARM DATA

    // Do not use the example project's Hatfield coordinates.
    // Instead, calculate the view from the loaded features.

    if (successfulLayers.length > 0) {

        await viewer.flyTo(successfulLayers);

        console.log(
            "FarmTech Africa infrastructure is ready."
        );

    } else {

        // If nothing loaded, the file paths or data may
        // need checking.
        console.warn(
            "No datasets loaded. Check your GeoJSON files."
        );
    }
}

// STEP 7: START FARMTECH AFRICA
// Run the function that loads the farm infrastructure.

loadFarmData();

