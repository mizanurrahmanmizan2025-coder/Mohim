# Custom AI Suite

Gemini-inspired AI SaaS chatbot: Express + MongoDB backend with a multi-provider fallback engine, React + Tailwind frontend, and a super-admin dashboard for user validity and limits.

**Features**
- Modes: Chat · Code Expert (before/after fix cards) · Image Generator (Pollinations) · Document & PDF Analyzer (Gemini vision/OCR) · Web Analyzer (URL scraping) · Content Writer · Prompt Library
- Markdown + syntax highlighting, copy & download code files, voice input (speech-to-text) and read-aloud, chat export (.md/.txt/.json), public share links
- Round-robin key pools per provider, 429 cooldowns, instant cascade Groq → Gemini → OpenRouter → Mistral
- JWT auth, admin dashboard: activate/suspend/block/delete, expiry dates, hourly/daily quotas, key-pool health
- Dark/light theme, collapsible sidebar, mobile drawer

**Start here:** [DEPLOY.md](DEPLOY.md)

Quick local run:
```bash
cp backend/.env.example backend/.env   # fill in values
npm install && npm run build && npm start
```
