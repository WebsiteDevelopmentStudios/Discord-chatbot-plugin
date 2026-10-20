# Bot-Hosting.net setup

This guide configures the Node.js API, Discord OAuth dashboard login, and persistent SQLite storage. It does not configure the model runtime; see the custom-model inference note in the README.

## 1. Prepare the Discord OAuth application

1. Open the Discord Developer Portal and select or create the application for this dashboard.
2. Open **OAuth2** and note the Client ID and Client Secret.
3. Once you know the public HTTPS address of the API, add this redirect URI in the application's OAuth2 redirect list:

   `https://YOUR-BOT-API-HOST/auth/discord/callback`

   The URL must match `DISCORD_REDIRECT_URI` exactly, including scheme and path.

The application only requests the `identify` scope. It does not need access to the user's guilds or messages for dashboard login.

## 2. Configure the bot host

Use Node.js 22 or newer. Install dependencies with:

```bash
npm install
```

Set these environment variables in the hosting panel:

| Variable | Value |
| --- | --- |
| `PORT` | The port provided by the host; usually injected automatically |
| `PERSISTENT_DIR` | The host's persistent directory path |
| `DISCORD_CLIENT_ID` | Client ID from Discord Developer Portal |
| `DISCORD_CLIENT_SECRET` | Client Secret from Discord Developer Portal |
| `DISCORD_REDIRECT_URI` | `https://YOUR-BOT-API-HOST/auth/discord/callback` |
| `WEB_ORIGIN` | Exact frontend origin, for example `https://your-project.pages.dev` |
| `DATABASE_PATH` | Optional override for the full path to `users.db` |

Do not commit real secrets to GitHub. If the host does not provide a persistent directory, ask its documentation/support which path persists across restarts before going live. SQLite cannot guarantee persistence if the database file lives on ephemeral storage.

For the custom adapters, the API accepts only a **local** inference URL. If a compatible inference server is running on the same host, set:

- `ZOI_INFERENCE_URL=http://127.0.0.1:7860` (replace the port if needed)
- `ZOI_INFERENCE_TOKEN` to a long random secret shared only with that local process
- `ZOI_INFERENCE_TIMEOUT_MS=120000` (optional)

Remote inference URLs are rejected by the API. Do not set these values until a real local runtime that loads the base model and both PEFT adapters is installed and tested. The current Colab-specific Python script is not a Bot-Hosting.net runtime.

Start the service with:

```bash
npm start
```

Verify `https://YOUR-BOT-API-HOST/health` returns JSON. The first launch creates `users.db` and its tables in the configured persistent directory.

## 3. Configure the web GUI

For Cloudflare Pages, deploy the repository's `public/` directory as the static site output. For Vercel, configure the project to serve `public/` as static assets or use a static project configuration.

Edit `public/config.js` before deployment:

```js
window.ZOI_API_BASE = "https://YOUR-BOT-API-HOST";
```

Use the API's public HTTPS origin without a trailing slash. This URL is public configuration, not a secret.

Set `WEB_ORIGIN` on the API to the exact deployed website origin, without a path or trailing slash. For example, if the page opens at `https://zoi-dashboard.pages.dev`, set `WEB_ORIGIN=https://zoi-dashboard.pages.dev`.

If you use a custom domain, set `WEB_ORIGIN` to that domain and redeploy the frontend if needed.

## 4. End-to-end check

1. Open the deployed dashboard.
2. Select **Continue with Discord** and authorize the application's basic identity request.
3. Confirm the dashboard shows your Discord username.
4. Create a key assigned to `zoi` or `zoi-unfiltered`. Copy it immediately; it is shown only once.
5. Confirm the key appears in **Your API keys** with the correct adapter.
6. Use **Revoke key** to verify owner-scoped revocation works.
7. Check **Inference status**. It must not be marked configured until a compatible local runtime for the actual custom adapters is available and verified.

## Notes

- The API and static website are separate origins, so the backend allows browser requests only from `WEB_ORIGIN`.
- The Discord OAuth callback exchanges the provider token server-side. The Discord access token is not returned to the browser.
- The browser receives a short-lived one-time exchange code in the redirect URL; it exchanges that code for a dashboard session, then removes the code from browser history.
- Dashboard sessions expire after seven days. The session token is kept in the current tab's `sessionStorage` and is not stored in local storage.
- The API key list never returns API-key values or their hashes.
- Use an HTTPS origin in production. Do not use wildcard CORS.
