import { state, runtime } from "../app-state.js";
import { APP_RELEASE } from "../release.js";
import { preserveUpgradeDraft } from "../app-storage.js";
import { flushPendingInputSave, syncStateNow, loadServerState } from "../app-sync.js";
import { loadHistoryPage } from "../history-store.js";
import { showToast, render } from "./services.js";

export function downloadDiagnostics() {
  const data = {
    version: APP_RELEASE,
    createdAt: new Date().toISOString(),
    online: navigator.onLine,
    syncStatus: state.backendStatus,
    pending: state.syncPending,
    errorKind: state.syncErrorKind,
    aiErrorCode: state.mealDraft.aiErrorCode,
    syncRequestId: runtime.syncRequestId || null,
    requestId: state.mealDraft.aiRequestId || null,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `wenjian-diagnostics-${APP_RELEASE}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function recoverCloudHistory() {
  if (!runtime.accessToken || navigator.onLine === false) return showToast("请联网并登录原账号后恢复云端记录");
  flushPendingInputSave();
  runtime.offlineSyncReadRequired = true;
  if (!(await loadServerState())) return showToast("云端读取暂未完成，本机记录保留");
  runtime.offlineSyncReadRequired = false;
  try {
    await loadHistoryPage();
    render();
    showToast("已读取云端档案及历史，本机待同步修改保留");
  } catch (error) {
    showToast(error.message);
  }
}
export async function updatePwa() {
  if (runtime.mealPhoto || state.mealDraft.aiStatus === "submitting") return showToast("请先完成或取消当前照片识别，再更新应用");
  flushPendingInputSave();
  if (!(await syncStateNow({ localOnly: true, silent: true })) && state.syncErrorKind === "storage")
    return showToast("本机保存失败，暂不更新");
  const registration = await navigator.serviceWorker.getRegistration();
  registration?.waiting?.postMessage({ type: "PREPARE_UPDATE" });
}
export function observePwaUpdates(registration) {
  navigator.serviceWorker.addEventListener("message", async (event) => {
    if (event.data?.type === "PWA_UPDATE_BLOCKED") {
      runtime.pwaReloadApproved = false;
      showToast("有标签页尚未完成保存或照片识别，请处理后重试更新");
      return;
    }
    if (event.data?.type !== "PREPARE_PWA_UPDATE") return;
    flushPendingInputSave();
    const ready =
      !runtime.mealPhoto &&
      state.mealDraft.aiStatus !== "submitting" &&
      (await syncStateNow({ localOnly: true, silent: true })) &&
      preserveUpgradeDraft();
    runtime.pwaReloadApproved = Boolean(ready);
    event.source?.postMessage({ type: "PWA_UPDATE_VOTE", ready: Boolean(ready), voteId: event.data.voteId });
  });
  const offer = () => {
    if (registration.waiting) {
      runtime.pwaUpdateReady = true;
      showToast("新版本已准备好，可在“我的”中保存草稿后更新");
      render();
    }
  };
  offer();
  registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", offer));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!runtime.pwaReloadApproved) return;
    flushPendingInputSave();
    location.reload();
  });
}
