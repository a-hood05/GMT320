// =====================================================================
// 3D FARM - SMART IRRIGATION DECISION
//
//   1. dryness score per soil sensor  (Wet 0 / Moist 1 / Dry 2, weighted by depth)
//   2. IDW interpolation -> dryness surface over the orchard (draped in 3D)
//   3. average dryness along each irrigation line -> soil decision
//   4. weather: ETo (raise "monitor" to "irrigate"), raining now / rain in the last 24 h
//      and rain forecast (postpone)
//   5. rainwater tanks: flag when the tanks are low
//
// Settings: decision_config.js     Data: GET /api/decision-inputs (server.js)
// Runs after main_cesium.js (uses viewer, layers, getProp).
// =====================================================================
(function () {
  const cfg = DASHBOARD_CONFIG;
  const D = DECISION_CONFIG;
  const $ = (id) => document.getElementById(id);

  const DECISIONS = {
    irrigate: { label: "Irrigate",               colour: "#e03b3b" },
    monitor:  { label: "Monitor",                colour: "#f2c12e" },
    none:     { label: "No irrigation needed",   colour: "#41ab5d" },
    postpone: { label: "Postpone – rain expected", colour: "#3b82f6" },
  };

  // metres <-> degrees around the orchard (accurate enough at farm scale)
  const LAT0 = -25.7488;
  const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110574;

  const state = { rows: [], inputs: null, surface: null, surfaceLayer: null };

  // -------------------------------------------------------------------
  // Pure calculations (no Cesium) - easy to explain in the report
  // -------------------------------------------------------------------

  // Step 1: { "20 cm status": "Dry", ... } -> 0..2  (null if no statuses)
  function drynessScore(statuses) {
    let sum = 0, weights = 0;
    for (const [depth, w] of Object.entries(D.DEPTH_WEIGHTS)) {
      const st = String(statuses[`${depth} status`] || "").trim().toLowerCase();
      if (st in D.STATUS_SCORE) { sum += w * D.STATUS_SCORE[st]; weights += w; }
    }
    return weights ? sum / weights : null;
  }

  // Step 2: IDW at (x, y) in metres from points [{x, y, v}]
  function idw(x, y, points) {
    let num = 0, den = 0;
    for (const p of points) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < 0.01) return p.v;
      const w = 1 / Math.pow(d, D.IDW_POWER);
      num += w * p.v; den += w;
    }
    return den ? num / den : null;
  }

  // Step 3 + 4 + 5: one row -> decision with reasons
  function decide(dryness, inputs) {
    const reasons = [];
    let decision;
    if (dryness >= D.IRRIGATE_FROM) { decision = "irrigate"; reasons.push(`soil is dry (dryness ${dryness.toFixed(2)} ≥ ${D.IRRIGATE_FROM})`); }
    else if (dryness >= D.MONITOR_FROM) { decision = "monitor"; reasons.push(`soil is moist (dryness ${dryness.toFixed(2)})`); }
    else { decision = "none"; reasons.push(`soil is wet (dryness ${dryness.toFixed(2)} < ${D.MONITOR_FROM})`); }

    const eto = inputs.eto && inputs.eto.eto;
    if (decision === "monitor" && typeof eto === "number" && eto >= D.HIGH_ETO_MM) {
      decision = "irrigate";
      reasons.push(`high water demand (ETo ${eto} mm ≥ ${D.HIGH_ETO_MM} mm)`);
    }

    // Current weather: the soil sensors can lag behind fresh rain, so check it directly
    const now = inputs.current && !inputs.current.error && !inputs.current.tooOld ? inputs.current : null;
    if (decision === "irrigate" && now) {
      if (now.rainingNow) {
        decision = "postpone";
        reasons.push(`it is raining on the farm now (${now.source})`);
      } else if (typeof now.rain24h === "number" && now.rain24h >= D.RAIN_RECENT_MM) {
        decision = "postpone";
        reasons.push(`${now.rain24h} mm rain in the last 24 h (≥ ${D.RAIN_RECENT_MM} mm) – sensors may not show it yet`);
      }
    }

    const rain = inputs.forecast && inputs.forecast.mm;
    if (decision === "irrigate" && typeof rain === "number" && rain >= D.RAIN_POSTPONE_MM) {
      decision = "postpone";
      reasons.push(`${rain} mm rain expected in 48 h (≥ ${D.RAIN_POSTPONE_MM} mm)`);
    }

    let tankFlag = null;
    const pct = tankPercent(inputs.tanks);
    if (decision === "irrigate" && pct !== null && pct < D.TANK_LOW_PERCENT) {
      tankFlag = `Rainwater tanks only ${pct.toFixed(0)}% full – use municipal/borehole supply`;
    }
    return { decision, reasons, tankFlag };
  }

  function tankPercent(tanks) {
    if (!tanks || !D.TANK_FULL_LEVEL) return null;
    if (typeof tanks.percent === "number") return (tanks.percent / D.TANK_FULL_LEVEL) * 100;   // role without "water": average only
    const levels = [tanks.level1, tanks.level2].filter((v) => typeof v === "number");
    if (!levels.length) return null;
    return (levels.reduce((a, b) => a + b, 0) / levels.length / D.TANK_FULL_LEVEL) * 100;
  }

  // -------------------------------------------------------------------
  // Load inputs + geometry, compute, draw
  // -------------------------------------------------------------------
  async function run() {
    setCard("Loading decision inputs…");
    let inputs, sensorsGj, irrigationGj;
    try {
      [inputs, sensorsGj, irrigationGj] = await Promise.all([
        AUTH.fetch(`${cfg.API_BASE}/api/decision-inputs`).then((r) => r.json()),   // trimmed by the server per role
        fetch(cfg.FILES.sensors).then((r) => r.json()),
        fetch(cfg.FILES.irrigation).then((r) => r.json()),
      ]);
    } catch (err) {
      console.warn("Decision: server not reachable - retrying in 10 s.");
      clearTimeout(state.retry);
      state.retry = setTimeout(run, 10000);
      return setCard("Waiting for the database server… start it with <code>npm run server</code> (retrying every 10 s).", true);
    }
    if (inputs.error) return setCard(`Decision unavailable: ${inputs.error}`, true);
    state.inputs = inputs;

    // Step 1 - sensor scores at their positions (metres)
    const latest = Object.fromEntries((inputs.sensors || []).map((s) => [String(s.id), s]));
    const points = [];
    for (const f of sensorsGj.features) {
      const s = latest[String(f.properties[cfg.SENSOR_ID_FIELD])];
      const v = s && s.statuses ? drynessScore(s.statuses) : null;
      if (v === null) continue;
      const [lon, lat] = f.geometry.coordinates;
      points.push({ x: lon * KX, y: lat * KY, v, id: f.properties[cfg.SENSOR_ID_FIELD], time: s.time });
    }
    if (points.length < 3) return setCard("Not enough soil sensors with data for a decision.", true);

    // Steps 2-5 per irrigation row
    state.rows = irrigationGj.features.map((f) => {
      const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const [a, b] = [lines[0][0], lines[0][lines[0].length - 1]];
      let sum = 0;
      for (let i = 0; i < D.SAMPLES_PER_ROW; i++) {
        const t = i / (D.SAMPLES_PER_ROW - 1);
        const lon = a[0] + (b[0] - a[0]) * t, lat = a[1] + (b[1] - a[1]) * t;
        sum += idw(lon * KX, lat * KY, points);
      }
      const dryness = sum / D.SAMPLES_PER_ROW;
      return { row: f.properties.row_number ?? f.properties.id, dryness, ...decide(dryness, inputs) };
    }).sort((p, q) => p.row - q.row);

    colourIrrigationLines();
    buildSurface(points, irrigationGj);
    renderCard();
  }

  // Colour the 3D irrigation lines by decision
  function colourIrrigationLines() {
    const ds = layers.irrigation;
    if (!ds) return setTimeout(colourIrrigationLines, 300);
    const byRow = Object.fromEntries(state.rows.map((r) => [String(r.row), r]));
    for (const e of ds.entities.values) {
      const r = byRow[String(getProp(e, ["row_number", "id"], ""))];
      if (!r || !e.polyline) continue;
      e.polyline.material = Cesium.Color.fromCssColorString(DECISIONS[r.decision].colour);
      e.polyline.width = 6;
      e.decisionRow = r;
    }
  }

  // Step 2 surface as an image draped over the orchard
  function buildSurface(points, irrigationGj) {
    const xs = [], ys = [];
    irrigationGj.features.forEach((f) => [].concat(...(f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates))
      .forEach(([lon, lat]) => { xs.push(lon); ys.push(lat); }));
    points.forEach((p) => { xs.push(p.x / KX); ys.push(p.y / KY); });
    const pad = 10;   // metres around the orchard
    const w = Math.min(...xs) - pad / KX, e = Math.max(...xs) + pad / KX;
    const s = Math.min(...ys) - pad / KY, n = Math.max(...ys) + pad / KY;
    const cols = Math.ceil(((e - w) * KX) / D.GRID_CELL_M), rows = Math.ceil(((n - s) * KY) / D.GRID_CELL_M);

    const canvas = document.createElement("canvas");
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(cols, rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const lon = w + ((i + 0.5) / cols) * (e - w), lat = n - ((j + 0.5) / rows) * (n - s);
        const [r, g, b] = drynessColour(idw(lon * KX, lat * KY, points));
        const k = (j * cols + i) * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    state.surface = { url: canvas.toDataURL("image/png"), rect: Cesium.Rectangle.fromDegrees(w, s, e, n) };
    if ($("dc-surface").checked && AUTH.can("soil")) showSurface(true);   // RBAC: surface = interpolated research data
  }

  // 0 wet (blue) -> 1 moist (green) -> 2 dry (orange)
  function drynessColour(v) {
    const stops = [[0, [43, 140, 190]], [1, [65, 171, 93]], [2, [230, 85, 13]]];
    const t = Math.max(0, Math.min(2, v));
    const [a, b] = t <= 1 ? [stops[0], stops[1]] : [stops[1], stops[2]];
    const f = (t - a[0]) / (b[0] - a[0]);
    return a[1].map((c, i) => Math.round(c + (b[1][i] - c) * f));
  }

  async function showSurface(on) {
    if (state.surfaceLayer) { viewer.imageryLayers.remove(state.surfaceLayer, true); state.surfaceLayer = null; }
    if (!on || !state.surface) { viewer.scene.requestRender(); return; }
    const provider = await Cesium.SingleTileImageryProvider.fromUrl(state.surface.url, { rectangle: state.surface.rect });
    state.surfaceLayer = viewer.imageryLayers.addImageryProvider(provider);
    state.surfaceLayer.alpha = 0.55;
    viewer.scene.requestRender();
  }

  // -------------------------------------------------------------------
  // Decision card
  // -------------------------------------------------------------------
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "–" : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  };

  function setCard(html, isError) {
    $("dc-body").innerHTML = `<p class="${isError ? "error" : "dc-muted"}">${html}</p>`;
  }

  function renderCard(selected) {
    const counts = Object.fromEntries(Object.keys(DECISIONS).map((k) => [k, 0]));
    state.rows.forEach((r) => counts[r.decision]++);
    const inp = state.inputs;
    const soilDates = (inp.sensors || []).filter((s) => s.statuses && Object.keys(s.statuses).length).map((s) => s.time).sort();
    const pct = tankPercent(inp.tanks);

    const chips = Object.entries(DECISIONS).filter(([k]) => counts[k]).map(([k, d]) =>
      `<span class="dc-chip" style="--c:${d.colour}"><b>${counts[k]}</b> ${d.label}</span>`).join("");

    const rowsHtml = state.rows.map((r) =>
      `<button class="dc-row ${selected && selected.row === r.row ? "on" : ""}" data-row="${r.row}" style="--c:${DECISIONS[r.decision].colour}">
         <span>Row ${r.row}</span><span>${DECISIONS[r.decision].label}</span></button>`).join("");

    const detail = selected ? `
      <div class="dc-detail" style="--c:${DECISIONS[selected.decision].colour}">
        <strong>Row ${selected.row}: ${DECISIONS[selected.decision].label}</strong>
        <ul>${selected.reasons.map((x) => `<li>${x}</li>`).join("")}</ul>
        ${selected.tankFlag ? `<p class="dc-flag">⚠ ${selected.tankFlag}</p>` : ""}
      </div>` : `<p class="dc-muted">Click an irrigation line or a row below for the reasoning.</p>`;

    const fc = inp.forecast && !inp.forecast.error ? inp.forecast : null;
    $("dc-body").innerHTML = `
      <div class="dc-chips">${chips}</div>
      ${detail}
      <div class="dc-rows">${rowsHtml}</div>
      <h4>Inputs used</h4>
      <table class="dc-inputs">
        <tr><td>Soil sensors</td><td>${soilDates.length} Chameleons, latest ${fmtDate(soilDates[soilDates.length - 1])}</td></tr>
        <tr><td>Weather now</td><td>${currentText(inp.current)}</td></tr>
        <tr><td>Rain next 48 h</td><td>${fc ? `${fc.mm} mm${fc.stale ? ` <em>(forecast table ends ${fmtDate(fc.to)})</em>` : ""}` : "not available"}</td></tr>
        <tr><td>ETo (AWS)</td><td>${inp.eto && !inp.eto.error ? `${inp.eto.eto} mm on ${fmtDate(inp.eto.date)}` : "not available"}</td></tr>
        <tr><td>Tanks</td><td>${tankText(inp.tanks, pct)}</td></tr>
      </table>
      <h4>Rules</h4>
      <p class="dc-rules">Dryness = ${Object.entries(D.DEPTH_WEIGHTS).map(([d, w]) => `${w}×${d}`).join(" + ")} (Wet 0, Moist 1, Dry 2), IDW power ${D.IDW_POWER}.
        Irrigate ≥ ${D.IRRIGATE_FROM}, monitor ≥ ${D.MONITOR_FROM}. Postpone if it is raining now, ≥ ${D.RAIN_RECENT_MM} mm fell in the last 24 h, or ≥ ${D.RAIN_POSTPONE_MM} mm is forecast for 48 h.
        Monitor → irrigate if ETo ≥ ${D.HIGH_ETO_MM} mm. Flag if tanks average &lt; ${D.TANK_LOW_PERCENT}%.</p>`;

    document.querySelectorAll(".dc-row").forEach((b) => b.addEventListener("click", () => {
      const r = state.rows.find((x) => String(x.row) === b.dataset.row);
      renderCard(r);
      flyToRow(r);
    }));
  }

  // "Tank 1: 38% · Tank 2: 101% (overfilled) – average 70%"
  function currentText(c) {
    if (!c || c.error) return "not available";
    const when = new Date(c.time).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const txt = `${c.rainingNow ? "raining" : "dry"}, ${c.rain24h} mm in last 24 h${c.temperature != null ? `, ${c.temperature} °C` : ""}
      <br><small>${c.source}, ${when}</small>`;
    return c.tooOld ? `<em>too old to use (${Math.round(c.ageHours)} h)</em><br><small>${c.source}, ${when}</small>` : txt;
  }

  function tankText(tanks, pct) {
    if (!tanks || tanks.error) return "not available";
    if (tanks.locked) return `${pct !== null && pct < D.TANK_LOW_PERCENT ? "low" : "enough"} rainwater <span class="dc-muted">(🔒 levels: farm staff / manager)</span>`;
    const levels = [tanks.level1, tanks.level2];
    if (!D.TANK_FULL_LEVEL) return `level ${levels.filter((v) => v !== null).join(" / ")} (full level not set)`;
    const parts = levels.map((v, i) => {
      if (typeof v !== "number") return null;
      const p = (v / D.TANK_FULL_LEVEL) * 100;
      return `Tank ${i + 1}: ${p.toFixed(0)}%${p > 100 ? " <em>(overfilled)</em>" : ""}`;
    }).filter(Boolean);
    const low = pct !== null && pct < D.TANK_LOW_PERCENT ? " <em>– low</em>" : "";
    return `${parts.join(" · ")}${parts.length > 1 ? ` – average ${pct.toFixed(0)}%` : ""}${low}<br><span class="dc-muted">${fmtDate(tanks.time)}</span>`;
  }

  function flyToRow(r) {
    const e = layers.irrigation && layers.irrigation.entities.values.find((x) => x.decisionRow === r);
    if (e) viewer.flyTo(e, { duration: 1.2, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-40), 180) });
  }

  // Clicking an irrigation line in 3D shows its decision
  viewer.selectedEntityChanged.addEventListener((entity) => {
    if (entity && entity.decisionRow) {
      viewer.infoBox.container.style.display = "none";
      $("decisionCard").classList.remove("collapsed");
      renderCard(entity.decisionRow);
    }
  });

  $("dc-surface").addEventListener("change", (e) => showSurface(e.target.checked).catch(console.error));
  $("dc-toggle").addEventListener("click", () => $("decisionCard").classList.toggle("collapsed"));
  $("dc-refresh").addEventListener("click", () => {
    run();
    if (window.refreshSoilProfiles) window.refreshSoilProfiles();
  });

  run();
})();
