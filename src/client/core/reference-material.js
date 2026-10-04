// Linear-sRGB material values. The color picker alone uses display sRGB.
const bound = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.min(high, Math.max(low, Number(value))) : fallback;
export const MATERIAL_PRESETS = Object.freeze({
  'Neutral': { baseColor: [.4, .4, .4], roughness: .65, metalness: 0 },
  'Gray 18%': { baseColor: [.18, .18, .18], roughness: .8, metalness: 0 },
  'White': { baseColor: [.8, .8, .8], roughness: .65, metalness: 0 },
  'Chrome': { baseColor: [.92, .92, .92], roughness: .1, metalness: 1 },
  'Gold': { baseColor: [1, .71, .29], roughness: .25, metalness: 1 },
  'Red matte': { baseColor: [.55, .025, .015], roughness: .9, metalness: 0 }
});
export function normalizeReferenceMaterial(value = {}) {
  return { baseColor: [0, 1, 2].map(i => bound(value?.baseColor?.[i], 0, 1, .4)),
    roughness: bound(value?.roughness, .04, 1, .65), metalness: bound(value?.metalness, 0, 1, 0),
    castShadow: value?.castShadow !== false, receiveShadow: value?.receiveShadow !== false };
}
export function colorFromHex(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex || '')) return null;
  return [1, 3, 5].map(i => { const x = parseInt(hex.slice(i, i + 2), 16) / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; });
}
export function colorToHex(color) {
  return '#' + normalizeReferenceMaterial({ baseColor: color }).baseColor.map(x => Math.round((x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055) * 255).toString(16).padStart(2, '0')).join('');
}
