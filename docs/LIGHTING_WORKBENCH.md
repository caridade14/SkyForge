# Lighting workbench

This increment adds editable opaque reference materials, a sky/cloud reflection probe and real object Sun shadows to the existing WebGL 1 viewport. It builds on the Studio preview/UI repair; Core, navigation, geometry, physical evaluation and export services keep their existing ownership. No runtime dependency is added.

## Using the bench

Open **Sky → Lighting bench** and click **Add lighting reference bench**, or use **Scene → Add lighting reference bench**. This adds 18% gray, chrome and white spheres with a 20 m ground plane. Existing objects, Sun and cloud settings are preserved. The camera frames the bench; one Undo restores the previous scene and camera.

Select a reference sphere, cube or plane. The **Selection** inspector exposes a material preset, base color, roughness, metalness and independent cast/receive Sun-shadow flags. The color picker presents sRGB and stores linear RGB albedo. Gray 18% means linear `[0.18, 0.18, 0.18]`. Material edits obey object locking, support live preview, one Undo per committed gesture and Escape cancellation. Project export/autosave use the committed value during a live edit.

**View → Toggle object Sun shadows** and the Lighting inspector toggle the same project flag. The Lighting readout identifies the current sky source, reflection availability and Sun-shadow status. Evaluated DNI/diffuse values appear only when the cached Natural Light evaluation matches the current direction and atmosphere. These model values do not calibrate the reference shader to W/m².

## State and compatibility

- `core/reference-material.js` normalizes albedo, roughness, metalness and shadow flags. Albedo is bounded to 0–1 and roughness to 0.04–1.
- `scene.referenceObjects[id].material` is the canonical optional material. Objects without it retain their original document shape and use the neutral gray default at draw time.
- `SceneObjectAdapter` carries materials in the existing canonical transform metadata of legacy records. Save/open, autosave, duplication and Legacy workspace synchronization preserve them.
- `studio/lighting-workbench.js` owns the controls and bench transaction. It calls the existing store/project/object services; it does not create a second scene model.
- `viewport/renderer.js` draws the existing meshes with GGX distribution, height-correlated Smith visibility, Schlick Fresnel and a metallic diffuse/specular balance. Manual atmospheric RGB transport or a matching spectral sky LUT supplies the sky environment. Display conversion remains the existing bounded sRGB preview.

## GPU work and limits

`viewport/object-shadows.js` renders actual transformed visible casters into an RG-packed depth color target plus a 16-bit depth renderbuffer. It avoids requiring a depth-texture extension. A 3 × 3 filter compares depths on each receiver plane, reducing sloped-ground self-shadow artifacts. Sun direction, caster transforms/visibility/flags and quality invalidate the map; camera-only and ordinary material edits reuse it. The existing procedural cloud shadow also attenuates direct light in volumetric mode. Objects do not cast into the cloud volume.

`viewport/sky-reflections.js` renders one full-sphere equirectangular probe at the viewport target using the actual sky and cloud shaders. It samples the same animated cloud density and chooses the same effective volumetric/layer mode. RGBM stores relative radiance over a bounded 0–16 range in RGBA8. The Sun disc is excluded from this environment probe because the mesh shader evaluates direct sunlight separately. Five directional samples provide a bounded rough-reflection approximation.

| Quality | Object depth map | Sky/cloud probe | Existing primary cloud steps |
| --- | --- | --- | ---: |
| Low | 512 × 512 | 128 × 64 | 16 |
| Medium | 768 × 768 | 192 × 96 | 28 |
| High | 1024 × 1024 | 256 × 128 | 44 |

The existing viewport pixel/DPR budgets remain in force. Sun, atmosphere, clouds, animated wind time, quality, probe origin or a compatible LUT revision invalidate the probe. Exposure, ordinary material edits and orbiting around the same target reuse it. Programs cache by mode/quality. No recurring physical-evaluation request or idle render loop is added.

Incomplete targets or rejected shaders release their allocations and fall back to unshadowed/analytic sky lighting without retrying every frame. Disposal deletes owned programs, textures and targets; context loss forgets invalid handles so the existing viewport recovery can create a new renderer.

These are preview materials and environment reflections. The probe does not reflect other objects, perform parallax correction or use a GGX-prefiltered environment/BRDF integration table. Diffuse fill remains the existing hemisphere approximation. Lighting is relative, shadows have bounded scene coverage, and the RGBM probe clips beyond its range. This increment does not certify a calibrated renderer, professional HDR/OpenEXR output, ACEScg or OCIO. The export/backend/Blender protocol is unchanged.

## Validation

`tests/lighting-workbench.test.js` checks material bounds/color conversion, old-project compatibility, canonical/legacy material migration, bench Undo/Redo, committed-only live-edit export and project roundtrip. It also checks shadow fitting, incomplete GPU-target cleanup, avoiding repeated failed allocations and clearing handles after context loss.

With the existing gateway running, execute the real browser gate with Playwright installed outside the project:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/node_modules/playwright \
SKYFORGE_TEST_OUTPUT=/tmp/skyforge-lighting \
node scripts/validate-lighting.cjs
```

For installed Chrome on a target Mac, add `PLAYWRIGHT_CHANNEL=chrome SKYFORGE_WEBGL_BACKEND=native`. The gate clicks the real controls, reads actual GPU pixels/targets, verifies cache reuse, cloud reflections, shadow changes, project download/open, duplication, lock/cancellation/history behavior and real resource deletion. CI also runs the existing viewport, Studio and preview/UI gates and portable Node checks on Linux, Windows, Intel macOS and Apple Silicon macOS. Native GPU performance of this increment still requires a target-machine run.

The BRDF follows the documented GGX/Smith/Schlick formulation in [Filament's material model](https://google.github.io/filament/main/filament.html); no Filament library is bundled.
