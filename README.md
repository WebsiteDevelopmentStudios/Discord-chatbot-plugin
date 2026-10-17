# Discord Chatbot Intelligence API

A free, model-independent conversational intelligence API prototype. The project is designed for any developer or application; Mallow Bot is only one possible test client.

## Current capabilities

- Generate API keys with `POST /v1/keys`.
- Validate keys using `GET /v1/keys`.
- Chat using `POST /v1/chat/completions`.
- Natural greetings and small talk, simple empathy, capability and identity questions, arithmetic with operator precedence and parentheses, and uncertainty-aware fallback answers.
- Conversation-scoped facts such as a user's name, location, likes/dislikes, job, and learning goals.
- Conversation history recall, user-saved notes, a small built-in knowledge base for common API/web/programming concepts, and recent-history context.
- Reset in-memory conversation state with `POST /v1/chat/reset`.
- Automated tests with GitHub Actions.

This is an early hand-built engine using language patterns, deterministic arithmetic, a small hand-authored knowledge base, and conversation state—not a trained large language model. The engine reports uncertainty for questions outside its limited knowledge. It is intentionally honest when it cannot answer a question. Its general knowledge and reasoning are currently limited.

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
  "model": "zoi-intelligence-0.2",
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
- `POST /v1/chat/completions` — generate a reply using the built-in intelligence engine.
- `POST /v1/chat/reset` — clear a conversation's in-memory state.

## Security and deployment limitations

- This is not a hosted public API yet. Deploy it to a server before calling it from external applications.
- Key records use a local JSON file. Production deployment needs durable storage, safe concurrent writes, key revocation, stronger rate limiting, and abuse prevention.
- The key-creation rate limiter is in-memory and trusts the first `X-Forwarded-For` value; configure trusted proxy handling before exposing it publicly.
- Conversation memory is in-process, bounded, and not durable across restarts.
- Do not send sensitive personal data to this prototype.
- GitHub Actions runs tests; it does not deploy the API or generate a production key.
- No paid AI provider or external model is used.
