"use strict";

const solar = require("./solar-core");
const atmosphereBase = require("./atmosphere-core");
const gasAbsorption = require("./gas-absorption-core");
const atmosphereAdvanced = require("./atmosphere-advanced");
const multipleScattering = require("./multiple-scattering-core");
const atmosphereMultiple = require("./atmosphere-multiple");
const inputSchema = require("./input-schema");
const lut = require("./lut-phase4");

module.exports = {
  ...solar,
  ...atmosphereBase,
  ...gasAbsorption,
  ...atmosphereAdvanced,
  ...multipleScattering,
  ...atmosphereMultiple,
  ...inputSchema,
  ...lut
};