import { state, runtime } from "../app-state.js";
import { escapeHtml } from "../app-utils.js";
import { APP_RELEASE } from "../release.js";

export function renderPrivacyInfo() {
  return `<details class="privacy-info"><summary>数据与隐私说明</summary><p>稳减用于成年人减脂记录和习惯管理。身体信息用于你选择的预算估算；建议是估算，请结合自身情况使用。</p><p>云账号的饮食、运动和身体记录保存于 Supabase，按账号隔离；离线缓存保存在当前浏览器。共用设备请勿开启离线信任，退出登录会撤销信任。</p><p>只有点击 AI 识别才会发送食物文字及所选照片到模型服务。照片会去除原始元数据，本应用不保存照片；服务商的保留规则适用。关闭 AI 后仍可手动记录。</p><p>你可以导出、恢复记录，清空档案或注销云账号。清理浏览器或卸载前请确认云同步和备份已完成。诊断导出只包含版本、同步状态和错误编号，不包含照片、饮食、体重、邮箱或登录凭证。</p></details>`;
}
export function renderProductInfo() {
  return `<section class="content-section section-list product-info"><div class="section-title"><h2>帮助与反馈</h2><span>${escapeHtml(APP_RELEASE)}</span></div><p>饮食可先记食物，再补营养。当天记录完整后主动确认，复盘才会使用该日摄入；补录时请选择实际日期。</p><p>PWA 添加桌面：浏览器菜单 → 添加到主屏幕。网页提醒目前仅在应用打开时有效。</p>${renderPrivacyInfo()}<p>遇到问题：导出下面的诊断摘要，与操作步骤一起交给邀请你参与内测的人。发送内容前可以先查看文件。</p><button type="button" class="outline-button" data-export-diagnostics>导出反馈诊断</button><button type="button" class="outline-button" data-recover-cloud>读取云端档案与历史</button>${runtime.pwaUpdateReady ? `<button type="button" class="outline-button" data-update-pwa>保存草稿并更新应用</button>` : ""}${state.syncError ? `<p role="status">当前错误：${escapeHtml(state.syncError)}</p>` : ""}</section>`;
}
