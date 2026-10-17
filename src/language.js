// Lightweight language normalization for the no-model fallback.
// This is typo tolerance and synonym expansion, not a trained language model.
const COMMON_CORRECTIONS = new Map(Object.entries({
  teh: "the", waht: "what", wahts: "what is", whta: "what", wat: "what", wht: "what",
  hwo: "how", hw: "how", wher: "where", wen: "when", wich: "which",
  becuase: "because", becasue: "because", recieve: "receive", recieveing: "receiving",
  seperate: "separate", definately: "definitely", occurrance: "occurrence",
  thier: "their", dont: "do not", doesnt: "does not", didnt: "did not",
  cant: "cannot", couldnt: "could not", wouldnt: "would not", shouldnt: "should not",
  isnt: "is not", arent: "are not", wasnt: "was not", werent: "were not",
  whats: "what is", whos: "who is", hows: "how is", its: "it is",
  pls: "please", plz: "please", thx: "thanks", thanx: "thanks",
  explaination: "explanation", explan: "explain", defin: "define",
  sumarize: "summarize", sumary: "summary", langauge: "language",
  inteligence: "intelligence", inteligent: "intelligent", knowlege: "knowledge",
  queston: "question", qustion: "question", answr: "answer", awnser: "answer",
  programmng: "programming", progamming: "programming", javscript: "javascript",
  pythn: "python", disord: "discord", mesage: "message", understaand: "understand",
  understnad: "understand", relevent: "relevant", relevence: "relevance",
  diffrence: "difference", diference: "difference", enviroment: "environment",
  enviornment: "environment", autentification: "authentication", authentification: "authentication",
  reccomend: "recommend", recomend: "recommend", availble: "available",
  becuase: "because", probly: "probably", basicly: "basically"
}));

const SYNONYMS = [
  [/\b(err|error|issue|problem|bug|broken|not working)\b/gu, " error "],
  [/\b(typo|typos|mistype|mistyped|misspelling|misspelled)\b/gu, " spelling "],
  [/\b(learn|learning|understand|understanding|figure out)\b/gu, " explain "],
  [/\b(give me|tell me|show me|help me with)\b/gu, " explain "],
  [/\b(whats|what's)\b/gu, " what is "],
  [/\b(how do i|how can i|how to)\b/gu, " how "],
  [/\b(meaning of|define|definition of)\b/gu, " meaning "],
  [/\b(difference between|compare|versus|vs\.? )\b/gu, " compare "]
];

export function normalizeForUnderstanding(input) {
  let text = String(input ?? "").toLowerCase().normalize("NFKC");
  text = text.replace(/[’‘]/g, "'").replace(/\b([a-z]+)'(?:re|ve|ll|d|m|s)\b/gu, (full, stem) => {
    const suffix = full.slice(stem.length + 1);
    const expansions = { re: " are", ve: " have", ll: " will", d: " would", m: " am", s: " is" };
    return stem + (expansions[suffix] || "");
  });
  text = text.replace(/\bdon't\b/gu, "do not").replace(/\bdoesn't\b/gu, "does not").replace(/\bdidn't\b/gu, "did not").replace(/\bcan't\b/gu, "cannot").replace(/\bwon't\b/gu, "will not").replace(/\bisn't\b/gu, "is not").replace(/\baren't\b/gu, "are not");
  text = text.replace(/[^\p{L}\p{N}' +*/%^().-]+/gu, " ");
  text = text.replace(/\b[a-z]+\b/gu, (word) => COMMON_CORRECTIONS.get(word) || word);
  for (const [pattern, replacement] of SYNONYMS) text = text.replace(pattern, replacement);
  return text.replace(/\s+/g, " ").trim();
}

export function editDistance(a, b, limit = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      // Handle common adjacent-key transpositions such as "teh" -> "the".
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (previous[j - 2] ?? limit + 1) + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

export function fuzzyTermMatch(queryTerm, candidateTerms) {
  if (candidateTerms.has(queryTerm)) return true;
  if (queryTerm.length < 4) return false;
  const limit = queryTerm.length >= 8 ? 2 : 1;
  for (const candidate of candidateTerms) {
    if (candidate.length < 4 || Math.abs(candidate.length - queryTerm.length) > limit) continue;
    if (editDistance(queryTerm, candidate, limit) <= limit) return true;
  }
  return false;
}
