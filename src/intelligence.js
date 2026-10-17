import { retrieveKnowledge } from "./knowledge.js";
import { normalizeForUnderstanding } from "./language.js";

const conversations = new Map();
const MAX_CONVERSATIONS = 10_000;
const MAX_HISTORY = 12;
const STOP_WORDS = new Set(["the","a","an","is","are","was","were","to","of","and","or","in","on","for","it","this","that","i","you","me","my","your","we","do","does","what","how","why","when","where","who","can","could","would","should","please","tell","about"]);

function tokens(text) {
  return String(text).toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}
function usefulTokens(text) {
  return tokens(text).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}
function overlapScore(a, b) {
  const aa = new Set(usefulTokens(a)), bb = new Set(usefulTokens(b));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common++;
  return common / new Set([...aa, ...bb]).size;
}
function normalize(text) {
  return String(text).trim().replace(/[.!?]+$/g, "").toLowerCase();
}
function getConversation(id) {
  if (!conversations.has(id)) {
    if (conversations.size >= MAX_CONVERSATIONS) {
      const oldest = conversations.keys().next().value;
      if (oldest !== undefined) conversations.delete(oldest);
    }
    conversations.set(id, { history: [], facts: {}, turns: 0 });
  }
  return conversations.get(id);
}
function cleanFact(value) {
  return value.trim().replace(/[,.!?]+$/g, "").replace(/\s+/g, " ").slice(0, 160);
}
function rememberFact(text, state) {
  const patterns = [
    { regex: /\bmy name is ([\p{L}\p{N}_ -]{1,60})/iu, key: "name", label: "your name" },
    { regex: /\bcall me ([\p{L}\p{N}_ -]{1,60})/iu, key: "name", label: "your name" },
    { regex: /\bi live in ([^.!?\n]{1,100})/iu, key: "location", label: "where you live" },
    { regex: /\bi am from ([^.!?\n]{1,100})/iu, key: "location", label: "where you're from" },
    { regex: /\bi like ([^.!?\n]{1,120})/iu, key: "likes", label: "something you like" },
    { regex: /\bi love ([^.!?\n]{1,120})/iu, key: "likes", label: "something you love" },
    { regex: /\bi dislike ([^.!?\n]{1,120})/iu, key: "dislikes", label: "something you dislike" },
    { regex: /\bi hate ([^.!?\n]{1,120})/iu, key: "dislikes", label: "something you dislike" },
    { regex: /\bi work as (?:a |an )?([^.!?\n]{1,100})/iu, key: "job", label: "your job" },
    { regex: /\bi am learning ([^.!?\n]{1,100})/iu, key: "learning", label: "what you're learning" }
  ];
  for (const p of patterns) {
    const m = text.match(p.regex);
    if (!m) continue;
    const value = cleanFact(m[1]);
    if (!value) continue;
    state.facts[p.key] = value;
    return { key: p.key, value, label: p.label };
  }
  return null;
}

