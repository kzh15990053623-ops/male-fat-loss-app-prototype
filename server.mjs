import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { dirname, extname, join, resolve, sep } from "node:path";

const port = Number(process.env.PORT || 5173);
const root = process.cwd();
const dataFile = join(root, "data", "app-state.json");
const accessPassword = process.env.APP_ACCESS_PASSWORD || "fit2026";
const sessionToken = randomBytes(24).toString("hex");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const defaultData = {
  state: null,
  meals: null,
  updatedAt: null,
};

const nutritionProfiles = [
  { keywords: ["鸡胸", "鸡肉"], calories: 165, protein: 31, carbs: 0, fat: 4 },
  { keywords: ["牛肉", "瘦牛"], calories: 210, protein: 27, carbs: 0, fat: 10 },
  { keywords: ["猪肉", "瘦肉"], calories: 242, protein: 27, carbs: 0, fat: 14 },
  { keywords: ["三文鱼", " salmon"], calories: 208, protein: 20, carbs: 0, fat: 13 },
  { keywords: ["鱼", "虾"], calories: 120, protein: 23, carbs: 0, fat: 2 },
  { keywords: ["鸡蛋", "蛋"], calories: 155, protein: 13, carbs: 1, fat: 11 },
  { keywords: ["豆腐"], calories: 85, protein: 8, carbs: 2, fat: 5 },
  { keywords: ["米饭", "糙米", "饭"], calories: 116, protein: 3, carbs: 26, fat: 1 },
  { keywords: ["面", "面条", "意面"], calories: 150, protein: 5, carbs: 30, fat: 1 },
  { keywords: ["燕麦"], calories: 389, protein: 17, carbs: 66, fat: 7 },
  { keywords: ["藜麦"], calories: 120, protein: 4, carbs: 21, fat: 2 },
  { keywords: ["红薯", "土豆"], calories: 86, protein: 2, carbs: 20, fat: 0 },
  { keywords: ["西兰花", "生菜", "青菜", "蔬菜", "菠菜"], calories: 30, protein: 3, carbs: 5, fat: 0 },
  { keywords: ["酸奶"], calories: 72, protein: 5, carbs: 8, fat: 2 },
  { keywords: ["牛奶"], calories: 54, protein: 3, carbs: 5, fat: 3 },
  { keywords: ["乳清", "蛋白粉"], calories: 400, protein: 78, carbs: 8, fat: 6 },
  { keywords: ["坚果", "花生", "杏仁"], calories: 575, protein: 21, carbs: 22, fat: 49 },
  { keywords: ["牛肉饭"], calories: 185, protein: 11, carbs: 24, fat: 5 },
  { keywords: ["沙拉"], calories: 75, protein: 4, carbs: 8, fat: 3 },
];

async function ensureDataFile() {
  if (existsSync(dataFile)) return;
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(defaultData, null, 2), "utf8");
}

async function readAppState() {
  await ensureDataFile();
  return JSON.parse(await readFile(dataFile, "utf8"));
}

