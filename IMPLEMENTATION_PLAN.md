# AI Interview & Candidate Evaluation Platform - Implementation Plan v2

## 1) Product Outcome
Build an enterprise-grade AI interviewer that can replace first-round technical + HR screening at scale with trustworthy scoring, anti-cheating controls, and recruiter-ready analytics.

Success criteria:
- Human-like adaptive interviews with <2.5s p95 AI turn response
- End-to-end secure interview lifecycle (link issuance -> completion -> report)
- Recruiter dashboard with ranking, integrity alerts, and explainable scoring
- Multi-tenant, audit-ready architecture with scalable async pipelines

---

## 2) Architecture Strategy

### 2.1 Planes
- Control Plane: auth, companies, jobs/campaigns, candidates, scheduling, settings, reporting
- Data Plane: realtime audio/video streams, turn orchestration, transcript chunks, proctoring events, coding execution events

### 2.2 Core Services
- API Gateway (FastAPI): REST + WebSocket/Socket gateway
- Interview Orchestrator: state machine + turn policy + adaptive questioning
- Resume Intelligence Service: parsing, extraction, enrichment, embeddings
- Proctoring Service: vision/audio signal analysis + integrity scoring
- Coding Engine: secure code execution sandbox + test harness
- Scoring & Ranking Service: weighted rubric + confidence calibration
- Notification Service: email delivery, retries, and audit logs

### 2.3 Data Stores
- PostgreSQL: system of record (multi-tenant relational core)
- Redis: session cache, rate limit counters, ephemeral interview state, pub/sub
- Vector DB (pgvector or external): candidate/job embeddings, retrieval
- Object Storage (S3-compatible): resumes, encrypted recordings, report artifacts

---

## 3) Execution Roadmap

## Phase 0 (Week 1): Foundation Bootstrap
Deliverables:
- Monorepo scaffolding with backend/frontend/shared
- Environment management (`.env.example`), Makefile, Docker Compose
- FastAPI app boot, API versioning, health endpoints
- Next.js app shell with route groups and design tokens
- CI stubs + lint/test commands

Acceptance:
- `docker compose up` brings up postgres, redis, api
- `/health/live` and `/health/ready` return success
- Frontend route shell renders locally

## Phase 1 (Weeks 2-3): Identity, Tenancy, Campaigns
Deliverables:
- Auth (Clerk/Auth.js + JWT session bridge)
- Multi-tenant RBAC (company, recruiter roles)
- Campaign/job CRUD + interview policy templates
- Candidate intake and resume upload APIs

Acceptance:
- Recruiter can create company, campaign, upload candidates
- Access control verified by role and tenant boundaries

## Phase 2 (Weeks 3-5): Resume Intelligence Engine
Deliverables:
- PDFPlumber + PyMuPDF + OCR fallback pipeline
- LangChain extraction graph (skills, experience, projects, links)
- Candidate profile embedding + experience graph generation
- Async ingestion workers + retry/dead-letter handling

Acceptance:
- >95% parse completion on benchmark sample set
- Structured extraction quality threshold met via validation rules

## Phase 3 (Weeks 5-8): Realtime Interview Orchestration
Deliverables:
- WebSocket interview session protocol
- Turn-state machine (listen -> transcribe -> evaluate -> ask)
- Adaptive questioning policy (difficulty ramping, challenge logic)
- Context memory model (claims ledger, contradictions, follow-up intents)

Acceptance:
- Stable 30+ minute interview session with reconnect handling
- Follow-up behavior demonstrably personalized from resume claims

## Phase 4 (Weeks 7-9): Voice + Natural Interaction
Deliverables:
- STT streaming (Deepgram/Whisper)
- LLM streaming (Groq)
- TTS (ElevenLabs/Cartesia)
- Interruption and barge-in handling, silence/latency recovery

Acceptance:
- p95 end-to-end turn latency <2.5s
- Candidate interruption handled without session corruption

## Phase 5 (Weeks 8-10): Proctoring & Integrity
Deliverables:
- Camera stream analysis (face visibility, multi-person detection)
- Tab focus + copy/paste + mic mute patterns
- Risk scoring model + explainable event timeline
- Recruiter integrity panel

Acceptance:
- Integrity score generated with explainable supporting events
- Alert precision/recall baseline measured on test scenarios

