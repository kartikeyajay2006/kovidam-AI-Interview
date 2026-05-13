# Kovidam AI Interview Platform

Production-grade AI Interview & Candidate Evaluation Platform for recruiters and startups.

## Full Commands

## 1) Database + Redis + Backend (single command)
```bash
cd /home/kartikeyayadav/Desktop/kovidam-AI-Interview && docker compose up -d --build
```

## 2) Verify backend is running
```bash
curl http://localhost:8000/api/v1/health/live && echo && curl http://localhost:8000/api/v1/health/ready
```

## 3) Frontend (single command)
```bash
cd /home/kartikeyayadav/Desktop/kovidam-AI-Interview/frontend && npm run dev:reset
```

## URLs
- Frontend: `http://localhost:3000`
- Dashboard: `http://localhost:3000/dashboard`
- Backend API: `http://localhost:8000`

## Important
- Do not keep re-copying `.env.example` into `.env` after you set real keys.
- For interview mail, use a real candidate email (not `@example.com` or fake domains).
