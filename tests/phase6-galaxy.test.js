"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_GALAXY,
  normalizeGalaxy,
  estimateGalaxy,
  createGalaxySceneState
} = require("../src/phase6");
const { injectPhase6Clients, PHASE6_CLIENT_TAGS } = require("../src/phase6/runtime-utils");
const renderer = require("../phase6-gpu-renderer.js");

test("galaxy input normalizes nested payloads and defaults", () => {
  const galaxy = normalizeGalaxy({
    scene: {
      galaxy: {
        type: "barred",
        seed: 42,
        armCount: 5,
        temperature: 7300
      }
    }
  });
  assert.equal(galaxy.type, "barred");
  assert.equal(galaxy.seed, 42);
  assert.equal(galaxy.armCount, 5);
  assert.equal(galaxy.temperature, 7300);
  assert.equal(galaxy.starDensity, DEFAULT_GALAXY.starDensity);
});

test("galaxy normalization rejects invalid physical bounds", () => {
  assert.throws(() => normalizeGalaxy({ armCount: 9 }), /armCount/);
  assert.throws(() => normalizeGalaxy({ temperature: 1000 }), /temperature/);
  assert.throws(() => normalizeGalaxy({ inclination: 2 }), /inclination/);
});

test("galaxy estimates are finite and deterministic", () => {
  const input = {
    type: "spiral",
    seed: 991,
    starDensity: 0.88,
    radius: 1.2,
    thickness: 0.24,
    dust: 0.65,
    nebula: 0.5
  };
  const first = estimateGalaxy(input);
  const second = estimateGalaxy(input);
  assert.deepEqual(first, second);
  assert.ok(first.estimates.estimatedStarCount > 0);
  assert.ok(first.estimates.diameterLightYears > 0);
  assert.ok(first.estimates.gpuComplexityScore >= 0 && first.estimates.gpuComplexityScore <= 100);
});

test("galaxy scene state is persistence safe", () => {
  const scene = createGalaxySceneState({ galaxy: { type: "ring", seed: 18 } });
  assert.equal(scene.schema.id, "skyforge.galaxy");
  assert.equal(scene.schema.version, 1);
  assert.equal(scene.mode, "procedural-gpu");
  assert.equal(scene.galaxy.type, "ring");
  assert.equal(scene.galaxy.seed, 18);
});

test("Phase 6 client injection is complete and idempotent", () => {
  const source = "<!doctype html><html><body><main>SkyForge</main></body></html>";
  const first = injectPhase6Clients(source);
  const second = injectPhase6Clients(first);
  for (const tag of PHASE6_CLIENT_TAGS) {
    assert.equal(first.includes(tag), true);
    assert.equal(second.split(tag).length - 1, 1);
  }
});

test("renderer settings sanitize quality, backend and galaxy controls", () => {
  const settings = renderer.sanitizeSettings({
    backend: "webgpu",
    quality: "reference",
    mode: "galaxy",
    exposure: 3,
    galaxy: {
      type: "elliptical",
      armCount: 2,
      temperature: 9000,
      starDensity: 1.2
    }
  });
  assert.equal(settings.backend, "webgpu");
  assert.equal(settings.quality, "reference");
  assert.equal(settings.mode, "galaxy");
  assert.equal(settings.galaxy.type, "elliptical");
  assert.equal(settings.galaxy.temperature, 9000);
  assert.equal(settings.galaxy.starDensity, 1.2);
});

test("renderer uniform contract remains ten aligned vec4 values", () => {
  const values = renderer.buildUniformValues(2.5, 1280, 720);
  assert.equal(values instanceof Float32Array, true);
  assert.equal(values.length, 40);
  assert.equal(values[0], 1280);
  assert.equal(values[1], 720);
  assert.equal(values[2], 2.5);
});
