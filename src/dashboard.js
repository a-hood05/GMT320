// =====================================================================
// DASHBOARD - switching between the 2D map and the 3D farm
// The 3D (Cesium) part is only downloaded the first time you open it,
// so the 2D map opens fast.
// =====================================================================

const CESIUM_BASE = "https://cesium.com/downloads/cesiumjs/releases/1.123/Build/Cesium/";
let cesiumPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load " + src));
    document.body.appendChild(s);
  });
}

function loadCss(href) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

// Load Cesium + our 3D scripts once
function ensure3D() {
  if (cesiumPromise) return cesiumPromise;
  const loading = document.getElementById("loading3d");
  loading.style.display = "flex";

  loadCss(CESIUM_BASE + "Widgets/widgets.css");
  cesiumPromise = loadScript(CESIUM_BASE + "Cesium.js")
    .then(() => loadScript("main_cesium.js"))     // the existing 3D farm model
    .then(() => loadScript("dashboard_3d.js"))    // sensor click -> PostGIS readings
    .then(() => { loading.style.display = "none"; })
    .catch((err) => {
      console.error(err);
      loading.textContent = "The 3D farm could not load. Check your internet connection and refresh.";
    });
  return cesiumPromise;
}

function showView(which) {
  const is3d = which === "3d";
  document.getElementById("view-2d").classList.toggle("active", !is3d);
  document.getElementById("view-3d").classList.toggle("active", is3d);
  document.getElementById("btn-view-2d").classList.toggle("active", !is3d);
  document.getElementById("btn-view-3d").classList.toggle("active", is3d);

  // Remember the view in the address bar (so ?view=3d links work)
  const url = new URL(location.href);
  url.searchParams.set("view", which);
  history.replaceState(null, "", url);

  if (is3d) {
    ensure3D();
  } else if (window.map2d && window.map2d.invalidateSize) {
    setTimeout(() => window.map2d.invalidateSize(), 50); // Leaflet needs this after being hidden
  }
}

document.getElementById("btn-view-2d").addEventListener("click", () => showView("2d"));
document.getElementById("btn-view-3d").addEventListener("click", () => showView("3d"));

// Open the view asked for in the link (index.html links to ?view=3d)
showView(new URLSearchParams(location.search).get("view") === "3d" ? "3d" : "2d");
