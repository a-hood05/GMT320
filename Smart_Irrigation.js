// =====================================================================
// Smart_Irrigation.js
// FarmTech Africa | Smart irrigation decision-making algorithm
//
// Two independent decision mechanisms (see Requirements doc, section 3.1):
//   1. Rain override logic       -> IRRIGATE / DELAY / HOLD
//   2. Water source prioritisation -> HARVESTED_RAINWATER / MUNICIPAL
//
// This module is PURE LOGIC: no database calls, no API calls.
// Data goes in, a decision object comes out. That keeps it testable
// and lets the same code run in Node (scheduled job) or in the browser
// (Cesium dashboard).
//
// Requirements covered: SR-05, SR-06, BR-01, BR-02, BR-05, FSLR01,
//                       SHR02, FSLR08 (adjustable parameters)
// =====================================================================


// ---------------------------------------------------------------------
// 1. DEFAULT PARAMETERS
// These are the values the farm manager / SME can change through the
// admin login (FSLR08). Everything marked TBC must be confirmed.
// ---------------------------------------------------------------------
export const DEFAULT_PARAMS = {

    // ---- Rain override ------------------------------------------------
    // Delay irrigation if forecast rain >= this many mm inside the window.
    forecastRainThresholdMm: 5,       // Scope doc: 5 mm
    forecastWindowHours: 6,           // Scope doc says 6-12 h, FSLR01 says 6 h -> TBC
    minRainProbabilityPct: 50,        // Ignore low-confidence forecasts (tunable)
    activeRainThresholdMm: 0.2,       // AWS last-hour rain above this = "raining now"

    // ---- Soil moisture (soil water TENSION in kPa, positive numbers) ---
    // Higher tension = drier soil. TEROS 21 reports matric potential
    // (negative kPa); convert with Math.abs() before passing in.
    // TBC with PhD student Prudence / Dr Taylor, depends on crop + research.
    fieldCapacityTensionKpa: 20,      // At or below this -> soil is wet enough, DELAY
    irrigationTriggerTensionKpa: 50,  // At or above this -> soil is dry, IRRIGATE
    maxSensorAgeHours: 24 * 8,        // Soil data arrives WEEKLY, so allow ~8 days

    // ---- Water source -------------------------------------------------
    // Min stored water before we trust the JoJo tanks.
    // NOTE: scope doc says 10%, SR-06 says 15% -> team to pick one.
    tankMinThresholdPct: 15,
    tankHysteresisPct: 5,             // Must refill to threshold + 5% before switching back
    maxTankDataAgeHours: 24 * 8,      // Siemens data is downloaded weekly
};


// ---------------------------------------------------------------------
// 2. HELPERS
// ---------------------------------------------------------------------
const hoursBetween = (a, b) => Math.abs(a - b) / 36e5;

const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Converts the `weatherData.hourly` object produced in dataRetrieval.js
 * into a simple array of { time, precipitation, probability }.
 */
export function openMeteoToForecast(hourly) {
    return hourly.time.map((t, i) => ({
        time: t,                                          // Date
        precipitation: hourly.precipitation[i],           // mm
        probability: hourly.precipitation_probability[i], // %
    }));
}


