import { fetchWeatherApi } from "openmeteo";
import { makeIrrigationDecision, openMeteoToForecast } from "./Smart_Irrigation.js";

const responses = await fetchWeatherApi("https://api.open-meteo.com/v1/forecast", {
    latitude: -25.7449, longitude: 28.1878,
    hourly: ["precipitation", "precipitation_probability"],
    timezone: "auto", forecast_days: 2,
});

const r = responses[0], h = r.hourly(), offset = r.utcOffsetSeconds();
const hourly = {
    time: Array.from({ length: (Number(h.timeEnd()) - Number(h.time())) / h.interval() },
        (_, i) => new Date((Number(h.time()) + i * h.interval() + offset) * 1000)),
    precipitation: h.variables(0).valuesArray(),
    precipitation_probability: h.variables(1).valuesArray(),
};

const now = new Date();
const decision = makeIrrigationDecision({
    now,
    forecast: openMeteoToForecast(hourly),
    soil: { time: now, tensionKpa: 60 },                        // fake for now
    tanks: [{ id: 1, levelPct: 50, time: now }],                // fake for now
    municipalOnline: true,
});
console.log(decision);