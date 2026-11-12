// =====================================================================
// FARMTECH AFRICA - NDVI, NDRE and canopy temperature from the drone orthomosaics
//
// Our orthomosaics (e.g. 251209ortho.tif) are 7-band MicaSense Altum exports:
//   1 Blue  2 Green  3 Red  4 Red-edge  5 NIR  6 Thermal (centi-Kelvin)  7 Alpha
//
// For every flight this script:
//   1. averages the ~3.4 cm pixels into RESOLUTION_M pixels
//      (the originals are ~1 GB - far too big for a browser)
//   2. calculates  NDVI = (NIR - Red)      / (NIR + Red)
//                  NDRE = (NIR - Red-edge) / (NIR + Red-edge)
//                  Canopy temperature (°C) = thermal / 100 - 273.15
//   3. saves a coloured, transparent PNG of each layer in src/ndvi/
//   4. works out the mean of each layer inside the pecan orchard
//   5. writes src/ndvi/ndvi_manifest.json -> the dashboard's time slider
// =====================================================================
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------
// SETTINGS
// ---------------------------------------------------------------------

// Folder with the orthomosaics (.tif), next to package.json
const INPUT_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "drone_images");

// The date is read from the file name: 251209ortho.tif -> 2025-12-09.
// Add a file here to override its date or give it a label for the slider.
const FILE_DATES = {
  // "2512095ortho.tif": { date: "2025-12-09", label: "flight 2" },
};

// Band numbers inside the orthomosaic (1 = first band) - MicaSense Altum order
const BANDS = { red: 3, rededge: 4, nir: 5, thermal: 6 };
const ALPHA_BAND = 7;     // transparency band (0 = outside the flight); null if there is none
const NODATA = 65535;     // "no data" value in the 16-bit bands

// Output pixel size in metres (0.25 m shows individual tree crowns)
const RESOLUTION_M = 0.25;

// Colour scale limits - the SAME for every flight so they compare fairly
const RANGES = { ndvi: [-0.1, 0.9], ndre: [0.0, 0.5], temp: [15, 50] };

const ORCHARD_BUFFER_M = 6;   // orchard = outline around the tree points + this buffer

// ---------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const OUT_DIR = path.join(SRC, "ndvi");
const TREES_FILE = path.join(SRC, "data", "tree.geojson");

export const INDEX_INFO = {
  ndvi: { label: "NDVI", unit: "", low: "Bare soil / stressed", high: "Healthy vegetation" },
  ndre: { label: "NDRE", unit: "", low: "Low chlorophyll", high: "High chlorophyll" },
  temp: { label: "Canopy temp", unit: "°C", low: "Cool (transpiring)", high: "Hot (water stress)", reverse: true },
};

// Red -> yellow -> green (ColorBrewer RdYlGn), same as the dashboard legend
const RAMP = [[0.00, [165, 0, 38]], [0.15, [215, 48, 39]], [0.30, [244, 109, 67]],
              [0.45, [254, 224, 139]], [0.60, [217, 239, 139]], [0.78, [102, 189, 99]],
              [1.00, [0, 104, 55]]];


// =====================================================================
// Small helpers
// =====================================================================

