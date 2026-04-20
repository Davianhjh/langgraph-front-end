# FastAPI Agent Chat Frontend

Next.js + Vercel AI SDK frontend client for a Python FastAPI backend.

## Features

- Multi-conversation sidebar with collapse/expand and new conversation creation
- Startup history loading from `/history`
- Dialog restore from `/dialog?thread_id=...`
- 32-char random `thread_id` for each new conversation
- Text + file upload in each chat message
- Streaming response from `/chat` SSE endpoint
- Markdown rendering for assistant replies
- Timestamp display for every message in `yyyy-MM-dd HH:mm:ss`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure backend address in `.env.local`:

```bash
FASTAPI_BASE_URL=http://127.0.0.1:8000
```

3. Run development server:

```bash
npm run dev
```

Open http://localhost:3000

## Frontend API Routes

- `/api/history` -> proxies to `${FASTAPI_BASE_URL}/history`
- `/api/dialog` -> proxies to `${FASTAPI_BASE_URL}/dialog`
- `/api/chat` -> proxies to `${FASTAPI_BASE_URL}/chat`, converts SSE events to plain text stream for Vercel AI SDK `TextStreamChatTransport`

## Notes

- The chat proxy forwards `thread_id`, `message`, `query`, `input`, and uploaded files to maximize compatibility with existing FastAPI handlers.
- History sidebar label shows the first message, truncated to 12 chars, with full text in hover tooltip.
