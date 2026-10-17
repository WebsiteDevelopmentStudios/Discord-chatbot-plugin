const conversations = new Map();
const MAX_CONVERSATIONS = 10_000;
const MAX_HISTORY = 12;
const STOP_WORDS = new Set(["the","a","an","is","are","was","were","to","of","and","or","in","on","for","it","this","that","i","you","me","my","your","we","do","does","what","how","why","when","where","who","can","could","would","should"]);

function tokens(text) {
  return String(text).toLowerCase().match(/[a-z0-9']+/g) || [];
}

function usefulTokens(text) {
  return tokens(text).filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function overlapScore(a, b) {
  const aa = new Set(usefulTokens(a));
  const bb = new Set(usefulTokens(b));
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

function rememberFact(text, state) {
  const patterns = [
    { regex: /\bmy name is ([\p{L}\p{N}_ -]{1,60})/iu, key: "name" },
    { regex: /\bcall me ([\p{L}\p{N}_ -]{1,60})/iu, key: "name" },
    { regex: /\bi live in ([\p{L}\p{N}_ ,'-]{1,80})/iu, key: "location" },
    { regex: /\bi like ([^.!?]{1,100})/iu, key: "likes" }
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const value = match[1].trim().replace(/[,.!?]+$/g, "");
      if (value) {
        state.facts[pattern.key] = value;
        return { key: pattern.key, value };
      }
    }
  }
  return null;
}

function answerMath(text) {
  const match = text.match(/(?:what is|calculate|compute)?\s*(-?\d+(?:\.\d+)?)\s*([+*/-])\s*(-?\d+(?:\.\d+)?)/i);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[3]);
  let result;
  switch (match[2]) {
    case "+": result = a + b; break;
    case "-": result = a - b; break;
    case "*": result = a * b; break;
    case "/":
      if (b === 0) return "Division by zero is undefined.";
      result = a / b;
      break;
    default: return null;
  }
  if (!Number.isFinite(result)) return null;
  return `The answer is ${Number(result.toPrecision(12))}.`;
}

function bestHistoryMatch(question, history) {
  let best = null;
  let score = 0;
  for (const entry of history) {
    if (entry.role !== "user") continue;
    const next = overlapScore(question, entry.content);
    if (next > score) { best = entry.content; score = next; }
  }
  return score >= 0.25 ? best : null;
}

function respond(text, state) {
  const clean = text.trim();
  const normalized = normalize(clean);
  const lower = clean.toLowerCase();

  const math = answerMath(clean);
  if (math) return { text: math, intent: "math", confidence: 0.99 };

  if (/^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)\b/i.test(normalized)) {
    const name = state.facts.name ? `, ${state.facts.name}` : "";
    return { text: [`Hey${name}! What would you like to talk about?`, `Hello${name}! What's on your mind?`, `Hi${name}! How can I help?`][state.turns % 3], intent: "greeting", confidence: 0.94 };
  }
  if (/\b(who are you|what are you|your name)\b/i.test(lower)) {
    return { text: "I'm an early, independently built conversational intelligence engine. I use language patterns, conversation context, and simple reasoning rules rather than an external AI model. I'm still learning how to handle more complex questions.", intent: "identity", confidence: 0.98 };
  }
  if (/\b(how are you|how's it going|how are things)\b/i.test(lower)) {
    return { text: "I'm running and ready to chat! I don't have feelings like a person, but I'm happy to help. How are things with you?", intent: "small_talk", confidence: 0.91 };
  }
  if (/\b(thank you|thanks|thx|ty)\b/i.test(lower)) {
    return { text: ["You're welcome!", "No problem — glad to help.", "Anytime!"][state.turns % 3], intent: "thanks", confidence: 0.96 };
  }
  if (/\b(what is your purpose|what can you do|help me|help)\b/i.test(lower)) {
    return { text: "I can chat, remember a few facts within this conversation, answer simple arithmetic, and use recent context to interpret follow-ups. My reasoning and general knowledge are still limited, so I may ask you to clarify when I don't know.", intent: "capabilities", confidence: 0.96 };
  }
  if (/\b(what is my name|what's my name|do you know my name)\b/i.test(lower)) {
    return state.facts.name
      ? { text: `You told me your name is ${state.facts.name}.`, intent: "memory_recall", confidence: 0.98 }
      : { text: "You haven't told me your name in this conversation yet. You can say “my name is …” and I'll remember it for this conversation.", intent: "memory_recall", confidence: 0.95 };
  }
  if (/\b(where do i live|where am i from)\b/i.test(lower)) {
    return state.facts.location
      ? { text: `You told me you live in ${state.facts.location}.`, intent: "memory_recall", confidence: 0.98 }
      : { text: "I don't know where you live yet. If you'd like, tell me and I can remember it for this conversation.", intent: "memory_recall", confidence: 0.9 };
  }
  if (/\b(what do i like|what are my interests)\b/i.test(lower)) {
    return state.facts.likes
      ? { text: `You told me you like ${state.facts.likes}.`, intent: "memory_recall", confidence: 0.98 }
      : { text: "I haven't learned your interests yet. Tell me something you like and I can remember it during this conversation.", intent: "memory_recall", confidence: 0.9 };
  }
  if (/\b(what did i say|what were we talking about|remind me what i said)\b/i.test(lower)) {
    const previous = [...state.history].reverse().find((entry) => entry.role === "user" && entry.content !== clean);
    return previous
      ? { text: `Earlier, you said: “${previous.content.slice(0, 500)}”`, intent: "history_recall", confidence: 0.9 }
      : { text: "This is the first message I've recorded in this conversation, so I don't have an earlier message to recall.", intent: "history_recall", confidence: 0.85 };
  }
  if (/\b(remember that|please remember)\b/i.test(lower)) {
    const fact = clean.replace(/^.*?\b(?:remember that|please remember)\b\s*/i, "").trim();
    if (fact) {
      state.facts.notes = [...(Array.isArray(state.facts.notes) ? state.facts.notes : []), fact].slice(-20);
      return { text: `I'll keep that in mind for this conversation: “${fact.slice(0, 250)}”`, intent: "memory_store", confidence: 0.88 };
    }
  }

  const fact = rememberFact(clean, state);
  if (fact) {
    const labels = { name: "your name", location: "where you live", likes: "something you like" };
    return { text: `Got it — I'll remember ${labels[fact.key]} is ${fact.value} during this conversation.`, intent: "memory_store", confidence: 0.93 };
  }

  if (/^(why|how|what|when|where|who|which|can|could|would|should|is|are|do|does|did)\b/i.test(normalized)) {
    const related = bestHistoryMatch(clean, state.history);
    if (related) {
      return { text: `I think this may connect to what you said earlier: “${related.slice(0, 300)}”. I don't have enough built-in knowledge to answer that reliably yet. Could you give me a little more detail about what you mean?`, intent: "contextual_question", confidence: 0.48 };
    }
    return { text: "I want to give you a useful answer, but my built-in knowledge is limited right now. Could you add a little context or explain what part you'd like me to focus on?", intent: "unknown_question", confidence: 0.28 };
  }

  const previous = state.history.filter((entry) => entry.role === "user").at(-1);
  if (previous && overlapScore(clean, previous.content) > 0.35) {
    return { text: "I see you're continuing the same topic. Could you tell me a bit more about what you want to explore? I'm still developing my ability to understand nuanced conversations.", intent: "contextual_chat", confidence: 0.42 };
  }
  return { text: "I'm listening. Tell me a little more — I can follow basic conversation and remember some details, but my language and reasoning abilities are still under development.", intent: "general_chat", confidence: 0.35 };
}

export function generateReply({ message, conversationId = "default", history = [] }) {
  const id = String(conversationId).slice(0, 160);
  const state = getConversation(id);
  if (Array.isArray(history)) {
    for (const item of history.slice(-MAX_HISTORY)) {
      if (item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string") {
        state.history.push({ role: item.role, content: item.content.slice(0, 1000) });
      }
    }
    state.history = state.history.slice(-MAX_HISTORY);
  }
  const result = respond(message, state);
  state.history.push({ role: "user", content: message.slice(0, 1000) });
  state.history.push({ role: "assistant", content: result.text });
  state.history = state.history.slice(-MAX_HISTORY);
  state.turns += 1;
  return {
    id: `reply_${Date.now().toString(36)}`,
    object: "chat.completion",
    model: "zoi-intelligence-0.1",
    choices: [{ index: 0, message: { role: "assistant", content: result.text }, finish_reason: "stop" }],
    intent: result.intent,
    confidence: result.confidence,
    conversationId: id
  };
}

export function resetConversation(conversationId = "default") {
  return conversations.delete(String(conversationId).slice(0, 160));
}
