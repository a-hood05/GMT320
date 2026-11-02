// =====================================================================
// 3D FARM - extra data layers
//   1. Soil moisture profiles: every Chameleon sensor gets a 3-part pillar
//      (top = 20 cm, middle = 50 cm, bottom = 80 cm) coloured by its latest
//      Wet / Moist / Dry status from the PostGIS database, and the sensor dot
//      itself takes the colour of the 20 cm reading.
//   2. Drone imagery (NDVI / NDRE / canopy temperature) draped over the
//      terrain, using the same images and dates as the 2D time slider.
// Runs after main_cesium.js and dashboard_3d.js (uses viewer, layers, getProp).
// =====================================================================
(function () {
  const cfg = DASHBOARD_CONFIG;
  const $ = (id) => document.getElementById(id);

  // -------------------------------------------------------------------
  // 1. SOIL MOISTURE PROFILES
  // -------------------------------------------------------------------
  const STATUS_COLOURS = {
    wet:   Cesium.Color.fromCssColorString("#2b8cbe"),
    moist: Cesium.Color.fromCssColorString("#41ab5d"),
    dry:   Cesium.Color.fromCssColorString("#e6550d"),
  };
  const NO_DATA = Cesium.Color.fromCssColorString("#9aa5a0");
  const colourFor = (status) => STATUS_COLOURS[String(status || "").trim().toLowerCase()] || NO_DATA;

  // top to bottom, like a soil profile
  const DEPTHS = ["20 cm", "50 cm", "80 cm"];
  const SEGMENT_M = 2.4;          // height of each pillar segment (metres)
  const GAP_M = 0.2;
  const RADIUS_M = 1.1;

  const profiles = new Cesium.CustomDataSource("soilProfiles");
  viewer.dataSources.add(profiles);

  function waitFor(test, tries = 80) {
    return new Promise((resolve, reject) => {
      (function check(n) {
        const v = test();
        if (v) return resolve(v);
        if (n <= 0) return reject(new Error("timed out"));
        setTimeout(() => check(n - 1), 250);
      })(tries);
    });
  }

  async function buildProfiles() {
    const sensorsDs = await waitFor(() => layers.sensors);
    let data;
    try {
      const res = await fetch(`${cfg.API_BASE}/api/sensors/latest`);
      data = await res.json();
    } catch (err) {
      // server not running (yet) - try again in 10 s, so starting the server later just works
      console.warn("Soil profiles: server not reachable - retrying in 10 s.");
      setTimeout(buildProfiles, 10000);
      return;
    }
    if (!data || data.source !== "postgis") return;
    profiles.entities.removeAll();              // rebuilding (e.g. after ↻) - clear the old pillars

    const latest = Object.fromEntries((data.sensors || []).map((s) => [String(s.id), s]));
    const now = Cesium.JulianDate.now();

    // sensors that have Wet/Moist/Dry statuses
    const items = sensorsDs.entities.values.map((sensor) => {
      const id = String(getProp(sensor, [cfg.SENSOR_ID_FIELD], ""));
      const info = latest[id];
      if (!info || !info.statuses || !Object.keys(info.statuses).length) return null;
      return { sensor, info, carto: Cesium.Cartographic.fromCartesian(sensor.position.getValue(now)) };
    }).filter(Boolean);

    // Real ground height at each sensor (the farm is ~1360 m above sea level)
    try {
      const terrain = await waitFor(() =>
        viewer.terrainProvider && !(viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) && viewer.terrainProvider);
      await Cesium.sampleTerrainMostDetailed(terrain, items.map((it) => it.carto));
    } catch (err) {
      console.warn("Soil profiles: could not read the terrain height", err);
      items.forEach((it) => { it.carto.height = viewer.scene.globe.getHeight(it.carto) || 0; });
    }

    for (const { sensor, info, carto } of items) {
      const statusAt = (depth) => info.statuses[`${depth} status`];

      // sensor dot = colour of the shallow (20 cm) reading
      if (sensor.point) sensor.point.color = colourFor(statusAt(DEPTHS[0]));

      // pillar: 80 cm at the bottom, 20 cm at the top
      const lon = Cesium.Math.toDegrees(carto.longitude), lat = Cesium.Math.toDegrees(carto.latitude);
      const ground = carto.height || 0;
      DEPTHS.slice().reverse().forEach((depth, i) => {
        const centre = ground + 0.3 + i * (SEGMENT_M + GAP_M) + SEGMENT_M / 2;
        const value = info.values ? info.values[`${depth} value`] : null;
        const seg = profiles.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat, centre),
          cylinder: {
            length: SEGMENT_M,
            topRadius: RADIUS_M,
            bottomRadius: RADIUS_M,
            material: colourFor(statusAt(depth)).withAlpha(0.9),
            outline: true,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1200),   // only when zoomed in
          },
          description: `${depth}: ${statusAt(depth) || "–"}${value !== null && value !== undefined ? ` (${value})` : ""}`,
        });
        seg.sensorEntity = sensor;     // clicking the pillar opens this sensor (dashboard_3d.js)
      });
    }
    profiles.show = $("toggle-profiles").checked;
  }

  $("toggle-profiles").addEventListener("change", (e) => { profiles.show = e.target.checked; viewer.scene.requestRender(); });
  window.refreshSoilProfiles = buildProfiles;   // used by the ↻ button on the decision card
  buildProfiles();


  // -------------------------------------------------------------------
  // 2. DRONE IMAGERY DRAPED ON THE TERRAIN
  // -------------------------------------------------------------------
  const img = { manifest: null, index: "off", layer: null, cache: {} };
  const dateSelect = $("img3d-date");
  const opacity = () => $("img3d-opacity").value / 100;

  function entryLabel(d) {
    const dt = new Date(d.date + "T00:00:00");
    const base = isNaN(dt) ? d.date : dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
    return d.label ? `${base} (${d.label})` : base;
  }

  async function showImagery() {
    if (img.layer) { viewer.imageryLayers.remove(img.layer, false); img.layer = null; }
    const key = $("key-imagery");
    if (img.index === "off" || !img.manifest) { key.hidden = true; viewer.scene.requestRender(); return; }

    const entry = img.manifest.dates[+dateSelect.value];
    const info = entry && entry[img.index];
    if (!info) return;

    if (!img.cache[info.file]) {
      const [[s, w], [n, e]] = info.bounds;
      const provider = await Cesium.SingleTileImageryProvider.fromUrl(info.file, {
        rectangle: Cesium.Rectangle.fromDegrees(w, s, e, n),
      });
      img.cache[info.file] = new Cesium.ImageryLayer(provider);
    }
    img.layer = img.cache[info.file];
    img.layer.alpha = opacity();
    viewer.imageryLayers.add(img.layer);

    // legend
    const meta = (img.manifest.indices || {})[img.index] || {};
    const unit = meta.unit ? ` ${meta.unit}` : "";
    $("key-img-title").textContent = `${meta.label || img.index.toUpperCase()} – ${entryLabel(entry)}`;
    $("key-img-min").textContent = (meta.min ?? "") + unit;
    $("key-img-max").textContent = (meta.max ?? "") + unit;
    $("key-img-ramp").classList.toggle("reverse", !!meta.reverse);
    key.hidden = false;
    viewer.scene.requestRender();
  }

  fetch(cfg.NDVI_MANIFEST)
    .then((r) => r.json())
    .then((m) => {
      const dates = (m.dates || []).slice().sort((a, b) => (a.id || a.date).localeCompare(b.id || b.date));
      if (!dates.length) return;
      img.manifest = { ...m, dates };
      dateSelect.innerHTML = dates.map((d, i) => `<option value="${i}">${entryLabel(d)}</option>`).join("");
      dateSelect.value = dates.length - 1;
    })
    .catch((err) => console.warn("3D imagery: no manifest", err));

  document.querySelectorAll("#img3d-index button").forEach((b) => {
    b.addEventListener("click", () => {
      img.index = b.dataset.index;
      document.querySelectorAll("#img3d-index button").forEach((x) => x.classList.toggle("active", x === b));
      dateSelect.disabled = img.index === "off";
      showImagery().catch((err) => console.error("3D imagery failed:", err));
    });
  });
  dateSelect.addEventListener("change", () => showImagery().catch(console.error));
  $("img3d-opacity").addEventListener("input", () => { if (img.layer) { img.layer.alpha = opacity(); viewer.scene.requestRender(); } });


  // -------------------------------------------------------------------
  // 3. WEATHER STATION (Davis Vantage Pro2) + RANGE RING
  // -------------------------------------------------------------------
  const aws = new Cesium.CustomDataSource("aws");
  const awsRange = new Cesium.CustomDataSource("awsRange");
  viewer.dataSources.add(aws);
  viewer.dataSources.add(awsRange);
  awsRange.show = false;

  fetch(cfg.FILES.aws)
    .then((r) => r.json())
    .then((gj) => {
      const f = gj.features[0];
      if (!f) return;
      const [lon, lat] = f.geometry.coordinates;
      const station = aws.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 16, color: Cesium.Color.fromCssColorString("#00e5ff"),
          outlineColor: Cesium.Color.WHITE, outlineWidth: 3,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(150, 1.0, 3000, 0.5),   // always visible, smaller when far
        },
        label: {
          text: "AWS",
          scaleByDistance: new Cesium.NearFarScalar(150, 1.0, 3000, 0.6), font: "bold 14px sans-serif", fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      station.isAws = true;

      // rings: filled disc + dashed outline per scale, both draped on the terrain
      const KX = 111320 * Math.cos((lat * Math.PI) / 180), KY = 110574;
      const colour = Cesium.Color.fromCssColorString("#00e5ff");
      cfg.AWS_RINGS.forEach(({ m: R, label }, i) => {
        const ring = [];
        for (let a = 0; a <= 360; a += 3) {
          const t = (a * Math.PI) / 180;
          ring.push(lon + (R * Math.cos(t)) / KX, lat + (R * Math.sin(t)) / KY);
        }
        awsRange.entities.add({
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(ring),
            material: colour.withAlpha(i === 0 ? 0.18 : 0.07),
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        });
        awsRange.entities.add({
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArray(ring), width: 3, clampToGround: true,
            material: new Cesium.PolylineDashMaterialProperty({ color: colour }),
          },
        });
        awsRange.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lon, lat + R / KY),
          label: {
            text: label, font: "13px sans-serif", fillColor: colour,
            outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -10),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      });
    })
    .catch((err) => console.warn("No weather station file (data/aws.geojson)", err));

  function setRange(on) {
    awsRange.show = on;
    viewer.scene.requestRender();
    $("toggle-awsrange").checked = on;
  }
  $("toggle-aws").addEventListener("change", (e) => { aws.show = e.target.checked; if (!e.target.checked) setRange(false); viewer.scene.requestRender(); });
  $("toggle-awsrange").addEventListener("change", (e) => setRange(e.target.checked));

  // Clicking the station: show its range and open its recordings
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (!entity || !entity.isAws) return;
    viewer.infoBox.container.style.display = "none";
    setRange(true);
    window.openReadingsPanel({
      label: "WEATHER STATION",
      title: "Davis Vantage Pro2 AWS",
      meta: cfg.AWS_RANGE_LABEL,
      url: (days) => `${cfg.API_BASE}/api/aws/readings?days=${days}`,
    });
    viewer.flyTo(awsRange, { duration: 1.5, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 0) });
  });

  // -------------------------------------------------------------------
  // 4. MAP KEY: click the title to fold it away (remembered per browser).
  //    It also folds itself while Cesium's basemap menu is open.
  // -------------------------------------------------------------------
  const key = $("mapKey"), keyBtn = $("mapKeyToggle");
  const setKey = (collapsed) => {
    key.classList.toggle("collapsed", collapsed);
    keyBtn.setAttribute("aria-expanded", String(!collapsed));
  };
  try { setKey(localStorage.getItem("farmtech_mapkey_collapsed") === "1"); } catch { /* ignore */ }
  keyBtn.addEventListener("click", () => {
    const collapsed = !key.classList.contains("collapsed");
    setKey(collapsed);
    try { localStorage.setItem("farmtech_mapkey_collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ }
  });

  const picker = document.querySelector(".cesium-baseLayerPicker-dropDown");
  if (picker) {
    let wasCollapsed = false;
    new MutationObserver(() => {
      const open = picker.classList.contains("cesium-baseLayerPicker-dropDown-visible");
      if (open) { wasCollapsed = key.classList.contains("collapsed"); setKey(true); }
      else setKey(wasCollapsed);
    }).observe(picker, { attributes: true, attributeFilter: ["class"] });
  }
})();
