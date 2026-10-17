import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReply, resetConversation } from "./intelligence.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataFile = resolve(process.env.DATA_FILE || resolve(here, "../data/api-keys.json"));
const port = Number(process.env.PORT || 3000);
const keyPrefix = "zai_";
const requestWindows = new Map();
const WINDOW_MS = 60_000;
const MAX_KEY_CREATIONS_PER_WINDOW = 5;

async function loadKeys() {
  try {
    return JSON.parse(await readFile(dataFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return [];
  }
}

async function saveKeys(keys) {
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
}

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function send(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

function allowKeyCreation(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = requestWindows.get(ip);
  if (!current || now - current.startedAt >= WINDOW_MS) {
    requestWindows.set(ip, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= MAX_KEY_CREATIONS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const page = await readFile(resolve(here, "../public/index.html"), "utf8");
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff"
      });
      return res.end(page);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, service: "discord-chatbot-intelligence-api", version: "0.1.0" });
    }

    if (req.method === "POST" && url.pathname === "/v1/keys") {
      if (!allowKeyCreation(req)) {
        return send(res, 429, { error: "key_creation_rate_limited", message: "Maximum 5 key creations per IP per minute." });
      }
      const body = await readJson(req);
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "My application";
      const key = keyPrefix + randomBytes(32).toString("base64url");
      const keys = await loadKeys();
      keys.push({
        id: randomBytes(8).toString("hex"),
        label: label || "My application",
        keyHash: hashKey(key),
        createdAt: new Date().toISOString(),
        status: "active"
      });
      await saveKeys(keys);
      return send(res, 201, {
        key,
        id: keys.at(-1).id,
        label: keys.at(-1).label,
        warning: "Copy this key now. It is only shown once; the server stores its SHA-256 hash."
      });
    }

    if (req.method === "GET" && url.pathname === "/v1/keys") {
      const auth = req.headers.authorization || "";
      const suppliedKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!suppliedKey) return send(res, 401, { error: "missing_api_key", message: "Provide Authorization: Bearer <key>." });
      const keys = await loadKeys();
      const record = keys.find((entry) => entry.status === "active" && entry.keyHash === hashKey(suppliedKey));
      if (!record) return send(res, 401, { error: "invalid_api_key" });
      return send(res, 200, { valid: true, keyId: record.id, label: record.label, createdAt: record.createdAt });
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const auth = req.headers.authorization || "";
      const suppliedKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!suppliedKey) return send(res, 401, { error: "missing_api_key" });
      const keys = await loadKeys();
      const record = keys.find((entry) => entry.status === "active" && entry.keyHash === hashKey(suppliedKey));
      if (!record) return send(res, 401, { error: "invalid_api_key" });
      const body = await readJson(req);
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return send(res, 400, { error: "message_required", message: "Send a non-empty 'message' string." });
      if (message.length > 4000) return send(res, 413, { error: "message_too_long", maxLength: 4000 });
      const clientConversationId = typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim().slice(0, 160)
        : randomBytes(12).toString("hex");
      // Scope conversations to their API key so one customer's memory cannot leak to another.
      const conversationId = `${record.id}:${clientConversationId}`;
      const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const completion = generateReply({ message, conversationId, history });
      return send(res, 200, { ...completion, conversationId: clientConversationId });
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/reset") {
      const auth = req.headers.authorization || "";
      const suppliedKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!suppliedKey) return send(res, 401, { error: "missing_api_key" });
      const keys = await loadKeys();
      const record = keys.find((entry) => entry.status === "active" && entry.keyHash === hashKey(suppliedKey));
      if (!record) return send(res, 401, { error: "invalid_api_key" });
      const body = await readJson(req);
      const clientConversationId = typeof body.conversationId === "string" && body.conversationId.trim()
        ? body.conversationId.trim().slice(0, 160)
        : "";
      const conversationId = clientConversationId ? `${record.id}:${clientConversationId}` : record.id;
      return send(res, 200, { reset: resetConversation(conversationId), conversationId: clientConversationId || null });

    }

    return send(res, 404, { error: "not_found", routes: ["GET /health", "POST /v1/keys", "GET /v1/keys", "POST /v1/chat/completions", "POST /v1/chat/reset"] });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? "bad_request" : "internal_error", message: error.status ? error.message : "Unexpected server error." });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer((req, res) => void handleRequest(req, res));
  server.listen(port, "0.0.0.0", () => {
    console.log(`Intelligence API prototype listening on port ${port}`);
  });
}