## Phase 6 (Weeks 10-12): Coding Interview Engine
Deliverables:
- Monaco coding UI, multi-language templates
- Secure execution sandbox (resource caps, network off, per-run isolation)
- Hidden tests + plagiarism and complexity analyzers
- AI follow-up evaluation on reasoning and debugging

Acceptance:
- Deterministic execution with timeout/memory limits
- No cross-run data leakage

## Phase 7 (Weeks 12-14): Scoring, Reports, Ranking
Deliverables:
- Multi-dimensional rubric scoring
- Weighted ranking with confidence and integrity adjustments
- Candidate report generation (strengths, weaknesses, hiring recommendation)
- Recruiter explainability layer

Acceptance:
- Ranking reproducible with auditable weighting
- Reports available <2 minutes post interview completion

## Phase 8 (Weeks 14-16): Recruiter Analytics + Premium UX
Deliverables:
- Live interview monitor and leaderboard
- Funnel analytics, competency heatmaps, radar charts
- Premium design system + motion language across app
- Responsive candidate and recruiter experiences

Acceptance:
- Dashboard p95 load <2s on core views
- Mobile usability validated for candidate flow

## Phase 9 (Weeks 16-18): Security Hardening + Production Launch
Deliverables:
- Threat model, pen-test checklist, rate limiting, WAF policy
- Audit logs, retention policy, DSAR/delete workflows
- Deployment runbooks, SLOs, monitoring and on-call alerts

Acceptance:
- Pre-launch security checklist signed off
- Incident dashboards and alerting fully wired

---

## 4) Database Design (Production Constraints)

Mandatory design rules:
- Use PostgreSQL enum types created via migrations (no inline invalid enum syntax)
- Use `CHECK` constraints for bounded scores (0-100, 0-1 probability)
- Use tenant-aware unique constraints (`company_id` + domain identifiers)
- Use pgvector extension migration before vector columns
- Partition high-volume tables: transcripts, proctoring events, interview events
- Add composite indexes for recruiter dashboard queries

Core entities:
- users, roles, companies, memberships
- jobs, interview_policies, candidates, resumes
- interview_links, interview_sessions, session_devices, login_attempts
- transcript_chunks, interview_events, proctoring_events
- coding_problems, coding_submissions, execution_runs
- scorecards, ranking_snapshots, reports, recruiter_notes
- audit_logs, webhooks, email_deliveries

---

## 5) API & Realtime Contracts

REST principles:
- Idempotency keys for create/link-send operations
- Cursor pagination on list endpoints
- Consistent error schema with trace IDs
- Tenant scoped auth on every data endpoint

WebSocket channels:
- `session.join`, `audio.chunk`, `transcript.partial`, `transcript.final`
- `ai.turn.start`, `ai.turn.delta`, `ai.turn.end`
- `proctoring.event`, `integrity.score.update`
- `coding.run.request`, `coding.run.result`
- `session.warning`, `session.terminate`

---

## 6) Security Model

- Auth: Clerk/Auth.js + JWT short-lived access and rotating refresh
- One-time links: token hash + expiry + attempt caps + replay prevention
- Session fingerprinting: device + network metadata with privacy guardrails
- Encryption: TLS in transit, KMS-backed object encryption at rest
- App security: CSRF, XSS, SQLi, SSRF defenses + strict CORS policy
- Platform controls: RBAC, audit trails, rate limits, bot protections

---

## 7) DevOps & SRE

- Frontend: Vercel
- Backend: AWS ECS/Fargate or Render managed containers
- PostgreSQL managed (RDS/Neon), Redis managed (Upstash/Redis Cloud)
- Observability: OpenTelemetry + Sentry + metrics/alerts
- CI/CD: GitHub Actions with test/lint/security gates
- SLOs: API availability, latency, interview completion success rate

---

## 8) Current Sprint (Execution Starts Now)

Sprint Goal:
- Bootstrap production codebase and runnable baseline

Tasks:
- [x] Create monorepo folders
- [ ] Backend app foundation and health endpoints
- [ ] Frontend shell routes and design token system
- [ ] Docker Compose for postgres/redis/api
- [ ] Environment templates and run scripts
- [ ] Update onboarding docs for local execution

Definition of Done:
- New developer can clone, configure env, run services, hit health checks, and see frontend shell in <30 minutes.
