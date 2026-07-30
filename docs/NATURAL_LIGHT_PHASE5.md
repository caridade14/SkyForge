# SkyForge Natural Light Phase 5

## Scope

Phase 5 adds a physically coherent HDR reference layer above the existing Phase 4 spectral-atmosphere solver.

Phase 4 remains responsible for solar position, Rayleigh/Mie extinction, ozone/oxygen/water absorption, finite-order multiple scattering, ground bounce and atmosphere LUT generation. Phase 5 consumes those results and adds physical camera, ACES colour management, volumetric-cloud, PBR and renderer-state contracts.

## Runtime

The default command is now:

```bash
npm start
```

It starts `server-natural-light-phase5.js`, which launches the existing Phase 4 gateway internally. The previous runtime remains available with:

```bash
npm run start:lighting:phase4
```

## API

```text
GET  /api/lighting/phase5/health
POST /api/lighting/phase5/pipeline
```

Example:

```json
{
  "input": {
    "latitude": 45.764,
    "longitude": 4.8357,
    "dateTime": "2026-07-30T18:30:00+02:00"
  },
  "camera": {
    "apertureFNumber": 8,
    "shutterSeconds": 0.008,
    "iso": 100,
    "whiteBalanceKelvin": 5600,
    "autoExposure": true
  },
  "clouds": {
    "coverage": 0.4,
    "density": 0.65,
    "baseHeightMeters": 1800,
    "thicknessMeters": 2200
  },
  "render": { "preset": "production" }
}
```

## Implemented systems

### HDR and colour

- scene-linear processing;
- ACEScg working-space matrices;
- ACES fitted tone mapping;
- soft gamut compression;
- sRGB display encoding;
- `RGBA16F` render-target contract;
- OpenEXR half/float export contract.

### Physical camera

- aperture, shutter and ISO;
- EV100 and scene EV;
- exposure compensation and ND stops;
- auto-exposure target from estimated scene luminance;
- asymmetric temporal adaptation;
- correlated-colour-temperature white balance.

### Atmosphere integration

- Phase 4 spectral atmosphere remains the source of truth;
- finite solar angular disc;
- LUT contracts for transmittance, multiple scattering, sky view and aerial perspective;
- aerial-perspective equation: `surface * transmittance + inscatter`.

### Volumetric clouds

- deterministic multi-octave density reference;
- vertical profile and wind advection;
- Beer-Lambert extinction;
- Henyey-Greenstein phase function;
- powder and approximate multiple-scattering terms;
- quality-dependent view/light step contracts;
- temporal-reprojection and cloud-shadow contracts.

### PBR

- Cook-Torrance GGX;
- Smith geometry term;
- Schlick Fresnel;
- metallic/roughness workflow;
- energy-conserving diffuse/specular separation;
- IBL contracts for diffuse irradiance, specular prefilter and BRDF LUT.

## Browser client

`natural-light-phase5.js` is injected after the Phase 4 client and provides a functional Canvas 2D reference preview with ACES tone mapping, adaptive exposure, white balance, bilinear Sky View LUT sampling, animated cloud extinction/scattering, a finite solar disc and horizon haze.

Public API:

```javascript
SkyForgeNaturalLightPhase5.setCamera({ iso: 200 });
SkyForgeNaturalLightPhase5.setClouds({ coverage: 0.55 });
SkyForgeNaturalLightPhase5.setQuality("reference");
SkyForgeNaturalLightPhase5.setEnabled(true);
SkyForgeNaturalLightPhase5.getState();
```

Phase 5 settings persist under:

```text
scene.rendering.naturalLightPhase5
```

## Quality presets

| Preset | Cloud view steps | Cloud light steps | Shadow map | Environment cube |
| --- | ---: | ---: | ---: | ---: |
| Realtime | 36 | 4 | 1024 | 128 |
| Production | 72 | 8 | 2048 | 256 |
| Reference | 144 | 16 | 4096 | 512 |

## Architectural boundary

The browser client is a reference implementation, not a native GPU path tracer. Canvas 2D cannot provide a real floating-point framebuffer, depth-aware aerial perspective over arbitrary geometry, true volumetric ray marching, shadow maps, reflection probes or screen-space GI.

The Phase 5 API establishes the physical state and rendering contracts required for a future WebGPU/WebGL2 implementation without changing saved scenes. The render state identifies Cycles as the intended final renderer, but native Cycles embedding is not included in this browser/backend repository.

## Validation

```bash
npm test
```

Tests cover photographic EV relationships, exposure adaptation, ACES output, deterministic cloud density, Beer-Lambert extinction, Henyey-Greenstein ordering, GGX response, the Phase 5 render-state contract and idempotent client injection.
