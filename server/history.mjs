import { requestSupabase } from "./supabase.mjs";
import { validateStateWrite, sanitizeState } from "./data.mjs";
import { localAuthService } from "./local-auth.mjs";

export async function handleHistory(request, response, url, auth, { readJsonBody, sendJson }) {
  if (url.pathname !== "/api/history") return false;
  const before = url.searchParams.get("before") || "9999-12-31";
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit")) || 30));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw Object.assign(new Error("历史日期无效"), { status: 400 });
  if (request.method === "GET") {
    const exact = url.searchParams.get("date");
    if (exact && !/^\d{4}-\d{2}-\d{2}$/.test(exact)) throw Object.assign(new Error("历史日期无效"), { status: 400 });
    const rows =
      auth.provider === "local"
        ? await localAuthService.readHistory(auth.user.id, before, limit, exact)
        : await requestSupabase(
            `/rest/v1/app_daily_records?select=date,record,revision&user_id=eq.${encodeURIComponent(auth.user.id)}&date=${exact ? `eq.${exact}` : `lt.${before}`}&order=date.desc&limit=${limit}`,
            { accessToken: auth.accessToken },
          );
    sendJson(response, 200, { rows, next: rows.length === limit ? rows.at(-1).date : null });
    return true;
  }
  if (request.method !== "PUT") return false;
  const payload = await readJsonBody(request);
  const { date, record, revision } = payload;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isInteger(revision) || revision < 0 || record?.date !== date)
    throw Object.assign(new Error("历史记录或版本无效"), { status: 400 });
  validateStateWrite({ state: { dailyRecords: { [date]: record } }, meals: [] });
  const safe = sanitizeState({ dailyRecords: { [date]: record } }).dailyRecords[date];
  let row;
  if (auth.provider === "local") row = await localAuthService.writeHistory(auth.user.id, date, safe, revision);
  else {
    row = await requestSupabase("/rest/v1/rpc/write_app_day", {
      method: "POST",
      accessToken: auth.accessToken,
      body: { p_date: date, p_record: safe, p_revision: revision },
    });
    if (row.cleared)
      throw Object.assign(new Error("另一设备已清空档案，请先刷新档案版本"), { status: 409, code: "STATE_CLEARED", conflict: row });
    if (row.conflict)
      throw Object.assign(new Error("此日记录在另一设备发生变化，请在历史页选择保留的内容"), {
        status: 409,
        code: "HISTORY_CONFLICT",
        conflict: row.conflict,
      });
  }
  sendJson(response, 200, row);
  return true;
}
