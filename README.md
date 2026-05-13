# Kovidam AI Interview Platform

Production-grade AI Interview & Candidate Evaluation Platform for recruiters and startups.

## Full Commands

## 1) Database + Redis + Backend (single command)
```bash
cp backend/.env.example backend/.env && docker compose up -d --build
```

## 2) Verify backend is running (single command)
```bash
curl http://localhost:8000/api/v1/health/live && echo && curl http://localhost:8000/api/v1/health/ready
```

## 3) Frontend (single command)
```bash
cd frontend && npm install && npm run dev
```

## URLs
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- Health: `http://localhost:8000/api/v1/health/live`

## Current Status
- Backend FastAPI foundation with health endpoints
- Frontend Next.js shell routes
- Docker Compose for postgres + redis + backend
- Production roadmap in `IMPLEMENTATION_PLAN.md`
