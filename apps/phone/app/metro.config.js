const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const protocolRoot = path.resolve(projectRoot, "../protocol");
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// @eren/protocol uygulamanın dışında, TS kaynağı olarak duruyor; zod gibi bağımlılıkları kök node_modules'ta.
const zodRoot = path.resolve(repoRoot, "node_modules/zod");
config.watchFolders = [protocolRoot, zodRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

config.resolver.extraNodeModules = { zod: zodRoot };

module.exports = config;



