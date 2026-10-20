import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const tempDir = mkdtempSync(join(tmpdir(), "zoi-dashboard-test-"));
process.env.DATABASE_PATH = join(tempDir, "users.db");
const store = await import("../src/database.js");

test.after(() => {
  store.db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("API key persistence keeps adapter and Discord owner", () => {
  const record = {
    id: "key-test-1", ownerDiscordId: "discord-user-123", label: "Test key",
    model: "zoi-unfiltered", keyHash: "a".repeat(64),
    createdAt: new Date().toISOString(), status: "active"
  };
  store.saveKeys([record]);
  assert.deepEqual(store.loadKeys(), [record]);
});

test("OAuth state can be consumed only once and expires", () => {
  const validState = randomBytes(24).toString("hex");
  store.createOAuthState(validState, Date.now() + 60_000);
  assert.equal(store.consumeOAuthState(validState), true);
  assert.equal(store.consumeOAuthState(validState), false);

  const expiredState = randomBytes(24).toString("hex");
  store.createOAuthState(expiredState, Date.now() - 1);
  assert.equal(store.consumeOAuthState(expiredState), false);
});

test("OAuth exchange codes are one-time and short-lived", () => {
  const code = randomBytes(24).toString("hex");
  const user = { id: "discord-user-456", username: "zoi-test", avatar: "avatarhash" };
  store.createExchangeCode(code, user, Date.now() + 60_000);
  assert.deepEqual(store.consumeExchangeCode(code), user);
  assert.equal(store.consumeExchangeCode(code), null);
});

test("dashboard sessions are hashed, expire, and can be revoked", () => {
  const token = randomBytes(32).toString("base64url");
  const user = { id: "discord-user-789", username: "dashboard-user", avatar: null };
  store.createSession(token, user, Date.now() + 60_000);
  assert.deepEqual(store.getSession(token), user);
  assert.equal(store.getSession("invalid-token"), null);
  store.deleteSession(token);
  assert.equal(store.getSession(token), null);

  const expiredToken = randomBytes(32).toString("base64url");
  store.createSession(expiredToken, user, Date.now() - 1);
  assert.equal(store.getSession(expiredToken), null);
});
