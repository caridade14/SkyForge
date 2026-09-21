import { cloneValue } from "./state-store.js";

function createId(prefix = "node") {
  const random = Math.random().toString(36).slice(2, 9);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isCompatible(outputType, inputType) {
  return inputType === "any" || outputType === "any" || outputType === inputType;
}

export class NodeGraph {
  constructor(options = {}) {
    this.registry = new Map();
    this.nodes = new Map();
    this.connections = new Map();
    this.listeners = new Set();
    this.version = Number(options.version || 1);
    registerDefaultNodeTypes(this);
    if (options.serialized) this.load(options.serialized);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const event = { type, ...detail };
    for (const listener of this.listeners) {
      try {
        listener(event, this.serialize());
      } catch (error) {
        console.error("SkyForge node graph listener failed", error);
      }
    }
  }

  registerType(type, definition) {
    if (!type || typeof definition?.evaluate !== "function") {
      throw new Error("Node type requires a name and evaluate function");
    }
    this.registry.set(type, {
      label: definition.label || type,
      category: definition.category || "Utility",
      inputs: cloneValue(definition.inputs || {}),
      outputs: cloneValue(definition.outputs || { output: { type: "any" } }),
      defaults: cloneValue(definition.defaults || {}),
      evaluate: definition.evaluate
    });
    return this;
  }

  addNode(type, options = {}) {
    const definition = this.registry.get(type);
    if (!definition) throw new Error(`Unknown node type: ${type}`);
    const id = options.id || createId(type.toLowerCase());
    if (this.nodes.has(id)) throw new Error(`Node already exists: ${id}`);
    const node = {
      id,
      type,
      label: options.label || definition.label,
      position: {
        x: Number(options.position?.x || 0),
        y: Number(options.position?.y || 0)
      },
      params: {
        ...cloneValue(definition.defaults),
        ...cloneValue(options.params || {})
      }
    };
    this.nodes.set(id, node);
    this.emit("node:add", { node: cloneValue(node) });
    return cloneValue(node);
  }

  updateNode(id, patch = {}) {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    if (patch.label !== undefined) node.label = String(patch.label);
    if (patch.position) {
      node.position.x = Number(patch.position.x ?? node.position.x);
      node.position.y = Number(patch.position.y ?? node.position.y);
    }
    if (patch.params) node.params = { ...node.params, ...cloneValue(patch.params) };
    this.emit("node:update", { node: cloneValue(node) });
    return cloneValue(node);
  }

  removeNode(id) {
    if (!this.nodes.delete(id)) return false;
    for (const [connectionId, connection] of this.connections) {
      if (connection.from.node === id || connection.to.node === id) this.connections.delete(connectionId);
    }
    this.emit("node:remove", { id });
    return true;
  }

  connect(fromNodeId, fromSocket, toNodeId, toSocket, options = {}) {
    const fromNode = this.nodes.get(fromNodeId);
    const toNode = this.nodes.get(toNodeId);
    if (!fromNode || !toNode) throw new Error("Both nodes must exist before connecting");
    const fromDefinition = this.registry.get(fromNode.type);
    const toDefinition = this.registry.get(toNode.type);
    const output = fromDefinition.outputs[fromSocket];
    const input = toDefinition.inputs[toSocket];
    if (!output) throw new Error(`Output socket not found: ${fromSocket}`);
    if (!input) throw new Error(`Input socket not found: ${toSocket}`);
    if (!isCompatible(output.type || "any", input.type || "any")) {
      throw new Error(`Socket type mismatch: ${output.type} -> ${input.type}`);
    }
    for (const [connectionId, connection] of this.connections) {
      if (connection.to.node === toNodeId && connection.to.socket === toSocket) {
        this.connections.delete(connectionId);
      }
    }
    const id = options.id || createId("connection");
    const connection = {
      id,
      from: { node: fromNodeId, socket: fromSocket },
      to: { node: toNodeId, socket: toSocket }
    };
    this.connections.set(id, connection);
    this.emit("connection:add", { connection: cloneValue(connection) });
    return cloneValue(connection);
  }

  disconnect(connectionId) {
    const removed = this.connections.delete(connectionId);
    if (removed) this.emit("connection:remove", { id: connectionId });
    return removed;
  }

  incoming(nodeId, socket) {
    return [...this.connections.values()].find(
      (connection) => connection.to.node === nodeId && connection.to.socket === socket
    );
  }

  evaluate(nodeId, context = {}) {
    const cache = new Map();
    const visiting = new Set();

    const evaluateNode = (id) => {
      if (cache.has(id)) return cache.get(id);
      if (visiting.has(id)) throw new Error(`Node graph cycle detected at ${id}`);
      const node = this.nodes.get(id);
      if (!node) throw new Error(`Node not found: ${id}`);
      const definition = this.registry.get(node.type);
      visiting.add(id);
      const inputs = {};
      for (const [socket, inputDefinition] of Object.entries(definition.inputs || {})) {
        const connection = this.incoming(id, socket);
        if (connection) {
          const upstream = evaluateNode(connection.from.node);
          inputs[socket] = cloneValue(upstream[connection.from.socket]);
        } else if (Object.prototype.hasOwnProperty.call(inputDefinition, "default")) {
          inputs[socket] = cloneValue(inputDefinition.default);
        }
      }
      const result = definition.evaluate({
        node: cloneValue(node),
        inputs,
        params: cloneValue(node.params),
        context
      });
      const normalized = result && typeof result === "object" ? result : { output: result };
      visiting.delete(id);
      cache.set(id, normalized);
      return normalized;
    };

    return cloneValue(evaluateNode(nodeId));
  }

  evaluateOutput(context = {}) {
    const outputNode = [...this.nodes.values()].find((node) => node.type === "Output");
    if (!outputNode) throw new Error("Node graph has no Output node");
    return this.evaluate(outputNode.id, context).output;
  }

  serialize() {
    return {
      version: this.version,
      nodes: [...this.nodes.values()].map(cloneValue),
      connections: [...this.connections.values()].map(cloneValue)
    };
  }

  load(serialized = {}) {
    this.nodes.clear();
    this.connections.clear();
    this.version = Number(serialized.version || 1);
    for (const node of serialized.nodes || []) {
      if (!this.registry.has(node.type)) continue;
      this.addNode(node.type, node);
    }
    for (const connection of serialized.connections || []) {
      try {
        this.connect(
          connection.from.node,
          connection.from.socket,
          connection.to.node,
          connection.to.socket,
          { id: connection.id }
        );
      } catch (error) {
        console.warn("Skipped invalid SkyForge node connection", error);
      }
    }
    this.emit("graph:load");
  }

  createDefaultGraph() {
    this.nodes.clear();
    this.connections.clear();
    const sun = this.addNode("Sun", { id: "sun", position: { x: 40, y: 80 } });
    const atmosphere = this.addNode("Atmosphere", { id: "atmosphere", position: { x: 40, y: 260 } });
    const clouds = this.addNode("Clouds", { id: "clouds", position: { x: 40, y: 440 } });
    const scene = this.addNode("SkyScene", { id: "sky-scene", position: { x: 340, y: 240 } });
    const color = this.addNode("ColorGrade", { id: "color-grade", position: { x: 620, y: 240 } });
    const output = this.addNode("Output", { id: "output", position: { x: 900, y: 240 } });
    this.connect(sun.id, "sun", scene.id, "sun");
    this.connect(atmosphere.id, "atmosphere", scene.id, "atmosphere");
    this.connect(clouds.id, "clouds", scene.id, "clouds");
    this.connect(scene.id, "scene", color.id, "input");
    this.connect(color.id, "output", output.id, "input");
    this.emit("graph:default");
    return this.serialize();
  }
}

export function registerDefaultNodeTypes(graph) {
  graph
    .registerType("Sun", {
      category: "Lighting",
      outputs: { sun: { type: "sun" } },
      defaults: { elevation: 7, azimuth: 215, intensity: 1.8, temperature: 5200 },
      evaluate: ({ params, context }) => ({ sun: { ...params, ...(context.state?.sun || {}) } })
    })
    .registerType("Atmosphere", {
      category: "Atmosphere",
      outputs: { atmosphere: { type: "atmosphere" } },
      defaults: { turbidity: 2.4, rayleigh: 2.8, haze: 0.3, ozone: 0.6 },
      evaluate: ({ params, context }) => ({
        atmosphere: { ...params, ...(context.state?.atmosphere || {}) }
      })
    })
    .registerType("Clouds", {
      category: "Atmosphere",
      outputs: { clouds: { type: "clouds" } },
      defaults: { type: "Cumulus", coverage: 0.62, density: 0.7, altitude: 2400 },
      evaluate: ({ params, context }) => ({ clouds: { ...params, ...(context.state?.clouds || {}) } })
    })
    .registerType("SkyScene", {
      category: "Compose",
      inputs: {
        sun: { type: "sun", default: null },
        atmosphere: { type: "atmosphere", default: null },
        clouds: { type: "clouds", default: null }
      },
      outputs: { scene: { type: "scene" } },
      evaluate: ({ inputs }) => ({ scene: { ...inputs } })
    })
    .registerType("ColorGrade", {
      category: "Color",
      inputs: { input: { type: "scene", default: {} } },
      outputs: { output: { type: "scene" } },
      defaults: { exposure: 0, contrast: 1, saturation: 1, workingSpace: "ACEScg" },
      evaluate: ({ inputs, params, context }) => ({
        output: {
          ...inputs.input,
          color: { ...params, ...(context.state?.color || {}) }
        }
      })
    })
    .registerType("Output", {
      category: "Output",
      inputs: { input: { type: "scene", default: {} } },
      outputs: { output: { type: "scene" } },
      evaluate: ({ inputs }) => ({ output: inputs.input })
    });
}