// A small recursive-descent calculator. It intentionally supports arithmetic only,
// and never evaluates user text as JavaScript.
function calculate(text) {
  let expression = normalizeForUnderstanding(text).trim()
    .replace(/^(?:what is|calculate|compute|solve|work out)\s+/i, "")
    .replace(/[×✕]/g, "*").replace(/[÷]/g, "/").replace(/−/g, "-")
    .replace(/\bplus\b/gi, "+").replace(/\bminus\b/gi, "-")
    .replace(/\btimes\b/gi, "*").replace(/\bmultiplied by\b/gi, "*")
    .replace(/\bdivided by\b/gi, "/");
  if (!expression || expression.length > 100 || !/^[\d\s()+\-*/%.^]+$/.test(expression)) return null;
  const parts = expression.match(/\d+(?:\.\d+)?|[()+\-*/%.^]/g);
  if (!parts || parts.join("") !== expression.replace(/\s/g, "")) return null;
  let i = 0;
  function primary() {
    if (parts[i] === "+") { i++; return primary(); }
    if (parts[i] === "-") { i++; return -primary(); }
    if (parts[i] === "(") {
      i++; const n = addSub();
      if (parts[i] !== ")") throw new Error("paren");
      i++; return n;
    }
    const token = parts[i++];
    if (!token || !/^\d/.test(token)) throw new Error("number");
    return Number(token);
  }
  function power() {
    let n = primary();
    if (parts[i] === "^") { i++; n = n ** power(); }
    return n;
  }
  function mulDiv() {
    let n = power();
    while (["*","/","%"].includes(parts[i])) {
      const op = parts[i++], b = power();
      if ((op === "/" || op === "%") && b === 0) throw new Error("zero");
      n = op === "*" ? n * b : op === "/" ? n / b : n % b;
    }
    return n;
  }
  function addSub() {
    let n = mulDiv();
    while (parts[i] === "+" || parts[i] === "-") {
      const op = parts[i++], b = mulDiv();
      n = op === "+" ? n + b : n - b;
    }
    return n;
  }
  try {
    const result = addSub();
    if (i !== parts.length || !Number.isFinite(result) || Math.abs(result) > 1e100) return null;
    return { result: Number(result.toPrecision(12)), expression };
  } catch (error) {
    if (error.message === "zero") return { error: "Division or remainder by zero is undefined." };
    return null;
  }
}
function bestHistoryMatch(question, history) {
  let best = null, score = 0;
  for (const entry of history) {
    if (entry.role !== "user") continue;
    const next = overlapScore(question, entry.content);
    if (next > score) { best = entry.content; score = next; }
  }
  return score >= 0.22 ? best : null;
}
function answerFromNotes(text, state) {
  const note = [...(Array.isArray(state.facts.notes) ? state.facts.notes : [])].reverse()
    .find((item) => overlapScore(text, item) >= 0.18);
  return note || null;
}
function knowledgeAnswer(text) {
  const result = retrieveKnowledge(text);
  return result?.text ?? null;
}
function respond(text, state) {
  const clean = text.trim(), normalized = normalizeForUnderstanding(normalize(clean)), lower = normalizeForUnderstanding(clean);
  const math = calculate(clean);
  if (math?.error) return { text: math.error, intent: "math", confidence: 0.99 };
  if (math) return { text: `The answer is ${math.result}.`, intent: "math", confidence: 0.99 };

  if (/^(hi|hello|hey|yo|sup|hiya|howdy|good morning|good afternoon|good evening|what's up|whats up|what is up)\b/i.test(normalized)) {
    const name = state.facts.name ? `, ${state.facts.name}` : "";
    return { text: [`Hey${name}! What would you like to talk about?`, `Hello${name}! What's on your mind?`, `Hi${name}! How can I help?`][state.turns % 3], intent: "greeting", confidence: 0.96 };
  }
  if (/\b(who are you|what are you|your name|are you (?:an? )?(?:ai|bot|human))\b/i.test(lower)) {
    return { text: "I'm Zoi Intelligence, an independently built local conversational engine. I use deterministic code, arithmetic, bundled knowledge retrieval, and conversation memory. I do not call hosted AI models or external model APIs. My general knowledge and language generation are still limited, and my small trained neural networks are not yet integrated into this live response path.", intent: "identity", confidence: 0.99 };
  }
  if (/\b(how are you|how's it going|how are things|how have you been|how is it going)\b/i.test(lower)) {
    return { text: "I'm up and running, ready to help! I don't have feelings or personal experiences, but I can chat and work through questions with you. How are you doing?", intent: "small_talk", confidence: 0.94 };
  }
  if (/\b(thank you|thanks|thx|ty|appreciate it)\b/i.test(lower)) {
    return { text: ["You're welcome!", "No problem — glad to help.", "Anytime!"][state.turns % 3], intent: "thanks", confidence: 0.98 };
  }
  if (/\b(sorry|my apologies|i apologize)\b/i.test(lower)) {
    return { text: "No worries. We can take it one step at a time.", intent: "empathy", confidence: 0.91 };
  }
  if (/\b(i feel|i'm feeling|i am feeling|i am sad|i'm sad|i am stressed|i'm stressed|i had a bad day|rough day)\b/i.test(lower)) {
    return { text: "I'm sorry it's feeling that way. If you want to talk about it, I'm here to listen. What has been the hardest part?", intent: "empathy", confidence: 0.78 };
  }
  if (/\b(what is your purpose|what can you do|your capabilities|help me|^help$)\b/i.test(lower)) {
    return { text: "I can chat, remember details during this conversation, recall earlier messages, calculate arithmetic, and search my built-in reference knowledge. Without an external language model or live web access, I may not know every answer, but I will use relevant information I have, explain what I can, and be clear about uncertainty rather than invent facts.", intent: "capabilities", confidence: 0.98 };
  }
  if (/\b(what is my name|what's my name|do you know my name|remember my name)\b/i.test(lower)) {
    return state.facts.name
      ? { text: `You told me your name is ${state.facts.name}.`, intent: "memory_recall", confidence: 0.99 }
      : { text: "You haven't told me your name in this conversation yet. You can say “my name is …” and I'll remember it for this conversation.", intent: "memory_recall", confidence: 0.96 };
  }
  if (/\b(where do i live|where am i from|what is my location)\b/i.test(lower)) {
    return state.facts.location ? { text: `You told me ${state.facts.location}.`, intent: "memory_recall", confidence: 0.98 } : { text: "I don't know your location yet. If you want, tell me where you're from and I'll remember it during this conversation.", intent: "memory_recall", confidence: 0.93 };
  }
  if (/\b(what do i like|what are my interests|what do i love)\b/i.test(lower)) {
    return state.facts.likes ? { text: `You told me you like ${state.facts.likes}.`, intent: "memory_recall", confidence: 0.98 } : { text: "I haven't learned your interests yet. Tell me something you like and I'll remember it during this conversation.", intent: "memory_recall", confidence: 0.93 };
  }
  if (/\b(what do i dislike|what do i hate)\b/i.test(lower)) {
    return state.facts.dislikes ? { text: `You told me you dislike ${state.facts.dislikes}.`, intent: "memory_recall", confidence: 0.98 } : { text: "You haven't told me what you dislike yet.", intent: "memory_recall", confidence: 0.92 };
  }
  if (/\b(what is my job|what do i do for work|what am i learning)\b/i.test(lower)) {
    const key = /learning/.test(lower) ? "learning" : "job";
    return state.facts[key] ? { text: key === "job" ? `You told me you work as ${state.facts[key]}.` : `You told me you're learning ${state.facts[key]}.`, intent: "memory_recall", confidence: 0.97 } : { text: key === "job" ? "You haven't told me your job yet." : "You haven't told me what you're learning yet.", intent: "memory_recall", confidence: 0.9 };
  }
  if (/\b(what did i say|what were we talking about|remind me what i said|what was my last message)\b/i.test(lower)) {
    const previous = [...state.history].reverse().find((entry) => entry.role === "user" && entry.content !== clean);
    return previous ? { text: `Earlier, you said: “${previous.content.slice(0, 500)}”`, intent: "history_recall", confidence: 0.96 } : { text: "This is the first message I've recorded in this conversation, so there's no earlier message to recall yet.", intent: "history_recall", confidence: 0.9 };
  }
  if (/\b(remember that|please remember|keep in mind)\b/i.test(lower)) {
    const fact = clean.replace(/^.*?\b(?:remember that|please remember|keep in mind)\b\s*/i, "").trim();
    if (fact) {
      state.facts.notes = [...(Array.isArray(state.facts.notes) ? state.facts.notes : []), fact.slice(0, 300)].slice(-20);
      return { text: `Got it — I'll keep this in mind for this conversation: “${fact.slice(0, 250)}”`, intent: "memory_store", confidence: 0.94 };
    }
  }
  const fact = rememberFact(clean, state);
  if (fact) return { text: `Got it — I'll remember ${fact.label}: ${fact.value} during this conversation.`, intent: "memory_store", confidence: 0.96 };

  const noted = answerFromNotes(clean, state);
  if (noted && /\b(what|which|remind|remember|tell me)\b/i.test(lower)) return { text: `You asked me to remember: “${noted}”.`, intent: "memory_recall", confidence: 0.83 };

  const known = knowledgeAnswer(clean);
  if (known) {
    return { text: known, intent: "built_in_knowledge", confidence: 0.79 };
  }
  if (/\b(yes|yeah|yep|no|nope|okay|ok|sure|maybe|i think so|not really)\b/i.test(normalized)) {
    const previous = [...state.history].reverse().find((entry) => entry.role === "assistant");
    if (previous) return { text: "Got it. Could you tell me a little more about what you mean, so I don't assume the wrong thing?", intent: "contextual_reply", confidence: 0.55 };
  }

  const related = bestHistoryMatch(clean, state.history);
  // Require an actual conversational reference before reusing an earlier topic.
  // Similar vocabulary by itself is not enough: a repeated or new question may
  // share words with history without being a follow-up.
  const explicitFollowUp = /^(?:and|also|but|so|then|what about|how about|tell me more|go on|continue|expand on|why is that|how so|what do you mean|can you elaborate|elaborate on)\b/i.test(normalized)
    || /\b(that|those|these|it|they|them|the same|the previous|the above)\b/i.test(normalized);
  if (/^(why|how|what|when|where|who|which|can|could|would|should|is|are|do|does|did|explain|describe|tell me|and then|what about|how about)\b/i.test(normalized)) {
    if (explicitFollowUp && related && overlapScore(clean, related) > 0.12) {
      return { text: `This sounds like a follow-up to what you said earlier: “${related.slice(0, 220)}”. What specific part should I focus on?`, intent: "contextual_question", confidence: 0.58 };
    }
    return { text: "I don't have enough built-in information to answer that confidently yet. I can still try to help if you share the relevant context or narrow down what you want to know.", intent: "unknown_question", confidence: 0.3 };
  }
  if (explicitFollowUp && related && overlapScore(clean, related) > 0.12) {
    return { text: `This sounds connected to what you said earlier: “${related.slice(0, 180)}”. Which part would you like to continue with?`, intent: "contextual_chat", confidence: 0.53 };
  }

  if (/\b(bored|just chatting|talk to me|let's talk|lets talk)\b/i.test(lower)) {
    return { text: "Sure, we can just chat. What's something you've been interested in lately, or would you rather hear a random question?", intent: "small_talk", confidence: 0.72 };
  }
  // A single-word message often lacks enough context to infer the user's intent.
  // Ask a neutral clarifying question instead of assuming a topic or using a generic fallback.
  const messageWords = tokens(normalized);
  if (messageWords.length === 1 && messageWords[0].length >= 2) {
    return {
      text: `What would you like to know or talk about regarding “${clean.slice(0, 100)}”?`,
      intent: "ambiguous_input",
      confidence: 0.52
    };
  }
  return { text: "I'm listening. I can follow basic conversation and use details from this chat, though my general knowledge is still limited. Tell me a bit more about what you're thinking, and I'll do my best.", intent: "general_chat", confidence: 0.4 };
}

export function generateReply({ message, conversationId = "default", history = [] }) {
  const id = String(conversationId).slice(0, 160);
  const state = getConversation(id);
  if (Array.isArray(history)) {
    for (const item of history.slice(-MAX_HISTORY)) {
      if (item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string") {
        const entry = { role: item.role, content: item.content.slice(0, 1000) };
        const last = state.history.at(-1);
        if (!last || last.role !== entry.role || last.content !== entry.content) state.history.push(entry);
      }
    }
    state.history = state.history.slice(-MAX_HISTORY);
  }
  const result = respond(String(message), state);
  state.history.push({ role: "user", content: String(message).slice(0, 1000) });
  state.history.push({ role: "assistant", content: result.text });
  state.history = state.history.slice(-MAX_HISTORY);
  state.turns += 1;
  return {
    id: `reply_${Date.now().toString(36)}`,
    object: "chat.completion",
    model: "zoi-intelligence-0.4",
    choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
    intent: result.intent,
    confidence: result.confidence,
    conversationId: id
  };
}
// Zoi runs entirely on its own local code and bundled knowledge. Deliberately
// do not call hosted or OpenAI-compatible model providers, even if old provider
// environment variables remain configured on the host.
async function searchLearnedKnowledge(message) {
  const base = (process.env.ZOI_LEARNING_URL || "").replace(/\\/$/, "");
  const token = process.env.ZOI_LEARNING_TOKEN || "";
  if (!base || !token) return null;
  try {
    const url = `${base}/v1/knowledge/search?q=${encodeURIComponent(String(message).slice(0, 1000))}`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1200)
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.match && typeof data.match.answer === "string" ? data.match : null;
  } catch {
    return null;
  }
}

export async function generateReplyAsync({ message, conversationId = "default", history = [] }) {
  const reply = generateReply({ message, conversationId, history });
  // Approved corrections are consulted only when the local engine cannot answer.
  // The learning store contains curated corrections, not a hosted language model.
  if (reply.intent === "unknown_question" || reply.intent === "general_chat") {
    const learned = await searchLearnedKnowledge(message);
    if (learned) {
      reply.choices[0].message.content = learned.answer;
      reply.intent = "learned_knowledge";
      reply.confidence = Math.min(0.92, 0.58 + learned.score * 0.3);
      reply.learnedKnowledgeId = learned.id;
    }
  }
  return {
    ...reply,
    engine: "local",
    providerStatus: {
      configured: false,
      provider: "local",
      reason: "External model providers are disabled; responses use Zoi's local engine."
    }
  };
}

export function resetConversation(conversationId = "default") {
  return conversations.delete(String(conversationId).slice(0, 160));
}
