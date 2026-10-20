import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resetConversation } from "./intelligence.js";
import { loadKeys, saveKeys } from "./database.js";
import { handleDashboardRequest } from "./dashboard.js";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const requestWindows = new Map();
const WINDOW_MS = 60_000;
const MAX_KEY_CREATIONS_PER_WINDOW = 5;
let trainingWorker = null;
let trainingJob = { status: "idle", progress: 0, stage: "idle", message: "Training has not started.", summaries: null, error: null, startedAt: null, finishedAt: null };

function validTrainingToken(req) {
  const expected = process.env.ZOI_TRAINING_TOKEN || "";
  const auth = req.headers.authorization || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function startTraining() {
  if (trainingWorker) return false;
  trainingJob = { status: "running", progress: 0, stage: "starting", message: "Starting training worker…", summaries: null, error: null, startedAt: new Date().toISOString(), finishedAt: null };
  trainingWorker = new Worker(new URL("./training-worker.js", import.meta.url), { workerData: { root: resolve(here, "..") } });
  trainingWorker.on("message", (message) => {
    if (message.type === "progress") {
      trainingJob = { ...trainingJob, ...message, status: message.progress >= 100 ? "complete" : "running", updatedAt: new Date().toISOString() };
    } else if (message.type === "failed") {
      trainingJob = { ...trainingJob, status: "failed", error: message.message, message: "Training failed.", finishedAt: new Date().toISOString() };
    }
  });
  trainingWorker.on("error", (error) => {
    trainingJob = { ...trainingJob, status: "failed", error: error.message, message: "Training worker failed.", finishedAt: new Date().toISOString() };
  });
  trainingWorker.on("exit", (code) => {
    if (code !== 0 && trainingJob.status !== "failed" && trainingJob.status !== "complete") {
      trainingJob = { ...trainingJob, status: "failed", error: "Training worker exited unexpectedly.", message: "Training failed.", finishedAt: new Date().toISOString() };
    }
    trainingWorker = null;
  });
  return true;
}

function hashKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function getLocalInferenceUrl() {
  const value = (process.env.ZOI_INFERENCE_URL || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  try {
    const parsed = new URL(value);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (!["http:", "https:"].includes(parsed.protocol) || !localHosts.has(parsed.hostname) ||
        parsed.username || parsed.password || parsed.search || parsed.hash) return "";
    return value;
  } catch {
    return "";
  }
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
  const allowedOrigin = (process.env.WEB_ORIGIN || "").trim().replace(/\/$/, "");
  const requestOrigin = req.headers.origin || "";
  if (allowedOrigin && requestOrigin === allowedOrigin) {
    res.setHeader("access-control-allow-origin", allowedOrigin);
    res.setHeader("access-control-allow-credentials", "false");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    if (!allowedOrigin || requestOrigin !== allowedOrigin) return send(res, 403, { error: "origin_not_allowed" });
    res.writeHead(204, { "cache-control": "no-store" });
    return res.end();
  }
  try {
    if (await handleDashboardRequest(req, res, url, { send, readJson, allowKeyCreation })) return;

    if (req.method === "GET" && url.pathname === "/config.js") {
      const config = await readFile(resolve(here, "../public/config.js"), "utf8");
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", "x-content-type-options": "nosniff" });
      return res.end(config);
    }

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
      return send(res, 200, { ok: true, service: "discord-chatbot-intelligence-api", version: "0.2.0", commit: process.env.BOT_HOST_COMMIT || process.env.GITHUB_SHA || null, model: { provider: "custom-peft", baseModel: "meta-llama/Llama-3.1-8B-Instruct" }, inference: { configured: Boolean(getLocalInferenceUrl() && process.env.ZOI_INFERENCE_TOKEN), location: "local-only", adapters: ["zoi", "zoi-unfiltered"] } });
    }

    if ((req.method === "POST" && url.pathname === "/v1/train/start") || (req.method === "GET" && url.pathname === "/v1/train/status")) {
      if (!validTrainingToken(req)) return send(res, 401, { error: "invalid_training_token", message: "Enter the training token configured by the service operator." });
      if (req.method === "POST") {
        if (trainingWorker || trainingJob.status === "running") return send(res, 409, { error: "training_in_progress", message: "Training is already running.", job: trainingJob });
        startTraining();
        return send(res, 202, { accepted: true, job: trainingJob });
      }
      return send(res, 200, { job: trainingJob });
    }

    if (req.method === "GET" && url.pathname === "/v1/keys") {
      const auth = req.headers.authorization || "";
      const suppliedKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!suppliedKey) return send(res, 401, { error: "missing_api_key", message: "Provide Authorization: Bearer <key>." });
      const keys = await loadKeys();
      const record = keys.find((entry) => entry.status === "active" && entry.keyHash === hashKey(suppliedKey));
      if (!record) return send(res, 401, { error: "invalid_api_key" });
      return send(res, 200, { valid: true, keyId: record.id, label: record.label, model: record.model || "zoi", createdAt: record.createdAt });
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
      // Adapter assignment is stored with the API key. Never trust a caller-supplied
      // model field: the public request cannot switch a regular key to the unfiltered adapter.
      const assignedModel = record.model === "zoi-unfiltered" ? "zoi-unfiltered" : "zoi";
      const inferenceUrl = getLocalInferenceUrl();
      const inferenceToken = (process.env.ZOI_INFERENCE_TOKEN || "").trim();
      let completion;
      if (inferenceUrl && inferenceToken) {
        try {
          const response = await fetch(`${inferenceUrl}/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${inferenceToken}` },
            body: JSON.stringify({ message, history, model: assignedModel }),
            signal: AbortSignal.timeout(Math.min(180_000, Math.max(5_000, Number(process.env.ZOI_INFERENCE_TIMEOUT_MS || 120_000))))
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error("The inference worker could not complete this request.");
            error.status = response.status === 429 ? 429 : 503;
            throw error;
          }
          if (typeof result.choices?.[0]?.message?.content !== "string") {
            const error = new Error("The inference worker returned an invalid response.");
            error.status = 503;
            throw error;
          }
          completion = {
            object: "chat.completion",
            model: assignedModel,
            choices: result.choices,
            engine: "peft-adapter",
            providerStatus: { configured: true, provider: "zoi-inference", model: assignedModel }
          };
        } catch (error) {
          return send(res, error.status || 503, {
            error: "inference_unavailable",
            message: "The local custom-model inference runtime is unavailable or timed out."
          });
        }
      } else {
        return send(res, 503, {
          error: "inference_not_configured",
          message: "The local custom-model inference runtime is not configured. No substitute model was used."
        });
      }
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

    return send(res, 404, { error: "not_found", routes: ["GET /health", "POST /v1/train/start", "GET /v1/train/status", "POST /v1/keys", "GET /v1/keys", "POST /v1/chat/completions", "POST /v1/chat/reset"] });
  } catch (error) {
    return send(res, error.status || 500, { error: error.status ? "bad_request" : "internal_error", message: error.status ? error.message : "Unexpected server error." });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer((req, res) => void handleRequest(req, res));
  server.listen(port, "0.0.0.0", () => {
    console.log(`Zoi Intelligence API listening on port ${port}`);
  });
}
