import { icon } from "./app-utils.js";

const initialState = {
  appLoading: true,
  activeTab: "home",
  weight: 0,
  weightDraft: "",
  waist: 0,
  waistDraft: "",
  targetWeight: 0,
  targetWaist: 0,
  weeklyLossTarget: 0.5,
  startWeight: 0,
  startWaist: 0,
  calorieBudget: 0,
  waterMl: 0,
  waterTarget: 2400,
  steps: 0,
  stepsTarget: 9000,
  sleep: 0,
  proteinTarget: 150,
  workoutDone: false,
  backendStatus: "idle",
  authRequired: true,
  authError: "",
  authFieldErrors: {},
  authMode: "login",
  authLoading: false,
  authEmail: "",
  authPasswordVisible: false,
  authProvider: "supabase",
  localAuthAvailable: false,
  authServiceStatus: "checking",
  authServiceMessage: "正在检查认证服务…",
  authServiceCode: "",
  authSignupAllowed: true,
  authReadinessCheckedAt: "",
  setupCompleted: false,
  setupFieldErrors: {},
  settingsDraft: null,
  schemaVersion: 3,
  currentDate: "",
  dailyRecords: {},
  lastSyncedAt: "",
  syncError: "",
  syncErrorKind: "none",
  syncPending: false,
  clearConfirmOpen: false,
  deleteAccountOpen: false,
  taskOverrides: {},
  settingsOpen: false,
  dietScenario: "takeout",
  toast: "",
  undoActivity: null,
  preferences: {
    unit: "metric",
    reminderTime: "21:30",
    pushEnabled: false,
    aiAssist: true,
  },
  mealTemplates: [],
  weightLogs: [],
  waistLogs: [],
  activityDraft: {
    name: "",
    type: "燃脂快练",
    minutes: 30,
  },
  mealDraft: {
    slot: "dinner",
    food: "",
    amount: 0,
    unit: "g",
    cooking: "清淡",
    oilGrams: 0,
    sauce: "少",
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    aiResult: null,
    aiStatus: "idle",
    aiError: "",
    aiErrorCode: "",
    aiRequestId: "",
    aiRetryable: false,
    advancedOpen: false,
  },
  customActivities: [],
  user: {
    height: 0,
    age: 0,
    bmr: 0,
    dailyCalories: 0,
  },
};

const sessionStateKeys = new Set([
  "backendStatus",
  "authRequired",
  "authError",
  "authFieldErrors",
  "authMode",
  "authLoading",
  "authEmail",
  "authPasswordVisible",
  "authProvider",
  "localAuthAvailable",
  "authServiceStatus",
  "authServiceMessage",
  "authServiceCode",
  "authSignupAllowed",
  "authReadinessCheckedAt",
  "lastSyncedAt",
  "syncError",
  "syncErrorKind",
  "syncPending",
]);

const uiStateKeys = new Set([
  "appLoading",
  "activeTab",
  "weightDraft",
  "waistDraft",
  "setupFieldErrors",
  "settingsDraft",
  "clearConfirmOpen",
  "deleteAccountOpen",
  "settingsOpen",
  "toast",
  "undoActivity",
  "activityDraft",
  "mealDraft",
]);

const domainState = {};
const sessionState = {};
const uiState = {};
const stateOwners = new Map();

Object.entries(initialState).forEach(([key, value]) => {
  const owner = sessionStateKeys.has(key) ? sessionState : uiStateKeys.has(key) ? uiState : domainState;
  owner[key] = value;
  stateOwners.set(key, owner);
});

function stateOwner(key) {
  if (typeof key !== "string") return null;
  if (!stateOwners.has(key)) stateOwners.set(key, domainState);
  return stateOwners.get(key);
}

// Compatibility facade while page modules migrate to the explicit state slices.
const state = new Proxy(
  {},
  {
    get(_target, key) {
      const owner = stateOwner(key);
      return owner ? owner[key] : undefined;
    },
    set(_target, key, value) {
      const owner = stateOwner(key);
      if (owner) owner[key] = value;
      return true;
    },
    deleteProperty(_target, key) {
      const owner = stateOwner(key);
      if (owner) delete owner[key];
      return true;
    },
    has(_target, key) {
      const owner = stateOwner(key);
      return Boolean(owner) && Object.prototype.hasOwnProperty.call(owner, key);
    },
    ownKeys() {
      return [...Reflect.ownKeys(domainState), ...Reflect.ownKeys(sessionState), ...Reflect.ownKeys(uiState)];
    },
    getOwnPropertyDescriptor(_target, key) {
      const owner = stateOwner(key);
      if (!owner || !Object.prototype.hasOwnProperty.call(owner, key)) return undefined;
      return { configurable: true, enumerable: true, writable: true, value: owner[key] };
    },
  },
);

const meals = [
  {
    id: "breakfast",
    name: "早餐",
    calories: 0,
    status: "待记录",
    foods: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
    nutritionSource: "manual",
    aiMeta: null,
  },
  {
    id: "lunch",
    name: "午餐",
    calories: 0,
    status: "待记录",
    foods: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
    nutritionSource: "manual",
    aiMeta: null,
  },
  {
    id: "dinner",
    name: "晚餐",
    calories: 0,
    status: "待记录",
    foods: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
    nutritionSource: "manual",
    aiMeta: null,
  },
  {
    id: "snack",
    name: "加餐",
    calories: 0,
    status: "待记录",
    foods: [],
    macros: { protein: 0, carbs: 0, fat: 0 },
    nutritionSource: "manual",
    aiMeta: null,
  },
];

