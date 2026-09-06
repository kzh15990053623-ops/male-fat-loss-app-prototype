import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialStateSnapshot, runtime, state } from "../../src/app-state.js";
import { createSettingsDraft, handleSettingControlInput, validateCoreSettings } from "../../src/actions/settings.js";
import { ensureReminderPermission, scheduleLocalReminder, showSystemReminder } from "../../src/actions/services.js";
import { barCard, chartDataDetails } from "../../src/render/shared.js";

const validSettings = {
  height: 178,
  age: 34,
  weight: 86.2,
  waist: 95.4,
  targetWeight: 78,
  targetWaist: 86,
  calories: 1900,
  weeklyLoss: 0.5,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 6, 21, 29, 0));
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, structuredClone(initialStateSnapshot));
  runtime.authUserId = "";
  runtime.reminderTimer = undefined;
  runtime.toastTimer = undefined;
  vi.stubGlobal("document", { querySelector: () => null });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function installNotifications(permission, registration = null) {
  const notificationApi = { permission, requestPermission: vi.fn().mockResolvedValue(permission) };
  vi.stubGlobal("Notification", notificationApi);
  vi.stubGlobal("window", { Notification: notificationApi });
  const getRegistration = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
  return { notificationApi, getRegistration };
}

describe("设置范围与草稿", () => {
  it("接受合法输入，并检查当前体重的上下边界", () => {
    expect(validateCoreSettings(validSettings)).toEqual({});
    expect(validateCoreSettings({ ...validSettings, weight: 40 })).not.toHaveProperty("weight");
    expect(validateCoreSettings({ ...validSettings, weight: 200 })).not.toHaveProperty("weight");
    for (const weight of [0, 39.9, 200.1, 250, 999, NaN, Infinity, -Infinity]) {
      expect(validateCoreSettings({ ...validSettings, weight }), `weight=${weight}`).toHaveProperty("weight", "请输入 40–200kg");
    }
  });

  it.each(Object.keys(validSettings))("%s 不接受非有限数值或未填写", (field) => {
    for (const value of [NaN, Infinity, -Infinity, undefined, ""]) {
      expect(validateCoreSettings({ ...validSettings, [field]: value })).toHaveProperty(field);
    }
  });

  it("目标关系检查不会覆盖更准确的范围错误", () => {
    expect(validateCoreSettings({ ...validSettings, targetWeight: 90 })).toHaveProperty("targetWeight", "减脂目标必须低于当前体重");
    expect(validateCoreSettings({ ...validSettings, targetWaist: 100 })).toHaveProperty("targetWaist", "目标腰围必须低于当前腰围");
    expect(validateCoreSettings({ ...validSettings, weight: NaN })).not.toHaveProperty("targetWeight");
  });

  it("各类控件更新同一份草稿，不提前改变已保存目标", () => {
    state.weight = 86.2;
    state.settingsDraft = createSettingsDraft();
    const input = (name, value, selector, checked = false) => ({
      name,
      value,
      checked,
      matches: (candidate) => candidate === selector,
    });
    handleSettingControlInput(input("weight", "0", "[data-setting-field]"));
    expect(state.settingsDraft.weight).toBe("0");
    expect(state.weight).toBe(86.2);
    handleSettingControlInput(input("weight", "", "[data-setting-field]"));
    handleSettingControlInput(input("aiAssist", "off", "[data-setting-ai]"));
    handleSettingControlInput(input("reminderTime", "20:15", "[data-setting-reminder]"));
    handleSettingControlInput(input("unit", "metric", "[data-setting-unit]"));
    handleSettingControlInput(input("pushEnabled", "on", '[type="checkbox"]', true));
    handleSettingControlInput(input("trustedOfflineAccess", "on", '[type="checkbox"]', true));
    expect(state.settingsDraft).toMatchObject({
      weight: "",
      aiAssist: false,
      reminderTime: "20:15",
      unit: "metric",
      pushEnabled: true,
      trustedOfflineAccess: true,
    });
    expect(state.preferences.pushEnabled).toBe(false);
  });
});

describe("应用打开时提醒", () => {
  it("系统权限被拒绝时保留应用内提醒，并继续安排下一天", async () => {
    const { notificationApi, getRegistration } = installNotifications("denied");
    state.preferences.pushEnabled = true;
    state.preferences.reminderTime = "21:30";
    expect(await ensureReminderPermission()).toBe(false);
    expect(notificationApi.requestPermission).not.toHaveBeenCalled();
    expect(state.preferences.pushEnabled).toBe(true);
    expect(state.toast).toContain("应用打开时仍会提醒");
    scheduleLocalReminder();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.toast).toContain("记得补全今天");
    expect(getRegistration).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(state.toast).toContain("记得补全今天");
  });

  it("权限 API 抛错或不存在时不会关闭应用内提醒", async () => {
    state.preferences.pushEnabled = true;
    expect(await ensureReminderPermission()).toBe(false);
    expect(state.preferences.pushEnabled).toBe(true);
    const { notificationApi } = installNotifications("default");
    notificationApi.requestPermission.mockRejectedValue(new Error("gesture required"));
    expect(await ensureReminderPermission()).toBe(false);
    expect(state.preferences.pushEnabled).toBe(true);
  });

  it("通过 Service Worker 发送系统通知，失败仍保留本次及后续应用内提醒", async () => {
    const showNotification = vi.fn().mockRejectedValue(new Error("notifications unavailable"));
    installNotifications("granted", { showNotification });
    state.preferences.pushEnabled = true;
    scheduleLocalReminder();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(showNotification).toHaveBeenCalledWith("稳减记录提醒", expect.objectContaining({ body: "记得补全今天的饮食、训练和体重记录" }));
    expect(state.toast).toContain("记得补全今天");
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(state.toast).toContain("记得补全今天");
  });

  it("没有注册 Service Worker 时安全降级，有注册时返回发送结果", async () => {
    const { getRegistration } = installNotifications("granted");
    expect(await showSystemReminder("test")).toBe(false);
    getRegistration.mockRejectedValueOnce(new Error("registration unavailable"));
    expect(await showSystemReminder("test")).toBe(false);
    getRegistration.mockResolvedValue({ showNotification: vi.fn().mockResolvedValue(undefined) });
    expect(await showSystemReminder("test")).toBe(true);
  });

  it("关闭提醒会撤销旧计时，异常时间使用安全默认值", async () => {
    state.preferences.pushEnabled = true;
    state.preferences.reminderTime = "invalid";
    scheduleLocalReminder();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(state.toast).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(state.toast).toContain("记得补全今天");
    state.preferences.pushEnabled = false;
    scheduleLocalReminder();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(state.toast).toBe("");
  });
});

describe("逐日图表数据", () => {
  it("保留零和负数，忽略缺失或无效数值，转义展示文本", () => {
    const html = chartDataDetails(
      "预算差额",
      [
        { date: "2026-09-04", value: -120 },
        { date: "2026-09-05", value: 0 },
        { date: "<script>", value: 30 },
        { date: "2026-09-06", value: null },
        { date: "2026-09-07", value: NaN },
      ],
      "kcal",
    );
    expect(html).toContain("-120 kcal");
    expect(html).toContain("0 kcal");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html.match(/<dt>/g)).toHaveLength(3);
    expect(barCard("运动消耗", [{ date: "2026-09-05", value: 260 }], "kcal")).toContain("运动消耗：查看每日数据");
  });
});
