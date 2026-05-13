# Getting Started

This guide runs the current executable baseline for the Kovidam AI Interview Platform.

## Prerequisites
- Node.js 18+
- Python 3.11+
- Docker + Docker Compose

## 1) Configure Environment

```bash
cd /home/kartikeyayadav/Desktop/kovidam-AI-Interview
cp backend/.env.example backend/.env
```

Update sensitive keys in `backend/.env` before production usage.

## 2) (Optional) Configure Free SMTP for Emails

Use Gmail SMTP (recommended for MVP):
- `SMTP_HOST=smtp.gmail.com`
- `SMTP_PORT=587`
- `SMTP_USERNAME=your-email@gmail.com`
- `SMTP_PASSWORD=<gmail-app-password>`
- `SMTP_FROM_EMAIL=your-email@gmail.com`
- `SMTP_USE_TLS=true`

Note: use a Gmail App Password (not your normal account password).

## 3) Run Backend Infra + API

```bash
make up
```

This starts:
- `postgres` on `5432`
- `redis` on `6379`
- `backend` on `8000`

Health checks:

```bash
curl http://localhost:8000/api/v1/health/live
curl http://localhost:8000/api/v1/health/ready
```

## 4) Run Frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev
```

Frontend routes:
- `/` landing shell
- `/dashboard` recruiter dashboard shell
- `/candidate/interview/demo-session` candidate interview shell

## 5) Stop Services

```bash
make down
```

## What is implemented right now
- Production-oriented monorepo scaffold
- FastAPI app foundation with versioned API routing
- Health endpoints (`/api/v1/health/live`, `/api/v1/health/ready`)
- Dockerized local environment (PostgreSQL + Redis + API)
- Next.js app shell with premium-style base theme tokens
- Rewritten implementation plan with execution phases and acceptance criteria

## Immediate next implementation targets
1. Authentication + tenant RBAC
2. Campaign and candidate APIs
3. Resume ingestion pipeline
4. Realtime interview session protocol
