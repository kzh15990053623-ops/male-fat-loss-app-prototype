import { state, runtime } from "../app-state.js";
import { storeSession } from "../app-storage.js";
import { authHeaders } from "../app-sync.js";
import { render, showToast } from "./services.js";

export async function requestAccountMail(control) {
  if (state.authLoading) return;
  const email = document.querySelector("[data-auth-email]")?.value?.trim();
  if (!email) return showToast("请先填写注册邮箱");
  state.authEmail = email;
  state.authLoading = true;
  render();
  try {
    const response = await fetch(`/api/auth/${control.dataset.accountMail}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "邮件请求失败");
    state.authError = data.message;
  } catch (error) {
    state.authError = error.message;
  } finally {
    state.authLoading = false;
    render();
  }
}

export async function completeAccountCallback() {
  const query = new URLSearchParams(location.search);
  const fragment = new URLSearchParams(location.hash.slice(1));
  const tokenHash = query.get("token_hash");
  const type = query.get("type") || fragment.get("type");
  const refreshToken = fragment.get("refresh_token");
  if (!tokenHash && !refreshToken && !fragment.get("error")) return false;
  // Remove the one-time credential before network requests or rendering.
  history.replaceState(null, "", location.pathname);
  try {
    if (fragment.get("error")) throw new Error("链接已过期或不可用，请重新发送邮件");
    const response = await fetch(tokenHash ? "/api/auth/verify" : "/api/auth/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokenHash ? { tokenHash, type } : { refreshToken }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.accessToken) throw new Error("链接无效、已使用或过期，请重新发送邮件");
    storeSession(payload);
    runtime.recoveryVerified = type === "recovery";
    return true;
  } catch (error) {
    state.authError = error.message;
    return false;
  }
}

export async function updatePassword(form) {
  const password = form.querySelector('[name="new-password"]').value;
  const confirmation = form.querySelector('[name="confirm-password"]').value;
  if (password !== confirmation) return showToast("两次密码不一致");
  if (runtime.passwordUpdating) return;
  runtime.passwordUpdating = true;
  try {
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ password }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "密码修改失败");
    runtime.recoveryVerified = false;
    render();
    showToast("密码已更新，原有健康记录保留");
  } catch (error) {
    showToast(error.message);
  } finally {
    runtime.passwordUpdating = false;
  }
}

export function renderPasswordRecovery() {
  return `<section class="lock-screen"><form class="lock-card" data-password-recovery><h1>设置新密码</h1><p>邮箱身份已确认。修改密码会保留原有健康记录。</p><label class="field-label"><span>新密码</span><input type="password" name="new-password" minlength="8" maxlength="128" autocomplete="new-password" required /></label><label class="field-label"><span>再次输入新密码</span><input type="password" name="confirm-password" minlength="8" maxlength="128" autocomplete="new-password" required /></label><button type="submit" class="complete-button">保存新密码</button></form></section>`;
}
