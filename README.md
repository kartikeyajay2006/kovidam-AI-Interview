# Kovidam AI Interview Platform

Production-grade AI Interview & Candidate Evaluation Platform for recruiters and startups.

## Prerequisites
- Docker + Docker Compose
- Node.js 20+ and npm
- Git

## Fresh Clone: One Command To Run Backend + Frontend
Run this from the project root (works on any laptop path, no hardcoded directory):

```bash
cp backend/.env.example backend/.env && cp frontend/.env.local frontend/.env.local.bak 2>/dev/null || true; cd frontend && npm install && cd .. && docker compose up -d --build && until curl -sf http://localhost:8000/api/v1/health/live; do sleep 1; done && echo "Backend is live" && cd frontend && npm run dev
```
This command does:
1. Prepares backend env file from template.
2. Installs frontend cdependencies.
3. Starts Postgres + Redis + Backend in Docker.
4. Waits for backend health to become ready.
5. Starts frontend dev server.

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
- Set real SMTP + OpenAI keys in `backend/.env` for mail + AI interview generation.
- Use real candidate emails (fake domains like `example.com` are blocked).
- Resume upload APIs were removed. Add candidates directly and optionally paste parsed resume JSON in the dashboard/API.
