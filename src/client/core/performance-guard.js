const PREVIEW_ENDPOINT = "/api/lighting/preview";
const DEFAULT_DRAW_FPS = 18;

function previewRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input && typeof input.url === "string") return input.url;
  return "";
}

function isPreviewRequest(input) {
  const url = previewRequestUrl(input);
  try {
    return new URL(url, globalThis.location?.href || "http://localhost").pathname === PREVIEW_ENDPOINT;
  } catch {
    return url.includes(PREVIEW_ENDPOINT);
  }
}

function previewRequestKey(input, init = {}) {
  const method = String(init.method || input?.method || "GET").toUpperCase();
  const body = typeof init.body === "string" ? init.body : "";
  return `${method}:${previewRequestUrl(input)}:${body}`;
}

export function installPreviewFetchScheduler(root = globalThis) {
  if (!root?.fetch || root.__skyforgePreviewFetchScheduler) {
    return root?.__skyforgePreviewFetchScheduler || null;
  }

  const originalFetch = root.fetch.bind(root);
  const inFlight = new Map();
  let queue = Promise.resolve();

  function scheduledFetch(input, init = {}) {
    if (!isPreviewRequest(input)) return originalFetch(input, init);

    const key = previewRequestKey(input, init);
    const existing = inFlight.get(key);
    if (existing) return existing.then((response) => response.clone());

    const task = queue
      .catch(() => undefined)
      .then(() => originalFetch(input, init));

    queue = task.then(() => undefined, () => undefined);
    inFlight.set(key, task);
    task.finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    });

    return task.then((response) => response.clone());
  }

  root.fetch = scheduledFetch;
  const api = {
    version: "1.0.0",
    originalFetch,
    inFlightCount: () => inFlight.size,
    restore() {
      if (root.fetch === scheduledFetch) root.fetch = originalFetch;
      inFlight.clear();
      delete root.__skyforgePreviewFetchScheduler;
    }
  };
  root.__skyforgePreviewFetchScheduler = api;
  return api;
}

export function throttleGlobalFunction(name, fps = DEFAULT_DRAW_FPS, root = globalThis) {
  const current = root?.[name];
  if (typeof current !== "function" || current.__sfPerformanceThrottle) return false;

  const minimumInterval = 1000 / Math.max(1, Number(fps) || DEFAULT_DRAW_FPS);
  let lastRun = -Infinity;
  let lastResult;

  function throttledFunction(...args) {
    const now = root.performance?.now?.() ?? Date.now();
    if (now - lastRun < minimumInterval) return lastResult;
    lastRun = now;
    lastResult = current.apply(this, args);
    return lastResult;
  }

  throttledFunction.__sfPerformanceThrottle = true;
  throttledFunction.__sfPerformanceOriginal = current;
  throttledFunction.__sfPhysicalWrapped = Boolean(current.__sfPhysicalWrapped);
  throttledFunction.__sfPhysicalOriginal = current.__sfPhysicalOriginal;
  root[name] = throttledFunction;
  return true;
}

export function installPerformanceGuard(root = globalThis, options = {}) {
  if (!root || root.__skyforgePerformanceGuard) return root?.__skyforgePerformanceGuard || null;

  const fps = Math.max(8, Math.min(30, Number(options.drawFps || DEFAULT_DRAW_FPS)));
  const fetchScheduler = installPreviewFetchScheduler(root);
  let attempts = 0;
  let timer = null;

  const applyThrottles = () => {
    throttleGlobalFunction("drawSky", fps, root);
    attempts += 1;
    if (attempts < 12) timer = root.setTimeout?.(applyThrottles, 1500);
  };
  applyThrottles();

  const visibilityHandler = () => {
    if (!root.document?.hidden) throttleGlobalFunction("drawSky", fps, root);
  };
  root.document?.addEventListener?.("visibilitychange", visibilityHandler);

  const api = {
    version: "1.0.0",
    drawFps: fps,
    fetchScheduler,
    dispose() {
      root.clearTimeout?.(timer);
      root.document?.removeEventListener?.("visibilitychange", visibilityHandler);
      fetchScheduler?.restore?.();
      delete root.__skyforgePerformanceGuard;
    }
  };
  root.__skyforgePerformanceGuard = api;
  return api;
}

if (typeof window !== "undefined") installPerformanceGuard(window);
