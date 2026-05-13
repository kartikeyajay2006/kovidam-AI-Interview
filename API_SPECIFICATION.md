# API SPECIFICATION - Complete Reference

## Base URLs

```
Development:  http://localhost:8000
Production:   https://api.kovidam.ai
Staging:      https://staging-api.kovidam.ai
```

---

## Authentication

All protected endpoints require JWT token in header:
```
Authorization: Bearer {token}
```

### Token Format
```json
{
  "sub": "user_id",
  "type": "recruiter|candidate",
  "exp": 1234567890,
  "iat": 1234567800
}
```

---

## Error Response Format

```json
{
  "detail": "Error message",
  "error_code": "ERROR_CODE",
  "status_code": 400,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## AUTH ENDPOINTS

### `POST /api/v1/auth/signup`
Register a new recruiter

**Request:**
```json
{
  "email": "recruiter@company.com",
  "password": "SecurePassword123!",
  "first_name": "John",
  "last_name": "Doe",
  "company_name": "Tech Corp",
  "phone": "+1234567890"
}
```

**Response (201):**
```json
{
  "id": "user_uuid",
  "email": "recruiter@company.com",
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "token_type": "bearer",
  "user": {
    "id": "user_uuid",
    "email": "recruiter@company.com",
    "type": "recruiter",
    "first_name": "John",
    "company_name": "Tech Corp"
  }
}
```

---

### `POST /api/v1/auth/login`
Recruiter login

**Request:**
```json
{
  "email": "recruiter@company.com",
  "password": "SecurePassword123!"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "token_type": "bearer",
  "user": { ... }
}
```

---

### `POST /api/v1/auth/refresh`
Refresh access token

**Request:**
```json
{
  "refresh_token": "eyJhbGc..."
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer"
}
```

---

### `GET /api/v1/auth/me`
Get current user profile

**Response (200):**
```json
{
  "id": "user_uuid",
  "email": "recruiter@company.com",
  "type": "recruiter",
  "first_name": "John",
  "company_name": "Tech Corp",
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

## JOB/CAMPAIGN ENDPOINTS

### `POST /api/v1/jobs`
Create a new hiring campaign

**Request:**
```json
{
  "title": "Senior Backend Engineer",
  "description": "We're looking for...",
  "required_skills": ["Python", "FastAPI", "PostgreSQL", "Docker"],
  "level": "senior",
  "interview_type": "mixed",
  "duration_minutes": 60,
  "difficulty": "hard",
  "ai_strictness": 8,
  "enable_video": true,
  "enable_coding": true,
  "coding_languages": ["python", "go", "rust"]
}
```

**Response (201):**
```json
{
  "id": "job_uuid",
  "recruiter_id": "user_uuid",
  "title": "Senior Backend Engineer",
  "status": "active",
  "created_at": "2024-01-15T10:00:00Z",
  "candidates_count": 0,
  "interviews_count": 0
}
```

---

### `GET /api/v1/jobs`
List all campaigns for recruiter

**Query Parameters:**
```
?page=1&limit=20&status=active&search=backend
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "job_uuid",
      "title": "Senior Backend Engineer",
      "created_at": "2024-01-15T10:00:00Z",
      "candidates_count": 25,
      "interviews_completed": 10,
      "pending_interviews": 5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

---

### `GET /api/v1/jobs/{jobId}`
Get job details

**Response (200):**
```json
{
  "id": "job_uuid",
  "title": "Senior Backend Engineer",
  "description": "...",
  "required_skills": ["Python", "FastAPI"],
  "level": "senior",
  "interview_type": "mixed",
  "duration_minutes": 60,
  "difficulty": "hard",
  "ai_strictness": 8,
  "enable_video": true,
  "enable_coding": true,
  "coding_languages": ["python", "go"],
  "created_at": "2024-01-15T10:00:00Z",
  "updated_at": "2024-01-15T10:00:00Z",
  "candidates": [
    {
      "id": "candidate_uuid",
      "email": "john@example.com",
      "name": "John Smith",
      "status": "interviewed"
    }
  ]
}
```

---

### `PUT /api/v1/jobs/{jobId}`
Update job

**Request:** (any fields)
```json
{
  "difficulty": "medium",
  "ai_strictness": 7
}
```

**Response (200):** Updated job object

---

### `DELETE /api/v1/jobs/{jobId}`
Delete job (archive)

**Response (204):** No content

---

## RESUME ENDPOINTS

### `POST /api/v1/resumes/upload`
Upload and parse resume

**Request:** (multipart/form-data)
```
file: [PDF/DOCX file]
job_id: job_uuid
candidate_email: john@example.com
candidate_name: John Smith
```

**Response (201):**
```json
{
  "id": "resume_uuid",
  "file_name": "john_smith_resume.pdf",
  "job_id": "job_uuid",
  "parsing_status": "processing",
  "created_at": "2024-01-15T10:00:00Z"
}
```

---

### `GET /api/v1/resumes/{resumeId}`
Get parsed resume data

**Response (200):**
```json
{
  "id": "resume_uuid",
  "file_name": "john_smith_resume.pdf",
  "parsing_status": "completed",
  "extracted_data": {
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+1234567890",
    "skills": [
      {
        "name": "Python",
        "proficiency": "expert",
        "years": 8
      },
      {
        "name": "FastAPI",
        "proficiency": "advanced",
        "years": 4
      }
    ],
    "experience": [
      {
        "company": "Tech Corp",
        "position": "Senior Backend Engineer",
        "duration": "2020-2024",
        "description": "Built microservices...",
        "tech_stack": ["Python", "FastAPI", "PostgreSQL"]
      }
    ],
    "education": [
      {
        "institution": "MIT",
        "degree": "B.S. Computer Science",
        "graduation_year": 2016
      }
    ],
    "certifications": ["AWS Solutions Architect"],
    "github": "https://github.com/johnsmith",
    "linkedin": "https://linkedin.com/in/johnsmith"
  },
  "skill_score": 0.92,
  "experience_score": 0.88
}
```

---

### `POST /api/v1/resumes/{resumeId}/parse`
Manual trigger to re-parse resume (admin only)

**Response (200):** Updated parsed data

---

## CANDIDATE ENDPOINTS

### `GET /api/v1/jobs/{jobId}/candidates`
List candidates for a job

**Query Parameters:**
```
?page=1&limit=20&status=all&sort_by=score_desc
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "candidate_uuid",
      "email": "john@example.com",
      "name": "John Smith",
      "resume_id": "resume_uuid",
      "interview_status": "completed",
      "overall_score": 8.5,
      "technical_score": 9.0,
      "communication_score": 8.0,
      "interview_date": "2024-01-15T14:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

---

### `POST /api/v1/jobs/{jobId}/send-interview-links`
Send interview links to candidates

**Request:**
```json
{
  "candidate_ids": ["candidate_uuid_1", "candidate_uuid_2"],
  "scheduled_date": "2024-01-20",
  "scheduled_time": "14:00"
}
```

**Response (200):**
```json
{
  "sent_count": 2,
  "failed_count": 0,
  "interview_links": [
    {
      "candidate_id": "candidate_uuid",
      "email": "john@example.com",
      "interview_link": "https://kovidam.ai/interview/abc123...",
      "expires_at": "2024-01-22T14:00:00Z"
    }
  ]
}
```

---

## INTERVIEW ENDPOINTS

### `POST /api/v1/interviews/{sessionId}/start`
Start an interview (candidate-initiated)

**Headers:**
```
Authorization: Bearer {candidate_session_token}
```

**Request:**
```json
{
  "candidate_session_id": "session_uuid"
}
```

**Response (200):**
```json
{
  "session_id": "interview_session_uuid",
  "job": {
    "title": "Senior Backend Engineer",
    "description": "..."
  },
  "interview_config": {
    "type": "mixed",
    "duration_minutes": 60,
    "include_coding": true,
    "coding_languages": ["python"]
  },
  "ai_interviewer": {
    "name": "Alex",
    "avatar": "https://...",
    "personality": "professional"
  },
  "start_token": "websocket_token_...",
  "recording_enabled": true
}
```

---

### `WS /ws/interview/{sessionId}`
WebSocket for real-time interview

**Connection:**
```
ws://localhost:8000/ws/interview/session_uuid?token=jwt_token
```

**Events from Client:**
```json
{
  "type": "audio_chunk",
  "data": "base64_encoded_audio",
  "timestamp": 1234567890
}

{
  "type": "video_frame",
  "data": "base64_encoded_frame",
  "timestamp": 1234567890
}

{
  "type": "ready",
  "message": "Candidate ready to start"
}

{
  "type": "leave",
  "reason": "completed|disconnected"
}
```

**Events from Server:**
```json
{
  "type": "question",
  "question": "Tell me about your experience with...",
  "audio_stream": true,
  "follow_up_index": 0
}

{
  "type": "audio",
  "data": "base64_audio_chunk",
  "is_final": false
}

{
  "type": "status",
  "message": "Processing your answer..."
}

{
  "type": "integrity_flag",
  "flag": "multiple_people_detected",
  "severity": "high"
}

{
  "type": "interview_complete",
  "message": "Thank you for the interview",
  "next_steps": "You'll hear back in 2-3 days"
}

{
  "type": "error",
  "error": "Session expired",
  "code": "SESSION_EXPIRED"
}
```

---

### `GET /api/v1/interviews`
List all interviews (recruiter)

**Response (200):**
```json
{
  "data": [
    {
      "id": "interview_uuid",
      "candidate": {
        "name": "John Smith",
        "email": "john@example.com"
      },
      "job": {
        "title": "Senior Backend Engineer"
      },
      "status": "completed",
      "started_at": "2024-01-15T14:00:00Z",
      "ended_at": "2024-01-15T15:00:00Z",
      "duration_minutes": 60,
      "overall_score": 8.5,
      "integrity_score": 95,
      "recording_available": true
    }
  ]
}
```

---

### `GET /api/v1/interviews/{interviewId}`
Get interview details

**Response (200):**
```json
{
  "id": "interview_uuid",
  "candidate": { ... },
  "job": { ... },
  "status": "completed",
  "transcript": [
    {
      "speaker": "ai",
      "text": "Tell me about your experience with Python",
      "timestamp": "2024-01-15T14:00:05Z"
    },
    {
      "speaker": "candidate",
      "text": "I've been using Python for 8 years...",
      "timestamp": "2024-01-15T14:00:15Z",
      "confidence": 0.95
    }
  ],
  "scores": {
    "technical_knowledge": 9.0,
    "communication": 8.0,
    "confidence": 8.5,
    "clarity": 8.0,
    "problem_solving": 9.0,
    "leadership": 7.5,
    "behavioral_fit": 8.0,
    "resume_authenticity": 9.5,
    "overall": 8.5
  },
  "recommendation": "strong_yes",
  "strengths": ["Strong technical knowledge", "Clear communicator"],
  "weaknesses": ["Limited leadership experience"],
  "summary": "John is a strong technical candidate...",
  "recording_url": "https://...",
  "behavioral_flags": []
}
```

---

### `GET /api/v1/interviews/{interviewId}/transcript`
Get full interview transcript

**Response (200):**
```json
{
  "interview_id": "interview_uuid",
  "transcript": [
    {
      "speaker": "ai|candidate",
      "text": "...",
      "timestamp": "2024-01-15T14:00:05Z",
      "duration_seconds": 10
    }
  ],
  "summary": "Multi-paragraph AI-generated summary",
  "key_points": ["Point 1", "Point 2"],
  "generated_at": "2024-01-15T16:00:00Z"
}
```

---

## ANALYTICS ENDPOINTS

### `GET /api/v1/analytics/dashboard`
Recruiter dashboard overview

**Response (200):**
```json
{
  "summary": {
    "total_interviews": 100,
    "completed_interviews": 85,
    "completion_rate": 0.85,
    "average_score": 7.8,
    "interviews_this_week": 15
  },
  "job_stats": [
    {
      "job_id": "job_uuid",
      "title": "Senior Backend Engineer",
      "candidates": 50,
      "completed": 40,
      "avg_score": 8.2
    }
  ],
  "top_candidates": [
    {
      "rank": 1,
      "name": "John Smith",
      "score": 9.2,
      "job": "Senior Backend Engineer"
    }
  ],
  "cheating_alerts": [
    {
      "candidate": "Jane Doe",
      "severity": "high",
      "flag": "multiple_people_detected",
      "timestamp": "2024-01-15T14:30:00Z"
    }
  ]
}
```

---

### `GET /api/v1/analytics/ranking`
Candidate ranking for a job

**Query Parameters:**
```
?job_id=job_uuid&sort_by=overall_score&page=1&limit=50
```

**Response (200):**
```json
{
  "job": {
    "id": "job_uuid",
    "title": "Senior Backend Engineer"
  },
  "rankings": [
    {
      "rank": 1,
      "candidate": {
        "name": "John Smith",
        "email": "john@example.com"
      },
      "scores": {
        "overall": 9.2,
        "technical": 9.5,
        "communication": 8.8
      },
      "recommendation": "strong_yes",
      "hiring_confidence": 0.95
    }
  ]
}
```

---

### `GET /api/v1/analytics/skills`
Skill analytics for candidates

**Query Parameters:**
```
?job_id=job_uuid
```

**Response (200):**
```json
{
  "skills": [
    {
      "name": "Python",
      "proficiency_avg": 8.5,
      "candidates_count": 35,
      "mastery_percentage": 0.85
    },
    {
      "name": "FastAPI",
      "proficiency_avg": 8.0,
      "candidates_count": 25,
      "mastery_percentage": 0.75
    }
  ],
  "skill_gaps": [
    {
      "skill": "Kubernetes",
      "required": true,
      "candidates_with_skill": 5
    }
  ]
}
```

---

### `GET /api/v1/analytics/funnel`
Hiring funnel visualization

**Response (200):**
```json
{
  "stages": [
    {
      "stage": "Applied",
      "count": 100,
      "percentage": 1.0
    },
    {
      "stage": "Interview Scheduled",
      "count": 50,
      "percentage": 0.5
    },
    {
      "stage": "Interview Completed",
      "count": 45,
      "percentage": 0.45
    },
    {
      "stage": "Passed Screening",
      "count": 15,
      "percentage": 0.15
    },
    {
      "stage": "Offered",
      "count": 5,
      "percentage": 0.05
    }
  ],
  "conversion_rates": {
    "application_to_interview": 0.5,
    "interview_to_offer": 0.33
  }
}
```

---

## CANDIDATE LOGIN ENDPOINTS

### `POST /api/v1/candidates/login`
Candidate one-time login

**Request:**
```json
{
  "interview_token": "abc123xyz...",
  "email": "john@example.com",
  "otp": "123456"
}
```

**Response (200):**
```json
{
  "session_id": "session_uuid",
  "session_token": "jwt_token...",
  "interview_details": {
    "job": "Senior Backend Engineer",
    "recruiter": "Tech Corp",
    "duration": 60,
    "scheduled_time": "2024-01-20T14:00:00Z"
  },
  "expires_at": "2024-01-20T15:00:00Z"
}
```

---

## Rate Limiting

All endpoints are rate-limited:
- **Unauthenticated:** 10 requests per minute
- **Authenticated:** 100 requests per minute
- **Interview WebSocket:** 1000 messages per 5 minutes

Headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

---

## Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Unprocessable Entity |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

---

## Common Error Codes

```
INVALID_REQUEST - Request validation failed
UNAUTHORIZED - Missing or invalid token
FORBIDDEN - No permission
NOT_FOUND - Resource not found
SESSION_EXPIRED - Interview session expired
INVALID_OTP - OTP incorrect or expired
RESUME_PARSING_FAILED - Could not parse resume
INTERVIEW_CONFLICT - Interview already scheduled
QUOTA_EXCEEDED - Monthly interview limit reached
AI_SERVICE_ERROR - Groq/Deepgram/ElevenLabs error
RECORDING_FAILED - Failed to record interview
INTEGRITY_VIOLATION - Cheating detected, interview stopped
```

---

Complete API Reference with examples for all 40+ endpoints.
