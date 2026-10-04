# SkyForge Studio

Run `npm start` in the original project folder and open <http://127.0.0.1:3000>.

The Sky, Animation and Nodes workspace presets use the same scene and services. Drag the panel separators, toggle Outliner/Inspector/Editors, or use Shift+Space to maximize the viewport. Layout preferences persist locally. **Legacy workspace**, **Legacy View** and **Core** keep the original tools accessible, including unsupported legacy object types and the Blender Bridge.

## Scene editing

Add a sphere, cube or plane below the outliner. Click an object in the viewport or outliner to select it. Use Move, Rotate and Scale in the toolbar (G/R/S with the canvas focused), then drag a colored X/Y/Z handle. Choose global or local orientation for movement and rotation; scaling always changes local dimensions. The Selection inspector edits position in metres, XYZ Euler rotation in degrees and independent scale factors. Names, visibility, locking, duplication and deletion use the existing outliner adapter.

F or Frame frames the selected object. Option+left drag or middle mouse orbits, Shift adds pan, Ctrl adds dolly, and scrolling zooms. Drag the Sun marker with the left mouse button. Escape restores the value before a gesture; a completed gesture creates one Undo entry.

Viewport coordinates are east X, north Y, up Z. Legacy coordinates are east X, up Y, north Z; the adapter exchanges Y/Z without changing units. Native meshes are generated in Z-up. Legacy project records keep canonical transform metadata so nonuniform scales and 3D rotations roundtrip. The fixed reference sphere remains a separate visual aid.

## Nodes and animation

In Nodes, select a card to edit its implemented parameters. Drag its title to reposition it, connect an output socket to a compatible input socket, select a wire to delete it, drag empty space to pan, scroll to zoom and press F in the editor to frame the graph. Sun, Atmosphere, Clouds, SkyScene, ColorGrade and Output are functional. Invalid socket types and cycles are rejected before changing the graph.

**Direct** uses the scene controls. **Graph** evaluates the connected Output using node parameters as the base. **From controls** copies implemented controls to node parameters. A committed direct edit returns to Direct mode; cancelling that gesture preserves Graph mode. Animation overrides either base for keyed properties at the current frame. Changes to evaluated preview state are transient, avoiding history entries and synchronization loops.

In Animation, select an animatable property and insert a keyframe. Scrub or change Frame, edit the value, and insert another keyframe. Sun angles/intensity, preview exposure, cloud parameters and complete object transform vectors are available. Click diamonds to select; Shift selects several, dragging moves them, Delete removes them, and Escape cancels a drag. Choose Linear, Constant or Smooth interpolation. Play/Pause, range, FPS and Loop use TimelineEngine. Playback advances the display preview without recording every frame or requesting physical lighting for every frame.

## GPU cloud preview

The viewport toolbar selects **GPU clouds** or the previous **Cloud layer** fallback, with Low, Medium and High quality. GPU clouds raymarch procedural 3D density, with coverage, density, altitude/thickness in metres, erosion, detail, wind speed/direction and timeline frame. Sun direction/intensity illuminate the volume with approximate self-shadowing. Unsupported fragment precision or a rejected shader automatically falls back to the cloud layer; the HUD reports the effective mode.

| Quality | Primary / shadow samples | Maximum pixels |
| --- | ---: | ---: |
| Low (default) | 16 / 2 | 250,000 |
| Medium | 28 / 2 | 500,000 |
| High | 44 / 3 | 900,000 |

The budget also caps Retina resolution. Ray distance is limited to 12 km, with approximate lighting and procedural cloud shapes; there are no mesh-to-cloud shadows, volumetric imports or production render claims. Low is the default for integrated Intel GPUs. Timings in the validation document include GPU readback overhead and do not establish sustained playback FPS.

## Projects and preview images

Save/Open use the existing project service; objects, graph positions/parameters/connections and keyframes are included. Autosave writes committed edits, while a project opens paused. Old projects receive missing defaults and preserve unknown legacy data. Undo/Redo synchronizes all editors.

Capture PNG downloads `skyforge-webgl-preview.png`, an image of the current WebGL display preview. The viewport renders on demand, pauses when hidden and releases GPU resources on disposal. Interactive sky optical grading and display conversion are approximate; this is not an HDR/EXR production renderer or an ACES/OCIO implementation.

See [STUDIO_VALIDATION.md](STUDIO_VALIDATION.md) for reproducible browser validation and measured performance.
