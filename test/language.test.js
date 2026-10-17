import test from "node:test";
import assert from "node:assert/strict";
import { normalizeForUnderstanding, editDistance, fuzzyTermMatch } from "../src/language.js";

test("normalizes common typos, contractions, and casual wording", () => {
  assert.equal(normalizeForUnderstanding("wahts teh diffrence between APIs?"), "what is the compare apis");
  assert.match(normalizeForUnderstanding("pls explan how javscript works"), /please explain how javascript works/);
  assert.equal(normalizeForUnderstanding("I don't know whats happening"), "i do not know what is happening");
});

test("matches small spelling errors without fuzzy-matching very short words", () => {
  assert.equal(editDistance("photosythesis", "photosynthesis", 2), 1);
  assert.equal(fuzzyTermMatch("photosythesis", new Set(["photosynthesis"])), true);
  assert.equal(fuzzyTermMatch("ai", new Set(["api"])), false);
});

