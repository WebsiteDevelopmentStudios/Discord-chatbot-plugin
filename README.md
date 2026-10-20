# Zoi Custom Model Dashboard

Zoi is a web dashboard and API for managing access to two custom Llama 3.1 8B PEFT adapters:

- `zoi` — the original custom adapter.
- `zoi-unfiltered` — the separate unfiltered adapter.

The dashboard uses Discord OAuth for identity. API keys are assigned to a Discord user and one adapter. Key hashes, OAuth state, one-time OAuth exchange codes, and dashboard sessions are stored in a local SQLite database named `users.db`.

## Architecture

- **Web GUI:** static frontend in `public/`, intended for Cloudflare Pages or Vercel connected to GitHub.
- **Backend:** Node.js API and Discord OAuth callback on Bot-Hosting.net.
- **Database:** SQLite on the bot host's persistent directory. Configure `PERSISTENT_DIR` or `DATABASE_PATH`; do not place the database in a temporary directory.
- **Custom models:** base model `meta-llama/Llama-3.1-8B-Instruct` with the selected PEFT adapter. No Gemini, Groq, Modal, Neon, or Render integration is part of this architecture.

## Dashboard features

- Sign in with Discord.
- Create a key assigned to either `zoi` or `zoi-unfiltered`.
- List and revoke only keys belonging to the signed-in Discord account.
- Test an API key using browser-side WebGPU inference.
- View WebGPU capability and model-export configuration status.

API keys are shown only at creation time. The database stores SHA-256 hashes, not the original API key. The dashboard session token is held in the current browser tab's `sessionStorage`, and the server stores only its hash.

## Bot-host setup

See [BOT_HOSTING_SETUP.md](BOT_HOSTING_SETUP.md) for environment variables, Discord OAuth configuration, persistent SQLite setup, and deployment steps.

Requires Node.js 22 or newer.

```bash
npm install
npm test
npm start
```

The API listens on `PORT` (default `3000`). Set `PERSISTENT_DIR` to the persistent directory supplied by your host. The database will be created as `users.db` in that directory unless `DATABASE_PATH` is set.

## Static website setup

1. Deploy the repository's `public/` directory as a static site on Cloudflare Pages or Vercel.
2. Edit `public/config.js` and set `window.ZOI_API_BASE` to the public HTTPS URL of the Node.js API running on Bot-Hosting.net. Do not add a trailing slash.
3. Set `WEB_ORIGIN` on the API to the exact deployed website origin, such as `https://your-project.pages.dev`. Do not include a path.
4. Set `DISCORD_REDIRECT_URI` to the API callback URL: `https://YOUR-BOT-API-HOST/auth/discord/callback`.
5. In the Discord Developer Portal OAuth2 settings, add that exact callback URL as a redirect URI.

If you serve the dashboard directly from the Node.js API, leave `ZOI_API_BASE` empty and set `WEB_ORIGIN` to the API's own HTTPS origin.

## Browser WebGPU inference

The dashboard test-message UI validates the selected API key and then runs the assigned custom adapter in the browser with WebGPU. Prompts and generated text stay in the browser; only API-key validation goes to the Node API. The browser requires a **public, Transformers.js-compatible ONNX export** for each adapter. Raw PEFT folders and Google Drive folder links are not directly loadable by the browser runtime.

See [WEBGPU_MODEL_SETUP.md](WEBGPU_MODEL_SETUP.md) for the required export and deployment steps. Set the public exported model repository IDs in `public/config.js`. Until both IDs point to verified compatible exports, the UI reports that model exports are needed rather than using a substitute model.

The server-side `POST /v1/chat/completions` endpoint is separate and still requires a server-accessible inference runtime. Browser GPU execution cannot service arbitrary external API clients. Bot-Hosting.net remains responsible for Discord OAuth, key ownership/revocation, and SQLite, not loading the 8B model.

## Security notes

- Keep `DISCORD_CLIENT_SECRET` and any model/runtime credentials in the host's environment settings, never in GitHub or `public/`.
- Use HTTPS for the dashboard and API.
- Set `WEB_ORIGIN` to one exact origin; do not use `*`.
- The API validates Discord sessions server-side. A browser-supplied Discord user ID is never accepted as identity.
- Use the hosting provider's persistent storage for `users.db`, and keep its backups private.
- The current API-key endpoint rate-limits creation per IP. Add additional abuse protection before offering the service publicly.
