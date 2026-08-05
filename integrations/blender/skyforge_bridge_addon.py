bl_info = {
    "name": "SkyForge Bridge",
    "author": "SkyForge",
    "version": (1, 1, 0),
    "blender": (4, 0, 0),
    "location": "3D Viewport > Sidebar > SkyForge",
    "description": "Receives SkyForge world, sun and color payloads over localhost",
    "category": "Lighting",
}

import json
import math
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import bpy
from bpy.props import BoolProperty, IntProperty, StringProperty

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 8765
_SERVER = None
_THREAD = None
_PENDING = []
_LOCK = threading.Lock()


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or 0)
    if length <= 0 or length > 8_000_000:
        raise ValueError("Invalid request size")
    return json.loads(handler.rfile.read(length).decode("utf-8"))


class SkyForgeRequestHandler(BaseHTTPRequestHandler):
    server_version = "SkyForgeBlenderBridge/1.1"

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.path == "/skyforge/health":
            _json_response(self, 200, {
                "ok": True,
                "connected": True,
                "service": "skyforge-blender-bridge",
                "version": "1.1.0",
                "blender": bpy.app.version_string,
            })
            return
        _json_response(self, 404, {"error": "Route not found"})

    def do_POST(self):
        if self.path != "/skyforge/world":
            _json_response(self, 404, {"error": "Route not found"})
            return
        try:
            payload = _read_json(self)
            if payload.get("protocol") != "skyforge.blender.world.v1":
                raise ValueError("Unsupported SkyForge bridge protocol")
            with _LOCK:
                _PENDING.append(payload)
                del _PENDING[:-4]
            _json_response(self, 202, {
                "ok": True,
                "queued": True,
                "receivedAt": payload.get("sentAt"),
            })
        except Exception as error:
            _json_response(self, 400, {"error": str(error)})


def _kelvin_to_rgb(kelvin):
    temperature = max(1000.0, min(40000.0, float(kelvin))) / 100.0
    if temperature <= 66:
        red = 255.0
        green = 99.4708025861 * math.log(temperature) - 161.1195681661
        blue = 0.0 if temperature <= 19 else 138.5177312231 * math.log(temperature - 10) - 305.0447927307
    else:
        red = 329.698727446 * pow(temperature - 60, -0.1332047592)
        green = 288.1221695283 * pow(temperature - 60, -0.0755148492)
        blue = 255.0
    return tuple(max(0.0, min(1.0, value / 255.0)) for value in (red, green, blue))


def _ensure_world():
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("SkyForge World")
    scene.world = world
    world.use_nodes = True
    return scene, world


def _ensure_node(nodes, node_type, name):
    node = nodes.get(name)
    if node and node.bl_idname != node_type:
        nodes.remove(node)
        node = None
    if not node:
        node = nodes.new(node_type)
        node.name = name
        node.label = name
    return node


def _replace_input_link(links, output_socket, input_socket):
    for link in list(input_socket.links):
        links.remove(link)
    links.new(output_socket, input_socket)


