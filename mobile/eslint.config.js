const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  { ignores: ["dist/**", ".expo/**", "babel.config.js", "eslint.config.js"] },
];
