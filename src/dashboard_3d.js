// =====================================================================
// 3D FARM - click a sensor to see its recordings from PostGIS
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
    current = {
      id:        getProp(entity, [cfg.SENSOR_ID_FIELD], null),
      type:      String(getProp(entity, ["sensor_typ", "type"], "Sensor")).trim(),
      installed: getProp(entity, ["installDat"], null),
      data:      null
    };

    $("sd-title").textContent = `${current.type} · #${current.id}`;
    $("sd-meta").textContent = current.installed ? `Installed ${current.installed}` : "Install date unknown";

    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");

    // Move the camera in towards the sensor
    viewer.flyTo(entity, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), 120)
    });

    loadReadings();
  }

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

    const url = `${cfg.API_BASE}/api/sensors/${encodeURIComponent(sensor.id)}/readings?days=${days}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
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
      pill.textContent = `● Live from PostGIS · ${data.table}`;
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
    const { rows, columns } = current.data;
    const last = rows[rows.length - 1];
    $("sd-latest").innerHTML = columns.slice(0, 4).map((c) => `
      <div class="latest-card">
        <span>${nice(c)}</span>
        <strong>${fmt(last[c])}</strong>
      </div>`).join("") +
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
