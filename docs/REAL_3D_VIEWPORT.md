# Current Studio editor

The integrated workspace, rotation/nonuniform scale, timeline and node editor are documented in [SKYFORGE_STUDIO.md](SKYFORGE_STUDIO.md). The sections below also describe the earlier viewport increments.

# Real 3D viewport — first integration milestone

## Baseline and architecture

Inspected `feature/natural-light-engine` at `b7cbaa9` (PR #7). The live page is
`SF30.html`, served by `server.js` through `server-natural-light.js`, which injects
Core bootstrap and Natural Light scripts. `drawSky` renders into a **2D** canvas;
`sfMakeCamera`, `sfProject3D` and multiple document-capture mouse controllers emulate
perspective. Unsupported scene types retain the legacy outliner/DOM implementation. Editable
reference sphere/cube/plane objects and their selection now live in the Core Store
with an explicit adapter to those existing tools.

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
The corner navigation gizmo controls view orientation; a separate X/Y/Z gizmo
controls the selected reference object.

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
Unsupported legacy object transforms, A/B capture, moon/stars/FX and old viewport
screenshot/export tools remain in **Legacy View**. They do not capture
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

## Sun direction gizmo

The gold **Sun** marker edits `sun.azimuth` and `sun.elevation` with a plain left
drag. An arrow at the viewport edge represents a sun outside the current view;
drag it into the view to place the manual direction. Alt/Option + left drag and
middle mouse retain their existing orbit/pan/dolly behavior, including on the
marker. Escape cancels. A click without movement creates no history entry.

`sun-gizmo.js` projects the Z-up east/north/up direction using the camera basis and
field of view. In perspective it agrees with the rendered sky ray; in orthographic
it uses an orientation hemisphere around the view target. The marker is a small
DOM overlay with canvas-based hit testing, so it adds no WebGL resources or runtime
dependencies. It follows camera/scene invalidation and creates no animation loop.

The Store's scoped `beginEdit` transaction publishes provisional sun values to
rendering and the UI Bridge. Releasing the pointer commits one Undo entry containing
both angles. Escape, lost capture, blur, context loss, switching view, disposal, or
an overlapping external edit cancel the transaction. Other sun properties remain
unchanged. Autosave and project export use committed snapshots during a gesture;
previous project payloads need no new keys or schema migration. Undo/Redo and
loading a project synchronize the marker and controls through the existing Store.

The UI Bridge assigns sun controls and angle labels directly, without synthetic
input events or legacy hooks. Elevation covers -90° to 90°; both sliders accept 0.1°
steps while the Store retains the full evaluated physical precision. Gizmo edits
use the analytic manual preview when they diverge from the cached physical sun.
**Use physical sun** still restores the cached evaluated direction and LUT. The
gizmo never calls the physical refresh API; existing deduplication and automatic
Natural Light hooks remain in place.

Validation includes projection/drag math, input priority, pointer cancellation,
one Undo per gesture, focused-control blur, concurrent edits, autosave/export during
a gesture and bidirectional controls. The browser gate also exercises the actual
marker with WebGL, physical request counts, idle rendering, persistence and context
recovery. For a separately installed Chrome on macOS, set `PLAYWRIGHT_CHANNEL=chrome`
alongside `PLAYWRIGHT_MODULE`; CI uses the bundled Chromium.

The complete gizmo browser gate also passed on macOS with native Chrome WebGL:
ANGLE/Metal on Intel Iris Plus Graphics 645, with no WebGL errors. Artifacts include
the GPU report and screenshots of the manual gizmo and restored physical LUT.

To try on Mac: refresh the page at `http://127.0.0.1:3000`, select **3D View** if
needed, drag the gold Sun marker with one finger click-and-drag, and watch the Sun
angles update. Press Escape while holding the drag to cancel; use Cmd+Z / Cmd+Shift+Z
to Undo/Redo a completed gesture. Option + drag still orbits, and Option + Shift +
drag pans. Press **Use physical sun** to return to the evaluated direction.


## Editable reference geometry

The existing **Object Builder** adds **SPHERE**, **CUBE** and **PLANE**, while keeping
all previous types available. The WebGL renderer draws shared real triangle meshes
with depth testing and the existing Sun direction/intensity/exposure. A sphere has
a 1 m radius, a cube is 2 m across, and a two-sided plane is 4 m across in XY. Uniform
scale is supported. Gold depth-tested edges highlight the selection. The original
optional **Reference sphere** remains an independent, noneditable viewport aid.

`scene.referenceObjects` maps stable IDs to `{id,type,name,position,scale,visible,
locked}`. `scene.selectedReferenceId` stores selection. `scene-object-adapter.js`
projects references into existing outliner rows and routes reference creation,
selection, inspector, visibility, locking, duplication and deletion to the Core
Store. Unsupported types keep their Legacy handlers. DOM updates are guarded and
observer records are drained to prevent feedback loops. Hidden and locked objects
remain in persistence; locking prevents editing but permits selection.

Coordinates are metres. Legacy uses **X east / Y up / Z north**; WebGL uses **X east /
Y north / Z up**. The explicit conversion is legacy `[x,y,z]` to viewport `[x,z,y]`,
with no sign or unit change. This permutation changes handedness, so new meshes are
generated directly in Z-up rather than permuting imported vertices. The inspector
labels references as **metres · Z up** and retains fractional positions; nonreference
objects keep their existing Y-up controls. Tests verify north/east/up against the
existing physical Sun convention.

Click a visible mesh to select the nearest surface, or click empty space to clear
reference selection. Drag a colored axis with plain LMB to move only X, Y or Z.
Option/Alt + drag and MMB keep navigation priority, including on the handles.
**Frame selected**, the inspector's frame button, and **F** center the camera on the
selected object. F is ignored in text/numeric inputs. Near view-parallel axes are
hidden to avoid unstable movement; orbit slightly or use the numeric inspector.

`reference-gizmo.js` captures a camera-facing drag plane containing the chosen
axis and intersects real perspective/orthographic rays. A scoped
`beginEdit(['scene','referenceObjects',id,'position'])` publishes previews, commits
one Undo entry on release, and cancels on Escape, lost capture, blur, hidden tab,
view/mode changes, locking, hiding, context loss and disposal. Core shortcuts have
one owner in WebGL so Legacy and Core do not both process Undo/Redo.

Core project files and autosave retain the object map and selection. Committed
snapshots exclude provisional movement. Legacy collection likewise serializes
committed reference transforms; explicit SPHERE/CUBE/PLANE rows survive Legacy
save/restore. Old Core files without reference state open empty. Legacy object
arrays migrate only explicit reference types; raw unsupported objects remain
available for Legacy View and retain their data.

Geometry and picking helpers are dependency-free. GPU buffers are allocated once
per primitive and reused for all positions/scales. Only relevant state/view changes
request a draw. Object edits do not schedule physical Natural Light evaluations,
and manual/physical Sun preview behavior remains unchanged.

This increment supports reference translation and uniform scale. Rotation is
disabled for references; it does not import models, render volumetric clouds, cast
object shadows, or add HDR/EXR export. Picking spheres uses their analytic surface
(the display mesh is tessellated). Existing camera distance and coordinate limits
apply, so extreme scales may exceed the framing range. Safari/Apple GPU validation
remains separate from the local Intel Mac/Chrome gate and CI software WebGL gate.

Validation includes unit tests for primitive normals/picking/projection, all axes
and both projections, nearest/hidden/locked selection, cancellation, Undo/Redo,
legacy coordinates, project/autosave persistence and GPU resource reuse/disposal.
The real-browser gate adds actual Object Builder/inspector/outliner interactions,
framebuffer geometry checks, reference gestures/shortcuts, project migration and
reload, plus the existing Sun/navigation/context/idle/physical-request regressions.
