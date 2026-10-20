import { createHash, randomBytes } from "node:crypto";
import {
  consumeExchangeCode, consumeOAuthState, createExchangeCode, createOAuthState,
  createSession, deleteSession, getSession, loadKeys, saveKeys
} from "./database.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXCHANGE_TTL_MS = 2 * 60 * 1000;
const hashKey = (key) => createHash("sha256").update(key).digest("hex");

function bearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}
function sessionUser(req) {
  return getSession(bearer(req));
}
function redirect(res, location) {
  res.writeHead(302, { location, "cache-control": "no-store", "referrer-policy": "no-referrer" });
  res.end();
}
function webOrigin() {
  const value = (process.env.WEB_ORIGIN || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash) return "";
    return parsed.origin;
  } catch { return ""; }
}
function oauthConfig() {
  const clientId = (process.env.DISCORD_CLIENT_ID || "").trim();
  const clientSecret = (process.env.DISCORD_CLIENT_SECRET || "").trim();
  const redirectUri = (process.env.DISCORD_REDIRECT_URI || "").trim();
  const origin = webOrigin();
  if (!clientId || !clientSecret || !redirectUri || !origin) return null;
  try {
    const redirectUrl = new URL(redirectUri);
    if (redirectUrl.protocol !== "https:" && redirectUrl.hostname !== "localhost") return null;
    return { clientId, clientSecret, redirectUri, origin };
  } catch { return null; }
}

export async function handleDashboardRequest(req, res, url, { send, readJson, allowKeyCreation }) {
  const path = url.pathname;

  if (req.method === "GET" && path === "/auth/discord") {
    const config = oauthConfig();
    if (!config) return send(res, 503, { error: "oauth_not_configured", message: "Discord OAuth is not configured on the bot host yet." }), true;
    const state = randomBytes(32).toString("base64url");
    createOAuthState(state, Date.now() + 10 * 60 * 1000);
    const authorize = new URL("https://discord.com/oauth2/authorize");
    authorize.search = new URLSearchParams({
      client_id: config.clientId, redirect_uri: config.redirectUri,
      response_type: "code", scope: "identify", state
    }).toString();
    redirect(res, authorize.toString());
    return true;
  }

  if (req.method === "GET" && path === "/auth/discord/callback") {
    const config = oauthConfig();
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    if (!config || !state || !consumeOAuthState(state) || !code) {
      return redirect(res, `${config?.origin || "/"}?oauth_error=discord_login_failed`), true;
    }
    try {
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId, client_secret: config.clientSecret,
          grant_type: "authorization_code", code, redirect_uri: config.redirectUri
        }),
        signal: AbortSignal.timeout(10_000)
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || typeof tokenData.access_token !== "string") throw new Error("OAuth token exchange failed");
      const userResponse = await fetch("https://discord.com/api/users/@me", {
        headers: { authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(10_000)
      });
      const user = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || typeof user.id !== "string" || typeof user.username !== "string") throw new Error("Discord user lookup failed");
      const exchangeCode = randomBytes(32).toString("base64url");
      createExchangeCode(exchangeCode, user, Date.now() + EXCHANGE_TTL_MS);
      return redirect(res, `${config.origin}/?oauth_code=${encodeURIComponent(exchangeCode)}`), true;
    } catch {
      return redirect(res, `${config.origin}/?oauth_error=discord_login_failed`), true;
    }
  }

  if (req.method === "POST" && path === "/auth/exchange") {
    const body = await readJson(req);
    const code = typeof body.code === "string" ? body.code : "";
    if (!code || code.length > 256) return send(res, 400, { error: "invalid_exchange_code" }), true;
    const user = consumeExchangeCode(code);
    if (!user) return send(res, 401, { error: "exchange_code_expired" }), true;
    const token = randomBytes(32).toString("base64url");
    createSession(token, user, Date.now() + SESSION_TTL_MS);
    return send(res, 200, { token, expiresIn: SESSION_TTL_MS / 1000, user }), true;
  }

  if (req.method === "GET" && path === "/auth/me") {
    const user = sessionUser(req);
    return send(res, user ? 200 : 401, user ? { authenticated: true, user } : { error: "not_authenticated" }), true;
  }

  if (req.method === "DELETE" && path === "/auth/session") {
    deleteSession(bearer(req));
    return send(res, 200, { loggedOut: true }), true;
  }

  if (req.method === "POST" && path === "/v1/keys") {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: "dashboard_login_required", message: "Sign in with Discord before creating an API key." }), true;
    if (!allowKeyCreation(req)) return send(res, 429, { error: "key_creation_rate_limited", message: "Maximum 5 key creations per IP per minute." }), true;
    const body = await readJson(req);
    const requestedModel = typeof body.model === "string" ? body.model : "zoi";
    if (!["zoi", "zoi-unfiltered"].includes(requestedModel)) return send(res, 400, { error: "invalid_model", message: "Choose zoi or zoi-unfiltered." }), true;
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "My application";
    const key = "zai_" + randomBytes(32).toString("base64url");
    const keys = loadKeys();
    const record = {
      id: randomBytes(8).toString("hex"), ownerDiscordId: user.id,
      label: label || "My application", model: requestedModel,
      keyHash: hashKey(key), createdAt: new Date().toISOString(), status: "active"
    };
    keys.push(record);
    saveKeys(keys);
    return send(res, 201, {
      key, id: record.id, label: record.label, model: record.model,
      warning: "Copy this key now. It is only shown once. The database stores only its hash."
    }), true;
  }

  if (req.method === "GET" && path === "/dashboard/keys") {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: "dashboard_login_required" }), true;
    const keys = loadKeys().filter((item) => item.ownerDiscordId === user.id || item.owner_discord_id === user.id);
    return send(res, 200, { keys: keys.map(({ id, label, model, createdAt, status }) => ({ id, label, model, createdAt, status })) }), true;
  }

  const revokeMatch = path.match(/^\/dashboard\/keys\/([a-f0-9]+)$/);
  if (req.method === "DELETE" && revokeMatch) {
    const user = sessionUser(req);
    if (!user) return send(res, 401, { error: "dashboard_login_required" }), true;
    const keys = loadKeys();
    const record = keys.find((item) => item.id === revokeMatch[1] && (item.ownerDiscordId === user.id || item.owner_discord_id === user.id));
    if (!record) return send(res, 404, { error: "key_not_found" }), true;
    record.status = "revoked";
    saveKeys(keys);
    return send(res, 200, { revoked: true }), true;
  }

  return false;
}
