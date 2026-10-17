import test from "node:test";
import assert from "node:assert/strict";
import { generateReply, generateReplyAsync, resetConversation } from "../src/intelligence.js";

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

test("supports arithmetic precedence, parentheses and natural operators", () => {
  assert.match(generateReply({message:"calculate (12 + 8) times 3",conversationId:"math-extra"}).choices[0].message.content, /60/);
  assert.match(generateReply({message:"what is 2^5",conversationId:"math-power"}).choices[0].message.content, /32/);
});

test("remembers a name in the same conversation", () => {
  const id = "memory-test";
  generateReply({ message: "my name is Alex", conversationId: id });
  const result = generateReply({ message: "what is my name?", conversationId: id });
  assert.match(result.choices[0].message.content, /Alex/);
  assert.equal(result.intent, "memory_recall");
  resetConversation(id);
});

test("remembers interests and can recall them", () => {
  const id = "likes-test";
  generateReply({message:"I like Minecraft",conversationId:id});
  const reply = generateReply({message:"what do I like?",conversationId:id});
  assert.match(reply.choices[0].message.content,/Minecraft/);
  resetConversation(id);
});

test("explains common API concepts from built-in knowledge", () => {
  const result = generateReply({message:"What is an API?",conversationId:"knowledge-api"});
  assert.match(result.choices[0].message.content,/software to communicate|software/i);
  assert.equal(result.intent,"built_in_knowledge");
});

test("uses an empathetic response for emotional language", () => {
  const result = generateReply({message:"I'm feeling sad today",conversationId:"empathy-test"});
  assert.equal(result.intent,"empathy");
  assert.match(result.choices[0].message.content,/sorry|listen/i);
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

test("retrieves relevant built-in knowledge across more topics", () => {
  const cases = [
    ["How does DNS work?", /domain names|DNS/i],
    ["What is a merge conflict?", /Git merge conflict|conflict/i],
    ["How do I protect an API key?", /credential|secret|key/i],
    ["What is a large language model?", /LLM|language model|neural network/i],
    ["What does HTTP 401 mean?", /401|authentication/i],
    ["What is photosynthesis?", /light energy|carbon dioxide/i]
  ];
  for (const [message, expected] of cases) {
    const result = generateReply({ message, conversationId: `retrieval-${message}` });
    assert.match(result.choices[0].message.content, expected, message);
    assert.equal(result.intent, "built_in_knowledge", message);
  }
});

test("does not confuse the letters AI inside unrelated words with artificial intelligence", () => {
  const result = generateReply({ message: "What is said in this sentence?", conversationId: "ai-boundary-test" });
  assert.doesNotMatch(result.choices[0].message.content, /Artificial intelligence is a broad field/i);
});

test("can retrieve an explanation of AI when asked directly", () => {
  const result = generateReply({ message: "What is AI?", conversationId: "ai-direct-test" });
  assert.match(result.choices[0].message.content, /Artificial intelligence/i);
  assert.equal(result.intent, "built_in_knowledge");
});

test("uses a configured model for open-ended questions and reports the selected engine", async () => {
  let requestedUrl = "";
  const result = await generateReplyAsync({
    message: "Compare two approaches to learning a new programming language",
    conversationId: "hybrid-model-test",
    providerEnv: {
      ZOI_MODEL_MODE: "auto",
      ZOI_MODEL_PROVIDER: "openai-compatible",
      ZOI_MODEL_BASE_URL: "https://models.example.test/v1",
      ZOI_MODEL_NAME: "test-model"
    },
    fetchImpl: async (url) => {
      requestedUrl = url;
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Build small projects, then review the concepts you used." } }] }) };
    }
  });
  assert.equal(requestedUrl, "https://models.example.test/v1/chat/completions");
  assert.equal(result.engine, "openai-compatible");
  assert.equal(result.intent, "model_response");
  assert.equal(result.choices[0].message.content, "Build small projects, then review the concepts you used.");
  assert.equal(result.confidence, null);
});

test("keeps deterministic arithmetic local even when a model is configured", async () => {
  let called = false;
  const result = await generateReplyAsync({
    message: "what is 9 * 9",
    conversationId: "hybrid-math-test",
    providerEnv: {
      ZOI_MODEL_MODE: "auto",
      ZOI_MODEL_PROVIDER: "openai-compatible",
      ZOI_MODEL_BASE_URL: "https://models.example.test/v1",
      ZOI_MODEL_NAME: "test-model"
    },
    fetchImpl: async () => { called = true; throw new Error("model must not be called for arithmetic"); }
  });
  assert.equal(called, false);
  assert.equal(result.engine, "rules");
  assert.equal(result.intent, "math");
  assert.match(result.choices[0].message.content, /81/);
});

test("answers a repeated cat-name request instead of treating it as topic continuation", () => {
  const id = "cat-name-repeat";
  const first = generateReply({ message: "well i need a new cat anme - me", conversationId: id });
  const second = generateReply({ message: "i need a new cat name - me", conversationId: id });
  assert.equal(first.intent, "recommendation");
  assert.equal(second.intent, "recommendation");
  assert.match(second.choices[0].message.content, /Luna|Mochi|Milo/i);
  assert.doesNotMatch(second.choices[0].message.content, /continuing the topic/i);
  resetConversation(id);
});

test("answers a supported question with a common typo", () => {
  const result = generateReply({ message: "waht is photosythesis?", conversationId: "typo-photosynthesis" });
  assert.match(result.choices[0].message.content, /light energy|carbon dioxide/i);
  assert.equal(result.intent, "built_in_knowledge");
});

test("understands casual phrasing for a known technical topic", () => {
  const result = generateReply({ message: "pls explain how do i protect an api key", conversationId: "casual-api-key" });
  assert.match(result.choices[0].message.content, /credential|secret|authorization/i);
  assert.equal(result.intent, "built_in_knowledge");
});

test("calculates arithmetic even when the question contains a common typo", () => {
  const result = generateReply({ message: "waht is 9 * 9", conversationId: "typo-math" });
  assert.match(result.choices[0].message.content, /81/);
  assert.equal(result.intent, "math");
});

test("retrieves expanded offline knowledge about computer memory", () => {
  const result = generateReply({ message: "whats the diffrence between ram and storage", conversationId: "ram-storage-typo" });
  assert.match(result.choices[0].message.content, /temporary working memory|SSD|storage/i);
  assert.equal(result.intent, "built_in_knowledge");
});
