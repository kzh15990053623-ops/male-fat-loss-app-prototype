import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadWriteAppState() {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://phase0.supabase.co";
  process.env.SUPABASE_ANON_KEY = "phase0-test-anon-key-that-is-long-enough";
  return (await import("../../server/supabase.mjs")).writeAppState;
}

async function loadSupabaseStateModule() {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://phase0.supabase.co";
  process.env.SUPABASE_ANON_KEY = "phase0-test-anon-key-that-is-long-enough";
  return import("../../server/supabase.mjs");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  if (ORIGINAL_ENV.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIGINAL_ENV.SUPABASE_URL;
  if (ORIGINAL_ENV.SUPABASE_ANON_KEY === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = ORIGINAL_ENV.SUPABASE_ANON_KEY;
});

describe("Supabase 状态首次写入 CAS", () => {
  it("revision 0 首写使用普通 INSERT 而不是覆盖式 upsert", async () => {
    const writeAppState = await loadWriteAppState();
    fetch.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(
      jsonResponse([
        {
          state: { weight: 85, syncRevision: 1 },
          meals: [],
          updated_at: "2026-08-30T01:00:00.000Z",
        },
      ]),
    );

    const result = await writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, "access-token", "user-1");

    expect(result).toMatchObject({ revision: 1, updatedAt: "2026-08-30T01:00:00.000Z" });
    const [insertUrl, insertInit] = fetch.mock.calls[1];
    expect(insertUrl).toBe("https://phase0.supabase.co/rest/v1/app_states");
    expect(insertInit.method).toBe("POST");
    expect(insertInit.headers.Prefer).toBe("return=representation");
    expect(JSON.parse(insertInit.body)).toMatchObject({ user_id: "user-1", state: { weight: 85, syncRevision: 1 } });
  });

  it("并发首写的唯一键失败重新读取并映射为 STATE_CONFLICT", async () => {
    const writeAppState = await loadWriteAppState();
    fetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ code: "23505", message: "duplicate key" }, 409))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            state: { weight: 84, syncRevision: 1 },
            meals: [],
            updated_at: "2026-08-30T01:00:00.000Z",
          },
        ]),
      );

    await expect(writeAppState({ state: { weight: 85 }, meals: [], revision: 0 }, "access-token", "user-1")).rejects.toMatchObject({
      status: 409,
      code: "STATE_CONFLICT",
      conflict: { revision: 1, state: { weight: 84 } },
    });
  });

  it("缺失 revision 返回当前冲突载荷，非法 revision 在请求上游前失败", async () => {
    const writeAppState = await loadWriteAppState();
    fetch.mockResolvedValueOnce(
      jsonResponse([
        {
          state: { weight: 84, syncRevision: 2 },
          meals: [],
          updated_at: "2026-08-30T02:00:00.000Z",
        },
      ]),
    );

    await expect(writeAppState({ state: { weight: 83 }, meals: [] }, "access-token", "user-1")).rejects.toMatchObject({
      status: 409,
      code: "STATE_REVISION_REQUIRED",
      conflict: { revision: 2 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(writeAppState({ state: { weight: 83 }, meals: [], revision: "2" }, "access-token", "user-1")).rejects.toMatchObject({
      status: 400,
      code: "STATE_REVISION_INVALID",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ syncRevision: 0, weight: 85 }, "state->>syncRevision=eq.0"],
    [{ syncRevision: "legacy-invalid", weight: 85 }, "state->>syncRevision=eq.legacy-invalid"],
  ])("既有 revision 0/非法遗留行使用其原始值做精确 CAS", async (storedState, expectedFilter) => {
    const { writeAppState } = await loadSupabaseStateModule();
    fetch
      .mockResolvedValueOnce(jsonResponse([{ state: storedState, meals: [], updated_at: "2026-08-30T03:00:00.000Z" }]))
      .mockResolvedValueOnce(jsonResponse([{ state: { weight: 84, syncRevision: 1 }, meals: [], updated_at: "2026-08-30T03:01:00.000Z" }]));

    await expect(writeAppState({ state: { weight: 84 }, meals: [], revision: 0 }, "access-token", "user-1")).resolves.toMatchObject({
      revision: 1,
    });
    expect(fetch.mock.calls[1][0]).toContain(expectedFilter);
  });

  it("清空 INSERT 的 clearedAt 与 updated_at 使用同一服务端时间", async () => {
    const { writeAppState } = await loadSupabaseStateModule();
    fetch.mockResolvedValueOnce(jsonResponse([])).mockImplementationOnce(async (_url, init) => {
      const body = JSON.parse(init.body);
      return jsonResponse([{ state: body.state, meals: body.meals, updated_at: body.updated_at }]);
    });

    const result = await writeAppState(
      { state: { schemaVersion: 3, clearedAt: "2036-08-30T00:00:00.000Z", weight: 999 }, meals: null, revision: 0 },
      "access-token",
      "user-1",
    );
    const inserted = JSON.parse(fetch.mock.calls[1][1].body);
    expect(inserted.state).toEqual({ schemaVersion: 3, clearedAt: inserted.updated_at, syncRevision: 1 });
    expect(result.state.clearedAt).toBe(result.updatedAt);
  });
});
