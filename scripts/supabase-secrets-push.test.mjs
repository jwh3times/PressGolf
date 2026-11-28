import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// `supabase secrets set` pushes every entry under `[edge_runtime.secrets]` in
// supabase/config.toml to the hosted project, along with what it is given, so a
// switch meant for the local stack reached production (#402). The installed CLI
// runs against this repository's own supabase/ folder, with a local stub in
// place of the Management API: a profile file points every API call at it, and
// a dead proxy catches anything that would still leave the machine. The token
// and project ref are made up, so nothing hosted is ever touched.

const run = (args, env) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["node_modules/supabase/dist/supabase.js", ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });

test("supabase secrets set pushes only the secrets it is given", async () => {
  const pushed = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.method === "POST" && /^\/v1\/projects\/[^/]+\/secrets/.test(request.url ?? "")) {
        pushed.push(...JSON.parse(body).map((secret) => secret.name));
      }
      response.writeHead(request.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      response.end(request.method === "GET" ? "[]" : "{}");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const stub = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "secrets-push-"));
  const profile = join(dir, "profile.yaml");
  writeFileSync(profile, `name: stub\napi_url: ${stub}\ndashboard_url: ${stub}\nproject_host: localhost\n`);

  try {
    const { code, output } = await run(
      ["secrets", "set", "PUSH_PROBE=1", "--remote=abcdefghijklmnopqrst", "--yes", "--profile", profile],
      {
        SUPABASE_API_URL: stub,
        SUPABASE_ACCESS_TOKEN: `sbp_${"0".repeat(40)}`,
        SUPABASE_TELEMETRY_DISABLED: "1",
        DO_NOT_TRACK: "1",
        HTTPS_PROXY: "http://127.0.0.1:9",
        HTTP_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "127.0.0.1,localhost",
      },
    );
    assert.equal(code, 0, `the Supabase CLI failed:\n${output}`);
    assert.deepEqual(pushed, ["PUSH_PROBE"]);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
