"use strict";

const PI = Math.PI;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function saturate(value) {
  return clamp(Number(value) || 0, 0, 1);
}

function mix(a, b, factor) {
  const t = saturate(factor);
  return a * (1 - t) + b * t;
}

function normalizeVector(vector = {}) {
  const x = Number(vector.x) || 0;
  const y = Number(vector.y) || 0;
  const z = Number(vector.z) || 0;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function distributionGgx(nDotH, roughness) {
  const alpha = Math.max(0.02, roughness * roughness);
  const alpha2 = alpha * alpha;
  const denominator = nDotH * nDotH * (alpha2 - 1) + 1;
  return alpha2 / Math.max(PI * denominator * denominator, 1e-7);
}

function geometrySchlickGgx(nDotV, roughness) {
  const r = roughness + 1;
  const k = (r * r) / 8;
  return nDotV / Math.max(nDotV * (1 - k) + k, 1e-7);
}

function geometrySmith(nDotV, nDotL, roughness) {
  return geometrySchlickGgx(nDotV, roughness) * geometrySchlickGgx(nDotL, roughness);
}

function fresnelSchlick(cosTheta, f0) {
  const factor = Math.pow(1 - saturate(cosTheta), 5);
  return {
    r: f0.r + (1 - f0.r) * factor,
    g: f0.g + (1 - f0.g) * factor,
    b: f0.b + (1 - f0.b) * factor
  };
}

function normalizeMaterial(material = {}) {
  const baseColor = material.baseColor || { r: 0.8, g: 0.8, b: 0.8 };
  return {
    baseColor: {
      r: saturate(baseColor.r),
      g: saturate(baseColor.g),
      b: saturate(baseColor.b)
    },
    metallic: saturate(material.metallic),
    roughness: clamp(Number(material.roughness ?? 0.5), 0.02, 1),
    specular: clamp(Number(material.specular ?? 0.5), 0, 1)
  };
}

function evaluateDirectPbr(input = {}) {
  const material = normalizeMaterial(input.material);
  const normal = normalizeVector(input.normal || { x: 0, y: 1, z: 0 });
  const view = normalizeVector(input.view || { x: 0, y: 1, z: 0 });
  const light = normalizeVector(input.light || { x: 0, y: 1, z: 0 });
  const halfVector = normalizeVector(add(view, light));
  const radiance = input.radiance || { r: 1, g: 1, b: 1 };

  const nDotL = saturate(dot(normal, light));
  const nDotV = saturate(dot(normal, view));
  const nDotH = saturate(dot(normal, halfVector));
  const vDotH = saturate(dot(view, halfVector));

  const dielectricF0 = 0.08 * material.specular;
  const f0 = {
    r: mix(dielectricF0, material.baseColor.r, material.metallic),
    g: mix(dielectricF0, material.baseColor.g, material.metallic),
    b: mix(dielectricF0, material.baseColor.b, material.metallic)
  };
  const fresnel = fresnelSchlick(vDotH, f0);
  const distribution = distributionGgx(nDotH, material.roughness);
  const geometry = geometrySmith(nDotV, nDotL, material.roughness);
  const denominator = Math.max(4 * nDotV * nDotL, 1e-6);
  const specular = {
    r: (distribution * geometry * fresnel.r) / denominator,
    g: (distribution * geometry * fresnel.g) / denominator,
    b: (distribution * geometry * fresnel.b) / denominator
  };
  const diffuseWeight = {
    r: (1 - fresnel.r) * (1 - material.metallic),
    g: (1 - fresnel.g) * (1 - material.metallic),
    b: (1 - fresnel.b) * (1 - material.metallic)
  };
  const diffuse = {
    r: diffuseWeight.r * material.baseColor.r / PI,
    g: diffuseWeight.g * material.baseColor.g / PI,
    b: diffuseWeight.b * material.baseColor.b / PI
  };

  return {
    r: (diffuse.r + specular.r) * (Number(radiance.r) || 0) * nDotL,
    g: (diffuse.g + specular.g) * (Number(radiance.g) || 0) * nDotL,
    b: (diffuse.b + specular.b) * (Number(radiance.b) || 0) * nDotL,
    components: { diffuse, specular, fresnel, nDotL }
  };
}

module.exports = {
  distributionGgx,
  geometrySchlickGgx,
  geometrySmith,
  fresnelSchlick,
  normalizeMaterial,
  evaluateDirectPbr
};
