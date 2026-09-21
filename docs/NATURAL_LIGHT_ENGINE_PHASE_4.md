# SkyForge Natural Light Engine — Phase 4

## Objective

Phase 4 introduces the first multiple-scattering and ground-reflection layer in the SkyForge Natural Light Engine.

The implementation is intentionally described as a finite-order hemispheric recurrence. It is designed for deterministic interactive previsualization and LUT generation. It is not a replacement for a full angular radiative-transfer integral, Monte Carlo path tracing or a reference Bruneton/Hillaire implementation.

## Public solver

```text
skyforge-natural-light-phase4 / 0.4.0
```

The multiple-scattering component is identified as:

```text
skyforge-multiple-scattering-phase4 / 0.4.0
```

## Transport decomposition

For each spectral sample, the engine separates:

- Rayleigh scattering optical depth;
- aerosol extinction optical depth;
- aerosol scattering optical depth;
- aerosol absorption optical depth;
- gas absorption optical depth;
- total scattering optical depth;
- total extinction optical depth;
- transport optical depth;
- effective single-scattering albedo.

The aerosol contribution includes a configurable single-scattering albedo:

```text
aerosolSingleScatteringAlbedo
```

The default is `0.92`, constrained to the physical interval `[0, 1]`.

Forward Mie scattering is reduced in the transport optical depth through the existing asymmetry parameter.

## Finite-order recurrence

The engine computes four spectral components:

1. first-order atmospheric scattering seed;
2. atmospheric energy returned by subsequent scattering orders;
3. Lambertian ground reflection and atmosphere-ground feedback;
4. total indirect contribution.

Each order receives energy from the previous atmospheric and ground terms. Return factors are bounded so the recurrence remains stable.

The default number of orders is:

```text
multipleScatteringOrders = 4
```

The supported interval is `1` to `8` orders.

The output includes the energy of every order and the fraction represented by the final order. This makes convergence measurable rather than assumed.

## Night handling

The indirect daylight source is faded close to the horizon and becomes zero when the Sun is below the supported daylight horizon.

This avoids the false night-time glow that can occur when a daylight air-mass approximation is evaluated with a clamped solar zenith angle.

A future twilight model will handle solar depression separately.

## Ground bounce

The ground is currently represented by a scalar Lambertian albedo:

```text
groundAlbedo
```

The reflected term includes:

- direct irradiance reaching the ground;
- diffuse escape attenuation;
- atmosphere-to-ground coupling;
- ground-to-atmosphere feedback in later orders.

The approximation does not yet include:

- wavelength-dependent surface reflectance;
- terrain orientation;
- horizon occlusion;
- shadow maps;
- spatially varying materials.

## Phase 4 Sky-View LUT

The public Sky-View LUT is now:

```text
skyforge-sky-view-lut-phase4 / 0.4.0
```

It starts from the Phase 3 gas-aware single-scattering LUT and adds:

- an approximately isotropic atmospheric multiple-scattering term;
- stronger indirect contribution toward the horizon;
- a ground-bounce term concentrated toward low view elevations;
- global normalization after indirect light is added.

The existing viewport client consumes this enhanced LUT automatically.

## Multiple-Scattering LUT

A dedicated LUT is available through:

```text
POST /api/lighting/lut/multiple-scattering
```

Model identifier:

```text
skyforge-multiple-scattering-lut-phase4 / 0.4.0
```

The LUT maps:

- X axis: solar zenith angle from 0 to 89.5 degrees;
- Y axis: observer altitude from the configured top altitude to ground;
- R/G/B: relative linear-sRGB indirect energy;
- A: broadband indirect spectral energy.

Default dimensions:

```text
32 × 16
```

The interactive preview requests a smaller `16 × 8` LUT while the standalone endpoint supports larger bounded dimensions.

## Preview response

`POST /api/lighting/preview` now returns:

```text
input
sceneState
evaluation
skyViewLut
transmittanceLut
multipleScatteringLut
```

## Irradiance diagnostics

The Phase 4 evaluation separates:

```text
singleScatterDiffuseHorizontalEstimatedWm2
multipleScatterDiffuseBoostEstimatedWm2
groundBounceDiffuseBoostEstimatedWm2
diffuseHorizontalEstimatedWm2
globalHorizontalEstimatedWm2
```

The multiple-scattering boost uses only the atmospheric multiple-scattering energy. Ground energy is accounted for separately to prevent double counting.

## Scene persistence

The scene state now stores:

```text
solver.multipleScatteringOrders
atmosphere.aerosolSingleScatteringAlbedo
atmosphere.groundAlbedo
```

Older scene states remain compatible because defaults are applied during normalization.

## API health metadata

The health endpoint reports:

```text
skyforge-natural-light-phase4
skyforge-multiple-scattering-phase4
skyforge-sky-view-lut-phase4
skyforge-transmittance-lut-phase3
skyforge-multiple-scattering-lut-phase4
```

## Validation

Automated tests cover:

- separation of scattering and absorption optical depths;
- aerosol single-scattering albedo bounds;
- increased ground bounce with increased ground albedo;
- monotonic energy accumulation with additional orders;
- decreasing energy in later orders;
- zero indirect daylight below the horizon;
- Phase 4 evaluation metadata and spectra;
- scene-state round trips;
- deterministic enhanced Sky-View LUT output;
- deterministic multiple-scattering LUT output;
- endpoint and gateway integration.

## Scientific limitations

The current model is not a full solution of the radiative-transfer equation.

Important limitations:

- hemispheric rather than fully directional recurrence;
- no polarization;
- no terrain or cloud occlusion;
- scalar rather than spectral ground albedo;
- no spatially varying atmosphere;
- no dedicated twilight scattering;
- relative rather than absolute LUT radiance;
- no GPU compute implementation yet.

## Next implementation increments

1. Add wavelength-dependent ground reflectance presets.
2. Add a dedicated twilight and Earth-shadow model.
3. Move transmittance and multiple-scattering LUT generation to WebGPU or native compute.
4. Add cloud optical depth and sun-cloud occlusion.
5. Add absolute radiance calibration and exposure mapping.
6. Build the SkyForge Light Benchmark using measured spectra, irradiance and HDR sky references.
7. Replace the hemispheric recurrence with a production angular integration pipeline.
