# Real 3D viewport — first integration milestone

## Baseline and architecture

Inspected `feature/natural-light-engine` at `b7cbaa9` (PR #7). The live page is
`SF30.html`, served by `server.js` through `server-natural-light.js`, which injects
Core bootstrap and Natural Light scripts. `drawSky` renders into a **2D** canvas;
`sfMakeCamera`, `sfProject3D` and multiple document-capture mouse controllers emulate
perspective. Scene objects and selection still live in the legacy outliner/DOM.
Core state and that legacy scene are only partially synchronized.

The new `src/client/viewport/` boundary contains:

- `camera.js`: Z-up camera math, projection, world-space pan and dolly, axis views.
- `navigation.js`: one scoped input owner; MMB orbit, Shift+MMB pan, Ctrl+MMB dolly,
  wheel dolly, Alt+LMB equivalents for Mac trackpads, Numpad 1/3/7 and 5, Home reset.
  Shift-click axis buttons selects the opposite view. Pointer cancellation/Escape
  restores the stored camera. One completed drag creates one Undo entry.
- `renderer.js`: actual WebGL vertex/fragment programs, perspective/orthographic
  matrices, depth-tested triangle sphere and world-space grid. The sky uses rays
  from the same camera basis. No runtime dependency, CDN, native module or bundler.
- `viewport.js`: mount, store subscription, lifecycle, LUT events, context recovery,
  explicit Legacy View switch. Only changed scene/view inputs invalidate drawing.

Navigation state is under `viewport.camera`, deliberately separate from lighting
inputs under `camera`. This avoids triggering LightingSync on navigation. During a
gesture the camera is local; the completed gesture commits atomically to the Store.
Undo/Redo, autosave and `.skyforge` project documents reuse the existing services.
Old projects without the new key use defaults without rewriting their payloads.

`drawSky` has one early-return guard while WebGL is active. Its existing code and
Natural Light hooks are preserved. The new canvas captures only its own events at
window level before legacy document listeners. Other controls retain their input
handlers. Existing viewport overlays are hidden only while the new viewport is
active. **Legacy View** restores the scene editing tools and the original renderer.
The navigation gizmo is a view-orientation gizmo, not an object transform gizmo.

## Natural Light and preview limits

LUTs are reused from `skyforge:natural-light-updated` / `skyforge:lighting-preview`.
Their axes (Y-up) are sampled from Z-up world rays using azimuth/elevation. Floating
textures preserve source values where supported; bounded RGB8 is a compatibility
fallback. Bilinear sampling wraps azimuth and clamps zenith/horizon, including NPOT
textures without requiring a float-linear extension.

The current solver LUT contains relative radiance, not a calibrated HDR environment.
The **Use physical sun** button copies the evaluated solar azimuth/elevation into
the Store so the sun disc, light direction and LUT agree. If the user changes the
sun away from the cached evaluation, the viewport explicitly reports **Analytic sky
preview** until they use the evaluated sun again. No forced solver calls are made
by camera navigation. An arbitrary manual sun position is not a solver override.

Clouds are a procedural **2D layer in world space**, with coverage, density,
altitude, erosion, detail and wind sampled at the timeline frame. They are not
volumetric and do not implement thickness, volumetric shadows or precipitation.
The reference sphere is an optional viewport aid, not a scene object or export.

This is a display preview with exposure, a simple Reinhard tone map and approximate
gamma display conversion. It does not implement ACES/OCIO, professional HDR/EXR
export, import legacy scene geometry, or replace the existing Blender bridge.
Legacy object transforms, A/B capture, object selection, moon/stars/FX and old
viewport screenshot/export tools remain in **Legacy View**. They do not capture
or export this GPU viewport. This boundary must stay explicit until scene migration.

Rendering is on demand, suspended in hidden tabs, limited to about one megapixel
and DPR 1.5. Context failure falls back to Legacy View. A restored context recreates
GPU resources. Dispose releases buffers, programs, texture, observers and listeners.

## Validation

- `npm test`: original Core/Natural Light tests plus camera/matrix/ray agreement,
  persistence, Undo/Redo, input mapping, LUT packing and navigation isolation.
- `node scripts/validate-viewport.cjs`: real gateway/page and Chromium WebGL,
  actual mouse/keyboard interactions, visual pixel changes, physical request count,
  idle frame count, project/restore, legacy fallback, context loss/recovery, dispose.
  Set `PLAYWRIGHT_MODULE` to a separately installed Playwright package. Browser tools
  are CI-only and not runtime dependencies of SkyForge.
- CI runs Node tests on Linux, macOS ARM, macOS Intel and Windows. Browser integration
  runs on Linux software WebGL. This does not certify real Intel/Apple GPU drivers,
  Safari or Blender; a manual hardware smoke test remains necessary.

For manual verification: launch with `npm start`, orbit/pan/dolly, use axis buttons,
change Sun/cloud controls, save/reopen a project, switch to Legacy View and back.
Verify native Mac trackpad feel and GPU performance on the actual target hardware.