async function writeAppState(payload) {
  await mkdir(dirname(dataFile), { recursive: true });
  const data = {
    state: payload.state || null,
    meals: Array.isArray(payload.meals) ? payload.meals : null,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(dataFile, JSON.stringify(data, null, 2), "utf8");
  return data;
}

function parseFoodItems(foodText) {
  return String(foodText || "")
    .split(/[，,、+和\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function amountFromText(text) {
  const gramMatch = text.match(/(\d+(?:\.\d+)?)\s*(g|克)/i);
  if (gramMatch) return Number(gramMatch[1]);

  const bowlMatch = text.match(/(\d+(?:\.\d+)?)?\s*(碗|份|个|只|块|杯)/);
  if (!bowlMatch) return 100;
  const count = Number(bowlMatch[1] || 1);
  const unit = bowlMatch[2];
  const unitGrams = {
    碗: 180,
    份: 150,
    个: 55,
    只: 80,
    块: 100,
    杯: 250,
  };
  return count * (unitGrams[unit] || 100);
}

function profileForFood(text) {
  const normalized = String(text || "").toLowerCase();
  return nutritionProfiles.find((profile) => profile.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())));
}

function contextAmountGrams(context) {
  const amount = Number(context?.amount || 0);
  if (!amount) return null;
  const unit = context?.unit || "g";
  const gramsByUnit = {
    g: 1,
    克: 1,
    份: 150,
    碗: 180,
    个: 55,
    杯: 250,
  };
  return amount * (gramsByUnit[unit] || 1);
}

function cookingAdjustment(context) {
  const cooking = context?.cooking || "清淡";
  const map = {
    清淡: { calories: 1, fat: 1 },
    水煮: { calories: 0.96, fat: 0.9 },
    蒸: { calories: 0.98, fat: 0.95 },
    烤: { calories: 1.04, fat: 1.08 },
    炒: { calories: 1.14, fat: 1.32 },
    煎: { calories: 1.18, fat: 1.42 },
    油炸: { calories: 1.45, fat: 2.1 },
  };
  return map[cooking] || map.清淡;
}

function extraCalories(context) {
  const oilGrams = Math.max(0, Number(context?.oilGrams || 0));
  const sauce = context?.sauce || "少";
  const sauceCalories = {
    无: 0,
    少: 20,
    中: 55,
    多: 110,
  };
  return {
    calories: Math.round(oilGrams * 9 + (sauceCalories[sauce] || 0)),
    fat: Math.round(oilGrams),
    carbs: sauce === "多" ? 10 : sauce === "中" ? 5 : sauce === "少" ? 2 : 0,
  };
}

function estimateNutrition(foodText, context = {}) {
  const items = parseFoodItems(foodText);
  const explicitGrams = contextAmountGrams(context);
  const gramsPerItem = explicitGrams ? explicitGrams / Math.max(1, items.length) : null;
  const adjustment = cookingAdjustment(context);
  const details = items.map((item) => {
    const profile = profileForFood(item) || { calories: 120, protein: 8, carbs: 12, fat: 4 };
    const grams = gramsPerItem || amountFromText(item);
    const ratio = grams / 100;
    return {
      name: item,
      grams: Math.round(grams),
      calories: Math.round(profile.calories * ratio * adjustment.calories),
      protein: Math.round(profile.protein * ratio),
      carbs: Math.round(profile.carbs * ratio),
      fat: Math.round(profile.fat * ratio * adjustment.fat),
      confidence: profileForFood(item) ? 0.78 : 0.42,
    };
  });

  const baseTotals = details.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const extras = extraCalories(context);
  const totals = {
    calories: baseTotals.calories + extras.calories,
    protein: baseTotals.protein,
    carbs: baseTotals.carbs + extras.carbs,
    fat: baseTotals.fat + extras.fat,
  };

  return {
    ...totals,
    details,
    context: {
      amount: context?.amount || null,
      unit: context?.unit || "g",
      cooking: context?.cooking || "清淡",
      oilGrams: Number(context?.oilGrams || 0),
      sauce: context?.sauce || "少",
      extraCalories: extras.calories,
    },
    confidence: details.length ? Number(Math.min(0.92, (details.reduce((sum, item) => sum + item.confidence, 0) / details.length) + (explicitGrams ? 0.08 : 0)).toFixed(2)) : 0,
    source: "free-local-estimator",
    note: explicitGrams ? "已结合总量、做法、油量和酱料修正估算；仍建议按实际称重微调。" : "未填写具体总量，已按常见份量估算；填写克重会更准确。",
  };
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        rejectBody(new Error("Request body is too large"));
      }
    });
    request.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch {
        rejectBody(new Error("Invalid JSON body"));
      }
    });
    request.on("error", rejectBody);
  });
}

function isAuthorized(request) {
  return request.headers["x-app-token"] === sessionToken || request.headers.authorization === `Bearer ${sessionToken}`;
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/session" && request.method === "POST") {
    const payload = await readJsonBody(request);
    if (String(payload.password || "") !== accessPassword) {
      sendJson(response, 401, { error: "访问密码不正确" });
      return true;
    }
    sendJson(response, 200, { token: sessionToken });
    return true;
  }

  if (!isAuthorized(request)) {
    sendJson(response, 401, { error: "需要访问密码" });
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    sendJson(response, 200, await readAppState());
    return true;
  }

  if (url.pathname === "/api/state" && (request.method === "PUT" || request.method === "POST")) {
    const payload = await readJsonBody(request);
    sendJson(response, 200, await writeAppState(payload));
    return true;
  }

  if (url.pathname === "/api/state" && request.method === "DELETE") {
    await writeAppState(defaultData);
    sendJson(response, 200, await readAppState());
    return true;
  }

  if (url.pathname === "/api/ai/nutrition" && request.method === "POST") {
    const payload = await readJsonBody(request);
    const foodText = String(payload.foodText || "").trim();
    if (!foodText) {
      sendJson(response, 400, { error: "请先填写食物内容" });
      return true;
    }
    sendJson(response, 200, estimateNutrition(foodText, payload.context || {}));
    return true;
  }

  return false;
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) sendJson(response, 404, { error: "API route not found" });
      return;
    }
  } catch (error) {
    sendJson(response, 400, { error: error.message || "Request failed" });
    return;
  }

  const requestPath = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
  let filePath = resolve(root, requestPath === "" ? "index.html" : requestPath);

  if (!filePath.startsWith(root + sep) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(root, "index.html");
  }

  response.writeHead(200, {
    "Content-Type": types[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Serving at http://localhost:${port}`);
});
