/*
    FarmTech Africa - 2D Interactive Farm Map
    This code loads our GeoJSON layers into Leaflet.
*/

// 1. Create the map
const map = L.map("map");

// 2. Add the OpenStreetMap background
const osm = L.tileLayer(
    "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
    }
).addTo(map);

// 3. Create a control group for the layers
const overlayLayers = {};

// 4. Function to load a GeoJSON file
async function loadGeoJSON(fileName, layerName, styleOptions = {}) {

    try {
        // Find the GeoJSON file inside src/data
        const response = await fetch(`./data/${fileName}`);

        // Check whether the file was found
        if (!response.ok) {
            throw new Error(`Could not find ${fileName}`);
        }

        // Convert the file into JavaScript data
        const geojsonData = await response.json();

        // Turn the GeoJSON features into a Leaflet layer
        const layer = L.geoJSON(geojsonData, {

            // Style polygons and lines
            style: function () {
                return styleOptions;
            },

            // Style point features such as sensors and tanks
            pointToLayer: function (feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: layerName === "Sensors" ? 7 : 6,
                    color: styleOptions.color || "#333333",
                    fillColor: styleOptions.fillColor || "#aaaaaa",
                    fillOpacity: 0.9,
                    weight: 2
                });
            },

            // Show a popup when a feature is clicked
            onEachFeature: function (feature, featureLayer) {
                const properties = feature.properties || {};

                let popupContent = `<b>${layerName}</b>`;

                // Display the available attribute information
                for (const key in properties) {
                    popupContent += `<br>${key}: ${properties[key]}`;
                }

                featureLayer.bindPopup(popupContent);
            }

        });

        // Add the layer to the map
        layer.addTo(map);

        // Give it a name in the layer control
        overlayLayers[layerName] = layer;

        console.log(`${layerName} loaded successfully`);

        return layer;

    } catch (error) {
        console.error(`Error loading ${layerName}:`, error);
        return null;
    }
}

// 5. Load all the farm layers
async function loadFarmLayers() {

    const farmBoundary = await loadGeoJSON(
        "UP_farm_aoi.geojson",
        "Farm Boundary",
        {
            color: "#174b35",
            fillColor: "#8bcf63",
            fillOpacity: 0.08,
            weight: 3
        }
    );

    await loadGeoJSON(
        "building.geojson",
        "Buildings",
        {
            color: "#8b4513",
            fillColor: "#d9a066",
            fillOpacity: 0.8,
            weight: 2
        }
    );

    await loadGeoJSON(
        "road.geojson",
        "Roads",
        {
            color: "#555555",
            weight: 4
        }
    );

    await loadGeoJSON(
        "irrigation.geojson",
        "Irrigation",
        {
            color: "#168aad",
            fillColor: "#48cae4",
            fillOpacity: 0.7,
            weight: 2
        }
    );

    await loadGeoJSON(
        "rainwater_tank.geojson",
        "Rainwater Tanks",
        {
            color: "#1565c0",
            fillColor: "#42a5f5"
        }
    );

    await loadGeoJSON(
        "sensor.geojson",
        "Sensors",
        {
            color: "#b71c1c",
            fillColor: "#ff5252"
        }
    );

    await loadGeoJSON(
        "tree.geojson",
        "Trees",
        {
            color: "#1b5e20",
            fillColor: "#66bb6a"
        }
    );

    // 6. Add the layer switcher
    L.control.layers(
        { "OpenStreetMap": osm },
        overlayLayers,
        { collapsed: false }
    ).addTo(map);

    // 7. Zoom to the farm boundary if it loaded successfully
    if (farmBoundary && farmBoundary.getBounds().isValid()) {
        map.fitBounds(farmBoundary.getBounds(), {
            padding: [20, 20]
        });
    } else {
        // Temporary fallback view if the boundary is unavailable
        map.setView([-25.75, 28.23], 15);
    }

   /*
    8. Add a dynamic distance scale
*/

L.control.scale({
    position: "bottomleft",
    maxWidth: 160,
    metric: true,
    imperial: false,
    updateWhenIdle: true
}).addTo(map);
}
/*
    9. Add a map legend
*/

const legend = L.control({
    position: "bottomright"
});

legend.onAdd = function () {

    const div = L.DomUtil.create("div", "map-legend");

    div.innerHTML = `
        <strong>FarmTech Africa</strong><br>
        <span style="color:#8b4513;">●</span> Buildings<br>
        <span style="color:#b71c1c;">●</span> Sensors<br>
        <span style="color:#1565c0;">●</span> Rainwater tanks<br>
        <span style="color:#1b5e20;">●</span> Trees<br>
        <span style="color:#168aad;">━</span> Irrigation<br>
        <span style="color:#555555;">━</span> Roads<br>
        <span style="color:#174b35;">━</span> Farm boundary
    `;

    return div;
};

 legend.addTo(map); 

 /* 10. Add a north arrow */

