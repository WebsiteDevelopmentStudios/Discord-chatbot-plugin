import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Worker } from "node:worker_threads";
import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReplyAsync, resetConversation } from "./intelligence.js";
import { getModelStatus } from "./model-provider.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataFile = resolve(process.env.DATA_FILE || resolve(here, "../data/api-keys.json"));
const port = Number(process.env.PORT || 3000);
const keyPrefix = "zai_";
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

async function callLearningStore(path, options = {}) {
  const base = (process.env.ZOI_LEARNING_URL || "").replace(/\/$/, "");
  const token = process.env.ZOI_LEARNING_TOKEN || "";
  if (!base || !token) {
    const error = new Error("Learning storage is not configured.");
    error.code = "LEARNING_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(2500)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || "Learning storage request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function learningStoreResponse(res, operation) {
  try {
    return send(res, 200, await operation());
  } catch (error) {
    const status = error.code === "LEARNING_NOT_CONFIGURED" ? 503 : (error.status === 401 ? 502 : 503);
    return send(res, status, {
      error: status === 503 ? "learning_store_unavailable" : "learning_store_error",
      message: status === 503 ? "Zoi's learning store is temporarily unavailable." : "Zoi could not complete the learning-store request."
    });
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
      return send(res, 200, { ok: true, service: "discord-chatbot-intelligence-api", version: "0.2.0", commit: process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || null, model: getModelStatus(), inference: { configured: Boolean(process.env.ZOI_INFERENCE_URL && process.env.ZOI_INFERENCE_TOKEN), adapters: ["zoi", "zoi-unfiltered"] } });
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

    if (req.method === "POST" && url.pathname === "/v1/keys") {
      if (!allowKeyCreation(req)) {
        return send(res, 429, { error: "key_creation_rate_limited", message: "Maximum 5 key creations per IP per minute." });
      }
      const body = await readJson(req);
      const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "My application";
      const key = keyPrefix + randomBytes(32).toString("base64url");
      const keys = await loadKeys();
      const requestedModel = typeof body.model === "string" ? body.model : "zoi";
      if (!["zoi", "zoi-unfiltered"].includes(requestedModel)) {
        return send(res, 400, { error: "invalid_model", message: "model must be 'zoi' or 'zoi-unfiltered'." });
      }
      keys.push({
        id: randomBytes(8).toString("hex"),
        label: label || "My application",
        model: requestedModel,
        keyHash: hashKey(key),
        createdAt: new Date().toISOString(),
        status: "active"
      });
      await saveKeys(keys);
      return send(res, 201, {
        key,
        id: keys.at(-1).id,
        label: keys.at(-1).label,
        model: keys.at(-1).model,
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
      return send(res, 200, { valid: true, keyId: record.id, label: record.label, model: record.model || "zoi", createdAt: record.createdAt });
    }

    if (req.method === "POST" && url.pathname === "/v1/learning/feedback") {
      const auth = req.headers.authorization || "";
      const suppliedKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
      if (!suppliedKey) return send(res, 401, { error: "missing_api_key" });
      const keys = await loadKeys();
      const record = keys.find((entry) => entry.status === "active" && entry.keyHash === hashKey(suppliedKey));
      if (!record) return send(res, 401, { error: "invalid_api_key" });
      const body = await readJson(req);
      const question = typeof body.question === "string" ? body.question.trim() : "";
      const correction = typeof body.correction === "string" ? body.correction.trim() : "";
      const originalAnswer = typeof body.originalAnswer === "string" ? body.originalAnswer.trim() : "";
      if (!question || !correction) return send(res, 400, { error: "question_and_correction_required" });
      if (question.length > 2000 || correction.length > 4000 || originalAnswer.length > 4000) {
        return send(res, 413, { error: "learning_example_too_long" });
      }
      return learningStoreResponse(res, () => callLearningStore("/v1/feedback", {
        method: "POST",
        body: JSON.stringify({ question, originalAnswer, correction, source: record.id })
      }));
    }

    if (req.method === "GET" && url.pathname === "/v1/learning/pending") {
      if (!validTrainingToken(req)) return send(res, 401, { error: "invalid_training_token" });
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
      return learningStoreResponse(res, () => callLearningStore(`/v1/examples/pending?limit=${limit}`));
    }

    const learningReviewPrefix = "/v1/learning/examples/";
    const learningReviewSuffix = "/review";
    const learningReviewId = url.pathname.startsWith(learningReviewPrefix) && url.pathname.endsWith(learningReviewSuffix)
      ? url.pathname.slice(learningReviewPrefix.length, -learningReviewSuffix.length)
      : "";
    if (req.method === "POST" && learningReviewId && Number.isSafeInteger(Number(learningReviewId)) && Number(learningReviewId) > 0) {
      if (!validTrainingToken(req)) return send(res, 401, { error: "invalid_training_token" });
      const body = await readJson(req);
      if (!["approved", "rejected"].includes(body.status)) return send(res, 400, { error: "status_must_be_approved_or_rejected" });
      return learningStoreResponse(res, () => callLearningStore(`/v1/examples/${learningReviewId}/review`, {
        method: "POST",
        body: JSON.stringify({ status: body.status, correction: typeof body.correction === "string" ? body.correction : "" })
      }));
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
      const inferenceUrl = (process.env.ZOI_INFERENCE_URL || "").trim().replace(/\/+$/, "");
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
            message: "The trained-model worker is unavailable or timed out. Start the Colab inference runtime and try again."
          });
        }
      } else {
        completion = await generateReplyAsync({ message, conversationId, history });
        completion.modelAssignment = assignedModel;
        completion.inferenceConfigured = false;
      }
      if (body.learnFromConversation === true && completion.intent === "unknown_question") {
        try {
          await callLearningStore("/v1/candidates", {
            method: "POST",
            body: JSON.stringify({
              question: message,
              originalAnswer: completion.choices?.[0]?.message?.content || "",
              source: record.id
            })
          });
        } catch {
          // Learning capture is best-effort; it must never break chat responses.
        }
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
