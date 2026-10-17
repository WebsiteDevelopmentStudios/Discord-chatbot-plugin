# Zoi Intelligence API

A hybrid conversational intelligence API for any developer or application. Mallow Bot is only one possible test client. It combines a lightweight local rules/retrieval engine with optional local models (Ollama) or user-configured OpenAI-compatible model endpoints. No model connection is required for the API to start.

## Current capabilities

- Generate API keys with `POST /v1/keys`.
- Validate keys using `GET /v1/keys`.
- Chat using `POST /v1/chat/completions`.
- Natural greetings and small talk, simple empathy, capability and identity questions, arithmetic with operator precedence and parentheses, and uncertainty-aware fallback answers.
- Conversation-scoped facts such as a user's name, location, likes/dislikes, job, and learning goals.
- Conversation history recall, user-saved notes, and relevance-ranked retrieval across a larger curated knowledge base covering APIs, HTTP, JavaScript, Node.js, Git, testing, security, databases, semantic search, AI/LLMs, hosting, Discord bots, Minecraft servers, networking, science, and other fundamentals.
- Typo-tolerant vocabulary normalization handles common misspellings, contractions, informal phrasing, and selected synonyms before intent detection and retrieval.
- Fuzzy term matching can recover some one- or two-character errors in longer words without fuzzy-matching very short terms like AI.
- Expanded offline reference coverage includes internet fundamentals, RAM vs storage, operating systems, algorithms, probability, evolution, climate, electricity, astronomy, clear writing, critical thinking, and machine learning.
- Knowledge retrieval scores query terms and topic aliases rather than relying only on broad substring matching; short technical terms such as AI are handled explicitly.
- Reset in-memory conversation state with `POST /v1/chat/reset`.
- Automated tests with GitHub Actions.

Without a configured provider, the fallback is a hand-built engine using language normalization, common typo corrections, fuzzy term matching, deterministic arithmetic, ranked retrieval over hand-authored knowledge, and conversation state—not a trained large language model. These techniques help it understand some misspelled or informal questions, but they do not provide the broad generalization of a trained language model. With a provider configured, open-ended messages can use that model, while arithmetic and conversation memory remain local and deterministic. Retrieval is not the same as understanding, and model quality depends on the selected model. Zoi has no built-in live web access and does not train itself from conversations.

## Hybrid model architecture

Zoi uses a provider adapter rather than baking one model vendor into the core:

1. **Rules and retrieval fallback:** deterministic arithmetic, conversation facts, memory, and curated reference knowledge work without a model connection.
2. **Optional model reasoning:** open-ended conversation and questions can be sent to a configured model for broader language understanding. Relevant built-in reference text is included when available.
3. **Graceful fallback:** an unavailable, misconfigured, timed-out, or unsuccessful model returns control to the local engine instead of taking the API down.
4. **Provider-neutral API:** the chat endpoint keeps its response shape and reports the selected engine in `engine` and provider status in `providerStatus`.

The model connection is configured by the **operator** using environment variables; callers cannot supply arbitrary URLs or credentials per request. This avoids turning a public API into an unrestricted server-side request proxy or exposing provider secrets.

### Configure a local Ollama model

Install Ollama and pull a model on a machine reachable from the API service. For example:

```bash
ollama pull qwen2.5:3b
ollama serve
```

Set these environment variables where Zoi runs:

- `ZOI_MODEL_MODE=auto` — use the model when configured; otherwise use rules.
- `ZOI_MODEL_PROVIDER=ollama`
- `ZOI_MODEL_BASE_URL=http://localhost:11434` — local host only for HTTP; use a reachable HTTPS endpoint for a remote host.
- `ZOI_MODEL_NAME=qwen2.5:3b`
- `ZOI_MODEL_TIMEOUT_MS=20000` — optional; clamped between 1 and 60 seconds.

Ollama is contacted at `/api/chat`. If Zoi runs on Render, `localhost` means the Render container itself—not your home computer. A model on another machine must be securely reachable from Render, typically through a private network or authenticated HTTPS gateway. Do not expose an unauthenticated Ollama port directly to the public internet.

