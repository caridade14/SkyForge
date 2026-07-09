"use strict";

const solar = require("./solar-core");
const atmosphereBase = require("./atmosphere-core");
const gasAbsorption = require("./gas-absorption-core");
const atmosphereAdvanced = require("./atmosphere-advanced");
const inputSchema = require("./input-schema");
const lut = require("./lut-core");

module.exports = {
  ...solar,
  ...atmosphereBase,
  ...gasAbsorption,
  ...atmosphereAdvanced,
  ...inputSchema,
  ...lut
};