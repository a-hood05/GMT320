-- Only needed if you don't have a readings table in PostGIS yet.
-- Run in pgAdmin (Query Tool) on your smart_irrigation database.

CREATE TABLE IF NOT EXISTS sensor_readings (
    gid                 serial PRIMARY KEY,
    sensor_id           integer     NOT NULL,   -- matches "id" in sensor.geojson
    recorded_at         timestamp   NOT NULL,
    soil_moisture_vwc   numeric,               -- add / rename columns to match your data;
    soil_temperature_c  numeric,               -- every numeric column shows up in the dashboard
    water_level_m       numeric
);

CREATE INDEX IF NOT EXISTS sensor_readings_sensor_time
    ON sensor_readings (sensor_id, recorded_at);

-- Load a CSV (columns in the same order as the list below):
-- \copy sensor_readings (sensor_id, recorded_at, soil_moisture_vwc, soil_temperature_c) FROM 'C:/path/to/readings.csv' CSV HEADER
