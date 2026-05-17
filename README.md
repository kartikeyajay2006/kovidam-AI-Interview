# Kovidam AI Interview Platform

Production-grade AI Interview & Candidate Evaluation Platform for recruiters and startups.

## Prerequisites
- Docker + Docker Compose
- Node.js 20+ and npm
- Git

## Fresh Clone: One Command To Run Backend + Frontend
Run this from the project root (works on any laptop path, no hardcoded directory):

```bash
cd /home/kartikeyayadav/Desktop/kovidam-AI-Interview && [ -f backend/.env ] || cp backend/.env.example backend/.env; cd frontend && npm install && cd .. && docker compose up -d --build --force-recreate postgres redis backend && until curl -sf http://localhost:8000/api/v1/health/live; do sleep 1; done && echo "Backend is live" && cd frontend && pkill -f "next dev" || true; rm -rf .next node_modules/.cache; npm run dev
```
This command does:
1. Moves to project root.
2. Creates `backend/.env` from template only if it does not exist (does not overwrite your SMTP keys).
3. Installs frontend dependencies.
4. Rebuilds/recreates Postgres + Redis + Backend in Docker so latest env values are loaded.
5. Waits for backend health to become ready.
6. Stops old Next dev processes, clears frontend cache, and starts frontend dev server cleanly.

## URLs
- Frontend: `http://localhost:3000`
- Recruiter Dashboard: `http://localhost:3000/dashboard`
- Backend API: `http://localhost:8000`

## If Port 3000 Is Busy
```bash
cd frontend && npm run dev -- -p 3001
```

## Verify Backend Quickly
```bash
curl -s http://localhost:8000/api/v1/health/live && echo && curl -s http://localhost:8000/api/v1/health/ready
```

## Notes
- Set real SMTP + GROQ keys in `backend/.env` for mail + AI interview generation.
- Do not run `cp backend/.env.example backend/.env` after setting SMTP keys, or your SMTP config will be erased.
- Use real candidate emails (fake domains like `example.com` are blocked).
- Resume upload APIs were removed. Add candidates directly and optionally paste parsed resume JSON in the dashboard/API.
