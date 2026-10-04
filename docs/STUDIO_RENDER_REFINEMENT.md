# Studio R15: rendering and interaction repairs

This change builds on `feature/atmosphere-celestial-studio`. It keeps Core v11,
the Natural Light service and request cancellation, the original canvas,
reference objects, project/history/graph/timeline services and Blender Bridge.
It adds no runtime dependency and does not change the export backend.

## Visible changes

- The toolbar and status bar show **R15**, so an old running build is identifiable.
  The viewport mode button names the active renderer; its tooltip describes the
  destination of a click. An active WebGL preview no longer says Legacy View.
- **Sky → Sky looks** or the Outliner **Sky looks** button opens six complete,
  reversible scenes: Cumulus daylight, Warm sunset, Storm front, Moonlit night,
  Aurora night and Sunshower. Each applies Sun, atmosphere, clouds, layers,
  display exposure and camera in one Undo transaction. Reference objects, graph
  documents and timeline keys are retained. Selecting a look pauses playback and
  selects direct control authority, so existing animation/graph evaluation does
  not immediately overwrite the selected scene.
- **Sky → Clouds → Cloud size m** adjusts horizontal cloud structure in metres
  (250–6000). It is also a real parameter on the existing Clouds graph node.
  Escape cancels a preview; blur/change commits one edit. Old projects and graph
  bases gain the default 1200 m without overwriting an existing value.
- Adding or enabling a celestial layer from Legacy opens the actual 3D renderer
  in the same Undo transaction. A layer no longer appears enabled while remaining
  invisible in the old canvas. Framing a Moon, Aurora or Rainbow preserves the
  observer position; previous pitch-only framing could put it under the floor.
  An already underground observer is raised to at least 1.7 m for sky framing.
- The Studio transform buttons now reflect the navigation tool. Orbit/Pan/Dolly
  no longer leave Move falsely selected, and transform orientation is disabled
  while a navigation tool owns the drag.
- Legacy and graphics failures have a visible **Open 3D View / Retry 3D View**
  control. Context loss reports waiting for browser restoration; errors are not
  silently presented as a successful 3D preview. A renderer initialization failure
  after context restoration leaves Retry available instead of waiting forever.
- **Help → Graphics diagnostics** displays and downloads the actual active
  renderer, GPU capabilities, display/cloud dimensions, buffer format, fallback
  reason, camera and graphics error. It does not send data to a server.

## Separate cloud and display resolution

The previous Low cloud budget downscaled the entire display, including geometry
and the Moon/stars. `viewport/cloud-pass.js` now computes cloud in-scattering and
path transmission into a separate target. The final sky/layers/geometry pass has
an independent 2,000,000-pixel cap and device-pixel ratio capped at 1.5.
For a 720×665 CSS viewport at DPR 1, the display stays 720×665 while Low clouds
use 520×480. The HUD and diagnostic report show both sizes.

| Quality | Cloud pixel cap | Primary steps | Sun-path steps |
| --- | ---: | ---: | ---: |
| Low | 250,000 | 16 | 2 |
| Medium | 500,000 | 28 | 2 |
| High | 900,000 | 44 | 3 |

The target stores **relative linear RGB in-scattering** in RGB and path
transmission in A; composition is `sky * transmission + inScattering` before
display tone mapping. It prefers renderable RGBA16F, then RGBA32F, checking
framebuffer completeness. Texture support alone is not assumed to imply that
the format is renderable. The WebGL 1 fallback uses logarithmic RGB over 0–32
relative radiance and linear 8-bit transmission. Four neighbouring samples are
decoded before interpolation; the fallback has bounded quantization and clips
radiance above 32. If the separate pass is unavailable, the existing bounded
full-frame volume remains available and the report names the fallback.

Cloud transport is cached for camera, cloud, Sun, ambient lighting, size and
quality changes. Display exposure/contrast/saturation do not rerun it. Texture
unit 6 fits within WebGL 1's minimum eight fragment texture units. Framebuffer,
viewport and depth/blend/dither state are restored after the pass. Disposal and
context restoration follow the existing viewport ownership. Sky reflections
still integrate the world-space volume; they do not reuse a camera projection.

## Cloud structure and receiver shadows

Cloud direct solar light now samples the existing spherical atmosphere optical
table at the cloud layer's centre altitude, rather than reusing the ground
transmission. Low-Sun airborne light therefore loses less blue, and a high cloud
can remain sunlit after the ground enters the Earth's shadow. Cloud Sun-path
samples leave through the upper or lower cloud boundary according to solar
direction. Ground/reference lighting retains its own transmission. This reuses
optical caches and adds no physical backend requests or raymarch steps.
It is a layer-centre approximation; it does not solve per-cell atmospheric
transport, varying local horizon over a large cloud field or solar refraction.
The diagnostics expose the layer altitude and actual RGB transmission.

The cloud body now includes the existing Perlin/Worley atlas's cellular channel,
with stronger erosion near sparse boundaries, metre-scaled horizontal structure
and the existing distinct height profiles. Two broadened Henyey–Greenstein
orders replace the earlier isotropic-only higher-order term. Ambient contribution
uses a bounded local-density approximation. These remain finite-sample cloud
approximations, not a calibrated water-droplet multiple-scattering solution.

The shadow depth pass rasterizes geometric triangles. Its receiver-depth gradient
previously used interpolated smooth normals, producing stripes on the reference
sphere even with no other occluder. When standard derivatives are available,
receiver compensation now uses the geometric normal from world-position
derivatives. Smooth normals remain in BRDF shading. Contexts without derivatives
retain a conservative bounded bias. Actual object cast/receive controls, shadow
coverage and the existing depth encoding are retained.

## Verification

`npm test` runs portable numerical/state/history/migration/graph tests. With the
gateway running and Playwright installed outside the runtime project, run:

```sh
node scripts/validate-viewport.cjs
node scripts/validate-studio.cjs
node scripts/validate-preview-ui.cjs
node scripts/validate-lighting.cjs
node scripts/validate-celestial.cjs
node scripts/validate-refinement.cjs
```

The new gate reads actual WebGL pixels, checks independent budgets, the two-column
gallery, visible changes from all six looks, observer height, Legacy activation
and Undo, navigation selection, cloud-size cancellation/history, cloud-cache
reuse after exposure changes, actual layer-altitude solar lighting versus ground
extinction, absence of unoccluded sphere self-shadow stripes,
retry/report download, failed initialization after real context restoration,
forced RGBA8 cloud fallback against float output, idle
rendering and deletion of cloud resources. Existing gates retain their cloud
pixel limits and separately enforce the final display cap.

CI runs portable tests on Linux, Windows, macOS Intel and macOS Apple Silicon;
the actual browser gates use WebGL 1 through ANGLE SwiftShader on Linux. They
do not certify native GPU driver behaviour or frame rate on a target Mac.

The sky transport still uses the documented 20 m atmosphere lookup observer and
relative linear sRGB lighting. This refinement does not add calibrated exposure,
ACES/OCIO, a professional HDR/OpenEXR exporter or new DCC bridges.

## Primary graphics references

- [Khronos EXT_color_buffer_half_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_half_float/)
- [Khronos WEBGL_color_buffer_float](https://registry.khronos.org/webgl/extensions/WEBGL_color_buffer_float/)
- [PBRT v4: Phase Functions](https://www.pbr-book.org/4ed/Volume_Scattering/Phase_Functions)
- [Bruneton: spherical transmission, ground intersections and solar lighting](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html)
- [Atmosphere and celestial transport already implemented](ATMOSPHERE_CELESTIAL_STUDIO.md)
