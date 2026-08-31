import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalAuthService } from "../server/local-auth.mjs";

const temporaryDirectory = await mkdtemp(join(tmpdir(), "weight-lab-local-auth-"));
const filePath = join(temporaryDirectory, "auth.json");
const service = createLocalAuthService({ filePath, enabled: true });

try {
  const signup = await service.signup("Lab@Example.com", "secure-pass-01");
  assert.equal(signup.provider, "local");
  assert.equal(signup.user.email, "lab@example.com");
  assert.match(signup.access_token, /^local_access_/);
  assert.match(signup.refresh_token, /^local_refresh_/);

  const storedText = await readFile(filePath, "utf8");
  assert.doesNotMatch(storedText, /secure-pass-01/);
  assert.equal(storedText.includes(signup.refresh_token), false);
  assert.match(storedText, /"algorithm": "scrypt"/);

  await assert.rejects(
    () => service.signup("lab@example.com", "another-pass"),
    (error) => error.code === "AUTH_EMAIL_EXISTS" && error.status === 409,
  );
  await assert.rejects(
    () => service.login("lab@example.com", "wrong-pass"),
    (error) => error.code === "AUTH_INVALID_CREDENTIALS" && error.status === 401,
  );

  const auth = await service.currentUser(signup.access_token);
  assert.equal(auth.provider, "local");
  assert.equal(auth.user.id, signup.user.id);

  const saved = await service.writeAppState(
    {
      state: { schemaVersion: 3, setupCompleted: true, weight: 86.2, authError: "must not persist" },
      meals: [{ id: "breakfast", name: "早餐", calories: 430, foods: ["燕麦"], macros: { protein: 20, carbs: 55, fat: 12 } }],
      revision: 0,
    },
    auth.user.id,
  );
  assert.equal(saved.state.weight, 86.2);
  assert.equal(saved.state.authError, undefined);
  assert.equal(saved.meals[0].calories, 430);

  const readBack = await service.readAppState(auth.user.id);
  assert.equal(readBack.state.weight, 86.2);
  assert.equal(readBack.meals[0].foods[0], "燕麦");

  const rotated = await service.refresh(signup.refresh_token);
  assert.equal(rotated.user.id, signup.user.id);
  assert.notEqual(rotated.refresh_token, signup.refresh_token);
  await assert.rejects(
    () => service.refresh(signup.refresh_token),
    (error) => error.code === "AUTH_SESSION_INVALID",
  );

  const login = await service.login("LAB@example.com", "secure-pass-01");
  assert.equal(login.user.id, signup.user.id);
  await service.logout(login.refresh_token);
  await assert.rejects(
    () => service.refresh(login.refresh_token),
    (error) => error.code === "AUTH_SESSION_INVALID",
  );
  await assert.rejects(
    () => service.currentUser(login.access_token),
    (error) => error.code === "AUTH_SESSION_EXPIRED",
  );

  await service.deleteAppState(auth.user.id);
  assert.deepEqual(await service.readAppState(auth.user.id), { state: null, meals: null, updatedAt: null, revision: 0 });

  await service.deleteAccount(signup.user.id);
  await assert.rejects(
    () => service.currentUser(signup.access_token),
    (error) => error.status === 401,
  );
  await assert.rejects(
    () => service.refresh(rotated.refresh_token),
    (error) => error.code === "AUTH_SESSION_INVALID",
  );
  await assert.rejects(
    () => service.login("lab@example.com", "secure-pass-01"),
    (error) => error.code === "AUTH_INVALID_CREDENTIALS",
  );
  await assert.rejects(
    () => service.deleteAccount(signup.user.id),
    (error) => error.code === "LOCAL_USER_NOT_FOUND",
  );

  const disabled = createLocalAuthService({ filePath: join(temporaryDirectory, "disabled.json"), enabled: false });
  await assert.rejects(
    () => disabled.signup("test@example.com", "secure-pass"),
    (error) => error.code === "LOCAL_AUTH_DISABLED" && error.status === 503,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Local auth security and persistence checks passed");
