import { registerServiceWorker, bindConnectivityRetry, initApp } from "./app-actions.js";

registerServiceWorker();
bindConnectivityRetry();
initApp();