def _apply_world(payload):
    scene, world = _ensure_world()
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    output = _ensure_node(nodes, "ShaderNodeOutputWorld", "SkyForge Output")
    background = _ensure_node(nodes, "ShaderNodeBackground", "SkyForge Background")
    mapping = _ensure_node(nodes, "ShaderNodeMapping", "SkyForge Mapping")
    texcoord = _ensure_node(nodes, "ShaderNodeTexCoord", "SkyForge Coordinates")
    environment = _ensure_node(nodes, "ShaderNodeTexEnvironment", "SkyForge HDRI")

    texcoord.location = (-720, 0)
    mapping.location = (-500, 0)
    environment.location = (-270, 0)
    background.location = (0, 0)
    output.location = (240, 0)

    _replace_input_link(links, texcoord.outputs["Generated"], mapping.inputs["Vector"])
    _replace_input_link(links, mapping.outputs["Vector"], environment.inputs["Vector"])
    _replace_input_link(links, background.outputs["Background"], output.inputs["Surface"])

    hdri_path = payload.get("hdriPath")
    if hdri_path and os.path.isfile(hdri_path):
        image = bpy.data.images.get(os.path.basename(hdri_path)) or bpy.data.images.load(
            hdri_path,
            check_existing=True,
        )
        environment.image = image
        _replace_input_link(links, environment.outputs["Color"], background.inputs["Color"])
    else:
        for link in list(background.inputs["Color"].links):
            links.remove(link)
        atmosphere = payload.get("atmosphere") or {}
        sun = payload.get("sun") or {}
        elevation_degrees = float(sun.get("elevation", 7.0))
        haze = max(0.0, min(1.0, float(atmosphere.get("haze", 0.3))))
        warm = max(0.0, min(1.0, (12.0 - elevation_degrees) / 18.0))
        background.inputs["Color"].default_value = (
            0.055 + warm * 0.22,
            0.10 + warm * 0.11,
            0.20 + (1.0 - haze) * 0.23,
            1.0,
        )

    background.inputs["Strength"].default_value = max(0.0, float(payload.get("strength", 1.0)))
    mapping.inputs["Rotation"].default_value[2] = math.radians(float(payload.get("rotation", 0.0)))

    project = payload.get("project") or {}
    world["skyforge_protocol"] = payload.get("protocol", "")
    world["skyforge_project"] = project.get("name", "Untitled Sky")
    world["skyforge_sync_time"] = payload.get("sentAt", "")
    scene["skyforge_color_space"] = (payload.get("color") or {}).get("workingSpace", "ACEScg")
    scene.view_settings.exposure = float((payload.get("color") or {}).get("exposure", 0.0))


def _apply_sun(payload):
    sun_data = payload.get("sun") or {}
    light_object = bpy.data.objects.get("SkyForge Sun")
    if not light_object:
        light = bpy.data.lights.new("SkyForge Sun", type="SUN")
        light_object = bpy.data.objects.new("SkyForge Sun", light)
        bpy.context.scene.collection.objects.link(light_object)
    elevation = math.radians(float(sun_data.get("elevation", 7.0)))
    azimuth = math.radians(float(sun_data.get("azimuth", 215.0)))
    light_object.rotation_euler = (math.pi / 2 - elevation, 0.0, azimuth + math.pi)
    light_object.data.energy = max(0.0, float(sun_data.get("intensity", 1.8)))
    light_object.data.angle = math.radians(float(sun_data.get("angularDiameter", 0.53)))
    light_object.data.color = _kelvin_to_rgb(sun_data.get("temperature", 5200))
    light_object["skyforge_managed"] = True


def apply_payload(payload):
    _apply_world(payload)
    _apply_sun(payload)
    bpy.context.scene.skyforge_bridge_last_status = "World applied"


def _drain_queue():
    payload = None
    with _LOCK:
        if _PENDING:
            payload = _PENDING.pop()
            _PENDING.clear()
    if payload:
        try:
            apply_payload(payload)
        except Exception as error:
            bpy.context.scene.skyforge_bridge_last_status = f"Error: {error}"
    return 0.2


def start_server():
    global _SERVER, _THREAD
    if _SERVER:
        return
    _SERVER = ReusableThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), SkyForgeRequestHandler)
    _THREAD = threading.Thread(target=_SERVER.serve_forever, name="SkyForgeBridge", daemon=True)
    _THREAD.start()
    if not bpy.app.timers.is_registered(_drain_queue):
        bpy.app.timers.register(_drain_queue, first_interval=0.2, persistent=True)


def stop_server():
    global _SERVER, _THREAD
    if _SERVER:
        _SERVER.shutdown()
        _SERVER.server_close()
    _SERVER = None
    _THREAD = None
    if bpy.app.timers.is_registered(_drain_queue):
        bpy.app.timers.unregister(_drain_queue)


