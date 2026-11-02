// =====================================================================
// GUIDED TOUR - walks a first-time user through the dashboard
//
//   * Welcome popup the first time the dashboard opens (Take the tour / Skip)
//   * 2D tour: highlights each part of the 2D map and explains it
//   * 3D tour: starts the first time the 3D farm is opened
//   * "? Tour" button in the top bar replays the tour for the current view
//   * Keys: → / Enter = next, ← = back, Esc = skip
//
// The browser remembers that the tour was seen (localStorage), so it does
// not pop up on every visit. Plain JavaScript - no library needed.
// =====================================================================
(function () {
  const SEEN_2D = "farmtech_tour_2d_seen";
  const SEEN_3D = "farmtech_tour_3d_seen";

  // localStorage can be blocked (private windows) - never let that break the page
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  // -------------------------------------------------------------------
  // The steps. "target" is a CSS selector; no target = popup in the middle.
  // -------------------------------------------------------------------
  const TOUR_2D = [
    {
      title: "Welcome to the FarmTech Africa dashboard 🌱",
      text: `This dashboard brings together the <b>sensors, drone images, weather station and database</b>
             of the UP Farm pecan orchard to support one question: <b>does the orchard need irrigation?</b>
             <br><br>This short tour (about 2 minutes) shows you around. You can skip it at any time
             and replay it later with the <b>? Tour</b> button at the top.`,
      welcome: true,
    },
    {
      target: '[data-tour="view-switch"]',
      title: "Two views of the farm",
      text: `<b>2D Map</b> is for analysis: filtering, statistics and drone images.<br>
             <b>3D Farm</b> is the digital twin: live sensor data from the database and the
             <b>irrigation decision</b>.`,
    },
    {
      target: '[data-tour="stats"]',
      title: "Farm statistics",
      text: `Quick numbers for the farm. They <b>update as you filter</b> - for example "Buildings shown"
             and "With gutters" change when you filter the buildings below.`,
    },
    {
      target: '[data-tour="buildings"]',
      title: "Explore the buildings",
      text: `Colour the buildings by <b>roof type</b>, <b>height</b> or <b>gutter</b>, and filter them.
             <br><br>Why it matters: roofs with gutters can harvest rainwater into the JoJo tanks -
             try ticking <b>"Only buildings with gutters"</b>.`,
    },
    {
      target: '[data-tour="sensors2d"]',
      title: "Sensors on the farm",
      text: `Show one sensor type at a time. <b>Chameleon</b> sensors measure soil moisture,
             <b>TEROS 21</b> sensors measure soil water potential, and the <b>water level</b>
             sensors measure how full the tanks are.`,
    },
    {
      target: '[data-tour="info"]',
      title: "Click anything for details",
      text: `Click any building, road, tank, sensor or irrigation line on the map - its information
             appears here and in a popup.`,
    },
    {
      target: "#ndviBar",
      title: "Drone images through time",
      text: `Multispectral drone flights over the orchard. Use the slider or <b>▶</b> to move between dates.
             <ul>
               <li><b>NDVI</b> - how green and dense the canopy is (green = healthy, red = bare/stressed).</li>
               <li><b>NDRE</b> - like NDVI but more sensitive to <b>chlorophyll</b>, so it shows stress earlier.</li>
               <li><b>Temp</b> - canopy temperature from the thermal camera. Trees with enough water
                   transpire and stay <b>cool</b>; water-stressed trees are <b>hotter</b>.</li>
             </ul>`,
    },
    {
      target: "#ndviLegend",
      title: "Reading the colours",
      text: `The legend explains the colours of the selected image. The small chart shows the
             <b>orchard average</b> for every flight, so you can see the trend over time.`,
    },
    {
      target: ".leaflet-control-layers",
      title: "Basemaps and layers",
      text: `Hover here to switch the background map (satellite, streets, topographic) and to turn
             map layers on or off.`,
    },
    {
      target: "#btn-view-3d",
      title: "Next: the 3D farm",
      text: `That's the 2D map! Click <b>3D Farm</b> when you're ready - a short tour explains
             the live sensor data and the irrigation decision there.`,
      last: true,
    },
  ];

  const TOUR_3D = [
    {
      title: "Welcome to the 3D farm",
      text: `This is a 3D digital twin of the UP Farm, connected to our <b>PostGIS spatial database</b>.
             <br><br><b>Moving around:</b>
             <ul>
               <li><b>Left-drag</b> - move the map</li>
               <li><b>Scroll</b> or <b>right-drag</b> - zoom</li>
               <li><b>Ctrl + left-drag</b> (or middle-drag) - tilt and rotate</li>
             </ul>
             Small details (sensors, pillars, trees) appear as you zoom in.`,
      welcome: true,
    },
    {
      target: "#panel",
      title: "Layers and drone imagery",
      text: `Turn layers on and off here. Under <b>Drone imagery</b> you can drape the same NDVI, NDRE
             and temperature images from the 2D map over the 3D terrain.`,
    },
    {
      target: "#mapKey",
      title: "Soil moisture at a glance",
      text: `Each Chameleon sensor has a <b>pillar of 3 blocks</b>: top = 20 cm deep, middle = 50 cm,
             bottom = 80 cm. Colours come from the sensor's own reading:
             <b style="color:#7cc4ea">Wet</b>, <b style="color:#8fd199">Moist</b>,
             <b style="color:#ff9d6b">Dry</b>.
             <br><br>Note: for Chameleon sensors a <b>low value means wet</b> and a high value means dry
             (it measures how hard roots must pull to get water).`,
    },
    {
      target: "#decisionCard",
      title: "The smart irrigation decision",
      text: `For every irrigation row the dashboard decides:
             <b style="color:#ff6b6b">Irrigate</b>, <b style="color:#f2c12e">Monitor</b>,
             <b style="color:#41ab5d">No irrigation needed</b> or
             <b style="color:#6ea8ff">Postpone (rain expected)</b>.
             <ol>
               <li>Sensor readings → a <b>dryness score</b> per sensor</li>
               <li><b>IDW interpolation</b> spreads the scores over the orchard (the coloured surface)</li>
               <li>Each row gets the average dryness along its length</li>
               <li><b>Rain forecast</b>, <b>evapotranspiration (ETo)</b> and <b>tank levels</b> adjust it</li>
             </ol>
             Click a row or an irrigation line to see <b>why</b>.`,
      before: () => { const c = document.getElementById("decisionCard"); if (c) c.classList.remove("collapsed"); },
    },
    {
      title: "Click to see the data",
      text: `<ul>
               <li><b>Sensor or pillar</b> - its recordings over 1, 7 or 30 days, with a chart.</li>
               <li><b>AWS</b> (the cyan weather station) - its temperature and rain, plus rings showing
                   how far its weather applies (100 m and 3 km, WMO guidelines).</li>
               <li><b>Irrigation line</b> - the decision for that row and the reasons.</li>
             </ul>
             The sensor data needs our database server to be running. That's it - enjoy exploring!`,
      last: true,
    },
  ];

  // -------------------------------------------------------------------
  // Building blocks: dark backdrop, spotlight, popup
  // -------------------------------------------------------------------
  const blocker = el("div", "tour-blocker");     // stops clicks on the page during the tour
  const spot = el("div", "tour-spotlight");      // the highlighted "hole"
  const pop = el("div", "tour-pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-live", "polite");
  document.body.append(blocker, spot, pop);

  let steps = [], index = 0, seenKey = null;

  function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }

  function visibleTarget(selector) {
    if (!selector) return null;
    const t = document.querySelector(selector);
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const hidden = r.width === 0 || r.height === 0 || getComputedStyle(t).display === "none" || t.hidden;
    return hidden ? null : t;
  }

  function start(which) {
    steps = which === "3d" ? TOUR_3D : TOUR_2D;
    seenKey = which === "3d" ? SEEN_3D : SEEN_2D;
    index = 0;
    document.body.classList.add("tour-on");
    show();
  }

  function end() {
    store.set(seenKey, "1");
    document.body.classList.remove("tour-on");
    blocker.style.display = spot.style.display = pop.style.display = "none";
  }

  function show() {
    const step = steps[index];
    if (step.before) step.before();
    const target = visibleTarget(step.target);
    if (target) target.scrollIntoView({ block: "nearest", inline: "nearest" });

    const total = steps.length;
    pop.innerHTML = `
      <div class="tour-count">${step.welcome ? "" : `Step ${index} of ${total - 1}`}</div>
      <h3>${step.title}</h3>
      <div class="tour-text">${step.text}</div>
      <div class="tour-dots">${steps.map((_, i) => `<span class="${i === index ? "on" : ""}"></span>`).join("")}</div>
      <div class="tour-actions">
        <button class="tour-skip">${step.last ? "" : step.welcome ? "Skip for now" : "Skip tour"}</button>
        <span>
          ${index > 0 ? '<button class="tour-back">Back</button>' : ""}
          <button class="tour-next">${step.welcome ? "Take the tour →" : step.last ? "Finish" : "Next →"}</button>
        </span>
      </div>`;
    pop.querySelector(".tour-next").onclick = next;
    const back = pop.querySelector(".tour-back"); if (back) back.onclick = prev;
    const skip = pop.querySelector(".tour-skip");
    if (step.last) skip.remove(); else skip.onclick = end;

    blocker.style.display = "block";
    pop.style.display = "block";
    place(target);
    pop.querySelector(".tour-next").focus({ preventScroll: true });
  }

  // Put the spotlight over the target and the popup next to it (inside the screen)
  function place(target) {
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14, pad = 6;
    pop.classList.toggle("centred", !target);
    if (!target) {
      spot.style.display = "none";
      blocker.classList.add("dim");
      pop.style.left = `${Math.max(16, (vw - pop.offsetWidth) / 2)}px`;
      pop.style.top = `${Math.max(16, (vh - pop.offsetHeight) / 2)}px`;
      return;
    }
    blocker.classList.remove("dim");
    const r = target.getBoundingClientRect();
    Object.assign(spot.style, {
      display: "block",
      left: `${r.left - pad}px`, top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    });

    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const options = [
      { left: r.left, top: r.bottom + gap, fits: r.bottom + gap + ph < vh },              // below
      { left: r.left, top: r.top - gap - ph, fits: r.top - gap - ph > 0 },               // above
      { left: r.right + gap, top: r.top, fits: r.right + gap + pw < vw },                // right
      { left: r.left - gap - pw, top: r.top, fits: r.left - gap - pw > 0 },              // left
    ];
    const o = options.find((x) => x.fits) || { left: (vw - pw) / 2, top: (vh - ph) / 2 };
    pop.style.left = `${Math.min(Math.max(16, o.left), vw - pw - 16)}px`;
    pop.style.top = `${Math.min(Math.max(16, o.top), vh - ph - 16)}px`;
  }

  function next() { if (index < steps.length - 1) { index++; show(); } else end(); }
  function prev() { if (index > 0) { index--; show(); } }

  document.addEventListener("keydown", (e) => {
    if (!document.body.classList.contains("tour-on")) return;
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  });
  window.addEventListener("resize", () => {
    if (document.body.classList.contains("tour-on")) place(visibleTarget(steps[index].target));
  });

  // -------------------------------------------------------------------
  // When to start
  // -------------------------------------------------------------------
  const is3dOpen = () => document.getElementById("view-3d").classList.contains("active");

  // "? Tour" button: replay the tour for the view you are looking at
  document.getElementById("btn-tour").addEventListener("click", () => start(is3dOpen() ? "3d" : "2d"));

  // First visit: welcome + 2D tour (once the map has had a moment to draw)
  window.addEventListener("load", () => {
    setTimeout(() => {
      if (!is3dOpen() && !store.get(SEEN_2D)) start("2d");
    }, 900);
  });

  // First time in 3D: dashboard.js calls this when the 3D farm has loaded
  window.startTour3DOnce = function () {
    if (!store.get(SEEN_3D) && !document.body.classList.contains("tour-on")) setTimeout(() => start("3d"), 1200);
  };
  window.startTour = start;
})();