const initialStateSnapshot = JSON.parse(JSON.stringify(state));
const initialMealsSnapshot = JSON.parse(JSON.stringify(meals));

const activityTypes = {
  燃脂快练: { met: 7.6, hint: "高心率间歇" },
  力量塑形: { met: 6.0, hint: "抗阻训练" },
  腹部核心: { met: 4.5, hint: "核心稳定" },
  跑步: { met: 8.8, hint: "户外或跑步机" },
  有氧恢复: { met: 4.2, hint: "低强度恢复" },
};

const workouts = [
  { type: "燃脂快练", name: "20 分钟全身循环", minutes: 20, kcal: 230, level: "中等", active: true },
  { type: "力量塑形", name: "上肢推拉基础", minutes: 38, kcal: 260, level: "中等", active: false },
  { type: "腹部核心", name: "核心稳定 + 平板支撑", minutes: 16, kcal: 120, level: "入门", active: false },
  { type: "跑步", name: "户外 5km 配速跑", minutes: 34, kcal: 360, level: "偏高", active: false },
  { type: "有氧恢复", name: "低强度椭圆机", minutes: 25, kcal: 160, level: "轻松", active: false },
];

const navItems = [
  { key: "home", label: "首页", svg: icon("home") },
  { key: "diet", label: "饮食", svg: icon("fork") },
  { key: "training", label: "训练", svg: icon("dumbbell") },
  { key: "data", label: "数据", svg: icon("chart") },
  { key: "profile", label: "我的", svg: icon("user") },
];

const STORAGE_KEY = "fat-loss-state-v3";
const LEGACY_STORAGE_KEY = "fat-loss-prototype-state-v2";
const LEGACY_TOKEN_KEY = "fat-loss-access-token";
const LEGACY_REFRESH_TOKEN_KEY = "fat-loss-refresh-token";
const AUTH_USER_KEY = "fat-loss-auth-user-id";
const AUTH_EMAIL_KEY = "fat-loss-auth-email";
const AUTH_PROVIDER_KEY = "fat-loss-auth-provider";
const API_STATE_URL = "/api/state";
const API_NUTRITION_URL = "/api/ai/nutrition";
const API_AUTH_LOGIN_URL = "/api/auth/login";
const API_AUTH_SIGNUP_URL = "/api/auth/signup";
const API_AUTH_REFRESH_URL = "/api/auth/refresh";
const API_AUTH_LOGOUT_URL = "/api/auth/logout";
const API_AUTH_ACCOUNT_URL = "/api/auth/account";
const API_AUTH_READINESS_URL = "/api/readiness";
const CURRENT_SCHEMA_VERSION = 3;

function storedValue(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

const runtime = {
  saveTimer: undefined,
  inputSaveTimer: undefined,
  toastTimer: undefined,
  retryTimer: undefined,
  reminderTimer: undefined,
  undoTimer: undefined,
  completionFeedbackTimer: undefined,
  accessToken: "",
  authUserId: storedValue(AUTH_USER_KEY),
  authProvider: storedValue(AUTH_PROVIDER_KEY) === "local" ? "local" : "supabase",
  settingsReturnAction: "settings",
  settingsReturnHash: "#tab-profile",
  pendingTabEnter: false,
  lastShellSignature: "",
  lastPageHtml: "",
  pendingActions: new Set(),
  aiNutritionController: null,
  aiNutritionSequence: 0,
  aiNutritionDraftKey: "",
  completionFeedback: null,
  completionAnnouncement: "",
  celebrationOpen: false,
  celebrationReturnSelector: "",
  celebrationSeenFallback: new Map(),
  countUpValues: new Map(),
  syncPromise: null,
  stateRevision: 0,
  localUpdatedAt: "",
  localMutationRevision: 0,
  dirtyBaseRevision: null,
  syncBasePayload: null,
  lastPersistedDataFingerprint: "",
  lastMutationChanged: false,
  lastActivityCommitFingerprint: "",
  lastActivityCommitAt: 0,
};

export {
  state,
  domainState,
  sessionState,
  uiState,
  meals,
  initialStateSnapshot,
  initialMealsSnapshot,
  activityTypes,
  workouts,
  navItems,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  LEGACY_TOKEN_KEY,
  LEGACY_REFRESH_TOKEN_KEY,
  AUTH_USER_KEY,
  AUTH_EMAIL_KEY,
  AUTH_PROVIDER_KEY,
  API_STATE_URL,
  API_NUTRITION_URL,
  API_AUTH_LOGIN_URL,
  API_AUTH_SIGNUP_URL,
  API_AUTH_REFRESH_URL,
  API_AUTH_LOGOUT_URL,
  API_AUTH_ACCOUNT_URL,
  API_AUTH_READINESS_URL,
  CURRENT_SCHEMA_VERSION,
  runtime,
};