### Configure an OpenAI-compatible endpoint

Set:

- `ZOI_MODEL_MODE=auto`
- `ZOI_MODEL_PROVIDER=openai-compatible`
- `ZOI_MODEL_BASE_URL=https://your-provider.example/v1`
- `ZOI_MODEL_NAME=the-model-id`
- `ZOI_MODEL_API_KEY=your-secret` (optional for endpoints that do not require one)
- `ZOI_MODEL_TIMEOUT_MS=20000` (optional)

The service appends `/chat/completions` unless the full endpoint is already supplied. Only HTTPS remote endpoints are accepted by the adapter. Keep secrets in the hosting provider's environment-variable settings, never in source control or client-side code.

Set `ZOI_MODEL_MODE=rules` to disable model calls. `/health` reports whether a model is configured and the provider/model label, but never returns the API key.

### Hardware and cost reality

The rules-only engine can run on a small Node.js instance but is much less capable than a trained language model. Model quality and speed depend on the model weights, quantization, available RAM/VRAM, CPU/GPU, context length, concurrency, and inference server. A small quantized model (for example, 3B–8B parameters) may be a practical starting point on suitable consumer hardware, but it will not reliably outperform frontier models. Larger models can require substantial GPU memory and slower or more expensive hosting. A hosted endpoint may charge per token or request; using a local model avoids a per-request model API bill but still costs compute, power, bandwidth, and maintenance. Render's ordinary lightweight web-service instance should not be assumed to have enough RAM/VRAM to host a capable LLM.

The project does not claim to be smarter than ChatGPT. The architecture makes it possible to connect stronger models and measure quality while keeping a free fallback.

## Run locally

Requires Node.js 22 or newer.

```bash
npm test
npm start
```

The API listens on port 3000 by default. Configure `PORT` and `DATA_FILE` through environment variables.

## Generate an API key

```bash
curl -X POST http://localhost:3000/v1/keys \
  -H "Content-Type: application/json" \
  -d '{"label":"My test bot"}'
```

Copy the returned `key` value. It is displayed once; the server stores only its SHA-256 hash.

## Chat with the engine

Replace `YOUR_KEY` with your generated key:

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"message":"Hello!","conversationId":"my-test-conversation"}'
```

The response uses a simple chat-completion structure:

```json
{
  "object": "chat.completion",
  "model": "zoi-intelligence-0.4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! What's on your mind?"
      },
      "finish_reason": "stop"
    }
  ],
  "intent": "greeting",
  "confidence": 0.94,
  "conversationId": "my-test-conversation"
}
```

Use the same `conversationId` to keep the engine's in-memory conversation state across requests. This state is lost when the process restarts. Conversation IDs should be unique per user's conversation and should not contain sensitive data.

## Reset a conversation

```bash
curl -X POST http://localhost:3000/v1/chat/reset \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_KEY" \
  -d '{"conversationId":"my-test-conversation"}'
```

## API endpoints

- `GET /health` — service health.
- `POST /v1/keys` — create a key; limited to 5 creations per IP per minute in this prototype.
- `GET /v1/keys` — verify a key.
- `POST /v1/chat/completions` — generate a reply using the configured model when available, with a built-in fallback.
- `POST /v1/chat/reset` — clear a conversation's in-memory state.

## Security and deployment limitations

- This is not a hosted public API yet. Deploy it to a server before calling it from external applications.
- Key records use a local JSON file. Production deployment needs durable storage, safe concurrent writes, key revocation, stronger rate limiting, and abuse prevention.
- The key-creation rate limiter is in-memory and trusts the first `X-Forwarded-For` value; configure trusted proxy handling before exposing it publicly.
- Conversation memory is in-process, bounded, and not durable across restarts.
- Do not send sensitive personal data to this prototype.
- GitHub Actions runs tests; it does not deploy the API or generate a production key.
- No model is called unless an operator configures one. A configured provider may charge for usage; users must check its pricing and terms.
