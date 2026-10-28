"""
FARMTECH AFRICA - NDVI, NDRE and canopy temperature from the drone orthomosaics
==============================================================================

Our orthomosaics (e.g. 251209ortho.tif) are 7-band MicaSense Altum exports:
    1 Blue   2 Green   3 Red   4 Red-edge   5 NIR   6 Thermal (centi-Kelvin)   7 Alpha

For every date this script:
  1. reprojects the bands to WGS84 and shrinks them to RESOLUTION_M
     (the originals are ~3.4 cm pixels and ~1 GB - far too big for a browser)
  2. calculates
         NDVI = (NIR - Red)      / (NIR + Red)
         NDRE = (NIR - Red-edge) / (NIR + Red-edge)
         Canopy temperature (degC) = thermal / 100 - 273.15
  3. saves a GeoTIFF of the real values  (src/ndvi/tif/  - open these in QGIS)
     and a coloured transparent PNG      (src/ndvi/      - used by the dashboard)
  4. works out the mean of each layer inside the pecan orchard
  5. writes src/ndvi/ndvi_manifest.json  -> the dashboard's time slider

HOW TO RUN (Windows)
--------------------
  1. Put the orthomosaics in C:\\Users\\noesi\\Downloads\\drone_images
  2. Start menu -> "OSGeo4W Shell"  (installed with QGIS, it has GDAL + numpy)
  3. cd C:\\Users\\noesi\\Downloads\\GMT320-Osimele\\GMT320-Osimele
  4. python server\\make_vegetation_indices.py

Only the SETTINGS block below needs editing.
"""

import glob
import json
import os
import re
import struct
import sys
import zlib

import numpy as np

# ===================================================================
# SETTINGS
# ===================================================================

# Folder with the orthomosaics (.tif)
INPUT_FOLDER = r"C:\Users\noesi\Downloads\drone_images"

# The date of each file is read from its name: 251209ortho.tif -> 2025-12-09
# (also works with 2025-12-09 / 20251209). Add a file here if its name has
# no clear date, or to override it.  "label" is optional (shown in the slider).
FILE_DATES = {
    # "2512095ortho.tif": {"date": "2025-12-09", "label": "9 Dec 2025 (flight 2)"},
}

# Band numbers inside the orthomosaic (1 = first band). MicaSense Altum order:
BANDS = {"red": 3, "rededge": 4, "nir": 5, "thermal": 6}
ALPHA_BAND = 7            # transparency band (0 = outside the flight), None if there is none
NODATA = 65535            # value used for "no data" in the 16-bit bands

# Output pixel size in metres (0.25 m shows individual tree crowns and keeps
# each PNG well under 1 MB)
RESOLUTION_M = 0.25

# Colour scale limits - kept the SAME for every date so the dates compare fairly
RANGES = {"ndvi": (-0.1, 0.9), "ndre": (0.0, 0.5), "temp": (15.0, 50.0)}

# Files in the project
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT_DIR = os.path.join(SRC, "ndvi")
AOI_FILE = os.path.join(SRC, "data", "UP_farm_aoi.geojson")
TREES_FILE = os.path.join(SRC, "data", "tree.geojson")
ORCHARD_BUFFER_M = 6        # orchard = outline around the tree points + this buffer

# ===================================================================


INDEX_INFO = {
    "ndvi": {"label": "NDVI", "unit": "", "low": "Bare soil / stressed", "high": "Healthy vegetation"},
    "ndre": {"label": "NDRE", "unit": "", "low": "Low chlorophyll", "high": "High chlorophyll"},
    "temp": {"label": "Canopy temp", "unit": "°C", "low": "Cool (transpiring)", "high": "Hot (water stress)",
             "reverse": True},
}

# Red -> yellow -> green (ColorBrewer RdYlGn), same as the dashboard legend
RAMP = [(0.00, (165, 0, 38)), (0.15, (215, 48, 39)), (0.30, (244, 109, 67)),
        (0.45, (254, 224, 139)), (0.60, (217, 239, 139)), (0.78, (102, 189, 99)),
        (1.00, (0, 104, 55))]


