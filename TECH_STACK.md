# TECH STACK SELECTION & JUSTIFICATION

## Frontend Stack

### Next.js 15 + TypeScript
**Why:**
- App Router for better file-based routing
- Server components for better performance
- Built-in image optimization
- Middleware for auth checks
- Zero-config deployment on Vercel
- Real-time capabilities with Vercel Functions

**Alternative considered:** React 19 standalone - but Next.js provides full-stack benefits
**Risk mitigation:** Test canary versions early, use feature flags

---

### Tailwind CSS + ShadCN UI
**Why:**
- Utility-first CSS for rapid prototyping
- Dark mode support out-of-box
- ShadCN provides production-ready component library
- Customizable design tokens
- Premium look with minimal effort

**Alternative considered:** Material-UI - but too heavy for this use case
**Customization:** Extend with custom gradients, glassmorphism effects

---

### Framer Motion
**Why:**
- Industry-standard animation library
- Used by Linear, Vercel, Apple websites
- Smooth, 60fps animations
- Spring physics for natural motion
- Excellent for page transitions

**Implementation strategy:**
```typescript
- Page transitions
- Card hover states
- Dashboard chart animations
- Interview UI transitions
- Loading states
```

---

### Zustand for State Management
**Why:**
- Minimal boilerplate (vs Redux)
- Simple API (vs Recoil)
- Excellent TypeScript support
- DevTools integration
- Perfect for medium-complexity apps

**Store structure:**
```
- authStore (user, session)
- recruiterStore (campaigns, candidates)
- interviewStore (session state, transcript)
- notificationStore (alerts, toasts)
```

---

### React Query (TanStack Query)
**Why:**
- Server state management (different from UI state)
- Automatic caching + refetching
- Built-in error handling
- Infinite queries (candidate lists)
- Mutations for POST/PUT/DELETE

**Usage:**
```
- Fetch job list
- Poll interview status
- Infinite scroll for candidates
- Real-time updates with WebSocket
```

---

### WebRTC (via browser native API)
**Why:**
- Peer-to-peer video streaming
- No server overhead for video
- Works in all modern browsers
- STUN/TURN servers for NAT traversal

**Implementation:**
```typescript
- getUserMedia() for camera/mic
- RTCPeerConnection for recording
- MediaRecorder API for encoding
- Send encoded chunks to server
```

---

### Socket.IO Client
**Why:**
- Real-time bidirectional communication
- Automatic reconnection
- Fallback to polling if WebSocket unavailable
- Built-in room concept (interview sessions)
- Acknowledgment system

---

## Backend Stack

### FastAPI
**Why:**
- Fastest Python web framework (performance comparable to Node)
- Automatic OpenAPI documentation
- Built-in request validation (Pydantic)
- Async-first architecture
- Type hints for better IDE support

**Benchmark:**
- 50-100k req/s (single server)
- < 100ms latency for typical requests

---

### PostgreSQL
**Why:**
- ACID compliance for critical operations
- JSONB for flexible resume data
- Full-text search for skill matching
- Native UUID type
- pgVector extension for embeddings

**Schema highlights:**
- Partitioned tables for massive scale
- JSON columns for semi-structured data
- Materialized views for analytics
- Triggers for audit logs

---

### Redis
**Why:**
- Sub-millisecond latency
- Pub/sub for real-time updates
- Session storage
- Rate limiting (sliding window)
- Distributed locking

**Usage:**
```
- Cache candidate embeddings
- Session tokens
- Rate limiting buckets
- Pub/sub for interview events
- Locks for concurrent operations
```

---

### SQLAlchemy ORM
**Why:**
- Type-safe database queries
- Relationship management
- Migration support (Alembic)
- Connection pooling
- Query optimization helpers

---

### Pydantic
**Why:**
- Data validation + parsing
- Type safety at runtime
- Automatic OpenAPI schemas
- Custom validators
- JSON serialization

---

### Celery + Redis
**Why:**
- Distributed task queue
- Parallel processing
- Job persistence
- Retry mechanism
- Task scheduling (cron)

**Tasks:**
```
- Resume parsing (async)
- Email sending (with retries)
- Interview scoring (post-interview)
- Transcription generation
- Analytics calculations
```

---

## AI/ML Stack