// ---------------------------------------------------------------------
// 3. MECHANISM 1: RAIN OVERRIDE LOGIC
//
// Priority order (first match wins):
//   a) Raining right now (AWS)            -> DELAY
//   b) Significant rain forecast          -> DELAY
//   c) Soil already wet                   -> DELAY
//   d) Soil dry                           -> IRRIGATE
//   e) Soil in the comfortable middle     -> HOLD
//   f) No usable soil data                -> IRRIGATE (low confidence)
//
// inputs:
//   now            Date
//   forecast       [{ time, precipitation, probability }]  (Open-Meteo)
//   aws            { time, rainLastHourMm }                (optional)
//   soil           { time, tensionKpa }  (latest validated reading, optional)
// ---------------------------------------------------------------------
export function evaluateRainOverride({ now, forecast, aws, soil }, params = DEFAULT_PARAMS) {

    const warnings = [];

    // (a) Active rain from the Farm@UP weather station
    if (aws && isNumber(aws.rainLastHourMm) &&
        aws.rainLastHourMm >= params.activeRainThresholdMm) {
        return {
            status: "DELAY",
            reason: `Rain is currently falling (${aws.rainLastHourMm.toFixed(1)} mm in the last hour).`,
            trigger: "ACTIVE_RAIN",
            confidence: "HIGH",
            warnings,
        };
    }

    // (b) Forecast rain inside the window
    const windowEnd = new Date(now.getTime() + params.forecastWindowHours * 36e5);
    const windowHours = (forecast || []).filter(
        (h) => h.time >= now && h.time <= windowEnd && isNumber(h.precipitation)
    );

    if (windowHours.length === 0) {
        warnings.push("No forecast data available for the rain window.");
    } else {
        const totalMm = windowHours.reduce((sum, h) => sum + h.precipitation, 0);
        const maxProb = Math.max(...windowHours.map((h) => (isNumber(h.probability) ? h.probability : 0)));

        if (totalMm >= params.forecastRainThresholdMm && maxProb >= params.minRainProbabilityPct) {
            return {
                status: "DELAY",
                reason: `${totalMm.toFixed(1)} mm of rain forecast within ${params.forecastWindowHours} h ` +
                        `(up to ${maxProb}% probability).`,
                trigger: "FORECAST_RAIN",
                confidence: "MEDIUM",
                forecastMm: totalMm,
                warnings,
            };
        }
    }

    // (c-f) Soil moisture
    const soilUsable =
        soil && isNumber(soil.tensionKpa) &&
        hoursBetween(now, soil.time) <= params.maxSensorAgeHours;

    if (!soilUsable) {
        warnings.push(
            soil ? "Soil moisture reading is older than the allowed age; ignoring it."
                 : "No soil moisture data available."
        );
        return {
            status: "IRRIGATE",
            reason: "No rain expected and no current soil data. Defaulting to irrigate.",
            trigger: "NO_SOIL_DATA",
            confidence: "LOW",
            warnings,
        };
    }

    if (soil.tensionKpa <= params.fieldCapacityTensionKpa) {
        return {
            status: "DELAY",
            reason: `Soil is wet enough (${soil.tensionKpa} kPa tension, at or below ` +
                    `${params.fieldCapacityTensionKpa} kPa).`,
            trigger: "SOIL_WET",
            confidence: "HIGH",
            warnings,
        };
    }

    if (soil.tensionKpa >= params.irrigationTriggerTensionKpa) {
        return {
            status: "IRRIGATE",
            reason: `Soil is dry (${soil.tensionKpa} kPa tension, at or above ` +
                    `${params.irrigationTriggerTensionKpa} kPa) and no significant rain expected.`,
            trigger: "SOIL_DRY",
            confidence: "HIGH",
            warnings,
        };
    }

    return {
        status: "HOLD",
        reason: `Soil moisture is adequate (${soil.tensionKpa} kPa tension). No irrigation needed yet.`,
        trigger: "SOIL_ADEQUATE",
        confidence: "HIGH",
        warnings,
    };
}


// ---------------------------------------------------------------------
// 4. MECHANISM 2: WATER SOURCE PRIORITISATION
//
// Rule: prefer harvested rainwater whenever the tanks hold enough water;
// fall back to municipal water otherwise. If municipal supply is down and
// the tanks are low, we still flag the tanks as the only option (CRITICAL).
//
// inputs:
//   now
//   tanks             [{ id, levelPct, capacityL (optional), time }]
//   municipalOnline   boolean (true = supply available)
//   previousSource    last recommendation (optional, used for hysteresis)
// ---------------------------------------------------------------------
export function evaluateWaterSource({ now, tanks, municipalOnline = true, previousSource = null },
                                    params = DEFAULT_PARAMS) {
    const warnings = [];

    // Keep only valid, recent tank readings
    const valid = (tanks || []).filter(
        (t) => isNumber(t.levelPct) && t.levelPct >= 0 && t.levelPct <= 100
    );
    const fresh = valid.filter((t) => hoursBetween(now, t.time) <= params.maxTankDataAgeHours);

    if (valid.length > 0 && fresh.length < valid.length) {
        warnings.push("Some tank readings are older than the allowed age and were ignored.");
    }

    // No usable tank data -> cannot trust stored water
    if (fresh.length === 0) {
        warnings.push("No recent tank level data available.");
        return {
            source: municipalOnline ? "MUNICIPAL" : "NONE_AVAILABLE",
            reason: municipalOnline
                ? "No recent tank data, so municipal water is recommended."
                : "Municipal supply is down and there is no tank data.",
            tankLevelPct: null,
            severity: municipalOnline ? "INFO" : "CRITICAL",
            warnings,
        };
    }

    // Combined level: volume-weighted if capacities known, else simple average
    const haveCapacity = fresh.every((t) => isNumber(t.capacityL) && t.capacityL > 0);
    const combinedPct = haveCapacity
        ? (fresh.reduce((s, t) => s + (t.levelPct / 100) * t.capacityL, 0) /
           fresh.reduce((s, t) => s + t.capacityL, 0)) * 100
        : fresh.reduce((s, t) => s + t.levelPct, 0) / fresh.length;

    // Hysteresis: once on municipal, require a small margin before switching
    // back to the tanks. Prevents flip-flopping around the threshold.
    const threshold =
        previousSource === "MUNICIPAL"
            ? params.tankMinThresholdPct + params.tankHysteresisPct
            : params.tankMinThresholdPct;

    if (combinedPct > threshold) {
        return {
            source: "HARVESTED_RAINWATER",
            reason: `Tanks hold ${combinedPct.toFixed(0)}% (above the ${threshold}% minimum). ` +
                    `Use harvested rainwater.`,
            tankLevelPct: combinedPct,
            severity: "INFO",
            warnings,
        };
    }

    // Tanks too low
    if (municipalOnline) {
        return {
            source: "MUNICIPAL",
            reason: `Tanks are low (${combinedPct.toFixed(0)}%, minimum ${threshold}%). ` +
                    `Use municipal water.`,
            tankLevelPct: combinedPct,
            severity: "INFO",
            warnings,
        };
    }

    // Municipal is down AND tanks are low: last resort
    warnings.push("Municipal outage and low tank levels.");
    return {
        source: "HARVESTED_RAINWATER",
        reason: `Municipal supply is unavailable and tanks are low (${combinedPct.toFixed(0)}%). ` +
                `Tanks are the only source. Irrigate sparingly.`,
        tankLevelPct: combinedPct,
        severity: "CRITICAL",
        warnings,
    };
}


