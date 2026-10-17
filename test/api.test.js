import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = await mkdtemp(join(tmpdir(), "intelligence-api-"));
process.env.DATA_FILE = join(tempDir, "keys.json");
const { handleRequest } = await import("../src/server.js?test=" + Date.now());
const server = createServer((req, res) => void handleRequest(req, res));
let base;

before(async () => {
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", (error) => error ? reject(error) : resolve()));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await rm(tempDir, { recursive: true, force: true });
});

test("health endpoint responds", async () => {
  const response = await fetch(base + "/health");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("creates a usable API key and authenticates it", async () => {
  const created = await fetch(base + "/v1/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "CI test key" })
  });
  assert.equal(created.status, 201);
  const payload = await created.json();
  assert.match(payload.key, /^zai_[A-Za-z0-9_-]{43}$/);
  const checked = await fetch(base + "/v1/keys", {
    headers: { authorization: `Bearer ${payload.key}` }
  });
  assert.equal(checked.status, 200);
  assert.equal((await checked.json()).valid, true);
});

test("rejects an invalid API key", async () => {
  const response = await fetch(base + "/v1/keys", {
    headers: { authorization: "Bearer zai_not-a-real-key" }
  });
  assert.equal(response.status, 401);
});
