/* =========================================================
   FARMTECH AFRICA - 2D MAP
   Based on our sem-test "Rainwater Project Dashboard" (script.js),
   plus the drone NDVI / NDRE time slider.
   Order:  map -> basemaps -> load data -> helpers -> layers -> controls
           -> dashboard -> NDVI/NDRE slider
   ========================================================= */


/* ---------- 1. MAP ----------
   setView([LAT, LNG], zoom)  -> Leaflet = LAT first
   GeoJSON files store [LNG, LAT]  -> the other way round! */
var map = L.map('map2d').setView([-25.7488, 28.2585], 16);
window.map2d = map;   // dashboard.js uses this when switching back from 3D

// Panes (Leaflet tutorial: "Working with map panes")
//   ndviPane   (350) - drone imagery, under everything else
//   pointsPane (650) - points always on top of polygons and lines
map.createPane('ndviPane');
map.getPane('ndviPane').style.zIndex = 350;
map.getPane('ndviPane').style.pointerEvents = 'none';
map.createPane('pointsPane');
map.getPane('pointsPane').style.zIndex = 650;


/* ---------- 2. BASEMAPS ---------- */
var imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 21, maxNativeZoom: 19,
  attribution: 'Tiles &copy; Esri'
}).addTo(map); // default here: satellite shows the orchard best

var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 21, maxNativeZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});

var light = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  maxZoom: 21, maxNativeZoom: 20, subdomains: 'abcd',
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
});

var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
  maxZoom: 21, maxNativeZoom: 17,
  attribution: 'Map data &copy; OpenStreetMap contributors, SRTM | Style &copy; OpenTopoMap (CC-BY-SA)'
});


/* ---------- 3. LOAD THE DATA ----------
   In the sem test every layer was a .js file (var xxxData = {...}).
   Here we load the same GeoJSON files the 3D map uses, so both views
   always show the same data. */
var FILES_2D = DASHBOARD_CONFIG.FILES;   // not "FILES": main_cesium.js already uses that name

function loadJSON(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error(url + ' (' + r.status + ')');
    return r.json();
  });
}

Promise.all([
  loadJSON(FILES_2D.aoi), loadJSON(FILES_2D.buildings), loadJSON(FILES_2D.roads),
  loadJSON(FILES_2D.irrigation), loadJSON(FILES_2D.tanks), loadJSON(FILES_2D.sensors), loadJSON(FILES_2D.trees)
]).then(function (d) {
  buildDashboard({
    aoiData: d[0], buildingsData: d[1], roadsData: d[2], irrigationData: d[3],
    tanksData: d[4], sensorsData: d[5], treesData: d[6]
  });
}).catch(function (err) {
  console.error(err);
  document.getElementById('infoPanel').innerHTML =
    '<span class="error">Could not load the map data: ' + err.message +
    '.<br>Open the dashboard through a local server (Live Server, Vite or npm run server), not by double-clicking the file.</span>';
});


