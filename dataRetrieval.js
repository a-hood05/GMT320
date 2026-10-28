import { fetchWeatherApi } from "openmeteo";

// Fetches the hourly forecast for UP Farm from Open-Meteo and returns
// [{ time: Date, precipitation: mm, probability: % }, ...]
// Later, this is the ONLY function to swap for a PostgreSQL query.
export async function getForecast() {
    const params = {
        latitude: -25.7449,
        longitude: 28.1878,
        hourly: ["precipitation", "precipitation_probability"],
        timezone: "auto",
        forecast_days: 3,
    };

    const responses = await fetchWeatherApi("https://api.open-meteo.com/v1/forecast", params);
    const hourly = responses[0].hourly();

    const count = (Number(hourly.timeEnd()) - Number(hourly.time())) / hourly.interval();
    const precipitation = hourly.variables(0).valuesArray();
    const probability = hourly.variables(1).valuesArray();

    return Array.from({ length: count }, (_, i) => ({
        time: new Date((Number(hourly.time()) + i * hourly.interval()) * 1000),
        precipitation: precipitation[i],
        probability: probability[i],
    }));
}
