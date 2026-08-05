# SkyForge Blender Bridge

The Blender addon receives live SkyForge world payloads over localhost and applies:

- World background or an exported HDRI;
- Environment rotation and strength;
- A managed Sun light with elevation, azimuth, intensity and color temperature;
- Basic display/exposure metadata;
- Project and sync metadata on the Blender scene/world.

## Install

1. In Blender 4+, open **Edit > Preferences > Add-ons**.
2. Choose **Install from Disk** and select `skyforge_bridge_addon.py`.
3. Enable **SkyForge Bridge**.
4. Return to the 3D Viewport and press `N`.
5. Open the **SkyForge** tab in the right sidebar.
6. Press **Start Bridge**.
7. In SkyForge Core v11, open the Command Center with `Ctrl+Shift+H`, select **Blender Bridge**, and press **Send World to Blender**.

The same controls are also available under **World Properties > SkyForge Bridge**.

The addon listens only on `127.0.0.1:8765`. If Blender is offline, SkyForge writes the latest payload to `data/bridge/blender-world-latest.json`, which can be loaded with **Load SkyForge Payload**.

## Updating from version 1.0

Disable and remove the previous addon, install the new `skyforge_bridge_addon.py`, enable it, and restart Blender. The updated addon reports version `1.1.0` and adds the dedicated `N`-panel tab.
