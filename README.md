# iAcademyAI

A technology learning platform: competency dashboard, practical labs, and an **AI workspace** powered by OpenAI.

## Requirements

- Node.js 18 or later
- npm
- An OpenAI API key

## Run locally

```bash
npm install
cp .env.example .env     # then set OPENAI_API_KEY (and optionally OPENAI_MODEL)
npm start
```

Open <http://localhost:3000>, create an account, then open **Workspace**.

## Workspace

`/workspace.html` is a VS Code-style learning workspace:

- File explorer, tabs, Monaco editor (loaded from a CDN; falls back to a plain editor offline), Markdown preview, command palette (`Ctrl+K`), light/dark theme.
- **Minimized assistant**: a chat button in the bottom-right corner opens the AI professor. Pick a teaching mode (tutor, professor, coding instructor, Socratic, mentor, exam prep) and optionally share your open file and selection. Replies stream in; code blocks have Copy and Insert buttons.
- **Lecture generator**: from the sidebar, or by typing `/lecture <topic>` in the chat. A structured lecture (objectives, lecture body, exercises, quiz with answer key) streams into `lectures/<topic>.md` and opens in preview.
- JavaScript files run in your browser (Web Worker, 5 s limit). Other languages need a code sandbox, which is not configured yet.

## AI architecture

```
ai/
  AIProvider.js      provider interface (swap OpenAI for another vendor here)
  OpenAIProvider.js  official SDK, Responses API, streaming
  ModelRegistry.js   models from OPENAI_MODEL / OPENAI_MODELS
  PromptManager.js   teaching modes and the lecture prompt
  UsageTracker.js    per-user daily token usage (data/usage.json), optional cost estimate
  RateLimiter.js     per-user requests per minute
  sse.js             Server-Sent Events streaming to the browser
  index.js           AIService: validation, limits, orchestration
```

Endpoints (all require sign-in): `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/lecture` (both stream SSE), and `POST /api/coach`.

The API key is read only on the server. If it is missing, the AI features return a clear "not configured" error; there are no canned answers.

## Security notes

- Passwords are hashed with scrypt (old SHA-256 accounts are upgraded on next login).
- The server never executes learner code. JavaScript challenges run in the browser.
- `.env` and `data/` are git-ignored.
