import test from "node:test";
import assert from "node:assert/strict";
import { generateReply, resetConversation } from "../src/intelligence.js";

test("answers greetings without an external model", () => {
  const result = generateReply({ message: "hello", conversationId: "greeting-test" });
  assert.equal(result.object, "chat.completion");
  assert.match(result.choices[0].message.content, /hello|hey|hi/i);
  assert.equal(result.intent, "greeting");
});

test("performs basic arithmetic", () => {
  const result = generateReply({ message: "what is 12 * 7", conversationId: "math-test" });
  assert.match(result.choices[0].message.content, /84/);
  assert.equal(result.intent, "math");
});

test("remembers a name in the same conversation", () => {
  const id = "memory-test";
  generateReply({ message: "my name is Alex", conversationId: id });
  const result = generateReply({ message: "what is my name?", conversationId: id });
  assert.match(result.choices[0].message.content, /Alex/);
  assert.equal(result.intent, "memory_recall");
  resetConversation(id);
});

test("does not pretend to know unsupported facts", () => {
  const result = generateReply({ message: "Who invented a fictional device called the glorpulator?", conversationId: "unknown-test" });
  assert.match(result.choices[0].message.content, /limited|context|detail/i);
  assert.ok(result.confidence < 0.5);
});

test("can reset conversation state", () => {
  const id = "reset-test";
  generateReply({ message: "my name is Taylor", conversationId: id });
  assert.equal(resetConversation(id), true);
  const result = generateReply({ message: "what is my name?", conversationId: id });
  assert.match(result.choices[0].message.content, /haven't told|don't know/i);
});
