import { fetchWeatherApi } from "openmeteo";

console.log("OpenMeteo package import successfully")

const params = {
	latitude: -25.7449,
	longitude: 28.1878,
	hourly: ["temperature_2m", "precipitation_probability", "precipitation", "rain", "showers", "snowfall", "weather_code"],
	timezone: "auto",
	forecast_days: 3,
};
const url = "https://api.open-meteo.com/v1/forecast";
const responses = await fetchWeatherApi(url, params);

// Process first location. Add a for-loop for multiple locations or weather models
const response = responses[0];

// Attributes for timezone and location
const latitude = response.latitude();
const longitude = response.longitude();
const elevation = response.elevation();
const timezone = response.timezone();
const timezoneAbbreviation = response.timezoneAbbreviation();
const utcOffsetSeconds = response.utcOffsetSeconds();

console.log(
	`\nCoordinates: ${latitude}°N ${longitude}°E`,
	`\nElevation: ${elevation}m asl`,
	`\nTimezone: ${timezone} ${timezoneAbbreviation}`,
	`\nTimezone difference to GMT+0: ${utcOffsetSeconds}s`,
);

const hourly = response.hourly();

// Note: The order of weather variables in the URL query and the indices below need to match!
const weatherData = {
	hourly: {
		time: Array.from(
			{ length: (Number(hourly.timeEnd()) - Number(hourly.time())) / hourly.interval() }, 
			(_ , i) => new Date((Number(hourly.time()) + i * hourly.interval() + utcOffsetSeconds) * 1000)
		),
		temperature_2m: hourly.variables(0).valuesArray(),
		precipitation_probability: hourly.variables(1).valuesArray(),
		precipitation: hourly.variables(2).valuesArray(),
		rain: hourly.variables(3).valuesArray(),
		showers: hourly.variables(4).valuesArray(),
		snowfall: hourly.variables(5).valuesArray(),
		weather_code: hourly.variables(6).valuesArray(),
	},
};

// The 'weatherData' object now contains a simple structure, with arrays of datetimes and weather information
console.log("\nHourly data:\n", weatherData.hourly)
