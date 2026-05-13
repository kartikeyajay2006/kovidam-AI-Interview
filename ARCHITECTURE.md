# AI Interview Platform - Architecture Deep Dive

## SYSTEM ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js 15)                       │
│  Landing → Recruiter Dashboard → Candidate Interview Interface │
│           (Modern UI with Framer Motion Animations)             │
└────────────────────────┬────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
   REST API        WebSocket         S3 Signed URLs
   (FastAPI)       (Socket.IO)        (Recordings)
        │                │                │
        └────────────────┼────────────────┘
                         │
        ┌────────────────▼────────────────┐
        │    BACKEND SERVICE LAYER        │
        │          (FastAPI)              │
        │  ┌──────────────────────────┐   │
        │  │  Auth Service            │   │
        │  │  Recruiter Service       │   │
        │  │  Resume Parser Service   │   │
        │  │  Interview Service       │   │
        │  │  AI Orchestration Layer  │   │
        │  │  Scoring Service         │   │
        │  │  Video Monitor Service   │   │
        │  └──────────────────────────┘   │
        └────────────┬─────────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
    ▼                ▼                ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│PostgreSQL│  │  Redis   │  │   Celery     │
│Database  │  │  Cache   │  │   Queue      │
└──────────┘  └──────────┘  └──────────────┘
```

---

## Recruiter Email Delivery (Cost-Optimized)

For MVP, use SMTP instead of paid email APIs:
- Gmail SMTP (`smtp.gmail.com:587`) with App Password
- Zoho SMTP free tier
- Mailgun SMTP free credits

Email flow:
- Generate secure interview token
- Compose branded HTML email
- Send via SMTP worker
- Store delivery attempt + retry status

---

## Notes

This file was trimmed and updated to prioritize low-cost SMTP delivery for MVP. Detailed flow remains in `IMPLEMENTATION_PLAN.md` and `DEVELOPMENT_ROADMAP.md`.
