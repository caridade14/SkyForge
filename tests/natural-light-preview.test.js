"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const preview = require("../natural-light-preview.js");

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

test("preview client builds a physical input from SkyForge controls", () => {
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

  const input = preview.buildInputFromDocument(documentRef, {});
  assert.equal(input.latitude, 48.8566);
  assert.equal(input.longitude, 2.3522);
  assert.equal(input.dateTime, "2026-07-09T14:00:00+02:00");
  assert.equal(input.timezoneOffsetMinutes, 120);
  assert.equal(input.temperatureC, 28);
  assert.equal(input.aerosolOpticalDepth550, 0.18);
  assert.equal(input.ozoneDobsonUnits, 320);
  assert.equal(input.mieAsymmetry, 0.755);
});

test("preview LUT sampling clamps coordinates and returns RGB triples", () => {
  const lut = {
    layout: { width: 2, height: 2 },
    pixels: [
      0.1, 0.2, 0.3,
      0.4, 0.5, 0.6,
      0.7, 0.8, 0.9,
      1.0, 0.9, 0.8
    ]
  };

  assert.deepEqual(preview.sampleLutPixel(lut, 0, 0), [0.1, 0.2, 0.3]);
  assert.deepEqual(preview.sampleLutPixel(lut, 9, 9), [1.0, 0.9, 0.8]);
  assert.deepEqual(preview.sampleLutPixel(null, 0, 0), [0, 0, 0]);
});

test("preview display conversion produces bounded channel values", () => {
  assert.equal(preview.linearToDisplayChannel(-1), 0);
  assert.ok(preview.linearToDisplayChannel(0.25) > 0);
  assert.ok(preview.linearToDisplayChannel(10) <= 255);
});
