# iAcademyAI

A competency-driven technology learning platform prototype with learner authentication, practical coding challenges, and an AI learning coach.

## Requirements

- Node.js 18 or later
- npm

## Run locally

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

To enable OpenAI-powered coaching, copy `.env.example` to `.env`, add your API key, and set `AI_PROVIDER=openai`. Keep `.env` private; it is excluded from Git.

User and session JSON files are created in `data/` at runtime and are intentionally excluded from Git.
