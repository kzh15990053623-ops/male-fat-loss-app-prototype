import { nativeRuntime, nativeCloudEnabled } from "../native-runtime.js";
import { escapeHtml } from "../app-utils.js";

export function renderNativeCloudPanel() {
  const cloud = nativeRuntime()?.cloud;
  if (!cloud) return "";
  const config = cloud.config;
  return `<section class="section-block data-tools-card native-cloud-panel content-section section-form" aria-label="云账号与同步">
    <div class="section-title"><h2>AI 与云同步</h2><span>${nativeCloudEnabled() ? "同步已开启" : "可选开启"}</span></div>
    <p class="tool-note">${config.email ? escapeHtml(config.email) : "登录云账号后可使用 AI 识别与跨设备同步。断网时仍可记录。"}</p>
    ${cloud.message ? `<p role="status">${escapeHtml(cloud.message)}</p>` : ""}
    ${cloud.aiMessage ? `<p class="tool-note">${escapeHtml(cloud.aiMessage)}</p>` : ""}
    <div class="data-tool-grid">
      <button type="button" class="outline-button" data-cloud-open ${cloud.busy ? "disabled" : ""}>${cloud.open ? "收起登录" : cloud.authenticated ? "账号与服务" : "登录 / 注册"}</button>
      ${nativeCloudEnabled() ? `<button type="button" class="outline-button" data-cloud-disconnect ${cloud.busy ? "disabled" : ""}>暂停云同步</button>` : ""}
      <button type="button" class="outline-button" data-cloud-recovery>导出首次同步前副本</button>
    </div>
    ${
      cloud.open
        ? `<form data-cloud-form class="setup-group">
      <label class="field-label"><span>邮箱</span><input name="cloudEmail" type="email" autocomplete="username" required value="${escapeHtml(config.email || "")}" /></label>
      <label class="field-label"><span>密码</span><input name="cloudPassword" type="password" autocomplete="current-password" minlength="6" required /></label>
      <label class="field-label"><span>账号操作</span><select name="cloudMode"><option value="login">登录已有账号</option><option value="signup">注册新账号</option></select></label>
      ${!config.ownerId ? `<label class="field-label"><span>两端都有档案时，首次同步保留</span><select name="cloudInitialData"><option value="review">先检查，暂不覆盖</option><option value="phone">手机档案（覆盖云端）</option><option value="cloud">云端档案（覆盖手机）</option></select></label>` : ""}
      <details><summary>高级：云服务地址</summary><label class="field-label"><span>云服务地址（HTTPS）</span><input name="cloudOrigin" type="url" autocomplete="url" required value="${escapeHtml(config.origin)}" ${config.ownerId ? "readonly" : ""} /></label></details>
      <p class="tool-note">连接后会同步健康记录；点击 AI 识别时会把食物文字或照片发送给服务端的模型提供商。照片不写入健康档案。</p>
      <button type="submit" class="complete-button" ${cloud.busy ? "disabled" : ""}>${cloud.busy ? "连接中…" : "连接并开启同步"}</button>
    </form>`
        : ""
    }
  </section>`;
}