# -------------------------------------------------------------------
# Helpers that need no GDAL (dates, colouring, PNG writing)
# -------------------------------------------------------------------
def date_from_name(name):
    """251209ortho.tif -> 2025-12-09, 2025-12-09_x.tif -> 2025-12-09"""
    m = re.search(r"(20\d{2})[-_.](\d{2})[-_.](\d{2})", name) or re.search(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", name)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"(\d{2})(\d{2})(\d{2})", name)          # YYMMDD at the start
    if m and 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 31:
        return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def colourise(values, vmin, vmax, reverse=False):
    """float array (NaN = no data) -> RGBA uint8 array"""
    t = np.clip((values - vmin) / (vmax - vmin), 0, 1)
    if reverse:
        t = 1 - t
    rgba = np.zeros(values.shape + (4,), dtype=np.uint8)
    stops = np.array([s for s, _ in RAMP])
    cols = np.array([c for _, c in RAMP], dtype=float)
    for ch in range(3):
        rgba[..., ch] = np.interp(np.nan_to_num(t), stops, cols[:, ch]).astype(np.uint8)
    rgba[..., 3] = np.where(np.isnan(values), 0, 255)
    return rgba


def write_png(path, rgba):
    """Write an RGBA PNG with only the standard library (no Pillow needed)."""
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def normalised_difference(a, b):
    """(a - b) / (a + b), NaN where there is no data"""
    with np.errstate(divide="ignore", invalid="ignore"):
        out = (a - b) / (a + b)
    out[~np.isfinite(out)] = np.nan
    return np.clip(out, -1, 1)


def thermal_to_celsius(t):
    c = t / 100.0 - 273.15
    c[(c < -10) | (c > 80)] = np.nan          # outside any realistic leaf temperature
    return c


def find_inputs():
    files = sorted(f for f in glob.glob(os.path.join(INPUT_FOLDER, "*"))
                   if f.lower().endswith((".tif", ".tiff")))
    if not files:
        sys.exit(f"No .tif files found in {INPUT_FOLDER} - check INPUT_FOLDER at the top of the script.")

    flights, used = [], {}
    for f in files:
        name = os.path.basename(f)
        override = FILE_DATES.get(name, {})
        date = override.get("date") or date_from_name(name)
        if not date:
            print(f"  skipped (no date in the name - add it to FILE_DATES): {name}")
            continue
        used[date] = used.get(date, 0) + 1
        flight_id = date if used[date] == 1 else f"{date}_{used[date]}"
        label = override.get("label") or (None if used[date] == 1 else f"flight {used[date]}")
        if used[date] > 1:
            print(f"  NOTE: {name} has the same date as another file - saved as {flight_id}")
        flights.append({"id": flight_id, "date": date, "label": label, "path": f})
    return flights


# -------------------------------------------------------------------
# GDAL processing
# -------------------------------------------------------------------
def warp_band(gdal, src, band_no, grid, resample="average", nodata=NODATA):
    """One band -> float32 array on the shared WGS84 grid."""
    vrt = gdal.Translate("", src, format="VRT", bandList=[band_no])
    opts = dict(format="MEM", dstSRS="EPSG:4326", resampleAlg=resample,
                outputType=gdal.GDT_Float32, dstNodata="nan", multithread=True,
                warpOptions=["NUM_THREADS=ALL_CPUS"])
    if nodata is not None:
        opts["srcNodata"] = nodata
    if grid is None:
        deg = RESOLUTION_M / 111320.0                       # metres -> degrees
        opts.update(xRes=deg, yRes=deg)
    else:
        bounds, size = grid
        opts.update(outputBounds=bounds, width=size[0], height=size[1])
    out = gdal.Warp("", vrt, **opts)
    arr = out.GetRasterBand(1).ReadAsArray().astype(np.float32)
    gt, size = out.GetGeoTransform(), (out.RasterXSize, out.RasterYSize)
    out = vrt = None
    return arr, gt, size


def bounds_of(gt, size):
    west, north = gt[0], gt[3]
    return west, north + gt[5] * size[1], west + gt[1] * size[0], north   # w, s, e, n


def orchard_mask(gdal, ogr, gt, size):
    """True where a pixel lies inside the pecan orchard (outline of the tree points)."""
    trees = ogr.Open(TREES_FILE)
    multipoint = ogr.Geometry(ogr.wkbMultiPoint)
    for feat in trees.GetLayer():
        multipoint.AddGeometry(feat.GetGeometryRef().Clone())
    hull = multipoint.ConvexHull().Buffer(ORCHARD_BUFFER_M / 111320.0)

    # No spatial reference on purpose: trees and raster are both lon/lat degrees,
    # so GDAL must not transform (and swap) the axes.
    mem = ogr.GetDriverByName("Memory").CreateDataSource("")
    lyr = mem.CreateLayer("orchard", None, ogr.wkbPolygon)
    feat = ogr.Feature(lyr.GetLayerDefn())
    feat.SetGeometry(hull)
    lyr.CreateFeature(feat)

    ras = gdal.GetDriverByName("MEM").Create("", size[0], size[1], 1, gdal.GDT_Byte)
    ras.SetGeoTransform(gt)
    gdal.RasterizeLayer(ras, [1], lyr, burn_values=[1])
    return ras.GetRasterBand(1).ReadAsArray().astype(bool)


def save_geotiff(gdal, path, arr, gt):
    ds = gdal.GetDriverByName("GTiff").Create(path, arr.shape[1], arr.shape[0], 1, gdal.GDT_Float32,
                                              ["COMPRESS=DEFLATE", "PREDICTOR=3"])
    ds.SetGeoTransform(gt)
    ds.SetProjection('GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
                     'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]')
    band = ds.GetRasterBand(1)
    band.SetNoDataValue(-9999)
    band.WriteArray(np.where(np.isnan(arr), -9999, arr))
    ds = None


def process_flight(gdal, ogr, flight):
    src = gdal.Open(flight["path"])
    needed = max(list(BANDS.values()) + [ALPHA_BAND or 0])
    if src.RasterCount < needed:
        raise RuntimeError(f"only {src.RasterCount} bands, expected at least {needed} - check BANDS")

    red, gt, size = warp_band(gdal, src, BANDS["red"], None)
    grid = (bounds_of(gt, size), size)
    rededge, _, _ = warp_band(gdal, src, BANDS["rededge"], grid)
    nir, _, _ = warp_band(gdal, src, BANDS["nir"], grid)

    valid = np.isfinite(red) & np.isfinite(rededge) & np.isfinite(nir)
    if ALPHA_BAND:
        alpha, _, _ = warp_band(gdal, src, ALPHA_BAND, grid, nodata=None)
        valid &= alpha > 32767                    # keep only fully-covered pixels
    for a in (red, rededge, nir):
        a[~valid] = np.nan

    layers = {
        "ndvi": normalised_difference(nir, red),
        "ndre": normalised_difference(nir, rededge),
    }
    if BANDS.get("thermal"):
        thermal, _, _ = warp_band(gdal, src, BANDS["thermal"], grid)
        thermal[~valid] = np.nan
        layers["temp"] = thermal_to_celsius(thermal)
    src = None

    try:
        mask = orchard_mask(gdal, ogr, gt, size)
    except Exception as err:
        print(f"    (orchard outline failed: {err} - using the whole image for the mean)")
        mask = np.ones(red.shape, dtype=bool)

    w, s, e, n = bounds_of(gt, size)
    out = {"date": flight["date"], "id": flight["id"]}
    if flight["label"]:
        out["label"] = flight["label"]
    for key, arr in layers.items():
        fid = flight["id"]
        save_geotiff(gdal, os.path.join(OUT_DIR, "tif", f"{fid}_{key}.tif"), arr, gt)
        write_png(os.path.join(OUT_DIR, f"{fid}_{key}.png"),
                  colourise(arr, *RANGES[key], reverse=INDEX_INFO[key].get("reverse", False)))
        inside = arr[mask & np.isfinite(arr)]
        mean = round(float(inside.mean()), 4) if inside.size else None
        out[key] = {
            "file": f"ndvi/{fid}_{key}.png",
            "geotiff": f"ndvi/tif/{fid}_{key}.tif",
            "bounds": [[round(s, 8), round(w, 8)], [round(n, 8), round(e, 8)]],
            "mean": mean,
        }
        print(f"    {INDEX_INFO[key]['label']:<12} orchard mean = {mean}")
    print(f"    {size[0]} x {size[1]} px at {RESOLUTION_M} m")
    return out


def main():
    try:
        from osgeo import gdal, ogr
    except ImportError:
        sys.exit("GDAL not found. Run this in the 'OSGeo4W Shell' that comes with QGIS.")
    gdal.UseExceptions()
    gdal.SetCacheMax(1024 * 1024 * 1024)          # 1 GB cache - the orthos are big

    os.makedirs(os.path.join(OUT_DIR, "tif"), exist_ok=True)
    print(f"Looking for orthomosaics in {INPUT_FOLDER}")
    flights = find_inputs()
    if not flights:
        sys.exit("No usable files found.")
    print(f"Processing {len(flights)} flight(s) - each one takes a minute or two.\n")

    manifest_path = os.path.join(OUT_DIR, "ndvi_manifest.json")
    done = {}
    if os.path.exists(manifest_path):           # keep flights processed earlier
        try:
            for d in json.load(open(manifest_path)).get("dates", []):
                done[d.get("id", d["date"])] = d
        except (ValueError, KeyError):
            pass

    for flight in flights:
        print(f"  {flight['id']}  ({os.path.basename(flight['path'])})")
        try:
            done[flight["id"]] = process_flight(gdal, ogr, flight)
        except Exception as err:
            print(f"    FAILED: {err}")

    manifest = {
        "indices": {k: dict(INDEX_INFO[k], min=RANGES[k][0], max=RANGES[k][1]) for k in RANGES},
        "dates": [done[k] for k in sorted(done)],
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"\nDone - {len(manifest['dates'])} flight(s) in src/ndvi/ndvi_manifest.json")
    print("Refresh the dashboard to see them on the time slider.")


if __name__ == "__main__":
    main()
