"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const preview = require("../natural-light-preview.js");
const dashboard = require("../natural-light-dashboard.js");

test("preview client reports the Phase 4 client versions", () => {
  assert.equal(preview.CLIENT_VERSION, "0.4.0");
  assert.equal(dashboard.DASHBOARD_VERSION, "0.2.0");
});

test("preview client parses and formats UTC offsets", () => {
  assert.equal(preview.parseOffsetText("UTC+02:30"), 150);
  assert.equal(preview.parseOffsetText("GMT-4"), -240);
  assert.equal(preview.parseOffsetText("Europe/Paris"), null);
  assert.equal(preview.formatOffset(120), "+02:00");
  assert.equal(preview.formatOffset(-330), "-05:30");
});

test("preview client resolves explicit timezone offsets before browser fallback", () => {
  assert.equal(
    preview.resolveTimezoneOffsetMinutes(
      "2026-07-09",
      "14:30",
      "Europe/Paris · UTC+2",
      60
    ),
    120
  );
  assert.equal(
    preview.resolveTimezoneOffsetMinutes(
      "2026-07-09",
      "14:30",
      "unknown",
      -180
    ),
    -180
  );
});

test("preview client builds a Phase 4 physical input from SkyForge controls", () => {
  const values = {
    "scene-date": { value: "2026-07-09" },
    "scene-time": { value: "14:00" },
    "city-lat": { value: "48.8566" },
    "city-lon": { value: "2.3522" },
    "city-tz": { textContent: "Europe/Paris · UTC+2" },
    "city-temp": { textContent: "28 °C" },
    "v-haze": { textContent: "0.18" },
    "v-oz": { textContent: "0.60" },
    "v-mie": { textContent: "0.35" }
  };
  const documentRef = {
    getElementById(id) {
      return values[id] || null;
    }
  };

  const input = preview.buildInputFromDocument(documentRef, {}, {
    groundAlbedo: 0.35,
    aerosolSingleScatteringAlbedo: 0.87,
    multipleScatteringOrders: 6
  });
  assert.equal(input.latitude, 48.8566);
  assert.equal(input.longitude, 2.3522);
  assert.equal(input.dateTime, "2026-07-09T14:00:00+02:00");
  assert.equal(input.timezoneOffsetMinutes, 120);
  assert.equal(input.temperatureC, 28);
  assert.equal(input.aerosolOpticalDepth550, 0.18);
  assert.equal(input.ozoneDobsonUnits, 320);
  assert.equal(input.mieAsymmetry, 0.755);
  assert.equal(input.groundAlbedo, 0.35);
  assert.equal(input.aerosolSingleScatteringAlbedo, 0.87);
  assert.equal(input.multipleScatteringOrders, 6);
});

test("preview controls clamp Phase 4 physical overrides", () => {
  const values = {
    "scene-date": { value: "2026-07-09" },
    "scene-time": { value: "14:00" },
    "city-lat": { value: "0" },
    "city-lon": { value: "0" },
    "city-tz": { textContent: "UTC+0" }
  };
  const documentRef = {
    getElementById(id) {
      return values[id] || null;
    }
  };
  const input = preview.buildInputFromDocument(documentRef, {}, {
    groundAlbedo: 4,
    aerosolSingleScatteringAlbedo: -1,
    multipleScatteringOrders: 99
  });

  assert.equal(input.groundAlbedo, 1);
  assert.equal(input.aerosolSingleScatteringAlbedo, 0);
  assert.equal(input.multipleScatteringOrders, 8);
});

test("preview LUT sampling supports RGB and RGBA-like LUT layouts", () => {
  const rgbLut = {
    layout: { width: 2, height: 2 },
    pixels: [
      0.1, 0.2, 0.3,
      0.4, 0.5, 0.6,
      0.7, 0.8, 0.9,
      1.0, 0.9, 0.8
    ]
  };
  const fourChannelLut = {
    layout: {
      width: 2,
      height: 1,
      channels: ["r", "g", "b", "broadband"]
    },
    pixels: [
      0.1, 0.2, 0.3, 0.99,
      0.4, 0.5, 0.6, 0.88
    ]
  };

  assert.equal(preview.lutChannelCount(rgbLut), 3);
  assert.equal(preview.lutChannelCount(fourChannelLut), 4);
  assert.deepEqual(preview.sampleLutPixel(rgbLut, 0, 0), [0.1, 0.2, 0.3]);
  assert.deepEqual(preview.sampleLutPixel(rgbLut, 9, 9), [1.0, 0.9, 0.8]);
  assert.deepEqual(preview.sampleLutPixel(fourChannelLut, 1, 0), [0.4, 0.5, 0.6]);
  assert.deepEqual(preview.sampleLutPixel(null, 0, 0), [0, 0, 0]);
});

test("preview selects the correct LUT for each diagnostic mode", () => {
  const result = {
    skyViewLut: { model: { id: "sky" } },
    transmittanceLut: { model: { id: "trans" } },
    multipleScatteringLut: { model: { id: "multi" } }
  };

  assert.equal(preview.selectLutForMode(result, "sky").model.id, "sky");
  assert.equal(preview.selectLutForMode(result, "transmittance").model.id, "trans");
  assert.equal(preview.selectLutForMode(result, "multiple-scattering").model.id, "multi");
  assert.equal(preview.selectLutForMode(result, "invalid").model.id, "sky");
});

test("preview display conversion produces bounded channel values", () => {
  assert.equal(preview.linearToDisplayChannel(-1), 0);
  assert.ok(preview.linearToDisplayChannel(0.25) > 0);
  assert.ok(preview.linearToDisplayChannel(10) <= 255);
});

test("dashboard physical surface presets are deterministic", () => {
  assert.equal(dashboard.getGroundPresetValue("asphalt"), 0.08);
  assert.equal(dashboard.getGroundPresetValue("vegetation"), 0.22);
  assert.equal(dashboard.getGroundPresetValue("snow"), 0.82);
  assert.equal(dashboard.inferGroundPreset(0.45), "sand");
  assert.equal(dashboard.inferGroundPreset(0.31), "custom");
});

test("dashboard quality presets map to bounded solver orders", () => {
  assert.equal(dashboard.getQualityOrders("realtime"), 2);
  assert.equal(dashboard.getQualityOrders("production"), 4);
  assert.equal(dashboard.getQualityOrders("reference"), 8);
  assert.equal(dashboard.inferQualityPreset(4), "production");
  assert.equal(dashboard.inferQualityPreset(6), "custom");
});

test("dashboard convergence classifier exposes actionable states", () => {
  assert.equal(dashboard.classifyConvergence(0.004).id, "converged");
  assert.equal(dashboard.classifyConvergence(0.01).id, "acceptable");
  assert.equal(dashboard.classifyConvergence(0.04).id, "refine");
});

test("dashboard formatting and defaults are deterministic", () => {
  assert.equal(dashboard.formatNumber(0.12345, 2), "0.12");
  assert.equal(dashboard.formatNumber(undefined, 2), "—");
  assert.equal(dashboard.DEFAULTS.multipleScatteringOrders, 4);
  assert.equal(dashboard.DEFAULTS.qualityPreset, "production");
});
