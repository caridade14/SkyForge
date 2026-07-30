"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeOpenMeteoPayload,
  weatherToRenderState,
  normalizeAurora,
  normalizeColorGrade,
  computeMoonState,
  injectPhase7Clients
} = require("../src/phase7");

test("live weather normalization preserves local time and cloud layers", () => {
  const result = normalizeOpenMeteoPayload({
    latitude: 45.76,
    longitude: 4.83,
    timezone: "Europe/Paris",
    timezone_abbreviation: "CEST",
    current: {
      time: "2026-07-30T17:00",
      temperature_2m: 27.4,
      relative_humidity_2m: 46,
      apparent_temperature: 28.1,
      is_day: 1,
      precipitation: 0,
      rain: 0,
      showers: 0,
      snowfall: 0,
      weather_code: 2,
      cloud_cover: 42,
      cloud_cover_low: 12,
      cloud_cover_mid: 18,
      cloud_cover_high: 28,
      surface_pressure: 1008,
      visibility: 32000,
      wind_speed_10m: 14,
      wind_direction_10m: 230,
      wind_gusts_10m: 24
    },
    daily: { sunrise: ["2026-07-30T06:20"], sunset: ["2026-07-30T21:09"] }
  });
  assert.equal(result.localTime, "2026-07-30T17:00");
  assert.equal(result.timezone, "Europe/Paris");
  assert.equal(result.cloudLow, 12);
  assert.equal(result.cloudHigh, 28);
  assert.equal(result.precipitationType, "none");
});

test("weather render state maps rain and fog without replacing the scene", () => {
  const state = weatherToRenderState({
    source: "open-meteo-live",
    weatherCode: 63,
    weather: "Rain",
    isDay: false,
    cloudCover: 94,
    cloudLow: 82,
    cloudMid: 54,
    cloudHigh: 32,
    humidity: 91,
    visibility: 1400,
    precipitation: 3.1,
    precipitationType: "rain",
    windSpeed: 36,
    windDirection: 180
  });
  assert.equal(state.live, true);
  assert.equal(state.precipitationType, "rain");
  assert.ok(state.fogDensity > 0.5);
  assert.ok(state.cloudCoverage > 0.9);
});

test("aurora defaults to a disabled additive layer", () => {
  const aurora = normalizeAurora({ intensity: 0.8 });
  assert.equal(aurora.enabled, false);
  assert.equal(aurora.palette.length, 4);
});

test("color grade clamps interactive wheel values", () => {
  const grade = normalizeColorGrade({ contrast: 8, saturation: -1, temperature: 3, hueShift: 20 });
  assert.equal(grade.contrast, 2.5);
  assert.equal(grade.saturation, 0);
  assert.equal(grade.temperature, 1);
  assert.equal(grade.hueShift, Math.PI);
});

test("moon state is deterministic for a date and location", () => {
  const a = computeMoonState("2026-07-30T17:00:00+02:00", 45.76, 4.83);
  const b = computeMoonState("2026-07-30T17:00:00+02:00", 45.76, 4.83);
  assert.deepEqual(a, b);
  assert.ok(a.phase >= 0 && a.phase <= 1);
  assert.ok(a.illumination >= 0 && a.illumination <= 1);
});

test("Phase 7 client injection is idempotent", () => {
  const html = "<html><body><main>SkyForge</main></body></html>";
  const once = injectPhase7Clients(html);
  const twice = injectPhase7Clients(once);
  assert.equal(once, twice);
  assert.match(once, /phase7-gpu-renderer\.js/);
  assert.match(once, /phase7-functional-controller\.js/);
});
