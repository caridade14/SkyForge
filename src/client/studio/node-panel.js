import { cloneValue } from "../core/state-store.js";

const TYPES = ["Sun", "Atmosphere", "Clouds", "SkyScene", "ColorGrade", "Output"];
const PARAMS = {
  Sun: { azimuth: [0, 360, 1], elevation: [-90, 90, 1], intensity: [0, 20, 0.05] },
  Atmosphere: { turbidity: [1, 10, 0.1], rayleigh: [0, 10, 0.1], haze: [0, 1, 0.01], ozone: [0, 1, 0.01] },
  Clouds: { coverage: [0, 1, 0.01], density: [0, 2, 0.01], altitude: [0, 15000, 10], thickness: [10, 10000, 10], erosion: [0, 1, 0.01], detail: [0, 1, 0.01], windSpeed: [0, 100, 0.1], windDirection: [0, 360, 1] },
  ColorGrade: { exposure: [-10, 10, 0.1], contrast: [0.1, 3, 0.05], saturation: [0, 3, 0.05] }
};
const CSS = `.sf-studio-nodes{height:100%;min-height:0;display:flex;flex-direction:column;color:#d5dee8;font:11px system-ui;outline:none}.sf-studio-nodes .sf-ng-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#20262d;padding:7px;border-bottom:1px solid #303941}.sf-studio-nodes button,.sf-studio-nodes select,.sf-studio-nodes input{font:inherit;color:inherit;background:#161d23;border:1px solid #3b454e;border-radius:4px;padding:4px}.sf-studio-nodes button:hover,.sf-studio-nodes button:focus-visible{border-color:#ed963e}.sf-studio-nodes button[aria-pressed=true]{background:#71502b;border-color:#e69543}.sf-studio-nodes .sf-ng-body{flex:1;min-height:0;display:flex}.sf-studio-nodes .sf-ng-view{position:relative;flex:1;overflow:hidden;min-width:0;touch-action:none;background-color:#171d23;background-image:radial-gradient(#39414a 1px,transparent 1px);background-size:20px 20px}.sf-studio-nodes .sf-ng-stage{position:absolute;left:0;top:0;width:2000px;height:1400px;transform-origin:0 0}.sf-studio-nodes .sf-ng-wires{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}.sf-studio-nodes .sf-ng-wire{fill:none;stroke:#6fabbe;stroke-width:2;pointer-events:stroke;cursor:pointer}.sf-studio-nodes .sf-ng-wire.selected{stroke:#ffb04f;stroke-width:3}.sf-studio-nodes .sf-ng-node{position:absolute;width:180px;border:1px solid #4b5966;background:#232e38;border-radius:7px;box-shadow:0 5px 14px #0005}.sf-studio-nodes .sf-ng-node.selected{border-color:#f0a14a;box-shadow:0 0 0 1px #f0a14a66}.sf-studio-nodes .sf-ng-title{padding:8px;color:#e7eef6;background:#344554;border-radius:6px 6px 0 0;cursor:grab;touch-action:none;font-weight:650;display:flex;justify-content:space-between;gap:6px}.sf-studio-nodes .sf-ng-type{font-weight:400;font-size:9px;color:#b7c7d5}.sf-studio-nodes .sf-ng-sockets{display:flex;justify-content:space-between;padding:6px 0;min-height:32px}.sf-studio-nodes .sf-ng-socket-column{display:flex;flex-direction:column;gap:5px}.sf-studio-nodes .sf-ng-socket{border:0;background:none;display:flex;align-items:center;gap:5px;cursor:crosshair;font-size:10px}.sf-studio-nodes .sf-ng-socket:before{content:'';width:9px;height:9px;border:1px solid #9ccee0;border-radius:50%;background:#1c323c;flex-shrink:0}.sf-studio-nodes .sf-ng-socket.output{flex-direction:row-reverse}.sf-studio-nodes .sf-ng-socket.pending:before{background:#ffc46a}.sf-studio-nodes .sf-ng-inspector{width:185px;flex-shrink:0;overflow:auto;border-left:1px solid #343c45;background:#20272e;padding:8px}.sf-studio-nodes .sf-ng-inspector label{display:flex;justify-content:space-between;align-items:center;gap:6px;margin:6px 0}.sf-studio-nodes .sf-ng-inspector input{width:70px;min-width:0}.sf-studio-nodes .sf-ng-inspector p{color:#a9b9c7;line-height:1.45;font-size:10px}.sf-studio-nodes .sf-ng-status{font-size:10px;color:#a9b9c7;padding:5px 9px;min-height:14px}.sf-studio-nodes .sf-ng-status.error{color:#ff9e92}`;
const svgNS = "http://www.w3.org/2000/svg";
function el(tag, cls, text) { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; }
function svg(tag) { return document.createElementNS(svgNS, tag); }

