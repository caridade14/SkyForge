"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateEv100,
  calculateSceneEv,
  adaptExposureEv,
  applyDisplayPipeline,
  sampleCloudDensity,
  beerLambertTransmittance,
  henyeyGreenstein,
  evaluateDirectPbr,
  createPhase5RenderState,
  PHASE5_RENDERER_ID,
  injectPhase5Client
} = require("../src/natural-light");

test("physical camera follows photographic EV relationships", () => {
  const ev100 = calculateEv100({ apertureFNumber: 8, shutterSeconds: 1 / 125, iso: 100 });
  assert.ok(Math.abs(ev100 - 12.9657842847) < 1e-9);
  assert.ok(Math.abs(calculateSceneEv({ apertureFNumber: 8, shutterSeconds: 1 / 125, iso: 400 }) - (ev100 - 2)) < 1e-9);
  const adapted = adaptExposureEv(12, 8, 0.1, { adaptationSpeedUp: 3 });
  assert.ok(adapted < 12 && adapted > 8);
});

test("ACES display pipeline maps HDR values into display RGB", () => {
  const output = applyDisplayPipeline(
    { r: 14, g: 6, b: 2 },
    { exposureMultiplier: 0.12, whiteBalance: { r: 0.95, g: 1, b: 0.88 } }
  );
  assert.ok(Object.values(output).every((value) => value >= 0 && value <= 1));
  assert.ok(output.r > output.b);
});

test("cloud density and optical functions are deterministic", () => {
  const clouds = { coverage: 0.6, density: 0.8, baseHeightMeters: 1000, thicknessMeters: 2500, seed: 42 };
  const position = { x: 1200, y: 2100, z: -850 };
  const first = sampleCloudDensity(position, clouds, 12);
  assert.equal(first, sampleCloudDensity(position, clouds, 12));
  assert.ok(first >= 0 && first <= 1.6);
  assert.ok(beerLambertTransmittance(0.8, 2000, 0.001) < beerLambertTransmittance(0.2, 2000, 0.001));
  assert.ok(henyeyGreenstein(1, 0.7) > henyeyGreenstein(-1, 0.7));
});

test("GGX PBR produces a finite energy-conserving response", () => {
  const result = evaluateDirectPbr({
    material: { baseColor: { r: 0.7, g: 0.3, b: 0.1 }, metallic: 0, roughness: 0.45, specular: 0.5 },
    normal: { x: 0, y: 1, z: 0 },
    view: { x: 0, y: 1, z: 0 },
    light: { x: 0.3, y: 0.9, z: 0.1 },
    radiance: { r: 1, g: 1, b: 1 }
  });
  assert.ok([result.r, result.g, result.b].every((value) => Number.isFinite(value) && value >= 0));
  assert.ok(result.components.diffuse.r < 1 / Math.PI);
});

test("Phase 5 state exposes the HDR rendering contract", () => {
  const state = createPhase5RenderState(
    { camera: { apertureFNumber: 11, shutterSeconds: 1 / 250, iso: 100 }, clouds: { coverage: 0.48 }, render: { preset: "reference" } },
    {
      solarPosition: { apparentElevationDeg: 35, azimuthDeg: 220, sunDirection: { x: -0.4, y: 0.57, z: -0.71 } },
      irradiance: { directNormalWm2: 780, diffuseHorizontalEstimatedWm2: 120, globalHorizontalEstimatedWm2: 567 },
      color: { zenithSkyXyz: { Y: 0.42 } }
    }
  );
  assert.equal(state.renderer.id, PHASE5_RENDERER_ID);
  assert.equal(state.colorManagement.workingSpace, "ACEScg");
  assert.equal(state.colorManagement.hdrTarget, "rgba16f");
  assert.equal(state.pbr.brdf, "Cook-Torrance-GGX");
  assert.equal(state.clouds.phaseFunction, "Henyey-Greenstein");
  assert.ok(state.sun.illuminanceLux > 70000);
});

test("Phase 5 client injection is idempotent", () => {
  const html = "<html><body><main>SkyForge</main></body></html>";
  const first = injectPhase5Client(html);
  assert.match(first, /natural-light-phase5\.js/);
  assert.equal(injectPhase5Client(first), first);
});
