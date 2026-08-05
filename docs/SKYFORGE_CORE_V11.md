# SkyForge Core v11 — Architecture

## Design goals

Core v11 turns the SF30 interface into a state-driven application without rewriting the 900 KB legacy HTML. The Natural Light gateway injects one stylesheet and one ES-module bootstrap. This keeps the current UI usable while new systems remain modular and testable.

## Runtime flow

```text
SF30.html
  ↓ injected by server-natural-light.js
bootstrap.js
  ├─ SkyForgeStore
  ├─ TimelineEngine
  ├─ NodeGraph
  ├─ ProjectService
  ├─ LightingSync → /api/lighting/preview
  ├─ RenderService → /api/preview + /api/renders
  ├─ BlenderBridgeClient → /api/bridge/blender/*
  └─ SkyForgeUIBridge
```

## State contract

The store owns these roots:

- `project`
- `sun`
- `atmosphere`
- `clouds`
- `camera`
- `color`
- `render`
- `timeline`
- `nodes`
- `bridge`
- `engine`

All new systems read from or write to this store. Transient engine/transport changes do not pollute Undo history.

## Legacy UI strategy

`ui-bridge.js` discovers existing sliders by their visible labels and maps them to store paths. This avoids editing `SF30.html` while keeping old inline handlers functional. A MutationObserver binds controls created later by the legacy UI.

The old startup splash is disabled. The replacement Command Center is available on demand with `Ctrl+Shift+H` or the `CORE` badge beside the logo.

## Blender protocol

Protocol name: `skyforge.blender.world.v1`

Transport:

- SkyForge gateway: `POST /api/bridge/blender/send`
- Blender addon: `POST http://127.0.0.1:8765/skyforge/world`
- Health: `GET http://127.0.0.1:8765/skyforge/health`

The gateway always writes the latest payload to disk before attempting delivery. This means a user can recover a sync even when Blender was offline.

## Next implementation milestones

1. WebGL viewport adapter connected to the central state;
2. real panoramic EXR writer;
3. visual node editor backed by `NodeGraph`;
4. timeline UI adapter with draggable keyframes;
5. live HDRI streaming to Blender without intermediate disk export;
6. volumetric cloud raymarching and temporal accumulation;
7. DCC bridge protocol adapters for Unreal, Houdini, Maya and Cinema 4D.