function buildDashboard(data) {
  var aoiData = data.aoiData, buildingsData = data.buildingsData, roadsData = data.roadsData,
      irrigationData = data.irrigationData, tanksData = data.tanksData,
      sensorsData = data.sensorsData, treesData = data.treesData;


  /* ---------- 4. HELPER FUNCTIONS ---------- */

  // Field that holds the building height in metres.
  // NOTE: "buildingHe" is the height of the ROOF above sea level (~1370 m),
  // "height" is the building height itself (0-23 m), so we use "height".
  var HEIGHT_FIELD = 'height';

  // Colours handed out to categories, in order
  var palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
                 '#8c564b', '#e377c2', '#17becf', '#bcbd22', '#7f7f7f'];

  // Returns the value of a field, or 'Unknown' if it is empty/null.
  // Also tidies the field-work spellings ("unkown", "Chameleon ", "TERROS 21").
  function getValue(props, field) {
    var v = props[field];
    if (v === null || v === undefined || v === '') return 'Unknown';
    v = String(v).trim();
    if (/^unk?no?wn$|^unkown$|^n\/a$/i.test(v)) return 'Unknown';
    if (field === 'sensor_typ') {
      if (/^ter+os\s*21$/i.test(v)) return 'TEROS 21';
      if (/water_level/i.test(v)) return 'Water level';
      if (/siemens/i.test(v)) return 'Siemens recorder';
    }
    return v;
  }

  // Makes a list of the unique values in a field, e.g. ['PVC', 'tile', 'zinc']
  function uniqueValues(features, field) {
    var list = [];
    features.forEach(function (f) {
      var v = getValue(f.properties, field);
      if (list.indexOf(v) === -1) list.push(v);
    });
    return list.sort();
  }

  // Gives every unique value its own colour
  function makeColourLookup(features, field) {
    var lookup = {};
    uniqueValues(features, field).forEach(function (v, i) {
      lookup[v] = palette[i % palette.length];
    });
    return lookup;
  }

  var roofColours   = makeColourLookup(buildingsData.features, 'roof_type');
  var roadColours   = makeColourLookup(roadsData.features, 'road_type1');
  var sensorColours = makeColourLookup(sensorsData.features, 'sensor_typ');

  // gutter can be 0/1 or false/true -> Number() turns both into 0/1
  function hasGutter(props) {
    return Number(props.gutter) === 1;
  }

  // Height classes (choropleth style)
  function getHeightColour(h) {
    return h > 15 ? '#08306b' :
           h > 10 ? '#2171b5' :
           h > 6  ? '#6baed6' :
           h > 3  ? '#c6dbef' :
                    '#f7fbff';
  }

  // Nice labels for the field names in popups
  var fieldLabels = {
    roof_type: 'Roof type', gutter: 'Gutter', building_t: 'Building type',
    groundHeig: 'Ground height (m asl)', buildingHe: 'Roof height (m asl)', height: 'Height (m)',
    row_number: 'Row number', capacity_l: 'Capacity (L)', con_tanked: 'Connected tank',
    road_use_1: 'Road use', road_type1: 'Road type',
    sensor_typ: 'Sensor type', installDat: 'Install date', id: 'ID'
  };
  var hiddenFields = ['fid'];

  // Builds an attribute table. Empty fields are skipped.
  function makePopup(title, props) {
    var html = '<b class="popup-title">' + title + '</b><table class="popup-table">';
    for (var key in props) {
      var value = props[key];
      if (value === null || value === '' || hiddenFields.indexOf(key) !== -1) continue;
      if (key === 'gutter') value = hasGutter(props) ? 'Yes' : 'No';
      if (typeof value === 'number' && !Number.isInteger(value)) value = value.toFixed(1);
      var label = fieldLabels[key] || key;
      html += '<tr><td><b>' + label + '</b></td><td>' + String(value).trim() + '</td></tr>';
    }
    html += '</table>';
    return html;
  }

  // Puts the same table in the sidebar
  function showInfo(title, props, extra) {
    document.getElementById('infoPanel').innerHTML = makePopup(title, props) + (extra || '');
  }

  // Length of a line in metres. GeoJSON = [lng, lat], so swap them for L.latLng(lat, lng)
  function lineLength(geometry) {
    var lines = (geometry.type === 'LineString') ? [geometry.coordinates] : geometry.coordinates;
    var total = 0;
    lines.forEach(function (line) {
      for (var i = 1; i < line.length; i++) {
        var a = L.latLng(line[i - 1][1], line[i - 1][0]);
        var b = L.latLng(line[i][1], line[i][0]);
        total += a.distanceTo(b); // metres
      }
    });
    return total;
  }


  /* ---------- 5. FARM BOUNDARY ---------- */
  var aoiLayer = L.geoJSON(aoiData, {
    style: { color: '#ffd400', weight: 3, fillOpacity: 0, dashArray: '8 6' },
    interactive: false
  }).addTo(map);


  /* ---------- 6. ROADS (lines, coloured by road_type1) ---------- */
  var roadsLayer = L.geoJSON(roadsData, {
    style: function (feature) {
      return {
        color: roadColours[getValue(feature.properties, 'road_type1')],
        weight: feature.properties.road_use_1 === 'Main road' ? 7 : 5,
        opacity: 0.85
      };
    },
    onEachFeature: function (feature, layer) {
      var len = Math.round(lineLength(feature.geometry));
      layer.bindPopup(makePopup('Road', feature.properties) + 'Length: ' + len + ' m');
      layer.on('click', function () { showInfo('Road', feature.properties, 'Length: ' + len + ' m'); });
    }
  }).addTo(map);


  /* ---------- 7. BUILDINGS (polygons, colour changes with the dropdown) ---------- */
  var colourMode = 'roof'; // 'roof', 'height' or 'gutter'

  function buildingStyle(feature) {
    var p = feature.properties;
    var fill;
    if (colourMode === 'roof') {
      fill = roofColours[getValue(p, 'roof_type')];
    } else if (colourMode === 'height') {
      fill = getHeightColour(Number(p[HEIGHT_FIELD]));
    } else {
      fill = hasGutter(p) ? '#198754' : '#dc3545'; // green = yes, red = no
    }
    return { fillColor: fill, color: '#222', weight: 1, fillOpacity: 0.8 };
  }

  var buildingsLayer;

  function highlightBuilding(e) {
    e.target.setStyle({ weight: 3, color: '#ffc107', fillOpacity: 0.95 });
  }

  function resetHighlight(e) {
    buildingsLayer.resetStyle(e.target);
  }

  buildingsLayer = L.geoJSON(buildingsData, {
    style: buildingStyle,
    onEachFeature: function (feature, layer) {
      layer.bindPopup(makePopup('Building', feature.properties));
      layer.on({
        mouseover: highlightBuilding,
        mouseout: resetHighlight,
        click: function () { showInfo('Building', feature.properties); }
      });
    }
  }).addTo(map);


  /* ---------- 8. IRRIGATION (lines) ---------- */
  var irrigationLayer = L.geoJSON(irrigationData, {
    style: { color: '#00bcd4', weight: 3, dashArray: '6 4' },
    onEachFeature: function (feature, layer) {
      var len = Math.round(lineLength(feature.geometry));
      layer.bindPopup(makePopup('Irrigation line', feature.properties) + 'Length: ' + len + ' m');
      layer.on('click', function () { showInfo('Irrigation line', feature.properties, 'Length: ' + len + ' m'); });
    }
  }).addTo(map);


  /* ---------- 9. POINT LAYERS (pointToLayer -> circleMarker) ---------- */

  // Rainwater tanks: bigger circle = bigger capacity
  var tanksLayer = L.geoJSON(tanksData, {
    pointToLayer: function (feature, latlng) {
      var cap = Number(feature.properties.capacity_l) || 0;
      return L.circleMarker(latlng, {
        pane: 'pointsPane',
        radius: 4 + Math.sqrt(cap) / 10,   // 1000 L ~ 7px, 10 000 L ~ 14px
        fillColor: '#0d6efd', color: '#fff', weight: 1.5, fillOpacity: 0.85
      });
    },
    onEachFeature: function (feature, layer) {
      layer.bindPopup(makePopup('Rainwater tank', feature.properties));
      layer.on('click', function () { showInfo('Rainwater tank', feature.properties); });
    }
  }).addTo(map);

  // Sensors: coloured by sensor_typ, with a button to open the 3D recordings
  function sensorButton(props) {
    var id = props[DASHBOARD_CONFIG.SENSOR_ID_FIELD];
    return '<button class="popup-btn" onclick="openSensorIn3D(\'' + id + '\')">View sensor in 3D →</button>';
  }

  var sensorsLayer = L.geoJSON(sensorsData, {
    pointToLayer: function (feature, latlng) {
      return L.circleMarker(latlng, {
        pane: 'pointsPane',
        radius: 7,
        fillColor: sensorColours[getValue(feature.properties, 'sensor_typ')],
        color: '#000', weight: 1.5, fillOpacity: 0.95
      });
    },
    onEachFeature: function (feature, layer) {
      var title = getValue(feature.properties, 'sensor_typ') + ' sensor';
      layer.bindPopup(makePopup(title, feature.properties) + sensorButton(feature.properties));
      layer.on('click', function () { showInfo(title, feature.properties, sensorButton(feature.properties)); });
    }
  }).addTo(map);

  // Trees: small green dots
  var treesLayer = L.geoJSON(treesData, {
    pointToLayer: function (feature, latlng) {
      return L.circleMarker(latlng, {
        pane: 'pointsPane',
        radius: 3.5, fillColor: '#2e7d32', color: '#0f3d1e', weight: 1, fillOpacity: 0.85
      });
    },
    onEachFeature: function (feature, layer) {
      layer.bindPopup(makePopup('Pecan tree', feature.properties));
    }
  }).addTo(map);

  // Start zoomed to the orchard + farm buildings
  var allLayers = L.featureGroup([roadsLayer, buildingsLayer, irrigationLayer,
                                  tanksLayer, sensorsLayer, treesLayer]);
  function zoomToData() {
    map.fitBounds(L.featureGroup([buildingsLayer, irrigationLayer, tanksLayer, sensorsLayer, treesLayer]).getBounds(),
                  { padding: [30, 30] });
  }
  zoomToData();


  /* ---------- 10. LAYER CONTROL ---------- */
  var baseMaps = {
    'Satellite (Esri)': imagery,
    'OpenStreetMap': osm,
    'Light (Carto)': light,
    'Topographic': topo
  };

  var overlayMaps = {
    'Farm boundary': aoiLayer,
    'Buildings': buildingsLayer,
    'Roads': roadsLayer,
    'Irrigation': irrigationLayer,
    'Rainwater tanks': tanksLayer,
    'Sensors': sensorsLayer,
    'Trees': treesLayer
  };

  L.control.layers(baseMaps, overlayMaps, { collapsed: true, position: 'topright' }).addTo(map);


  /* ---------- 11. SCALE BAR ---------- */
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);


  /* ---------- 12. LEGEND (custom control, rebuilt when colour mode changes) ---------- */
  var legend = L.control({ position: 'bottomright' });
  var legendDiv;

  legend.onAdd = function () {
    legendDiv = L.DomUtil.create('div', 'legend');
    L.DomEvent.disableScrollPropagation(legendDiv);
    return legendDiv;
  };
  legend.addTo(map);

  function updateLegend() {
    var html = '<b>Buildings</b><br>';

    if (colourMode === 'roof') {
      for (var roof in roofColours) {
        html += '<i style="background:' + roofColours[roof] + '"></i>' + roof + '<br>';
      }
    } else if (colourMode === 'height') {
      var grades = [0, 3, 6, 10, 15];
      for (var i = 0; i < grades.length; i++) {
        html += '<i style="background:' + getHeightColour(grades[i] + 1) + '"></i>' +
                grades[i] + (grades[i + 1] ? '&ndash;' + grades[i + 1] + ' m<br>' : '+ m<br>');
      }
    } else {
      html += '<i style="background:#198754"></i>Gutter<br>';
      html += '<i style="background:#dc3545"></i>No gutter<br>';
    }

    html += '<b>Roads</b><br>';
    for (var road in roadColours) {
      html += '<i class="line" style="background:' + roadColours[road] + '"></i>' + road + '<br>';
    }
    html += '<i class="line" style="background:#00bcd4"></i>Irrigation<br>';
    html += '<i class="line" style="background:#ffd400"></i>Farm boundary<br>';

    html += '<b>Sensors</b><br>';
    for (var s in sensorColours) {
      html += '<i class="dot" style="background:' + sensorColours[s] + '"></i>' + s + '<br>';
    }

    html += '<b>Other</b><br>';
    html += '<i class="dot" style="background:#0d6efd"></i>Rainwater tank (size = capacity)<br>';
    html += '<i class="dot" style="background:#2e7d32"></i>Pecan tree';

    legendDiv.innerHTML = html;
  }

  updateLegend();


  /* ---------- 13. MOUSE COORDINATES ---------- */
  map.on('mousemove', function (e) {
    document.getElementById('coords').innerHTML =
      'Lat: ' + e.latlng.lat.toFixed(5) + ' | Lng: ' + e.latlng.lng.toFixed(5);
  });


  /* ================= DASHBOARD FUNCTIONALITY ================= */

  /* ---------- 14. STATISTICS ---------- */
  function updateStats() {
    var buildings = 0, gutters = 0;
    buildingsLayer.eachLayer(function (layer) {
      buildings++;
      if (hasGutter(layer.feature.properties)) gutters++;
    });

    var sensors = 0;
    sensorsLayer.eachLayer(function () { sensors++; });

    var capacity = 0;
    tanksData.features.forEach(function (f) {
      capacity += Number(f.properties.capacity_l) || 0;
    });

    var irrigation = 0;
    irrigationData.features.forEach(function (f) { irrigation += lineLength(f.geometry); });

    var roads = 0;
    roadsData.features.forEach(function (f) { roads += lineLength(f.geometry); });

    document.getElementById('statBuildings').innerHTML  = buildings;
    document.getElementById('statGutters').innerHTML    = gutters;
    document.getElementById('statTanks').innerHTML      = tanksData.features.length;
    document.getElementById('statCapacity').innerHTML   = capacity.toLocaleString('en-ZA');
    document.getElementById('statSensors').innerHTML    = sensors;
    document.getElementById('statTrees').innerHTML      = treesData.features.length;
    document.getElementById('statIrrigation').innerHTML = Math.round(irrigation).toLocaleString('en-ZA');
    document.getElementById('statRoads').innerHTML      = Math.round(roads).toLocaleString('en-ZA');
  }


  /* ---------- 15. FILL THE DROPDOWNS FROM THE DATA ---------- */
  function fillSelect(selectId, features, field) {
    var select = document.getElementById(selectId);
    uniqueValues(features, field).forEach(function (v) {
      var option = document.createElement('option');
      option.value = v;
      option.text = v;
      select.appendChild(option);
    });
  }

  fillSelect('roofFilter',   buildingsData.features, 'roof_type');
  fillSelect('typeFilter',   buildingsData.features, 'building_t');
  fillSelect('sensorFilter', sensorsData.features,   'sensor_typ');

  // Set the slider's maximum to the tallest building
  var maxHeight = 0;
  buildingsData.features.forEach(function (f) {
    var h = Number(f.properties[HEIGHT_FIELD]) || 0;
    if (h > maxHeight) maxHeight = h;
  });
  document.getElementById('heightSlider').max = Math.ceil(maxHeight);


  /* ---------- 16. BUILDING FILTERS (all combined) ---------- */
  function filterBuildings() {
    var roof       = document.getElementById('roofFilter').value;
    var type       = document.getElementById('typeFilter').value;
    var minHeight  = Number(document.getElementById('heightSlider').value);
    var gutterOnly = document.getElementById('gutterOnly').checked;

    document.getElementById('heightValue').innerHTML = minHeight;

    var filtered = buildingsData.features.filter(function (f) {
      var p = f.properties;
      if (roof !== 'All' && getValue(p, 'roof_type') !== roof) return false;
      if (type !== 'All' && getValue(p, 'building_t') !== type) return false;
      if ((Number(p[HEIGHT_FIELD]) || 0) < minHeight) return false;
      if (gutterOnly && !hasGutter(p)) return false;
      return true;
    });

    buildingsLayer.clearLayers();
    buildingsLayer.addData({ type: 'FeatureCollection', features: filtered });
    updateStats();
  }

  document.getElementById('roofFilter').addEventListener('change', filterBuildings);
  document.getElementById('typeFilter').addEventListener('change', filterBuildings);
  document.getElementById('heightSlider').addEventListener('input', filterBuildings);
  document.getElementById('gutterOnly').addEventListener('change', filterBuildings);


  /* ---------- 17. COLOUR-BY DROPDOWN ---------- */
  document.getElementById('colourBy').addEventListener('change', function () {
    colourMode = this.value;
    buildingsLayer.setStyle(buildingStyle);
    updateLegend();
  });


  /* ---------- 18. SENSOR FILTER + BREAKDOWN BARS ---------- */
  function filterSensors() {
    var chosen = document.getElementById('sensorFilter').value;
    var filtered = sensorsData.features.filter(function (f) {
      return chosen === 'All' || getValue(f.properties, 'sensor_typ') === chosen;
    });
    sensorsLayer.clearLayers();
    sensorsLayer.addData({ type: 'FeatureCollection', features: filtered });
    updateStats();
  }

  document.getElementById('sensorFilter').addEventListener('change', filterSensors);

  function drawSensorBars() {
    var counts = {};
    sensorsData.features.forEach(function (f) {
      var t = getValue(f.properties, 'sensor_typ');
      counts[t] = (counts[t] || 0) + 1;
    });

    var total = sensorsData.features.length;
    var html = '';
    for (var t in counts) {
      var percent = Math.round(counts[t] / total * 100);
      html += '<div class="bar-label">' + t + ' (' + counts[t] + ')</div>' +
              '<div class="bar-track"><div class="bar-fill" style="width:' + percent + '%; background:' + sensorColours[t] + '"></div></div>';
    }
    document.getElementById('sensorBars').innerHTML = html;
  }

  drawSensorBars();


  /* ---------- 19. BUTTONS ---------- */
  document.getElementById('zoomAll').addEventListener('click', zoomToData);

  document.getElementById('resetBtn').addEventListener('click', function () {
    document.getElementById('roofFilter').value = 'All';
    document.getElementById('typeFilter').value = 'All';
    document.getElementById('heightSlider').value = 0;
    document.getElementById('gutterOnly').checked = false;
    document.getElementById('sensorFilter').value = 'All';
    filterBuildings();
    filterSensors();
  });


  /* ---------- 20. START ---------- */
  updateStats();
}


