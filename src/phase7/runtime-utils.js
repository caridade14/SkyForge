"use strict";

const PHASE7_CLIENT_TAGS = Object.freeze([
  '<link rel="stylesheet" href="/phase7-functional.css">',
  '<script src="/phase7-gpu-renderer.js" defer></script>',
  '<script src="/phase7-functional-controller.js" defer></script>'
]);

function injectPhase7Clients(html) {
  let source = String(html || "");
  const missing = PHASE7_CLIENT_TAGS.filter((tag) => !source.includes(tag));
  if (!missing.length) return source;
  const injection = missing.join("\n");
  if (/<\/body\s*>/i.test(source)) return source.replace(/<\/body\s*>/i, `${injection}\n</body>`);
  return `${source}\n${injection}\n`;
}

module.exports = { PHASE7_CLIENT_TAGS, injectPhase7Clients };
