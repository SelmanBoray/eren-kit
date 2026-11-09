const { withGradleProperties } = require("expo/config-plugins");

// prebuild --clean gradle.properties dosyasını yeniden üretir; bellek ayarı burada yazılır.
module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === "property" && item.key === "org.gradle.jvmargs"),
    );
    cfg.modResults.push({
      type: "property",
      key: "org.gradle.jvmargs",
      value: "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
    });
    return cfg;
  });
};
