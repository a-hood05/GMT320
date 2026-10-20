import { getForecast } from "./dataRetrieval.js";
import { makeIrrigationDecision } from "./Smart_Irrigation.js";

const now = new Date();
const forecast = await getForecast();

const decision = makeIrrigationDecision({
    now,
    forecast,                                          // REAL data from Open-Meteo
    soil: { time: now, tensionKpa: 60 },               // fake until the database is ready
    tanks: [{ id: 1, levelPct: 50, time: now }],       // fake until the database is ready
    municipalOnline: true,
});

console.log(decision.irrigationStatus, "|", decision.recommendedWaterSource);
console.log(decision.irrigationReason);
console.log(decision.waterSourceReason);

console.log("\nNext 12 hours of forecast:");
forecast.slice(0, 12).forEach(h =>
    console.log(h.time.toLocaleString(), "|", h.precipitation, "mm |", h.probability, "%")
);