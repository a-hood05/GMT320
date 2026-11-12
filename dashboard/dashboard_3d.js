// =====================================================================
// 3D FARM - click a sensor to see its recordings from PostgreSQL
// Runs after main_cesium.js, so it can use `viewer`, `layers` and `getProp`
// from that file.
// =====================================================================
(function () {
  const cfg = DASHBOARD_CONFIG;
  const $ = (id) => document.getElementById(id);

  const drawer = $("sensorDrawer");
  let chart = null;
  let current = null;   // { id, type, installed, data }

  // ---------------------------------------------------------------
  // 1. Listen for clicks on sensors
  // ---------------------------------------------------------------
  viewer.selectedEntityChanged.addEventListener((entity) => {
    // Clicking a soil-profile pillar (dashboard_3d_layers.js) opens its sensor
    if (entity && entity.sensorEntity) {
      viewer.selectedEntity = entity.sensorEntity;
      return;
    }
    const isSensor = !!(entity && layers.sensors && layers.sensors.entities.contains(entity));

    // Sensors get our own panel; every other layer keeps Cesium's info box
    viewer.infoBox.container.style.display = isSensor ? "none" : "";

    if (isSensor) openSensor(entity);
  });

  $("sd-close").addEventListener("click", closeDrawer);
  $("sd-range").addEventListener("change", () => current && loadReadings());
  $("sd-var").addEventListener("change", () => current && drawChart());

  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    viewer.selectedEntity = undefined;
  }

  function openSensor(entity) {
    const id = getProp(entity, [cfg.SENSOR_ID_FIELD], null);
    const type = String(getProp(entity, ["sensor_typ", "type"], "Sensor")).trim();
    const installed = getProp(entity, ["installDat"], null);
    openPanel({
      label: "SENSOR",
      title: `${type} · #${id}`,
      meta: installed ? `Installed ${installed}` : "Install date unknown",
      url: (days) => `${cfg.API_BASE}/api/sensors/${encodeURIComponent(id)}/readings?days=${days}`,
      entity,
    });
  }

  // Generic panel - also used by the weather station (dashboard_3d_layers.js)
  function openPanel({ label, title, meta, url, entity }) {
    current = { url, data: null };
    $("sd-title").textContent = title;
    $("sd-meta").textContent = meta || "";
    drawer.querySelector(".drawer-label").textContent = label || "SENSOR";

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");

    // Move the camera in towards the feature
    if (entity) {
      viewer.flyTo(entity, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 120)
      });
    }
    loadReadings();
  }
  window.openReadingsPanel = openPanel;

  // ---------------------------------------------------------------
  // 2. Fetch the recordings from the API (server/server.js)
  // ---------------------------------------------------------------
  async function loadReadings() {
    const sensor = current;
    const days = $("sd-range").value;
    setStatus("Loading recordings…");
    $("sd-latest").innerHTML = "";
    $("sd-table").innerHTML = "";
    $("sd-source").textContent = "";

    const url = sensor.url(days);
    try {
      const res = await AUTH.fetch(url);      // auth.js: sends the sign-in token
      const data = await res.json();
      if (sensor !== current) return;
      if (res.status === 401 || res.status === 403) {   // RBAC: this role may not see these recordings
        if (chart) { chart.destroy(); chart = null; }
        $("sd-var-wrap").style.display = "none";
        $("sd-source").className = "source-pill locked";
        $("sd-source").textContent = "🔒 Not available for your role";
        $("sd-status").className = "drawer-status";
        $("sd-status").innerHTML = `${data.error || "Not available for your role."}
          ${AUTH.role === "public" ? '<br><button class="ghost-btn sd-signin" type="button">Sign in</button>' : ""}`;
        const b = $("sd-status").querySelector(".sd-signin");
        if (b) b.addEventListener("click", AUTH.openSignIn);
        return;
      }
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (sensor !== current) return;            // user clicked another sensor meanwhile

      current.data = data;
      showSource(data);

      if (!data.rows.length) {
        setStatus(data.message || "No recordings for this sensor in this period.");
        if (chart) { chart.destroy(); chart = null; }
        $("sd-var-wrap").style.display = "none";
        return;
      }

      fillVariableList(data.columns);
      drawLatest();
      drawChart();
      drawTable();
      setStatus(`${data.rows.length} recordings`);
    } catch (err) {
      console.error(err);
      if (chart) { chart.destroy(); chart = null; }
      setStatus("Could not reach the sensor database. Is the server running? (npm run server)", true);
    }
  }

  function showSource(data) {
    const pill = $("sd-source");
    if (data.source === "none") {
      pill.className = "source-pill demo";
      pill.textContent = "● Not linked to the database yet";
    } else if (data.source === "postgis") {
      pill.className = "source-pill live";
      pill.textContent = `● Live from PostgreSQL · ${data.table}`;
    } else {
      pill.className = "source-pill demo";
      pill.textContent = "● Demo data (database not connected)";
    }
  }

  function fillVariableList(columns) {
    const select = $("sd-var");
    const previous = select.value;
    select.innerHTML = columns.map((c) => `<option value="${c}">${nice(c)}</option>`).join("");
    if (columns.includes(previous)) select.value = previous;
    $("sd-var-wrap").style.display = columns.length > 1 ? "" : "none";
  }

  // ---------------------------------------------------------------
  // 3. Draw: latest values, chart, table
  // ---------------------------------------------------------------
  function drawLatest() {
    const { rows, columns, statuses = {} } = current.data;
    const last = rows[rows.length - 1];
    // "20 cm value" -> its status column "20 cm status" (Wet / Moist / Dry)
    const statusOf = (c) => statuses[c.replace(/value/i, "status")] || null;
    $("sd-latest").innerHTML = columns.slice(0, 4).map((c) => {
      const st = statusOf(c);
      return `
      <div class="latest-card">
        <span>${nice(c)}</span>
        <strong>${fmt(last[c])}</strong>
        ${st ? `<em class="status-badge status-${String(st).toLowerCase()}">${st}</em>` : ""}
      </div>`;
    }).join("") +
      `<div class="latest-time">Last recording: ${fmtTime(last.time)}</div>`;
  }

  function drawChart() {
    const { rows } = current.data;
    const col = $("sd-var").value;
    const ctx = $("sd-chart");
    if (chart) chart.destroy();

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: rows.map((r) => fmtTime(r.time, true)),
        datasets: [{
          label: nice(col),
          data: rows.map((r) => r[col]),
          borderColor: "#8fd199",
          backgroundColor: "rgba(143, 209, 153, 0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: rows.length > 60 ? 0 : 2,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#a9b8af", maxTicksLimit: 6, maxRotation: 0 }, grid: { color: "rgba(255,255,255,0.05)" } },
          y: { ticks: { color: "#a9b8af" }, grid: { color: "rgba(255,255,255,0.08)" },
               title: { display: true, text: nice(col), color: "#a9b8af" } }
        }
      }
    });
  }

  function drawTable() {
    const { rows, columns } = current.data;
    const recent = rows.slice(-50).reverse();   // newest first, max 50
    $("sd-table").innerHTML =
      `<thead><tr><th>Time</th>${columns.map((c) => `<th>${nice(c)}</th>`).join("")}</tr></thead>` +
      `<tbody>${recent.map((r) =>
        `<tr><td>${fmtTime(r.time)}</td>${columns.map((c) => `<td>${fmt(r[c])}</td>`).join("")}</tr>`
      ).join("")}</tbody>`;
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  function setStatus(text, isError) {
    const el = $("sd-status");
    el.textContent = text;
    el.classList.toggle("error", !!isError);
  }

  function nice(col) {
    return col.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function fmt(v) {
    if (v === null || v === undefined || v === "") return "–";
    const n = Number(v);
    return Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)) : String(v);
  }

  function fmtTime(t, short) {
    const d = new Date(t);
    if (isNaN(d)) return String(t);
    return short
      ? d.toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString("en-ZA", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
})();
