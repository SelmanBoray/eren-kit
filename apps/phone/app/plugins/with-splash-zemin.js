const { withAndroidColors, withAndroidStyles, AndroidConfig } = require("expo/config-plugins");

// expo-splash-screen pakedi projede yok; prebuild şablonu splashscreen_background'u #FFFFFF bırakır ve
// Theme.App.SplashScreen windowBackground'u splashscreen_logo PNG'sine bağlar (açılışta beyaz parlama).
// Burada renk koyu zemine çekilir, windowBackground düz renge yönlendirilir (PNG zemin olmaktan çıkar).
const ZEMIN = "#101A1E";

function withSplashRenk(config) {
  return withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.setColorItem(
      AndroidConfig.Resources.buildResourceItem({ name: "splashscreen_background", value: ZEMIN }),
      cfg.modResults,
    );
    return cfg;
  });
}

function withSplashTema(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults.resources.style ?? [];
    const tema = styles.find((s) => s.$.name === "Theme.App.SplashScreen");
    if (tema) {
      const items = (tema.item ?? []).filter((i) => i.$.name !== "android:windowBackground");
      items.push({ $: { name: "android:windowBackground" }, _: "@color/splashscreen_background" });
      tema.item = items;
    }
    return cfg;
  });
}

module.exports = function withSplashZemin(config) {
  return withSplashTema(withSplashRenk(config));
};
