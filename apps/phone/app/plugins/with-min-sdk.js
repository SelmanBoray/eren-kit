const { withGradleProperties } = require("expo/config-plugins");

// Yerel modül (eren-device) minSdk 30 ister. ExpoRootProject, minSdkVersion proje özelliği
// tanımlıysa varsayılanı (24) ezmez; prebuild --clean gradle.properties'i yeniden ürettiği için burada yazılır.
const MIN_SDK = "30";

module.exports = function withMinSdk(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === "property" && item.key === "minSdkVersion"),
    );
    cfg.modResults.push({ type: "property", key: "minSdkVersion", value: MIN_SDK });
    return cfg;
  });
};