class SKYFORGE_OT_start_bridge(bpy.types.Operator):
    bl_idname = "skyforge.start_bridge"
    bl_label = "Start Bridge"
    bl_description = "Start the local SkyForge listener on port 8765"
    bl_options = {"REGISTER"}

    def execute(self, context):
        try:
            start_server()
            context.scene.skyforge_bridge_running = True
            context.scene.skyforge_bridge_last_status = f"Listening on {BRIDGE_HOST}:{BRIDGE_PORT}"
            return {"FINISHED"}
        except Exception as error:
            context.scene.skyforge_bridge_running = False
            context.scene.skyforge_bridge_last_status = f"Error: {error}"
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


class SKYFORGE_OT_stop_bridge(bpy.types.Operator):
    bl_idname = "skyforge.stop_bridge"
    bl_label = "Stop Bridge"
    bl_description = "Stop the local SkyForge listener"

    def execute(self, context):
        stop_server()
        context.scene.skyforge_bridge_running = False
        context.scene.skyforge_bridge_last_status = "Stopped"
        return {"FINISHED"}


class SKYFORGE_OT_load_payload(bpy.types.Operator):
    bl_idname = "skyforge.load_payload"
    bl_label = "Load SkyForge Payload"
    bl_description = "Load a SkyForge JSON payload manually"

    filepath: StringProperty(subtype="FILE_PATH")

    def execute(self, context):
        try:
            with open(bpy.path.abspath(self.filepath), "r", encoding="utf-8") as handle:
                apply_payload(json.load(handle))
            return {"FINISHED"}
        except Exception as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}


def _draw_bridge_panel(layout, scene):
    header = layout.row(align=True)
    header.label(
        text="Online" if scene.skyforge_bridge_running else "Offline",
        icon="CHECKMARK" if scene.skyforge_bridge_running else "RADIOBUT_OFF",
    )
    header.label(text=f"{BRIDGE_HOST}:{BRIDGE_PORT}")

    row = layout.row(align=True)
    start_row = row.row(align=True)
    start_row.enabled = not scene.skyforge_bridge_running
    start_row.operator("skyforge.start_bridge", icon="PLAY")
    stop_row = row.row(align=True)
    stop_row.enabled = scene.skyforge_bridge_running
    stop_row.operator("skyforge.stop_bridge", icon="PAUSE")

    layout.operator("skyforge.load_payload", icon="FILE_FOLDER")
    box = layout.box()
    box.label(text=scene.skyforge_bridge_last_status or "Ready")
    box.label(text="SkyForge > CORE > Blender Bridge", icon="INFO")


class SKYFORGE_PT_bridge_sidebar(bpy.types.Panel):
    bl_label = "SkyForge Bridge"
    bl_idname = "SKYFORGE_PT_bridge_sidebar"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "SkyForge"

    def draw(self, context):
        _draw_bridge_panel(self.layout, context.scene)


class SKYFORGE_PT_bridge_world(bpy.types.Panel):
    bl_label = "SkyForge Bridge"
    bl_idname = "SKYFORGE_PT_bridge_world"
    bl_space_type = "PROPERTIES"
    bl_region_type = "WINDOW"
    bl_context = "world"

    def draw(self, context):
        _draw_bridge_panel(self.layout, context.scene)


_CLASSES = (
    SKYFORGE_OT_start_bridge,
    SKYFORGE_OT_stop_bridge,
    SKYFORGE_OT_load_payload,
    SKYFORGE_PT_bridge_sidebar,
    SKYFORGE_PT_bridge_world,
)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.skyforge_bridge_running = BoolProperty(default=False)
    bpy.types.Scene.skyforge_bridge_port = IntProperty(default=BRIDGE_PORT)
    bpy.types.Scene.skyforge_bridge_last_status = StringProperty(
        default="Ready — press Start Bridge",
    )


def unregister():
    stop_server()
    for name in ("skyforge_bridge_running", "skyforge_bridge_port", "skyforge_bridge_last_status"):
        if hasattr(bpy.types.Scene, name):
            delattr(bpy.types.Scene, name)
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
