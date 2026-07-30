# SkyForge Phase 6 — GPU Renderer and Galaxy Builder

## Overview

Phase 6 turns the Phase 5 physical-light contracts into a live GPU viewport and adds a native **Galaxy** menu for building procedural galaxies.

The implementation is progressive:

1. WebGPU is requested first.
2. WebGL2 is used automatically when WebGPU is unavailable.
3. The Phase 5 Canvas reference client remains available as a compatibility layer.
4. Saved scenes keep Phase 5 natural-light data and add `scene.rendering.phase6` plus `scene.galaxy`.

## Start

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Health endpoint:

```text
GET /api/phase6/health
```

## GPU viewport

The Phase 6 viewport client is injected through:

```text
/phase6-gpu-renderer.js
/phase6-gpu.css
```

It implements:

- WebGPU full-screen render pipeline;
- WebGL2 fallback pipeline;
- GPU quality presets: Realtime, Production and Reference;
- ACES fitted tone mapping;
- exposure and bloom controls;
- physical-atmosphere composite driven by the current Natural Light solver;
- finite solar disc and directional light response;
- procedural cloud extinction/scattering approximation;
- aerial-perspective and horizon integration;
- ground-bounce approximation;
- optional PBR reference objects;
- procedural galaxy rendering and animation;
- live backend/FPS badge in the viewport.

The renderer reads current Phase 4/5 results when available, including solar direction, direct-normal irradiance, estimated solar colour temperature and zenith-sky colour.

## Galaxy Builder

The native **Galaxy** menu appears in the main SkyForge menu bar. Open the full builder with:

```text
Shift + G
```

### Galaxy types

- Spiral
- Barred spiral
- Elliptical
- Irregular
- Ring

### Presets

- Milky Way
- Andromeda
- Sombrero
- Whirlpool
- Starburst
- Elliptical
- Ring Galaxy

### Controls

Structure:

- seed;
- radius;
- disk thickness;
- inclination;
- orientation;
- galaxy morphology.

Stars:

- star density;
- spiral-arm count;
- arm twist;
- core size and intensity;
- stellar colour temperature.

Interstellar medium:

- dust-lane strength;
- nebula emission;
- black-hole silhouette;
- lensing/accretion ring.

Dynamics and rendering:

- animation and angular speed;
- atmosphere/galaxy/hybrid compositing;
- GPU quality;
- exposure;
- bloom;
- PBR reference objects.

## Public APIs

```javascript
SkyForgePhase6Renderer.getState();
SkyForgePhase6Renderer.setEnabled(true);
SkyForgePhase6Renderer.setSettings({ quality: "reference", exposure: 1 });
SkyForgePhase6Renderer.setGalaxy({ type: "barred", armCount: 4 });
SkyForgePhase6Renderer.applyPreset("milkyWay");
SkyForgePhase6Renderer.switchBackend("webgl2");

SkyForgeGalaxyBuilder.open();
SkyForgeGalaxyBuilder.close();
SkyForgeGalaxyBuilder.toggle();
SkyForgeGalaxyBuilder.randomize();
SkyForgeGalaxyBuilder.applyPreset("andromeda");
SkyForgeGalaxyBuilder.getState();
```

## Scene persistence

Phase 6 hooks the existing scene collector and adds:

```json
{
  "rendering": {
    "phase6": {
      "backend": "auto",
      "mode": "hybrid",
      "quality": "production",
      "galaxy": {}
    }
  },
  "galaxy": {}
}
```

The loader hooks restore those values when a scene is applied.

## API

### Galaxy build state

```text
POST /api/phase6/galaxy/build
```

Example:

```json
{
  "galaxy": {
    "type": "barred",
    "seed": 8347,
    "starDensity": 0.82,
    "armCount": 4,
    "dust": 0.72,
    "temperature": 6000
  }
}
```

The response includes normalized settings, estimated diameter, thickness, star count, relative dust/nebula metrics and a GPU-complexity score.

### Combined scene state

```text
POST /api/phase6/scene-state
```

The response includes:

- natural-light input;
- physical-light evaluation;
- Phase 5 render state;
- Galaxy Builder scene state.

## Validation

```bash
npm run test:phase6
```

The Phase 6 tests cover:

- nested galaxy input normalization;
- physical bounds;
- deterministic galaxy estimates;
- persistence-safe scene state;
- idempotent browser-client injection;
- renderer settings;
- GPU uniform-buffer layout.

GitHub Actions runs the full test suite on Node.js 22 and Node.js 24.

## Current boundary

Phase 6 is a real GPU procedural renderer, but it is not yet a general mesh renderer for every arbitrary object in the SkyForge HTML prototype. The shader includes atmosphere, clouds, galaxy fields and optional PBR reference objects. Importing arbitrary scene meshes, cascaded shadow maps, reflection probes, screen-space GI, multilayer OpenEXR and a native Cycles bridge remain separate native/GPU milestones.
