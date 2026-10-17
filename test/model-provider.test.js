import test from "node:test";
import assert from "node:assert/strict";
import { completeWithModel, getModelStatus } from "../src/model-provider.js";

const baseEnv = {
  ZOI_MODEL_MODE: "auto",
  ZOI_MODEL_PROVIDER: "openai-compatible",
  ZOI_MODEL_BASE_URL: "https://models.example.test/v1",
  ZOI_MODEL_NAME: "example-model",
  ZOI_MODEL_API_KEY: "test-secret"
};

test("calls an OpenAI-compatible model with conversation context and keeps credentials in headers", async () => {
  let captured;
  const answer = await completeWithModel({
    message: "Explain this more simply",
    history: [{ role: "user", content: "What is DNS?" }, { role: "assistant", content: "DNS maps names." }],
    knowledge: "DNS translates domain names into records.",
    env: baseEnv,
    fetchImpl: async (url, options) => {
      captured = { url, options, payload: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: "DNS is like the internet's address book." } }] }) };
    }
  });
  assert.equal(answer, "DNS is like the internet's address book.");
  assert.equal(captured.url, "https://models.example.test/v1/chat/completions");
  assert.equal(captured.options.headers.authorization, "Bearer test-secret");
  assert.equal(captured.payload.model, "example-model");
  assert.equal(captured.payload.messages.at(-1).content, "Explain this more simply");
  assert.match(captured.payload.messages[0].content, /built-in reference/);
  assert.equal(captured.payload.stream, false);
});

test("supports Ollama's native chat endpoint without an API key", async () => {
  let captured;
  const answer = await completeWithModel({
    message: "Hello",
    env: { ZOI_MODEL_PROVIDER: "ollama", ZOI_MODEL_BASE_URL: "http://localhost:11434", ZOI_MODEL_NAME: "qwen2.5:3b" },
    fetchImpl: async (url, options) => {
      captured = { url, options, payload: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ message: { content: "Hi there." } }) };
    }
  });
  assert.equal(answer, "Hi there.");
  assert.equal(captured.url, "http://localhost:11434/api/chat");
  assert.equal(captured.payload.model, "qwen2.5:3b");
  assert.equal(captured.options.headers.authorization, undefined);
});

test("falls back cleanly when the provider is missing or unavailable", async () => {
  assert.equal(await completeWithModel({ message: "hi", env: {} }), null);
  const result = await completeWithModel({
    message: "hi",
    env: baseEnv,
    fetchImpl: async () => ({ ok: false, status: 503 })
  });
  assert.equal(result, null);
});

test("rejects insecure non-local model endpoints and never exposes the API key in status", () => {
  const status = getModelStatus({
    ZOI_MODEL_BASE_URL: "http://remote.example.test/v1",
    ZOI_MODEL_NAME: "example-model",
    ZOI_MODEL_API_KEY: "never-show-this"
  });
  assert.equal(status.configured, false);
  assert.equal(JSON.stringify(status).includes("never-show-this"), false);
});

test("rules-only mode disables model calls even when configured", async () => {
  let called = false;
  const result = await completeWithModel({
    message: "hello",
    env: { ...baseEnv, ZOI_MODEL_MODE: "rules" },
    fetchImpl: async () => { called = true; throw new Error("should not be called"); }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});
