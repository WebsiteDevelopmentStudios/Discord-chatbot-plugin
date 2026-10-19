import test from "node:test";
import assert from "node:assert/strict";
import { retrieveKnowledge } from "../src/knowledge.js";

test("retrieves the API reference for a direct API question", () => {
  const result = retrieveKnowledge("what is an API?");
  assert.ok(result, "expected a relevant reference article");
  assert.match(result.text, /application programming interface/i);
});

test("retrieves the sky explanation for a natural-language question", () => {
  const result = retrieveKnowledge("why is the sky blue?");
  assert.ok(result, "expected a relevant reference article");
  assert.match(result.text, /Rayleigh scattering/i);
});

test("keeps typo-tolerant query normalization in the retrieval path", () => {
  const result = retrieveKnowledge("waht is an API");
  assert.ok(result, "expected a relevant reference article after correcting a common typo");
  assert.match(result.text, /application programming interface/i);
});
