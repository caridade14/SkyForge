"use strict";

const PHASE7_VERSION = "0.7.0";

function clamp(value, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : 0));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function weatherCodeLabel(code) {
  const value = Number(code) || 0;
  if (value === 0) return "Clear sky";
  if (value === 1) return "Mainly clear";
  if (value === 2) return "Partly cloudy";
  if (value === 3) return "Overcast";
  if (value === 45 || value === 48) return "Fog";
  if (value >= 51 && value <= 57) return "Drizzle";
  if (value >= 61 && value <= 67) return "Rain";
  if (value >= 71 && value <= 77) return "Snow";
  if (value >= 80 && value <= 82) return "Rain showers";
  if (value === 85 || value === 86) return "Snow showers";
  if (value >= 95) return "Thunderstorm";
  return "Mixed weather";
}

function precipitationType(current = {}) {
  const snowfall = finiteOr(current.snowfall, 0);
  const rain = finiteOr(current.rain, 0) + finiteOr(current.showers, 0);
  const code = Number(current.weather_code) || 0;
  if (snowfall > 0.01 || (code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (rain > 0.01 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return "rain";
  return "none";
}

function normalizeOpenMeteoPayload(data = {}) {
  const current = data.current || {};
  const daily = data.daily || {};
  const weatherCode = Number(current.weather_code) || 0;
  const precipitation = finiteOr(current.precipitation, finiteOr(current.rain, 0) + finiteOr(current.showers, 0) + finiteOr(current.snowfall, 0));
  const cloudCover = clamp(current.cloud_cover, 0, 100);
  const visibilityMeters = Math.max(50, finiteOr(current.visibility, 50000));
  const localTime = current.time || new Date().toISOString().slice(0, 16);
  const sunrise = Array.isArray(daily.sunrise) ? daily.sunrise[0] : null;
  const sunset = Array.isArray(daily.sunset) ? daily.sunset[0] : null;
  return {
    source: "open-meteo-live",
    latitude: finiteOr(data.latitude, 0),
    longitude: finiteOr(data.longitude, 0),
    elevation: finiteOr(data.elevation, 0),
    timezone: data.timezone || "UTC",
    timezoneAbbreviation: data.timezone_abbreviation || "",
    utcOffsetSeconds: finiteOr(data.utc_offset_seconds, 0),
    localTime,
    sunrise,
    sunset,
    isDay: current.is_day === 1,
    weatherCode,
    weather: weatherCodeLabel(weatherCode),
    temperature: finiteOr(current.temperature_2m, 15),
    apparentTemperature: finiteOr(current.apparent_temperature, finiteOr(current.temperature_2m, 15)),
    humidity: clamp(current.relative_humidity_2m, 0, 100),
    pressure: finiteOr(current.surface_pressure, 1013),
    visibility: visibilityMeters,
    cloudCover,
    cloudLow: clamp(current.cloud_cover_low ?? cloudCover * 0.5, 0, 100),
    cloudMid: clamp(current.cloud_cover_mid ?? cloudCover * 0.32, 0, 100),
    cloudHigh: clamp(current.cloud_cover_high ?? cloudCover * 0.18, 0, 100),
    precipitation,
    rain: finiteOr(current.rain, 0),
    showers: finiteOr(current.showers, 0),
    snowfall: finiteOr(current.snowfall, 0),
    precipitationType: precipitationType(current),
    windSpeed: Math.max(0, finiteOr(current.wind_speed_10m, 0)),
    windDirection: ((finiteOr(current.wind_direction_10m, 270) % 360) + 360) % 360,
    windGusts: Math.max(0, finiteOr(current.wind_gusts_10m, finiteOr(current.wind_speed_10m, 0))),
    fetchedAt: new Date().toISOString()
  };
}

function weatherToRenderState(weather = {}) {
  const cover = clamp(finiteOr(weather.cloudCover, 0) / 100, 0, 1);
  const humidity = clamp(finiteOr(weather.humidity, 50) / 100, 0, 1);
  const visibility = Math.max(50, finiteOr(weather.visibility, 50000));
  const visibilityFactor = clamp(Math.log10(visibility / 50) / 3, 0, 1);
  const precip = clamp(finiteOr(weather.precipitation, 0) / 4, 0, 1);
  const storm = Number(weather.weatherCode) >= 95 ? 1 : 0;
  return {
    enabled: true,
    live: String(weather.source || "").includes("live"),
    weatherCode: Number(weather.weatherCode) || 0,
    label: weather.weather || weatherCodeLabel(weather.weatherCode),
    isDay: weather.isDay !== false,
    cloudCoverage: cover,
    cloudDensity: clamp(0.18 + cover * 0.9 + humidity * 0.2, 0.08, 1.35),
    cloudLow: clamp(finiteOr(weather.cloudLow, cover * 50) / 100, 0, 1),
    cloudMid: clamp(finiteOr(weather.cloudMid, cover * 32) / 100, 0, 1),
    cloudHigh: clamp(finiteOr(weather.cloudHigh, cover * 18) / 100, 0, 1),
    humidity,
    visibilityFactor,
    fogDensity: clamp((1 - visibilityFactor) * 1.25 + humidity * 0.12, 0, 1.4),
    precipitation: precip,
    precipitationType: weather.precipitationType || "none",
    storm,
    windSpeed: clamp(finiteOr(weather.windSpeed, 0) / 80, 0, 1.5),
    windDirection: finiteOr(weather.windDirection, 270) * Math.PI / 180,
    temperature: finiteOr(weather.temperature, 15),
    localTime: weather.localTime || null,
    timezone: weather.timezone || "UTC",
    latitude: finiteOr(weather.latitude, 0),
    longitude: finiteOr(weather.longitude, 0),
    sunrise: weather.sunrise || null,
    sunset: weather.sunset || null,
    fetchedAt: weather.fetchedAt || new Date().toISOString()
  };
}

function normalizeAurora(input = {}) {
  const palette = Array.isArray(input.palette)
    ? input.palette.slice(0, 4)
    : String(input.palette || "#00e87a,#00c8ff,#9b6bff,#ff6baa").split(",").slice(0, 4);
  while (palette.length < 4) palette.push(palette[palette.length - 1] || "#00e87a");
  return {
    enabled: Boolean(input.enabled),
    intensity: clamp(input.intensity ?? 0.6, 0, 2),
    waveSpeed: clamp(input.waveSpeed ?? 0.4, 0, 2),
    altitude: clamp(input.altitude ?? 110, 70, 300),
    bandCount: Math.round(clamp(input.bandCount ?? 5, 1, 16)),
    curtainWidth: clamp(input.curtainWidth ?? 120, 20, 260),
    lowerEdge: clamp(input.lowerEdge ?? 38, 0, 100),
    magneticTilt: clamp(input.magneticTilt ?? -12, -60, 60),
    shimmer: clamp(input.shimmer ?? 0.35, 0, 1),
    softness: clamp(input.softness ?? 82, 0, 100),
    palette
  };
}

function normalizeColorGrade(input = {}) {
  return {
    enabled: input.enabled !== false,
    exposure: clamp(input.exposure ?? 0, -8, 8),
    contrast: clamp(input.contrast ?? 1, 0.35, 2.5),
    saturation: clamp(input.saturation ?? 1, 0, 2.5),
    temperature: clamp(input.temperature ?? 0, -1, 1),
    tint: clamp(input.tint ?? 0, -1, 1),
    hueShift: clamp(input.hueShift ?? 0, -Math.PI, Math.PI),
    lift: clamp(input.lift ?? 0, -0.5, 0.5),
    gamma: clamp(input.gamma ?? 1, 0.25, 3),
    gain: clamp(input.gain ?? 1, 0.1, 4),
    highlightRolloff: clamp(input.highlightRolloff ?? 0.65, 0, 2),
    gamutCompression: clamp(input.gamutCompression ?? 0.35, 0, 1.5),
    look: String(input.look || "Neutral ACES")
  };
}

function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function computeMoonState(dateLike = new Date(), latitude = 0, longitude = 0) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const jd = julianDay(Number.isNaN(date.getTime()) ? new Date() : date);
  const synodic = 29.53058867;
  const knownNewMoon = 2451550.1;
  const age = ((jd - knownNewMoon) % synodic + synodic) % synodic;
  const phase = age / synodic;
  const illumination = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + longitude / 15;
  const azimuth = ((hours / 24) * Math.PI * 2 + phase * Math.PI * 2 + Math.PI) % (Math.PI * 2);
  const seasonalTilt = Math.sin((jd - 2451545) / 365.25 * Math.PI * 2) * 0.18;
  const elevation = clamp(
    Math.sin((hours / 24 + phase) * Math.PI * 2) * (0.72 - Math.abs(latitude) / 180) + seasonalTilt,
    -1.2,
    1.2
  );
  return { phase, ageDays: age, illumination, azimuth, elevation };
}

module.exports = {
  PHASE7_VERSION,
  clamp,
  finiteOr,
  weatherCodeLabel,
  normalizeOpenMeteoPayload,
  weatherToRenderState,
  normalizeAurora,
  normalizeColorGrade,
  computeMoonState
};