// 251209ortho.tif -> 2025-12-09 ; also 2025-12-09_x.tif and 20251209.tif
export function dateFromName(name) {
  let m = name.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/) || name.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = name.match(/^(\d{2})(\d{2})(\d{2})/);                 // YYMMDD at the start
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return `20${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// value -> [r, g, b, a]  (NaN = transparent)
export function colour(v, min, max, reverse) {
  if (!Number.isFinite(v)) return [0, 0, 0, 0];
  let t = Math.min(1, Math.max(0, (v - min) / (max - min)));
  if (reverse) t = 1 - t;
  for (let i = 1; i < RAMP.length; i++) {
    if (t <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1], [t1, c1] = RAMP[i];
      const f = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * f)).concat(255);
    }
  }
  return RAMP[RAMP.length - 1][1].concat(255);
}

// Write an RGBA PNG using only Node's built-in zlib
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(file, values, width, height, [min, max], reverse) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;                                   // filter: none
    for (let x = 0; x < width; x++) {
      const c = colour(values[y * width + x], min, max, reverse);
      raw.set(c, row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]));
}

// ---- Orchard outline: convex hull of the trees, plus a buffer ----
function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function insidePolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
export function orchardMask(width, height, west, north, dx, dy) {
  const trees = JSON.parse(fs.readFileSync(TREES_FILE, "utf8"));
  const lat0 = trees.features[0].geometry.coordinates[1];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;     // degrees -> metres
  const hull = convexHull(trees.features.map((f) => [f.geometry.coordinates[0] * kx, f.geometry.coordinates[1] * ky]));
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const py = (north - (y + 0.5) * dy) * ky;
    for (let x = 0; x < width; x++) {
      const px = (west + (x + 0.5) * dx) * kx;
      let ok = insidePolygon(px, py, hull);
      for (let i = 0; !ok && i < hull.length; i++) {
        ok = distToSegment(px, py, hull[i], hull[(i + 1) % hull.length]) <= ORCHARD_BUFFER_M;
      }
      mask[y * width + x] = ok ? 1 : 0;
    }
  }
  return mask;
}


// =====================================================================
// Reading the orthomosaic: average blocks of k x k pixels
// =====================================================================
export async function aggregate(image) {
  const W = image.getWidth(), H = image.getHeight();
  const [west, south, east, north] = image.getBoundingBox();
  const keys = image.getGeoKeys() || {};
  if (keys.ProjectedCSTypeGeoKey && keys.ProjectedCSTypeGeoKey !== 32767) {
    throw new Error(`this file is in a projected CRS (EPSG:${keys.ProjectedCSTypeGeoKey}); export it in WGS84 (EPSG:4326)`);
  }
  const needed = Math.max(...Object.values(BANDS), ALPHA_BAND || 0);
  if (image.getSamplesPerPixel() < needed) {
    throw new Error(`only ${image.getSamplesPerPixel()} bands, expected at least ${needed} - check BANDS`);
  }

  // native pixel size in metres -> block size k
  const latMid = (north + south) / 2;
  const pxM = ((east - west) / W) * 111320 * Math.cos((latMid * Math.PI) / 180);
  const k = Math.max(1, Math.round(RESOLUTION_M / pxM));
  const W2 = Math.ceil(W / k), H2 = Math.ceil(H / k);

  const names = ["red", "rededge", "nir"].concat(BANDS.thermal ? ["thermal"] : []);
  const samples = names.map((n) => BANDS[n] - 1).concat(ALPHA_BAND ? [ALPHA_BAND - 1] : []);
  const sums = Object.fromEntries(names.map((n) => [n, new Float64Array(W2 * H2)]));
  const count = new Uint32Array(W2 * H2);
  const countT = new Uint32Array(W2 * H2);

  const rowsPerRead = k * Math.max(1, Math.floor(256 / k));
  let lastPct = -1;
  for (let y0 = 0; y0 < H; y0 += rowsPerRead) {
    const y1 = Math.min(H, y0 + rowsPerRead);
    const r = await image.readRasters({ window: [0, y0, W, y1], samples, interleave: false });
    const bands = names.map((_, i) => r[i]);
    const alpha = ALPHA_BAND ? r[names.length] : null;
    const tIdx = names.indexOf("thermal");

    for (let row = 0; row < y1 - y0; row++) {
      const oRow = Math.floor((y0 + row) / k) * W2;
      for (let x = 0; x < W; x++) {
        const i = row * W + x;
        if (alpha && alpha[i] === 0) continue;
        const red = bands[0][i], re = bands[1][i], nir = bands[2][i];
        const o = oRow + Math.floor(x / k);
        if (red !== NODATA && re !== NODATA && nir !== NODATA && red + re + nir > 0) {
          sums.red[o] += red; sums.rededge[o] += re; sums.nir[o] += nir; count[o]++;
        }
        if (tIdx >= 0) {
          const t = bands[tIdx][i];
          if (t !== NODATA && t > 0) { sums.thermal[o] += t; countT[o]++; }
        }
      }
    }
    const pct = Math.floor((y1 / H) * 10) * 10;
    if (pct !== lastPct) { process.stdout.write(`${pct}% `); lastPct = pct; }
  }
  process.stdout.write("\n");

  // Only keep output pixels that are at least half covered by real data
  const minCount = Math.ceil((k * k) / 2);
  const mean = (n, c) => Float32Array.from(sums[n], (s, i) => (c[i] >= minCount ? s / c[i] : NaN));

  const dx = (east - west) / W * k, dy = (north - south) / H * k;
  return {
    width: W2, height: H2, k,
    west, north, dx, dy,
    bounds: [[north - H2 * dy, west], [north, west + W2 * dx]],   // Leaflet: [[S, W], [N, E]]
    red: mean("red", count), rededge: mean("rededge", count), nir: mean("nir", count),
    thermal: BANDS.thermal ? mean("thermal", countT) : null,
  };
}

export function computeLayers(g) {
  const nd = (a, b) => Float32Array.from(a, (v, i) => {
    const d = (v - b[i]) / (v + b[i]);
    return Number.isFinite(d) ? Math.max(-1, Math.min(1, d)) : NaN;
  });
  const layers = { ndvi: nd(g.nir, g.red), ndre: nd(g.nir, g.rededge) };
  if (g.thermal) {
    layers.temp = Float32Array.from(g.thermal, (t) => {
      const c = t / 100 - 273.15;
      return c > -10 && c < 80 ? c : NaN;          // outside any realistic leaf temperature
    });
  }
  return layers;
}

function meanInside(values, mask) {
  let s = 0, n = 0;
  for (let i = 0; i < values.length; i++) if (mask[i] && Number.isFinite(values[i])) { s += values[i]; n++; }
  return n ? Math.round((s / n) * 10000) / 10000 : null;
}


// =====================================================================
// Main
// =====================================================================
function findInputs() {
  if (!fs.existsSync(INPUT_FOLDER)) throw new Error(`Folder not found: ${INPUT_FOLDER} - check INPUT_FOLDER at the top of the script`);
  const files = fs.readdirSync(INPUT_FOLDER).filter((f) => /\.tiff?$/i.test(f)).sort();
  if (!files.length) throw new Error(`No .tif files in ${INPUT_FOLDER}`);

  const used = {}, flights = [];
  for (const name of files) {
    const override = FILE_DATES[name] || {};
    const date = override.date || dateFromName(name);
    if (!date) { console.log(`  skipped (no date in the name - add it to FILE_DATES): ${name}`); continue; }
    used[date] = (used[date] || 0) + 1;
    const id = used[date] === 1 ? date : `${date}_${used[date]}`;
    const label = override.label || (used[date] === 1 ? undefined : `flight ${used[date]}`);
    if (used[date] > 1) console.log(`  NOTE: ${name} has the same date as another file - saved as ${id}`);
    flights.push({ id, date, label, file: path.join(INPUT_FOLDER, name) });
  }
  return flights;
}

export async function processFlight(image, flight) {
  const g = await aggregate(image);
  const layers = computeLayers(g);
  const mask = orchardMask(g.width, g.height, g.west, g.north, g.dx, g.dy);

  const out = { date: flight.date, id: flight.id };
  if (flight.label) out.label = flight.label;
  for (const [key, values] of Object.entries(layers)) {
    const file = `${flight.id}_${key}.png`;
    writePng(path.join(OUT_DIR, file), values, g.width, g.height, RANGES[key], INDEX_INFO[key].reverse);
    out[key] = { file: `ndvi/${file}`, bounds: g.bounds, mean: meanInside(values, mask) };
    console.log(`    ${INDEX_INFO[key].label.padEnd(12)} orchard mean = ${out[key].mean}`);
  }
  console.log(`    ${g.width} x ${g.height} px (${g.k} x ${g.k} original pixels each)`);
  return out;
}

async function main() {
  let fromFile;
  try {
    ({ fromFile } = await import("geotiff"));
  } catch {
    console.error("The 'geotiff' package is missing - run  npm install  in the project folder first.");
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Looking for orthomosaics in ${INPUT_FOLDER}`);
  const flights = findInputs();
  console.log(`Processing ${flights.length} flight(s) - each takes a few minutes.\n`);

  const manifestPath = path.join(OUT_DIR, "ndvi_manifest.json");
  const done = {};
  if (fs.existsSync(manifestPath)) {                 // keep flights processed earlier
    try { for (const d of JSON.parse(fs.readFileSync(manifestPath, "utf8")).dates || []) done[d.id || d.date] = d; } catch {}
  }

  for (const flight of flights) {
    console.log(`  ${flight.id}  (${path.basename(flight.file)})`);
    try {
      const tiff = await fromFile(flight.file);
      const image = await tiff.getImage();
      done[flight.id] = await processFlight(image, flight);
      await tiff.close?.();
    } catch (err) {
      console.log(`    FAILED: ${err.message}`);
    }
  }

  const manifest = {
    indices: Object.fromEntries(Object.entries(RANGES).map(([k, [min, max]]) => [k, { ...INDEX_INFO[k], min, max }])),
    dates: Object.keys(done).sort().map((k) => done[k]),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nDone - ${manifest.dates.length} flight(s) in src/ndvi/ndvi_manifest.json`);
  console.log("Refresh the dashboard to see them on the time slider.");
}

// Run only when started directly (not when imported by a test)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
