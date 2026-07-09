"use strict";

const solar = require("./solar-core");
const atmosphere = require("./atmosphere-core");

module.exports = {
  ...solar,
  ...atmosphere
};
