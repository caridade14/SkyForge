"use strict";

const solar = require("./solar-core");
const atmosphereBase = require("./atmosphere-core");
const gasAbsorption = require("./gas-absorption-core");
const atmosphereAdvanced = require("./atmosphere-advanced");
const multipleScattering = require("./multiple-scattering-core");
const atmosphereMultiple = require("./atmosphere-multiple");
const inputSchema = require("./input-schema");
const lut = require("./lut-phase4");
const physicalCamera = require("./physical-camera");
const colorPipeline = require("./color-pipeline");
const cloudCore = require("./cloud-core");
const pbrCore = require("./pbr-core");
const renderPipeline = require("./render-pipeline");
const phase5RuntimeUtils = require("./phase5-runtime-utils");

module.exports = {
  ...solar,
  ...atmosphereBase,
  ...gasAbsorption,
  ...atmosphereAdvanced,
  ...multipleScattering,
  ...atmosphereMultiple,
  ...inputSchema,
  ...lut,
  ...physicalCamera,
  ...colorPipeline,
  ...cloudCore,
  ...pbrCore,
  ...renderPipeline,
  ...phase5RuntimeUtils
};
