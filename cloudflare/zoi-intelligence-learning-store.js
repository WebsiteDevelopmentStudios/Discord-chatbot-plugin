const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const normalize = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => [...new Set(normalize(s).split(" ").filter((w) => w.length > 2 && !["the","and","for","that","this","with","what","when","where","which","who","why","how","are","is","was","were","does","did","can","could","would","should","tell","about","from","have","has","your","you"].includes(w)))];
function similarity(a, b) {
  const aa = new Set(words(a)), bb = new Set(words(b));
  if (!aa.size || !bb.size) return 0;
  let n = 0;
  for (const w of aa) if (bb.has(w)) n++;
  return n / new Set([...aa, ...bb]).size;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      try { await env.DB.prepare("SELECT 1 AS ok").first(); return json({ ok: true, service: "zoi-intelligence-learning", storage: "cloudflare-d1" }); }
      catch { return json({ ok: false, error: "database_unavailable" }, 503); }
    }
    if (!["GET", "POST"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
    const supplied = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!env.LEARNING_API_TOKEN || !supplied || supplied !== env.LEARNING_API_TOKEN) return json({ error: "unauthorized" }, 401);
    try {
      if (request.method === "POST" && url.pathname === "/v1/feedback") {
        const body = await request.json();
        const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
        const original = typeof body.originalAnswer === "string" ? body.originalAnswer.trim().slice(0, 4000) : "";
        const correction = typeof body.correction === "string" ? body.correction.trim().slice(0, 4000) : "";
        const source = typeof body.source === "string" ? body.source.trim().slice(0, 80) : "api";
        if (!question || !correction) return json({ error: "question_and_correction_required" }, 400);
        const duplicate = await env.DB.prepare("SELECT id, status FROM learning_examples WHERE lower(question)=lower(?) AND lower(corrected_answer)=lower(?) AND status IN ('pending','approved') LIMIT 1").bind(question, correction).first();
        if (duplicate) return json({ accepted: true, duplicate: true, id: duplicate.id, status: duplicate.status }, 200);
        const result = await env.DB.prepare("INSERT INTO learning_examples (question, original_answer, corrected_answer, source, status) VALUES (?, ?, ?, ?, 'pending')").bind(question, original, correction, source || "api").run();
        return json({ accepted: true, id: result.meta.last_row_id, status: "pending", message: "Correction saved for review; it is not used as verified knowledge until approved." }, 201);
      }
      if (request.method === "POST" && url.pathname === "/v1/candidates") {
        const body = await request.json();
        const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
        const original = typeof body.originalAnswer === "string" ? body.originalAnswer.trim().slice(0, 4000) : "";
        const source = typeof body.source === "string" ? body.source.trim().slice(0, 80) : "api";
        if (!question) return json({ error: "question_required" }, 400);
        const duplicate = await env.DB.prepare("SELECT id FROM learning_examples WHERE lower(question)=lower(?) AND corrected_answer='' AND status='pending' LIMIT 1").bind(question).first();
        if (duplicate) return json({ accepted: true, duplicate: true, id: duplicate.id, status: "pending" }, 200);
        const result = await env.DB.prepare("INSERT INTO learning_examples (question, original_answer, corrected_answer, source, status) VALUES (?, ?, '', ?, 'pending')").bind(question, original, source || "api").run();
        return json({ accepted: true, id: result.meta.last_row_id, status: "pending", message: "Unanswered question saved for review; no conversation history was stored." }, 201);
      }
      if (request.method === "GET" && url.pathname === "/v1/examples/pending") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
        const result = await env.DB.prepare("SELECT id, question, original_answer AS originalAnswer, corrected_answer AS correction, source, status, created_at AS createdAt FROM learning_examples WHERE status='pending' ORDER BY created_at ASC LIMIT ?").bind(limit).all();
        return json({ examples: result.results || [] });
      }
      const reviewMatch = url.pathname.match(/^\/v1\/examples\/(\d+)\/review$/);
      if (request.method === "POST" && reviewMatch) {
        const body = await request.json();
        const status = body.status;
        const correction = typeof body.correction === "string" ? body.correction.trim().slice(0, 4000) : "";
        if (!["approved", "rejected"].includes(status)) return json({ error: "status_must_be_approved_or_rejected" }, 400);
        const id = Number(reviewMatch[1]);
        const existing = await env.DB.prepare("SELECT id, corrected_answer FROM learning_examples WHERE id=? AND status='pending'").bind(id).first();
        if (!existing) return json({ error: "pending_example_not_found" }, 404);
        if (status === "approved" && !correction && !existing.corrected_answer) return json({ error: "correction_required_for_approval" }, 400);
        const result = await env.DB.prepare("UPDATE learning_examples SET status=?, corrected_answer=CASE WHEN ? <> '' THEN ? ELSE corrected_answer END, reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'").bind(status, correction, correction, id).run();
        if (!result.meta.changes) return json({ error: "pending_example_not_found" }, 404);
        return json({ reviewed: true, id, status });
      }
      if (request.method === "GET" && url.pathname === "/v1/knowledge/search") {
        const query = (url.searchParams.get("q") || "").trim().slice(0, 1000);
        if (!query) return json({ error: "query_required" }, 400);
        const terms = words(query).slice(0, 6);
        if (!terms.length) return json({ match: null });
        const clauses = terms.map(() => "(lower(question) LIKE ? OR lower(corrected_answer) LIKE ?)").join(" OR ");
        const params = terms.flatMap((term) => { const p = "%" + term + "%"; return [p, p]; });
        const found = await env.DB.prepare("SELECT id, question, corrected_answer AS answer, created_at AS createdAt FROM learning_examples WHERE status='approved' AND corrected_answer<>'' AND (" + clauses + ") ORDER BY created_at DESC LIMIT 100").bind(...params).all();
        const ranked = (found.results || []).map((row) => ({ ...row, score: Math.max(similarity(query, row.question), similarity(query, row.answer)) })).sort((a,b) => b.score - a.score);
        const best = ranked[0];
        if (!best || best.score < 0.22) return json({ match: null });
        return json({ match: { id: best.id, question: best.question, answer: best.answer, score: Number(best.score.toFixed(3)) } });
      }
      return json({ error: "not_found" }, 404);
    } catch {
      return json({ error: "internal_error", message: "The learning store could not complete the request." }, 500);
    }
  }
};