// ---------------------------------------------------------------------
// 5. MAIN ENTRY POINT
// Runs both mechanisms and returns one combined decision for the dashboard.
// Call this on the 30-minute cycle (NFSLR03).
// ---------------------------------------------------------------------
export function makeIrrigationDecision(inputs, params = DEFAULT_PARAMS) {

    const now = inputs.now || new Date();

    const irrigation = evaluateRainOverride(
        { now, forecast: inputs.forecast, aws: inputs.aws, soil: inputs.soil },
        params
    );

    const water = evaluateWaterSource(
        {
            now,
            tanks: inputs.tanks,
            municipalOnline: inputs.municipalOnline,
            previousSource: inputs.previousSource,
        },
        params
    );

    // Only recommend a water source if irrigation is actually going ahead
    const irrigating = irrigation.status === "IRRIGATE";

    return {
        timestamp: now.toISOString(),
        irrigationStatus: irrigation.status,        // IRRIGATE | DELAY | HOLD
        irrigationReason: irrigation.reason,
        trigger: irrigation.trigger,
        confidence: irrigation.confidence,
        recommendedWaterSource: irrigating ? water.source : null,
        waterSourceReason: water.reason,
        tankLevelPct: water.tankLevelPct,
        severity: water.severity,                   // INFO | CRITICAL
        warnings: [...irrigation.warnings, ...water.warnings],
        paramsUsed: params,                         // For audit / research reproducibility
    };
}


// ---------------------------------------------------------------------
// 6. QUICK SELF-TEST (run with: node Smart_Irrigation.js)
// Remove or comment out once the module is wired into the app.
// ---------------------------------------------------------------------
const isMainModule =
    typeof process !== "undefined" && process.argv?.[1]?.endsWith("Smart_Irrigation.js");

if (isMainModule) {
    const now = new Date();
    const hour = (h, mm, p) => ({ time: new Date(now.getTime() + h * 36e5), precipitation: mm, probability: p });

    const scenarios = {
        "Dry soil, no rain, full tanks": {
            forecast: [hour(1, 0, 5), hour(2, 0, 5)],
            soil: { time: now, tensionKpa: 65 },
            tanks: [{ id: 1, levelPct: 80, time: now }, { id: 2, levelPct: 70, time: now }],
            municipalOnline: true,
        },
        "Rain forecast (6 mm in 3 h)": {
            forecast: [hour(1, 3, 80), hour(2, 3, 85)],
            soil: { time: now, tensionKpa: 65 },
            tanks: [{ id: 1, levelPct: 80, time: now }],
            municipalOnline: true,
        },
        "Dry soil, low tanks, municipal outage": {
            forecast: [hour(1, 0, 0)],
            soil: { time: now, tensionKpa: 70 },
            tanks: [{ id: 1, levelPct: 8, time: now }, { id: 2, levelPct: 12, time: now }],
            municipalOnline: false,
        },
    };

    for (const [name, data] of Object.entries(scenarios)) {
        const d = makeIrrigationDecision({ now, ...data });
        console.log(`\n--- ${name} ---`);
        console.log(d.irrigationStatus, "|", d.recommendedWaterSource);
        console.log(d.irrigationReason);
        console.log(d.waterSourceReason);
    }
}