### Groq API (Primary LLM)
**Why:**
- Fastest LLM inference (10x faster than OpenAI)
- Cost-effective ($0.05 per 1M tokens vs OpenAI $3-15)
- Mixtral 8x7B model best-in-class for reasoning
- Perfect for real-time interview engine
- Streaming support for real-time responses

**Alternative:** OpenAI GPT-4 (if budget allows, for better quality)
**Fallback:** Anthropic Claude (via API)

**Models to use:**
```
- Mixtral 8x7B: Main reasoning model
- Llama 3 70B: Fallback for complex tasks
- Llama 3 8B: Light tasks (question generation)
```

---

### OpenAI Whisper (Speech-to-Text)
**Why:**
- 99.9% accuracy
- Multilingual support
- Affordable pricing
- API + open-source models available

**Alternative:** Deepgram (10x faster, cheaper)
**Strategy:** Use Deepgram for real-time, Whisper for batch

---

### ElevenLabs API (Text-to-Speech)
**Why:**
- Most natural-sounding voices
- 29 languages
- Streaming support
- AI-humanlike intonation

**Alternative:** Cartesia (faster) or Google Cloud TTS (cheaper)
**Voice selection:** Professional + empathetic tone for interviewer

---

### Deepgram API
**Why:**
- Real-time speech recognition
- 100ms latency
- Multiple speaker detection
- Profanity detection

**Usage:** Primary for interview session (real-time)

---

### LangChain
**Why:**
- LLM orchestration abstraction
- Chain composition (sequential + parallel)
- Memory management
- Agent framework
- Retrieval-augmented generation (RAG)

**Usage:**
```python
class InterviewChain:
  - Question generation chain
  - Answer evaluation chain
  - Follow-up generation chain
  - Score calculation chain
```

---

### LangGraph (New!)
**Why:**
- State machine for interview workflow
- Controllable agent loops
- Better than LangChain chains for complex flows
- Supports streaming + human-in-loop

**Interview state machine:**
```
START → GREET → QUESTION_1 → ANSWER_1 
  → EVALUATE → FOLLOW_UP_OR_NEXT 
  → ... → CODING_ROUND (optional) 
  → CONCLUSION → END
```

---

### Pinecone / Weaviate (Vector DB)
**Why:**
- Fast semantic search
- Dense vector similarity
- Supports metadata filtering
- Scalable to millions of vectors

**Vectors to store:**
```
- Candidate profile embeddings (resume analysis)
- Question embeddings (for similarity matching)
- Skill vector representations
- Experience graph embeddings
```

**Alternative:** Chroma (local) for development, Milvus (self-hosted)

---

### PDFPlumber + PyMuPDF (Resume Parsing)
**Why:**
- PDFPlumber: Excellent table extraction
- PyMuPDF: Fast, handles complex PDFs
- Both support Python
- OCR fallback with Tesseract

**Resume extraction pipeline:**
```
1. PDFPlumber.open() → extract text/tables
2. If fails → PyMuPDF fallback
3. If still fails → OCR (Tesseract)
4. Send text to LangChain + Groq
5. Extract structured fields
6. Generate embeddings
```

---

### OpenCV + MediaPipe (Video Monitoring)
**Why:**
- MediaPipe: Lightweight ML for pose/face detection
- OpenCV: Video processing
- JavaScript version available (TensorFlow.js) for browser
- Real-time performance (30fps)

**Browser-side implementation:**
```typescript
// Use TensorFlow.js + MediaPipe models
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import * as faceMesh from '@tensorflow-models/facemesh';
import * as handPose from '@tensorflow-models/hand-pose-detection';

// Real-time face detection + eye tracking
```

---

## Real-time Stack

### WebRTC
**Why:**
- Peer-to-peer video/audio
- No server video bandwidth cost
- DTLS encryption
- STUN/TURN for NAT traversal

**Implementation:**
```
Browser → STUN Server (free)
       → TURN Server (paid, if needed)
       → Backend signaling (Socket.IO)
```

---

### Socket.IO
**Why:**
- Real-time bidirectional communication
- Fallback to polling
- Room-based communication (interviews)
- Event-based architecture

**Events:**
```
- interview:started
- interview:question_asked
- interview:answer_received
- interview:candidate_left
- interview:scoring_complete
- behavior:flag_detected
```

---

### Redis Streams (Optional)
**Why:**
- Persistent event log
- Multiple consumers
- Replay capability
- Better than Pub/Sub for reliability

