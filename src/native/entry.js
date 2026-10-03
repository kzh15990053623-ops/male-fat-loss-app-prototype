import { Capacitor, CapacitorHttp, CapacitorCookies } from "@capacitor/core";

if (Capacitor.isNativePlatform()) {
  const store = await import("./device-store.js");
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const { Camera } = await import("@capacitor/camera");
  const { LocalNotifications } = await import("@capacitor/local-notifications");
  const { App } = await import("@capacitor/app");
  globalThis.__WENJIAN_NATIVE__ = {
    store,
    Filesystem,
    Directory,
    Encoding,
    Share,
    Camera,
    LocalNotifications,
    App,
    Http: CapacitorHttp,
    Cookies: CapacitorCookies,
    apiOrigin: import.meta.env.VITE_API_ORIGIN || "https://male-fat-loss-app-prototype.onrender.com",
  };
}

await import("../app.js");

if (Capacitor.isNativePlatform()) {
  const { state } = await import("../app-state.js");
  const { activateTab, render } = await import("../actions/services.js");
  const { App } = globalThis.__WENJIAN_NATIVE__;
  await App.addListener("backButton", () => {
    if (state.clearConfirmOpen) return document.querySelector("[data-close-clear-confirm]")?.click();
    if (state.settingsOpen) return document.querySelector("[data-close-settings]")?.click();
    if (state.activeTab !== "home" && state.setupCompleted) {
      activateTab("home", { replace: true });
      render();
      return;
    }
    void App.exitApp();
  });
}
