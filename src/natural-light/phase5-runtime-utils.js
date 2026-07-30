"use strict";

const PHASE5_CLIENT_TAG = '<script src="/natural-light-phase5.js" defer></script>';

function injectPhase5Client(html) {
  const source = String(html || "");
  if (source.includes(PHASE5_CLIENT_TAG)) return source;
  if (/<\/body\s*>/i.test(source)) {
    return source.replace(/<\/body\s*>/i, `${PHASE5_CLIENT_TAG}\n</body>`);
  }
  return `${source}\n${PHASE5_CLIENT_TAG}\n`;
}

module.exports = { PHASE5_CLIENT_TAG, injectPhase5Client };