**Usage:** Event sourcing for interview sessions

---

## DevOps Stack

### Docker + Docker Compose
**Why:**
- Development/production parity
- Easy deployment
- Multi-service orchestration
- Reproducible environments

**Services:**
```
- frontend (Next.js)
- backend (FastAPI)
- postgres
- redis
- celery
- nginx
```

---

### GitHub Actions (CI/CD)
**Why:**
- Native GitHub integration
- Matrix testing (multiple Python versions)
- Secrets management
- Deploy on push

**Workflows:**
```
1. lint + test (backend)
2. build docker image
3. push to registry
4. deploy to Render/AWS
5. run smoke tests
```

---

### Vercel (Frontend Deployment)
**Why:**
- One-click Next.js deployment
- Automatic previews for PRs
- Edge functions for auth
- Global CDN
- Zero-config

---

### Render / AWS EC2 (Backend)
**Why:**
- Render: Simpler, auto-deploys from GitHub
- AWS: More control, better for scaling
- Both support Docker
- Both have managed databases available

**Choice:** Start with Render, migrate to AWS if needed

---

### AWS RDS (PostgreSQL)
**Why:**
- Managed PostgreSQL
- Automated backups
- Read replicas for scaling
- Multi-AZ for availability
- Point-in-time recovery

**Alternative:** Railway (simpler UI)

---

### Redis Cloud (Upstash)
**Why:**
- Managed Redis
- Auto-scaling
- Global replication
- REST API fallback

**Alternative:** Redis Labs, AWS ElastiCache

---

### AWS S3 + CloudFront (Storage)
**Why:**
- Unlimited scalable storage
- Encryption at rest
- CDN integration (CloudFront)
- Versioning + lifecycle policies
- Pre-signed URLs for secure downloads

**Usage:**
- Resumes (encrypted)
- Interview recordings (encrypted)
- Analytics exports

---

### Sentry (Error Tracking)
**Why:**
- Real-time error notifications
- Source map support
- Session replay
- Performance monitoring
- Release tracking

---

### DataDog (Monitoring)
**Why:**
- APM (Application Performance Monitoring)
- Infrastructure monitoring
- Log management
- Distributed tracing
- Real-time dashboards

---

## Authentication Stack

### Clerk (Primary)
**Why:**
- Multi-provider OAuth (Google, GitHub, Microsoft)
- Email verification
- Multi-factor authentication
- Organization support (companies)
- React component library

**Alternative:** Auth0, NextAuth.js

---

### JWT Tokens
**Why:**
- Stateless authentication
- Good for APIs + WebSocket
- Portable across servers
- Signature verification

**Implementation:**
```
1. Issue JWT on login
2. Store in HTTP-only cookie (XSS protection)
3. Validate on each request
4. Refresh token on expiry
```

---

## Summary: Why This Stack?

**Optimal for this use case because:**

1. **Performance:**
   - Groq LLM: 10x faster inference
   - Deepgram: Real-time speech-to-text
   - FastAPI: Sub-100ms latency
   - Next.js: Optimized frontend

2. **Scalability:**
   - Docker + Kubernetes-ready
   - PostgreSQL partitioning
   - Redis caching
   - Celery task distribution
   - S3 unlimited storage

3. **Cost-effectiveness:**
   - Groq: 10x cheaper than OpenAI
   - Vercel free tier
   - Render affordable
   - Open-source where possible

4. **User Experience:**
   - Framer Motion: Smooth animations
   - ShadCN: Premium components
   - WebRTC: Low-latency video
   - Socket.IO: Instant updates

5. **Developer Experience:**
   - TypeScript: Type safety
   - FastAPI: Auto-documentation
   - Clear separation of concerns
   - Well-documented libraries

**Estimated costs (monthly for 10,000 interviews/month):**
```
- Groq API: ~$500 (vs OpenAI $5000)
- Vercel: $20 (pro plan)
- Render Backend: $100 (standard instance)
- PostgreSQL: $50 (managed)
- Redis: $30 (Upstash)
- S3: $100 (recordings storage)
- ElevenLabs: $200 (TTS)
- Deepgram: $300 (STT)
- Sentry/DataDog: $100
- Other: $100
---
TOTAL: ~$1,500/month
Per interview: ~$0.15 (highly profitable at $50+/interview)
```

This is production-grade, cost-effective, and highly scalable.