const northArrow = L.control({
    position: "topright"
});

northArrow.onAdd = function () {
    const div = L.DomUtil.create("div", "north-arrow");

    div.innerHTML = `
        <div class="north-label">N</div>
        <svg width="34" height="48" viewBox="0 0 34 48"
             xmlns="http://www.w3.org/2000/svg">
            <polygon points="17,2 4,34 17,27"
                     fill="#174b35"/>
            <polygon points="17,2 17,27 30,34"
                     fill="#ffffff" stroke="#174b35"/>
            <line x1="17" y1="2" x2="17" y2="44"
                  stroke="#174b35" stroke-width="1.5"/>
        </svg>
    `;

    return div;
};

northArrow.addTo(map);
/*
    11. Display the coordinates under the mouse
*/

const coordinateControl = L.control({
    position: "bottomleft"
});

coordinateControl.onAdd = function () {
    this._div = L.DomUtil.create("div", "coordinate-display");
    this._div.innerHTML = "Latitude: — | Longitude: —";
    return this._div;
};

coordinateControl.addTo(map);

map.on("mousemove", function (event) {
    const lat = event.latlng.lat.toFixed(5);
    const lng = event.latlng.lng.toFixed(5);

    coordinateControl.getContainer().innerHTML =
        `Latitude: ${lat} | Longitude: ${lng}`;
});
/*
    12. Search farm features and zoom to a result
*/

// Find the search controls from leaflet.html
const searchInput = document.getElementById("feature-search");
const searchResults = document.getElementById("search-results");
const clearSearchButton = document.getElementById("clear-search");

// Store the features that match the search
let matchingFeatures = [];

// Search all the GeoJSON layers already loaded on the map
function searchFarmFeatures(searchText) {
    matchingFeatures = [];

    const query = searchText.trim().toLowerCase();

    // Clear old results
    searchResults.replaceChildren();

    // Do not search for an empty phrase
    if (!query) {
        return;
    }

    // Go through each layer, such as Buildings, Sensors and Trees
    for (const layerName in overlayLayers) {
        const geoJsonLayer = overlayLayers[layerName];

        geoJsonLayer.eachLayer(function (featureLayer) {
            const properties = featureLayer.feature?.properties || {};

            // Search the layer name and its GeoJSON attribute values
            const searchableText = (
                layerName + " " +
                Object.entries(properties)
                    .map(([key, value]) => `${key} ${value ?? ""}`)
                    .join(" ")
            ).toLowerCase();

            if (searchableText.includes(query)) {
                matchingFeatures.push({
                    layerName: layerName,
                    featureLayer: featureLayer,
                    properties: properties
                });
            }
        });
    }

    // Show a message if nothing matches
    if (matchingFeatures.length === 0) {
        const message = document.createElement("p");
        message.textContent = "No matching features found.";
        searchResults.appendChild(message);
        return;
    }

    // Show up to 20 results at a time
    const resultsToShow = matchingFeatures.slice(0, 20);

    resultsToShow.forEach(function (item, index) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";

        // Use a useful attribute as the feature label, if available
        const values = Object.entries(item.properties)
            .filter(([key, value]) =>
                value !== null &&
                value !== undefined &&
                String(value).trim() !== ""
            )
            .slice(0, 2)
            .map(([key, value]) => `${key}: ${value}`);

        button.textContent = values.length
            ? `${item.layerName} — ${values.join(", ")}`
            : `${item.layerName} — Feature ${index + 1}`;

        // Clicking a result zooms to that feature
        button.addEventListener("click", function () {
            const featureLayer = item.featureLayer;

            // Turn on its layer if it has been switched off
            const parentLayer = overlayLayers[item.layerName];

            if (parentLayer && !map.hasLayer(parentLayer)) {
                parentLayer.addTo(map);
            }

            // Zoom to the feature's location
            if (typeof featureLayer.getBounds === "function") {
                const bounds = featureLayer.getBounds();

                if (bounds.isValid()) {
                    map.fitBounds(bounds, {
                        padding: [40, 40],
                        maxZoom: 18
                    });
                }
            } else if (typeof featureLayer.getLatLng === "function") {
                map.setView(featureLayer.getLatLng(), 18);
            }

            // Open its information popup, if it has one
            if (typeof featureLayer.openPopup === "function") {
                featureLayer.openPopup();
            }
        });

        searchResults.appendChild(button);
    });

    if (matchingFeatures.length > 20) {
        const message = document.createElement("p");
        message.textContent =
            `Showing 20 of ${matchingFeatures.length} matches. Type more to narrow your search.`;
        searchResults.appendChild(message);
    }
}

// Search as the user types
searchInput.addEventListener("input", function () {
    searchFarmFeatures(searchInput.value);
});

// Clear the search results
clearSearchButton.addEventListener("click", function () {
    searchInput.value = "";
    searchResults.replaceChildren();
    matchingFeatures = [];
});

 // Start loading the layers
loadFarmLayers();