/* =========================================================
   21. NDVI / NDRE TIME SLIDER
   The images are made by server/make_vegetation_indices.py, which writes
   a coloured PNG per date + index and src/ndvi/ndvi_manifest.json:
   { "indices": { "ndvi": {...legend}, "ndre": {...legend} },
     "dates": [ { "date": "2026-08-14",
                  "ndvi": { "file": "ndvi/2026-08-14_ndvi.png", "bounds": [[S,W],[N,E]], "mean": 0.41 },
                  "ndre": { ... } } ] }
   ========================================================= */
(function () {
  var $ = function (id) { return document.getElementById(id); };

  var DEFAULT_INDICES = {
    ndvi: { label: 'NDVI', unit: '', min: -0.1, max: 0.9, low: 'Bare soil / stressed', high: 'Healthy vegetation' },
    ndre: { label: 'NDRE', unit: '', min: 0.0,  max: 0.5, low: 'Low chlorophyll', high: 'High chlorophyll' },
    temp: { label: 'Canopy temp', unit: '°C', min: 15, max: 50, low: 'Cool (transpiring)', high: 'Hot (water stress)', reverse: true }
  };

  // 0.4123 for NDVI/NDRE, 27.3 °C for temperature
  function fmtValue(v, info) {
    if (v === null || v === undefined) return '–';
    return info.unit ? v.toFixed(1) + ' ' + info.unit : v.toFixed(3);
  }
  function entryLabel(d, long) {
    var base = long ? fmtDate(d.date) : shortDate(d.date);
    return d.label ? base + (long ? ' – ' : ' ') + d.label.replace(/^flight /, long ? 'flight ' : '#') : base;
  }

  var state = { dates: [], indices: DEFAULT_INDICES, index: 'ndvi', i: 0, overlays: {}, current: null, timer: null };
  var slider = $('ndvi-slider');
  var trend = null;

  function fmtDate(d) {
    var dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(d) {
    var dt = new Date(d + 'T00:00:00');
    return isNaN(dt) ? d : dt.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  }
  function opacity() { return $('ndvi-opacity').value / 100; }

  function updateLegend() {
    var info = state.indices[state.index];
    if (!info) return;
    var unit = info.unit ? ' ' + info.unit : '';
    $('legend-title').textContent = info.label + (info.unit ? ' (' + info.unit + ')' : '');
    $('leg-min').textContent = info.min + unit;
    $('leg-mid').textContent = info.unit ? Math.round((info.min + info.max) / 2) + unit : ((info.min + info.max) / 2).toFixed(2);
    $('leg-max').textContent = info.max + unit;
    $('ndviLegend').classList.toggle('reverse', !!info.reverse);
    $('legend-sub').textContent = info.low + ' → ' + info.high;
    drawTrend();
  }

  function drawTrend() {
    if (!window.Chart || !state.dates.length) return;
    var values = state.dates.map(function (d) { return d[state.index] ? d[state.index].mean : null; });
    var colours = state.dates.map(function (d, j) { return j === state.i ? '#ffd400' : '#8fd199'; });
    if (trend) trend.destroy();
    trend = new Chart($('ndvi-trend'), {
      type: 'line',
      data: {
        labels: state.dates.map(function (d) { return entryLabel(d, false); }),
        datasets: [{ data: values, borderColor: '#8fd199', borderWidth: 2, tension: 0.3,
                     pointBackgroundColor: colours, pointBorderColor: colours, pointRadius: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false },
                   tooltip: { callbacks: { label: function (c) { return state.indices[state.index].label + ' ' + fmtValue(c.raw, state.indices[state.index]); } } } },
        scales: {
          x: { ticks: { color: '#a9b8af', font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: '#a9b8af', font: { size: 10 }, maxTicksLimit: 4 }, grid: { color: 'rgba(255,255,255,0.07)' } }
        }
      }
    });
  }

  function show(i) {
    if (!state.dates.length) return;
    state.i = (i + state.dates.length) % state.dates.length;
    slider.value = state.i;
    var entry = state.dates[state.i];
    $('ndvi-date').textContent = entryLabel(entry, true);
    document.querySelectorAll('#ndvi-ticks span').forEach(function (s, j) { s.classList.toggle('on', j === state.i); });

    if (state.current) { map.removeLayer(state.current); state.current = null; }
    if (state.index === 'off') { $('ndvi-mean').textContent = ''; return; }

    var layerInfo = entry[state.index];
    if (!layerInfo) {
      $('ndvi-mean').textContent = 'No ' + state.indices[state.index].label + ' image for this date';
      return;
    }
    var key = layerInfo.file;
    if (!state.overlays[key]) {
      state.overlays[key] = L.imageOverlay(layerInfo.file, layerInfo.bounds,
        { pane: 'ndviPane', opacity: opacity(), interactive: false });
    }
    state.current = state.overlays[key].setOpacity(opacity()).addTo(map);
    $('ndvi-mean').textContent = layerInfo.mean !== undefined && layerInfo.mean !== null
      ? 'Orchard mean: ' + fmtValue(layerInfo.mean, state.indices[state.index]) : '';
    drawTrend();
  }

  function stopPlay() {
    clearInterval(state.timer);
    state.timer = null;
    $('ndvi-play').textContent = '▶';
  }

  // Index buttons (NDVI / NDRE / Off)
  document.querySelectorAll('.index-switch button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.index = b.dataset.index;
      document.querySelectorAll('.index-switch button').forEach(function (x) { x.classList.toggle('active', x === b); });
      $('ndviLegend').style.display = state.index === 'off' ? 'none' : '';
      updateLegend();
      show(state.i);
    });
  });

  slider.addEventListener('input', function () { stopPlay(); show(+slider.value); });
  $('ndvi-prev').addEventListener('click', function () { stopPlay(); show(state.i - 1); });
  $('ndvi-next').addEventListener('click', function () { stopPlay(); show(state.i + 1); });
  $('ndvi-play').addEventListener('click', function () {
    if (state.timer) return stopPlay();
    $('ndvi-play').textContent = '❚❚';
    state.timer = setInterval(function () { show(state.i + 1); }, 1800);
  });
  $('ndvi-opacity').addEventListener('input', function () { if (state.current) state.current.setOpacity(opacity()); });

  fetch(DASHBOARD_CONFIG.NDVI_MANIFEST)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (m) {
      state.indices = Object.assign({}, DEFAULT_INDICES, m.indices || {});
      state.dates = (m.dates || []).slice().sort(function (a, b) { return (a.id || a.date).localeCompare(b.id || b.date); });
      if (!state.dates.length) throw new Error('no dates in the manifest yet');

      slider.max = state.dates.length - 1;
      $('ndvi-ticks').innerHTML = state.dates.map(function (d, j) {
        var left = state.dates.length > 1 ? (j / (state.dates.length - 1)) * 100 : 50;
        return '<span style="left:' + left + '%" data-i="' + j + '">' + entryLabel(d, false) + '</span>';
      }).join('');
      document.querySelectorAll('#ndvi-ticks span').forEach(function (s) {
        s.addEventListener('click', function () { stopPlay(); show(+s.dataset.i); });
      });

      updateLegend();
      show(0);   // start on the first date so "play" runs forward in time
    })
    .catch(function (err) {
      console.warn('No NDVI/NDRE images yet:', err.message);
      $('ndviBar').classList.add('empty');
      $('ndviLegend').style.display = 'none';
      $('ndvi-caption').textContent = 'Drone NDVI / NDRE';
      $('ndvi-date').textContent = 'No images yet - run make_vegetation_indices.py';
    });
})();


/* ---------- 22. "View sensor in 3D" button in the sensor popup ---------- */
window.openSensorIn3D = function (sensorId) {
  document.getElementById('btn-view-3d').click();
  ensure3D().then(function waitForSensors(tries) {
    tries = tries || 0;
    var ds = (typeof layers !== 'undefined') && layers.sensors;
    if (!ds) {
      if (tries < 40) setTimeout(function () { waitForSensors(tries + 1); }, 250);
      return;
    }
    var entity = ds.entities.values.find(function (e) {
      return String(getProp(e, [DASHBOARD_CONFIG.SENSOR_ID_FIELD], '')) === String(sensorId);
    });
    if (entity) {
      viewer.selectedEntity = entity;
      viewer.flyTo(entity, { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 120) });
    }
  });
};
