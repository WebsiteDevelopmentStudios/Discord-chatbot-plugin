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

test("asks for context when a one-word message is ambiguous", () => {
  const result = generateReply({ message: "gay", conversationId: "ambiguous-one-word" });
  assert.equal(result.intent, "ambiguous_input");
  assert.match(result.choices[0].message.content, /what would you like to know or talk about regarding/i);
  assert.match(result.choices[0].message.content, /gay/i);
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

test("never calls an external model provider, even if legacy provider settings exist", async () => {
  let called = false;
  const result = await generateReplyAsync({
    message: "Compare two approaches to learning a new programming language",
    conversationId: "local-only-engine-test",
    providerEnv: {
      ZOI_MODEL_MODE: "auto",
      ZOI_MODEL_PROVIDER: "openai-compatible",
      ZOI_MODEL_BASE_URL: "https://models.example.test/v1",
      ZOI_MODEL_NAME: "test-model",
      OPENAI_API_KEY: "must-not-be-used"
    },
    fetchImpl: async () => { called = true; throw new Error("external provider must not be called"); }
  });
  assert.equal(called, false);
  assert.equal(result.engine, "local");
  assert.equal(result.providerStatus.configured, false);
  assert.match(result.providerStatus.reason, /disabled/i);
});

test("keeps deterministic arithmetic local", async () => {
  const result = await generateReplyAsync({
    message: "what is 9 * 9",
    conversationId: "local-math-test"
  });
  assert.equal(result.engine, "local");
  assert.equal(result.intent, "math");
  assert.match(result.choices[0].message.content, /81/);
});

test("does not assume a repeated request is a follow-up just because words overlap", () => {
  const id = "repeat-request-general";
  generateReply({ message: "I am planning a project", conversationId: id });
  const result = generateReply({ message: "What is project management?", conversationId: id });
  assert.equal(result.intent, "unknown_question");
  assert.doesNotMatch(result.choices[0].message.content, /connect to what you said earlier/i);
  resetConversation(id);
});

test("only uses conversation history when a follow-up clearly refers to it", () => {
  const id = "explicit-follow-up-general";
  generateReply({ message: "I am learning photography", conversationId: id });
  const result = generateReply({ message: "How does that photography technique work?", conversationId: id });
  assert.equal(result.intent, "contextual_question");
  assert.match(result.choices[0].message.content, /follow-up|earlier/i);
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
