"use strict";

const PHASE6_CLIENT_TAGS = Object.freeze([
  '<link rel="stylesheet" href="/phase6-gpu.css">',
  '<script>(function(){let retried=false;window.addEventListener("skyforge:phase6-error",function(){if(retried)return;const r=window.SkyForgePhase6Renderer;if(!r)return;retried=true;try{r.setSettings({backend:"webgl2"},{reinitialize:false});r.destroy();requestAnimationFrame(function(){r.install();});}catch(error){console.error("SkyForge Phase 6 fallback failed",error);}});})();</script>',
  '<script src="/phase6-gpu-renderer.js" defer></script>',
  '<script src="/galaxy-builder.js" defer></script>'
]);

function injectPhase6Clients(html) {
  let source = String(html || "");
  const missing = PHASE6_CLIENT_TAGS.filter((tag) => !source.includes(tag));
  if (!missing.length) return source;
  const injection = missing.join("\n");
  if (/<\/body\s*>/i.test(source)) {
    return source.replace(/<\/body\s*>/i, `${injection}\n</body>`);
  }
  return `${source}\n${injection}\n`;
}

module.exports = {
  PHASE6_CLIENT_TAGS,
  injectPhase6Clients
};
