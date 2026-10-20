import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const persistentDir = resolve(process.env.PERSISTENT_DIR || resolve(here, "../data"));
const databasePath = resolve(process.env.DATABASE_PATH || resolve(persistentDir, "users.db"));
mkdirSync(dirname(databasePath), { recursive: true });
export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    owner_discord_id TEXT,
    label TEXT NOT NULL,
    model TEXT NOT NULL CHECK(model IN ('zoi', 'zoi-unfiltered')),
    key_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS api_keys_owner_idx ON api_keys(owner_discord_id);
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_exchange_codes (
    code_hash TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar TEXT,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dashboard_sessions (
    token_hash TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    username TEXT NOT NULL,
    avatar TEXT,
    expires_at INTEGER NOT NULL
  );
`);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const keyRow = (row) => ({
  id: row.id, ownerDiscordId: row.owner_discord_id ?? null, label: row.label,
  model: row.model, keyHash: row.key_hash, createdAt: row.created_at, status: row.status
});

export function loadKeys() {
  return db.prepare("SELECT * FROM api_keys").all().map(keyRow);
}

export function saveKeys(keys) {
  const insert = db.prepare(`INSERT INTO api_keys(id, owner_discord_id, label, model, key_hash, created_at, status)
    VALUES(@id, @ownerDiscordId, @label, @model, @keyHash, @createdAt, @status)`);
  const transaction = db.transaction((rows) => {
    db.prepare("DELETE FROM api_keys").run();
    for (const row of rows) insert.run({
      id: row.id, ownerDiscordId: row.ownerDiscordId ?? row.owner_discord_id ?? null,
      label: row.label || "My application", model: row.model === "zoi-unfiltered" ? "zoi-unfiltered" : "zoi",
      keyHash: row.keyHash ?? row.key_hash, createdAt: row.createdAt ?? row.created_at,
      status: row.status || "active"
    });
  });
  transaction(keys);
}

export function createOAuthState(state, expiresAt) {
  db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO oauth_states(state_hash, expires_at) VALUES(?, ?)").run(hash(state), expiresAt);
}
export function consumeOAuthState(state) {
  const stateHash = hash(state);
  const row = db.prepare("SELECT expires_at FROM oauth_states WHERE state_hash = ?").get(stateHash);
  db.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(stateHash);
  return Boolean(row && row.expires_at >= Date.now());
}
export function createExchangeCode(code, user, expiresAt) {
  db.prepare("DELETE FROM oauth_exchange_codes WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO oauth_exchange_codes(code_hash, discord_id, username, avatar, expires_at) VALUES(?, ?, ?, ?, ?)")
    .run(hash(code), user.id, user.username, user.avatar ?? null, expiresAt);
}
export function consumeExchangeCode(code) {
  const codeHash = hash(code);
  const row = db.prepare("SELECT * FROM oauth_exchange_codes WHERE code_hash = ?").get(codeHash);
  db.prepare("DELETE FROM oauth_exchange_codes WHERE code_hash = ?").run(codeHash);
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.discord_id, username: row.username, avatar: row.avatar };
}
export function createSession(token, user, expiresAt) {
  db.prepare("DELETE FROM dashboard_sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO dashboard_sessions(token_hash, discord_id, username, avatar, expires_at) VALUES(?, ?, ?, ?, ?)")
    .run(hash(token), user.id, user.username, user.avatar ?? null, expiresAt);
}
export function getSession(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM dashboard_sessions WHERE token_hash = ?").get(hash(token));
  if (!row || row.expires_at < Date.now()) {
    if (row) db.prepare("DELETE FROM dashboard_sessions WHERE token_hash = ?").run(hash(token));
    return null;
  }
  return { id: row.discord_id, username: row.username, avatar: row.avatar };
}
export function deleteSession(token) {
  if (token) db.prepare("DELETE FROM dashboard_sessions WHERE token_hash = ?").run(hash(token));
}
