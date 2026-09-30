import { assertDedicatedProject, assertDockerReady, localSupabaseStatus, PROJECT_ID, runLocalSupabaseCli } from "./supabase-test-stack.mjs";

try {
  const action = process.argv[2];
  if (!["start", "stop"].includes(action)) throw new Error("Use npm run supabase:test:start or npm run supabase:test:stop");
  await assertDedicatedProject();
  await assertDockerReady();
  if (action === "start") {
    // start applies migrations only when creating this dedicated local stack.
    // No db reset, db push, remote URL, login, or project-link command is used.
    await runLocalSupabaseCli(["start"]);
    await localSupabaseStatus();
    console.log(`Local Supabase ${PROJECT_ID} ready on loopback ports 55321/55322; keys are not printed.`);
  } else {
    await runLocalSupabaseCli(["stop", "--project-id", PROJECT_ID]);
    console.log(`Stopped only local Supabase ${PROJECT_ID}; local data is retained by the CLI.`);
  }
} catch (error) {
  // CLI errors can contain status output with local keys; never echo stdout/stderr.
  console.error(
    error.message?.startsWith("NOT RUN:")
      ? error.message
      : "Local Supabase command failed. Verify Docker and the dedicated test configuration; no remote command was issued.",
  );
  process.exitCode = 1;
}