export class NodePanel {
  constructor(api) { this.api = api; this.store = api.store; this.graph = api.nodeGraph; this.selectedId = null; this.selectedConnection = null; this.pending = null; this.view = { x: 10, y: 5, zoom: 0.68 }; }
  init(host) {
    this.host = host; this.root = el("section", "sf-studio-nodes"); this.root.tabIndex = 0; this.root.setAttribute("aria-label", "Sky composition node editor");
    const style = el("style"); style.textContent = CSS; this.root.append(style);
    const bar = el("div", "sf-ng-bar");
    this.direct = this.button(bar, "Direct", () => this.api.composition.setAuthority("direct")); this.direct.title = "Direct controls own the sky; animation overlays its tracks";
    this.graphMode = this.button(bar, "Use graph", () => this.api.composition.setAuthority("graph")); this.graphMode.dataset.studioAction = "use-graph"; this.graphMode.title = "Graph output owns the sky; animation overrides animated tracks";
    this.types = el("select"); this.types.setAttribute("aria-label", "Node type"); for (const type of TYPES) { const option = el("option", "", type); option.value = type; this.types.append(option); } bar.append(this.types);
    this.button(bar, "+ Node", () => { const rect = this.viewEl.getBoundingClientRect(); this.graph.addNode(this.types.value, { position: { x: (rect.width / 2 - this.view.x) / this.view.zoom, y: (rect.height / 2 - this.view.y) / this.view.zoom } }); });
    this.button(bar, "Delete", () => this.deleteSelection()); this.button(bar, "From controls", () => this.api.composition.copySceneToGraph());
    this.button(bar, "Frame graph", () => this.frameGraph()); this.button(bar, "Reset", () => { this.view = { x: 10, y: 5, zoom: 0.68 }; this.updateView(); });
    const body = el("div", "sf-ng-body"); this.viewEl = el("div", "sf-ng-view"); this.stage = el("div", "sf-ng-stage"); this.wires = svg("svg"); this.wires.classList.add("sf-ng-wires"); this.nodeHost = el("div"); this.stage.append(this.wires, this.nodeHost); this.viewEl.append(this.stage); this.inspector = el("aside", "sf-ng-inspector"); this.inspector.setAttribute("aria-label", "Node parameters"); body.append(this.viewEl, this.inspector);
    this.status = el("div", "sf-ng-status", "Connect an output socket to an input. Wheel zooms; middle button or Alt + drag pans."); this.root.append(bar, body, this.status); host.append(this.root);
    this.onDown = (event) => this.pointerDown(event); this.onMove = (event) => this.pointerMove(event); this.onUp = (event) => this.pointerUp(event); this.onCancel = () => this.finishDrag(false);
    this.viewEl.addEventListener("pointerdown", this.onDown); globalThis.addEventListener("pointermove", this.onMove); globalThis.addEventListener("pointerup", this.onUp); globalThis.addEventListener("pointercancel", this.onCancel); globalThis.addEventListener("blur", this.onCancel);
    this.onWheel = (event) => { event.preventDefault(); this.finishDrag(false); const rect = this.viewEl.getBoundingClientRect(), local = this.local(event.clientX, event.clientY); this.view.zoom = Math.max(0.25, Math.min(2, this.view.zoom * Math.exp(-event.deltaY * 0.001))); this.view.x = event.clientX - rect.left - local.x * this.view.zoom; this.view.y = event.clientY - rect.top - local.y * this.view.zoom; this.updateView(); };
    this.viewEl.addEventListener("wheel", this.onWheel, { passive: false });
    this.onKey = (event) => {
      if (event.key === "Escape") { this.finishDrag(false); this.cancelParam(); this.pending = null; if (event.target.matches("input")) event.target.blur(); this.render(); event.stopPropagation(); }
      if (event.target.matches("input,select,textarea")) return;
      if (["Delete", "Backspace"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); this.deleteSelection(); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); event.stopPropagation(); this.frameGraph(); }
    };
    this.root.addEventListener("keydown", this.onKey);
    this.unsubscribe = this.store.subscribe((_state, change) => {
      if (this.drag?.edit && !this.drag.edit.active) this.finishDrag(false);
      if (["Scrub timeline", "Evaluate animation preview", "Evaluate graph preview", "Update lighting engine status"].includes(change?.label)) return;
      if (!change?.path || change.path === "nodes" || change.path.startsWith("nodes.") || change.path === "scene.authority") this.render();
    });
    this.unsubscribeComposition = this.api.composition.subscribe(({ error }) => { if (error) this.message(error, true); else this.message("Graph and animation evaluate as preview; direct edits return to Direct mode."); });
    this.render(); this.updateView(); return this;
  }
  button(bar, label, action) { const button = el("button", "", label); button.onclick = () => { try { action(); } catch (error) { this.message(error.message, true); } }; bar.append(button); return button; }
  message(text, error = false) { this.status.textContent = text; this.status.classList.toggle("error", error); }
  local(x, y) { const rect = this.viewEl.getBoundingClientRect(); return { x: (x - rect.left - this.view.x) / this.view.zoom, y: (y - rect.top - this.view.y) / this.view.zoom }; }
  updateView() { this.stage.style.transform = `translate(${this.view.x}px,${this.view.y}px) scale(${this.view.zoom})`; }
  render() {
    const authority = this.api.composition.authority; this.direct.setAttribute("aria-pressed", String(authority === "direct")); this.graphMode.setAttribute("aria-pressed", String(authority === "graph"));
    if (!this.graph.nodes.has(this.selectedId)) this.selectedId = null;
    const signature = JSON.stringify([[...this.graph.nodes.values()].map((node) => [node.id, node.type, node.label]), this.selectedId, this.pending]);
    if (signature !== this.signature) {
      this.signature = signature; this.nodeHost.replaceChildren();
      for (const node of this.graph.nodes.values()) {
        const card = el("article", `sf-ng-node${node.id === this.selectedId ? " selected" : ""}`); card.dataset.node = node.id; card.style.left = `${node.position.x}px`; card.style.top = `${node.position.y}px`;
        const title = el("div", "sf-ng-title", node.label), type = el("span", "sf-ng-type", node.type); title.append(type); title.dataset.nodeDrag = node.id; title.tabIndex = 0; title.setAttribute("aria-label", `Move ${node.label}`);
        const sockets = el("div", "sf-ng-sockets");
        for (const side of ["input", "output"]) {
          const column = el("div", "sf-ng-socket-column"), definitions = this.graph.registry.get(node.type)[side === "input" ? "inputs" : "outputs"];
          for (const socket of Object.keys(definitions)) {
            const button = el("button", `sf-ng-socket ${side}${this.pending?.node === node.id && this.pending?.socket === socket && side === "output" ? " pending" : ""}`, socket); button.dataset.node = node.id; button.dataset.socket = socket; button.dataset.side = side; button.title = `${node.label} · ${side} ${socket} (${definitions[socket].type})`; button.onclick = (event) => { event.stopPropagation(); this.socketClick(button); }; column.append(button);
          }
          sockets.append(column);
        }
        card.append(title, sockets); this.nodeHost.append(card);
      }
    }
    for (const card of this.nodeHost.querySelectorAll(".sf-ng-node")) {
      const node = this.graph.nodes.get(card.dataset.node);
      card.style.left = `${node.position.x}px`; card.style.top = `${node.position.y}px`;
    }
    this.renderWires(); this.renderInspector();
  }
  socketPoint(nodeId, socket, side) {
    const selector = [...this.nodeHost.querySelectorAll(".sf-ng-socket")].find((button) => button.dataset.node === nodeId && button.dataset.socket === socket && button.dataset.side === side);
    if (!selector) return null;
    const rect = selector.getBoundingClientRect(), point = this.local(side === "output" ? rect.right - 8 : rect.left + 8, rect.top + rect.height / 2); return point;
  }
  wire(from, to) { return `M${from.x},${from.y} C${from.x + 80},${from.y} ${to.x - 80},${to.y} ${to.x},${to.y}`; }
  renderWires() {
    this.wires.replaceChildren();
    for (const connection of this.graph.connections.values()) {
      const from = this.socketPoint(connection.from.node, connection.from.socket, "output"), to = this.socketPoint(connection.to.node, connection.to.socket, "input"); if (!from || !to) continue;
      const path = svg("path"); path.setAttribute("d", this.wire(from, to)); path.classList.add("sf-ng-wire"); if (this.selectedConnection === connection.id) path.classList.add("selected"); path.dataset.connection = connection.id; this.wires.append(path);
    }
    if (this.pending && this.pointer) { const from = this.socketPoint(this.pending.node, this.pending.socket, "output"); if (from) { const path = svg("path"); path.setAttribute("d", this.wire(from, this.pointer)); path.classList.add("sf-ng-wire"); path.style.strokeDasharray = "5 4"; this.wires.append(path); } }
  }
  socketClick(button) {
    if (button.dataset.side === "output") { this.pending = { node: button.dataset.node, socket: button.dataset.socket }; this.message("Choose an input socket. Escape cancels the connection."); this.render(); }
    else if (this.pending) {
      try { this.graph.connect(this.pending.node, this.pending.socket, button.dataset.node, button.dataset.socket); this.message("Connected. Use graph to preview its output."); }
      catch (error) { this.message(error.message, true); }
      this.pending = null; this.pointer = null; this.render();
    }
  }
  pointerDown(event) {
    if (event.button === 2) return;
    const socket = event.target.closest(".sf-ng-socket");
    if (socket && !event.altKey && event.button === 0) {
      if (socket.dataset.side === "output") { event.preventDefault(); this.pending = { node: socket.dataset.node, socket: socket.dataset.socket }; this.pointer = this.local(event.clientX, event.clientY); this.render(); }
      return;
    }
    event.preventDefault(); this.root.focus(); this.cancelParam();
    const title = event.target.closest("[data-node-drag]"), card = event.target.closest(".sf-ng-node"), connection = event.target.closest("[data-connection]");
    if (event.button === 1 || (event.altKey && event.button === 0)) { this.drag = { type: "pan", x: event.clientX, y: event.clientY, view: { ...this.view } }; return; }
    if (connection) { this.selectedConnection = connection.dataset.connection; this.selectedId = null; this.render(); return; }
    this.selectedConnection = null;
    if (card) this.selectedId = card.dataset.node; else this.selectedId = null;
    if (title && event.button === 0) {
      this.drag = { type: "node", id: title.dataset.nodeDrag, x: event.clientX, y: event.clientY, before: this.graph.serialize(), edit: this.store.beginEdit("nodes", { label: "Move composition node" }) };
    }
    this.render();
  }
  pointerMove(event) {
    if (this.pending) { this.pointer = this.local(event.clientX, event.clientY); this.renderWires(); }
    const drag = this.drag; if (!drag) return;
    event.preventDefault();
    if (drag.type === "pan") { this.view.x = drag.view.x + event.clientX - drag.x; this.view.y = drag.view.y + event.clientY - drag.y; this.updateView(); return; }
    if (!drag.edit.active) return;
    const serialized = cloneValue(drag.before), node = serialized.nodes.find((item) => item.id === drag.id); node.position.x += (event.clientX - drag.x) / this.view.zoom; node.position.y += (event.clientY - drag.y) / this.view.zoom; drag.edit.preview(serialized);
  }
  pointerUp(event) {
    if (this.pending) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".sf-ng-socket.input"); if (target && this.root.contains(target)) this.socketClick(target);
    }
    this.finishDrag(true);
  }
  finishDrag(commit) {
    const drag = this.drag; if (!drag) return; this.drag = null;
    if (drag.edit) { if (commit) drag.edit.commit(); else drag.edit.cancel(); }
    this.render();
  }
  renderInspector() {
    const node = this.graph.nodes.get(this.selectedId), signature = JSON.stringify([node?.id, node?.type]);
    if (signature !== this.inspectorSignature) {
      this.cancelParam(); this.inspectorSignature = signature; this.inspector.replaceChildren();
      if (!node) { this.inspector.append(el("strong", "", "Composition"), el("p", "", "Select a node to edit its implemented preview parameters. Direct / Graph chooses the base; animation wins on keyed properties.")); return; }
      this.inspector.append(el("strong", "", node.label));
      for (const [key, [min, max, step]] of Object.entries(PARAMS[node.type] || {})) {
        const label = el("label", "", key), input = el("input"); input.type = "number"; input.min = String(min); input.max = String(max); input.step = String(step); input.dataset.param = key; input.setAttribute("aria-label", `${node.type} ${key}`);
        input.onfocus = () => { this.paramEdit = { id: node.id, key, before: this.graph.serialize(), edit: this.store.beginEdit("nodes", { label: `Edit ${node.type} ${key}` }) }; };
        input.oninput = () => {
          if (!this.paramEdit?.edit.active || input.value === "" || !Number.isFinite(Number(input.value))) return;
          const serialized = cloneValue(this.paramEdit.before), target = serialized.nodes.find((item) => item.id === node.id); target.params[key] = Math.max(min, Math.min(max, Number(input.value))); this.paramEdit.edit.preview(serialized);
        };
        input.onblur = () => { if (this.paramEdit?.id === node.id && this.paramEdit?.key === key) { const edit = this.paramEdit.edit; this.paramEdit = null; edit.commit(); } };
        label.append(input); this.inspector.append(label);
      }
      if (!Object.keys(PARAMS[node.type] || {}).length) this.inspector.append(el("p", "", node.type === "SkyScene" ? "Combines the Sun, Atmosphere and Clouds inputs." : "Passes its connected scene to the preview composition."));
      const connections = el("div", "sf-ng-input-connections"); this.inspector.append(connections);
    }
    if (!node) return;
    for (const input of this.inspector.querySelectorAll("input[data-param]")) if (document.activeElement !== input) input.value = String(node.params[input.dataset.param] ?? 0);
    const connections = this.inspector.querySelector(".sf-ng-input-connections"); connections?.replaceChildren();
    for (const connection of this.graph.connections.values()) if (connection.to.node === node.id) this.button(connections, `Disconnect ${connection.to.socket}`, () => this.graph.disconnect(connection.id));
  }
  cancelParam() { const edit = this.paramEdit; this.paramEdit = null; edit?.edit.cancel(); }
  deleteSelection() { this.finishDrag(false); this.cancelParam(); if (this.selectedConnection) { this.graph.disconnect(this.selectedConnection); this.selectedConnection = null; } else if (this.selectedId) { this.graph.removeNode(this.selectedId); this.selectedId = null; } this.render(); }
  frameGraph() {
    const nodes = [...this.graph.nodes.values()]; if (!nodes.length) return;
    const minX = Math.min(...nodes.map((node) => node.position.x)), minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + 180)), maxY = Math.max(...nodes.map((node) => node.position.y + 160)), rect = this.viewEl.getBoundingClientRect();
    this.view.zoom = Math.max(0.25, Math.min(1.5, Math.min((rect.width - 30) / Math.max(1, maxX - minX), (rect.height - 30) / Math.max(1, maxY - minY))));
    this.view.x = (rect.width - (maxX - minX) * this.view.zoom) / 2 - minX * this.view.zoom; this.view.y = (rect.height - (maxY - minY) * this.view.zoom) / 2 - minY * this.view.zoom; this.updateView();
  }
  dispose() {
    this.finishDrag(false); this.cancelParam(); this.unsubscribe?.(); this.unsubscribeComposition?.();
    globalThis.removeEventListener("pointermove", this.onMove); globalThis.removeEventListener("pointerup", this.onUp); globalThis.removeEventListener("pointercancel", this.onCancel); globalThis.removeEventListener("blur", this.onCancel);
    this.root?.remove();
  }
}
