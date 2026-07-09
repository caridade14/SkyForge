"use strict";

const solar = require("./solar-core");
const atmosphere = require("./atmosphere-core");
const inputSchema = require("./input-schema");
const lut = require("./lut-core");

module.exports = {
  ...solar,
  ...atmosphere,
  ...inputSchema,
  ...lut
};