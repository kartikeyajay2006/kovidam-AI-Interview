from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import Candidate, InterviewSecurityEvent, InterviewSession, InterviewTurnLog, Job, Resume
from app.schemas.recruiter import (
    BulkInviteResponse,
    CandidateCreate,
    CandidateDashboardOut,
    CandidateOut,
    DashboardStats,
    InterviewCreate,
    InterviewDetail,
    InterviewOut,
    InterviewQuestionRequest,
    InterviewQuestionResponse,
    InterviewReviewFeedItem,
    InterviewReviewPacket,
    InterviewSecurityEventCreate,
    InterviewSecurityEventOut,
    InterviewQuestionReview,
    InterviewAnswerReview,
    InterviewTurn,
    InterviewTurnCreate,
    InterviewTurnOut,
    JobCreate,
    JobOut,
    SendInterviewLinkRequest,
    SendInterviewLinkResponse,
)
from app.services.email_service import send_interview_email
from app.services.interview_engine import (
    INTERVIEW_COMPLETE_SENTINEL,
    QUESTION_BANK,
    analyze_candidate_answer,
    generate_interview_question,
)

router = APIRouter(tags=["recruiter"])

BLOCKED_EMAIL_DOMAINS = {"example.com", "test.com", "invalid", "localhost"}


def is_deliverable_email(email: str) -> bool:
    if "@" not in email:
        return False
    domain = email.split("@")[-1].strip().lower()
    return domain not in BLOCKED_EMAIL_DOMAINS


def validate_recipient_email(email: str) -> None:
    domain = email.split("@")[-1].strip().lower() if "@" in email else ""
    if domain in BLOCKED_EMAIL_DOMAINS:
        raise HTTPException(
            status_code=400,
            detail=f"Recipient domain '{domain}' is not deliverable. Use a real email address.",
        )


def _extract_skills_from_parsed_json(parsed_resume_json: dict) -> str:
    data = parsed_resume_json.get("data") if isinstance(parsed_resume_json, dict) else {}
    if not isinstance(data, dict):
        return ""

    skills_section = data.get("skills_section", {})
    if isinstance(skills_section, dict):
        items = skills_section.get("items", [])
        if isinstance(items, list):
            cleaned = [str(item).strip() for item in items if str(item).strip()]
            return ", ".join(cleaned[:25])

    return ""


def _extract_candidate_fields(parsed_resume_json: dict) -> tuple[str, str, str]:
    if not isinstance(parsed_resume_json, dict):
        return "", "", ""
    data = parsed_resume_json.get("data") if isinstance(parsed_resume_json.get("data"), dict) else {}
    raw_text = str(data.get("raw_text_full") or data.get("raw_text_preview") or "")
    candidate_name = ""
    candidate_email = ""
    candidate_phone = ""

    if raw_text:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if lines:
            candidate_name = lines[0][:120]

        import re
        email_match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw_text)
        if email_match:
            candidate_email = email_match.group(0).strip()

        phone_match = re.search(r"(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}", raw_text)
        if phone_match:
            candidate_phone = phone_match.group(0).strip()

    return candidate_name, candidate_email, candidate_phone


def _build_resume_context(parsed_resume_json: dict) -> tuple[str, str]:
    if not isinstance(parsed_resume_json, dict) or not parsed_resume_json:
        return "", ""

    data = parsed_resume_json.get("data") if isinstance(parsed_resume_json.get("data"), dict) else {}
    skills = _extract_skills_from_parsed_json(parsed_resume_json)

    project_lines: list[str] = []
    projects_section = data.get("projects_section", {})
    if isinstance(projects_section, dict):
        items = projects_section.get("items", [])
        if isinstance(items, list):
            for item in items[:3]:
                if not isinstance(item, dict):
                    continue
                title = str(item.get("title") or "").strip()
                description = str(item.get("description") or "").strip()
                highlights = item.get("highlights", [])
                joined_highlights = "; ".join(
                    [str(h).strip() for h in highlights[:3] if str(h).strip()]
                ) if isinstance(highlights, list) else ""
                line = " | ".join([p for p in [title, description, joined_highlights] if p])
                if line:
                    project_lines.append(line)

    raw_text_preview = str(data.get("raw_text_preview") or "").strip()
    resume_text = "\n".join(project_lines) or raw_text_preview
    return resume_text[:3000], skills


def _default_human_question_bank() -> list[dict]:
    bank: list[dict] = []
    for idx, entry in enumerate(QUESTION_BANK, start=1):
        bank.append(
            {
                "id": f"HQ{idx:02d}",
                "question": entry["main"],
                "difficulty": "medium",
                "competency_bucket": "technical_depth",
                "type": "main",
            }
        )
    return bank

def _parse_job_questions(question_bank: str | None) -> list[dict]:
    if not question_bank or not question_bank.strip():
        return []
    lines = [q.strip() for q in question_bank.splitlines() if q.strip()]
    if not lines:
        return []
    bank = []
    for idx, line in enumerate(lines, start=1):
        bank.append(
            {
                "id": f"CQ{idx:02d}",
                "question": line,
                "difficulty": "medium",
                "competency_bucket": "technical_depth",
                "type": "main",
            }
        )
    return bank


def _normalize_severity(value: str) -> str:
    cleaned = (value or "medium").strip().lower()
    if cleaned in {"info", "low", "medium", "high", "critical"}:
        return cleaned
    return "medium"


def _event_penalty(event_type: str, severity: str) -> float:
    severity_weight = {
        "info": 0.15,
        "low": 0.35,
        "medium": 0.8,
        "high": 1.4,
        "critical": 2.4,
    }
    event_weight = {
        "tab_hidden": 1.2,
        "tab_hidden_timeout": 2.5,
        "screen_share_stopped": 2.3,
        "camera_unavailable": 2.0,
        "microphone_unavailable": 1.8,
        "face_not_visible": 1.8,
        "multiple_faces_detected": 2.2,
        "screen_change_detected": 0.9,
        "network_unstable": 0.6,
    }
    return severity_weight.get(severity, 0.8) * event_weight.get(event_type, 0.7)


def _recalculate_interview_integrity(db: Session, interview: InterviewSession) -> None:
    events = db.execute(
        select(InterviewSecurityEvent).where(InterviewSecurityEvent.interview_id == interview.id)
    ).scalars().all()
    total_penalty = 0.0
    for event in events:
        total_penalty += _event_penalty(event.event_type, event.severity)
    integrity = max(0.0, 100.0 - (total_penalty * 8.0))
    interview.integrity_score = round(integrity, 2)
    if integrity >= 85:
        interview.risk_level = "low"
    elif integrity >= 65:
        interview.risk_level = "medium"
    elif integrity >= 45:
        interview.risk_level = "high"
    else:
        interview.risk_level = "critical"


def create_and_send_invite(db: Session, candidate: Candidate, job: Job) -> tuple[bool, str]:
    target_email = candidate.email.strip()
    if not is_deliverable_email(target_email):
        latest_resume = db.execute(
            select(Resume).where(Resume.candidate_id == candidate.id).order_by(Resume.created_at.desc())
        ).scalars().first()
        if latest_resume and latest_resume.extracted_email and is_deliverable_email(latest_resume.extracted_email.strip()):
            target_email = latest_resume.extracted_email.strip()
            candidate.email = target_email
            db.commit()
        else:
            return False, f"{candidate.name}: invalid recipient email"

    interview = InterviewSession(
        candidate_id=candidate.id,
        job_id=job.id,
        status="scheduled",
        integrity_score=100.0,
        risk_level="low",
    )
    db.add(interview)
    db.commit()
    db.refresh(interview)

    settings = get_settings()
    interview_link = f"{settings.frontend_base_url}/candidate/interview/{interview.id}"

    try:
        send_interview_email(
            to_email=target_email,
            candidate_name=candidate.name,
            job_title=job.title,
            interview_link=interview_link,
        )
        return True, interview_link
    except Exception as exc:
        db.delete(interview)
        db.commit()
        return False, f"{candidate.name}: {exc}"


@router.post("/jobs", response_model=JobOut)
def create_job(payload: JobCreate, db: Session = Depends(get_db)):
    job = Job(**payload.model_dump())
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/jobs", response_model=list[JobOut])
def list_jobs(db: Session = Depends(get_db)):
    jobs = db.execute(select(Job).order_by(Job.created_at.desc())).scalars().all()
    return list(jobs)


@router.post("/candidates", response_model=CandidateOut)
def create_candidate(payload: CandidateCreate, db: Session = Depends(get_db)):
    import json as _json
    job_exists = db.execute(select(Job.id).where(Job.id == payload.job_id)).first()
    if not job_exists:
        raise HTTPException(status_code=404, detail="Job not found")

    extracted_name, extracted_email, extracted_phone = _extract_candidate_fields(payload.parsed_resume_json)
    candidate_name = extracted_name or payload.name.strip()
    candidate_email = extracted_email or payload.email.strip()
    candidate_phone = extracted_phone or payload.phone.strip()
    if not candidate_email:
        raise HTTPException(status_code=400, detail="Could not extract candidate email from parsed_resume_json")
    if not candidate_name:
        candidate_name = candidate_email.split("@")[0]

    validate_recipient_email(candidate_email)

    merged_skills = payload.skills.strip()
    parsed_skills = _extract_skills_from_parsed_json(payload.parsed_resume_json)
    if parsed_skills:
        merged_skills = parsed_skills

    candidate = Candidate(
        job_id=payload.job_id,
        name=candidate_name,
        email=candidate_email,
        phone=candidate_phone,
        skills=merged_skills,
        parsed_resume_json=_json.dumps(payload.parsed_resume_json) if payload.parsed_resume_json else "{}",
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return candidate


@router.get("/candidates", response_model=list[CandidateOut])
def list_candidates(db: Session = Depends(get_db)):
    candidates = db.execute(select(Candidate).order_by(Candidate.created_at.desc())).scalars().all()
    return list(candidates)


@router.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: UUID, db: Session = Depends(get_db)):
    candidate = db.execute(select(Candidate).where(Candidate.id == candidate_id)).scalars().first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    interview_ids = db.execute(
        select(InterviewSession.id).where(InterviewSession.candidate_id == candidate_id)
    ).scalars().all()
    if interview_ids:
        db.execute(delete(InterviewSecurityEvent).where(InterviewSecurityEvent.interview_id.in_(interview_ids)))
        db.execute(delete(InterviewTurnLog).where(InterviewTurnLog.interview_id.in_(interview_ids)))
        db.execute(delete(InterviewSession).where(InterviewSession.id.in_(interview_ids)))

    db.execute(delete(Resume).where(Resume.candidate_id == candidate_id))
    db.execute(delete(Candidate).where(Candidate.id == candidate_id))
    db.commit()
    return {"deleted": True, "candidate_id": str(candidate_id)}


@router.get("/candidates/dashboard", response_model=list[CandidateDashboardOut])
def list_candidates_dashboard(db: Session = Depends(get_db)):
    rows = db.execute(
        select(Candidate, Job)
        .join(Job, Job.id == Candidate.job_id)
        .order_by(Candidate.created_at.desc())
    ).all()

    result: list[CandidateDashboardOut] = []
    for candidate, job in rows:
        latest_interview = db.execute(
            select(InterviewSession)
            .where(InterviewSession.candidate_id == candidate.id)
            .where(InterviewSession.job_id == candidate.job_id)
            .order_by(InterviewSession.created_at.desc())
        ).scalars().first()
        interview_count = db.execute(
            select(func.count())
            .select_from(InterviewSession)
            .where(InterviewSession.candidate_id == candidate.id)
            .where(InterviewSession.job_id == candidate.job_id)
        ).scalar_one()
        result.append(
            CandidateDashboardOut(
                id=candidate.id,
                job_id=candidate.job_id,
                job_title=job.title,
                name=candidate.name,
                email=candidate.email,
                phone=candidate.phone,
                skills=candidate.skills,
                invite_sent=interview_count > 0,
                interview_count=interview_count,
                latest_interview_status=latest_interview.status if latest_interview else "not_scheduled",
            )
        )
    return result


@router.post("/interviews", response_model=InterviewOut)
def create_interview(payload: InterviewCreate, db: Session = Depends(get_db)):
    candidate_exists = db.execute(select(Candidate.id).where(Candidate.id == payload.candidate_id)).first()
    if not candidate_exists:
        raise HTTPException(status_code=404, detail="Candidate not found")

    job_exists = db.execute(select(Job.id).where(Job.id == payload.job_id)).first()
    if not job_exists:
        raise HTTPException(status_code=404, detail="Job not found")

    interview = InterviewSession(**payload.model_dump(), integrity_score=100.0, risk_level="low")
    db.add(interview)
    db.commit()
    db.refresh(interview)
    return interview


@router.get("/interviews", response_model=list[InterviewOut])
def list_interviews(db: Session = Depends(get_db)):
    interviews = db.execute(select(InterviewSession).order_by(InterviewSession.created_at.desc())).scalars().all()
    return list(interviews)


@router.delete("/interviews/{interview_id}")
def delete_interview(interview_id: UUID, db: Session = Depends(get_db)):
    interview = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview session not found")

    db.execute(delete(InterviewSecurityEvent).where(InterviewSecurityEvent.interview_id == interview_id))
    db.execute(delete(InterviewTurnLog).where(InterviewTurnLog.interview_id == interview_id))
    db.execute(delete(InterviewSession).where(InterviewSession.id == interview_id))
    db.commit()
    return {"deleted": True, "interview_id": str(interview_id)}


@router.get("/interviews/review-feed", response_model=list[InterviewReviewFeedItem])
def interview_review_feed(limit: int = 30, db: Session = Depends(get_db)):
    safe_limit = max(1, min(limit, 100))
    rows = db.execute(
        select(InterviewSession, Candidate, Job)
        .join(Candidate, Candidate.id == InterviewSession.candidate_id)
        .join(Job, Job.id == InterviewSession.job_id)
        .order_by(InterviewSession.created_at.desc())
        .limit(safe_limit)
    ).all()

    feed: list[InterviewReviewFeedItem] = []
    for interview, candidate, job in rows:
        turns_count = db.execute(
            select(func.count())
            .select_from(InterviewTurnLog)
            .where(InterviewTurnLog.interview_id == interview.id)
        ).scalar_one()
        security_events_count = db.execute(
            select(func.count())
            .select_from(InterviewSecurityEvent)
            .where(InterviewSecurityEvent.interview_id == interview.id)
        ).scalar_one()
        # Backfill display values for old sessions created before integrity scoring.
        if interview.integrity_score <= 0 and security_events_count == 0:
            interview.integrity_score = 100.0
            interview.risk_level = "low"
            db.commit()
            db.refresh(interview)
        feed.append(
            InterviewReviewFeedItem(
                interview_id=interview.id,
                candidate_name=candidate.name,
                candidate_email=candidate.email,
                job_title=job.title,
                status=interview.status,
                integrity_score=interview.integrity_score,
                risk_level=interview.risk_level,
                turns_count=turns_count,
                security_events_count=security_events_count,
                created_at=interview.created_at,
            )
        )
    return feed


@router.get("/interviews/{interview_id}/review-packet", response_model=InterviewReviewPacket)
def interview_review_packet(interview_id: UUID, db: Session = Depends(get_db)):
    row = db.execute(
        select(InterviewSession, Candidate, Job)
        .join(Candidate, Candidate.id == InterviewSession.candidate_id)
        .join(Job, Job.id == InterviewSession.job_id)
        .where(InterviewSession.id == interview_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Interview session not found")

    interview, candidate, job = row
    turns = db.execute(
        select(InterviewTurnLog)
        .where(InterviewTurnLog.interview_id == interview_id)
        .order_by(InterviewTurnLog.created_at.asc())
    ).scalars().all()
    security_events = db.execute(
        select(InterviewSecurityEvent)
        .where(InterviewSecurityEvent.interview_id == interview_id)
        .order_by(InterviewSecurityEvent.created_at.asc())
    ).scalars().all()

    qna_pairs: list[InterviewQuestionReview] = []
    current_q_idx = -1
    for turn in turns:
        if turn.role == "assistant":
            qna_pairs.append(
                InterviewQuestionReview(
                    question=turn.content,
                    asked_at=turn.created_at,
                    answers=[],
                )
            )
            current_q_idx += 1
            continue
        if turn.role != "candidate":
            continue
        if current_q_idx < 0:
            qna_pairs.append(InterviewQuestionReview(question="", answers=[]))
            current_q_idx = 0
        qna_pairs[current_q_idx].answers.append(
            InterviewAnswerReview(
                content=turn.content,
                analysis=turn.analysis,
                score=turn.score,
                source=turn.source,
                created_at=turn.created_at,
            )
        )

    transcript = [
        InterviewTurnOut(
            id=t.id,
            interview_id=t.interview_id,
            role=t.role,
            source=t.source,
            content=t.content,
            analysis=t.analysis,
            score=t.score,
            confidence_score=t.confidence_score,
            communication_score=t.communication_score,
            technical_depth_score=t.technical_depth_score,
            authenticity_score=t.authenticity_score,
        )
        for t in turns
    ]

    return InterviewReviewPacket(
        interview_id=interview.id,
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_title=job.title,
        status=interview.status,
        integrity_score=interview.integrity_score,
        risk_level=interview.risk_level,
        transcript=transcript,
        qna_pairs=qna_pairs,
        security_events=security_events,
    )


@router.get("/interviews/{interview_id}", response_model=InterviewDetail)
def get_interview(interview_id: UUID, db: Session = Depends(get_db)):
    import json as _json
    row = db.execute(
        select(InterviewSession, Candidate, Job)
        .join(Candidate, Candidate.id == InterviewSession.candidate_id)
        .join(Job, Job.id == InterviewSession.job_id)
        .where(InterviewSession.id == interview_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Interview session not found")

    interview, candidate, job = row
    try:
        resume_json = _json.loads(candidate.parsed_resume_json or "{}")
    except Exception:
        resume_json = {}
    return InterviewDetail(
        id=interview.id,
        candidate_id=candidate.id,
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_id=job.id,
        job_title=job.title,
        job_description=job.description,
        job_difficulty=job.difficulty,
        job_interview_type=job.interview_type,
        status=interview.status,
        integrity_score=interview.integrity_score,
        risk_level=interview.risk_level,
        candidate_skills=candidate.skills,
        parsed_resume_json=resume_json,
    )


@router.post("/interviews/{interview_id}/start", response_model=InterviewOut)
def start_interview(interview_id: UUID, db: Session = Depends(get_db)):
    interview = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if interview.status == "completed":
        raise HTTPException(status_code=400, detail="Interview is already completed")

    interview.status = "in_progress"
    if interview.integrity_score <= 0:
        interview.integrity_score = 100.0
        interview.risk_level = "low"
    db.commit()
    db.refresh(interview)
    return interview


@router.post("/interviews/{interview_id}/end", response_model=InterviewOut)
def end_interview(interview_id: UUID, db: Session = Depends(get_db)):
    interview = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview session not found")

    interview.status = "completed"
    db.commit()
    db.refresh(interview)
    return interview


@router.post("/interviews/{interview_id}/next-question", response_model=InterviewQuestionResponse)
def get_next_question(interview_id: UUID, payload: InterviewQuestionRequest, db: Session = Depends(get_db)):
    import json as _json
    row = db.execute(
        select(InterviewSession, Candidate, Job)
        .join(Candidate, Candidate.id == InterviewSession.candidate_id)
        .join(Job, Job.id == InterviewSession.job_id)
        .where(InterviewSession.id == interview_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Interview session not found")

    interview, candidate, job = row
    if interview.status == "scheduled":
        interview.status = "in_progress"
        db.commit()

    stored_turns = db.execute(
        select(InterviewTurnLog)
        .where(InterviewTurnLog.interview_id == interview_id)
        .order_by(InterviewTurnLog.created_at.asc())
    ).scalars().all()
    stored_history = []
    for t in stored_turns:
        if t.role == "assistant" and t.source == "proctor":
            continue
        content = (t.content or "").strip()
        if not content:
            continue
        stored_history.append({"role": t.role, "content": content})
    payload_history = [InterviewTurn(role=t.role, content=t.content).model_dump() for t in payload.history]
    merged_history = stored_history if stored_history else payload_history

    # Load resume from DB first; fall back to payload
    try:
        db_resume_json = _json.loads(candidate.parsed_resume_json or "{}")
    except Exception:
        db_resume_json = {}
    effective_resume_json = db_resume_json if db_resume_json else (payload.parsed_resume_json or {})

    resume_text, parsed_skills = _build_resume_context(effective_resume_json)
    resume_skills = parsed_skills or candidate.skills

    question, rationale = generate_interview_question(
        role_title=job.title,
        job_description=job.description,
        interview_type=job.interview_type,
        difficulty=job.difficulty,
        resume_text=resume_text,
        resume_skills=resume_skills,
        parsed_resume_json=effective_resume_json,
        human_question_bank=payload.human_question_bank or _parse_job_questions(job.question_bank) or _default_human_question_bank(),
        history=merged_history,
        candidate_name=candidate.name,
    )
    if question == INTERVIEW_COMPLETE_SENTINEL:
        interview.status = "completed"
        db.commit()
        return InterviewQuestionResponse(
            question="Interview complete. Thank you for your responses.",
            rationale="source=completion_guard state=closed",
        )

    rationale = f"{rationale} job={job.title} jd_excerpt={job.description[:120]}"

    db.add(
        InterviewTurnLog(
            interview_id=interview_id,
            role="assistant",
            source="system",
            content=question,
            analysis=rationale,
            score=0.0,
        )
    )
    db.commit()

    return InterviewQuestionResponse(question=question, rationale=rationale)


@router.get("/interviews/{interview_id}/turns", response_model=list[InterviewTurnOut])
def list_interview_turns(interview_id: UUID, db: Session = Depends(get_db)):
    turns = db.execute(
        select(InterviewTurnLog)
        .where(InterviewTurnLog.interview_id == interview_id)
        .order_by(InterviewTurnLog.created_at.asc())
    ).scalars().all()
    return list(turns)


@router.post("/interviews/{interview_id}/turns", response_model=InterviewTurnOut)
def add_interview_turn(interview_id: UUID, payload: InterviewTurnCreate, db: Session = Depends(get_db)):
    import json as _json
    interview_row = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    if not interview_row:
        raise HTTPException(status_code=404, detail="Interview session not found")

    role = payload.role.strip().lower()
    if role not in {"assistant", "candidate"}:
        raise HTTPException(status_code=400, detail="Role must be assistant or candidate")
    content = (payload.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="Turn content cannot be empty")
    source = (payload.source or "speech").strip().lower()
    if source not in {"speech", "text", "system", "proctor"}:
        source = "speech"

    analysis = ""
    score = 0.0
    confidence_score = communication_score = technical_depth_score = authenticity_score = 0.0

    if role == "candidate":
        job = db.execute(select(Job).where(Job.id == interview_row.job_id)).scalars().first()
        candidate = db.execute(select(Candidate).where(Candidate.id == interview_row.candidate_id)).scalars().first()
        turns = db.execute(
            select(InterviewTurnLog)
            .where(InterviewTurnLog.interview_id == interview_id)
            .order_by(InterviewTurnLog.created_at.asc())
        ).scalars().all()
        history = [{"role": t.role, "content": t.content} for t in turns]
        history.append({"role": "candidate", "content": content})
        try:
            resume_json = _json.loads(candidate.parsed_resume_json or "{}")
        except Exception:
            resume_json = {}
        candidate_info = {
            "name": candidate.name if candidate else "",
            "skills": candidate.skills if candidate else "",
            "resume_context": resume_json.get("data", {}).get("raw_text_preview", "")[:500] if resume_json else "",
        }
        # Keep live interviews snappy; run lightweight scoring while in_progress.
        if interview_row.status == "in_progress":
            wc = len(content.split())
            if wc < 8:
                analysis, score = "Answer captured. Please expand with more specifics.", 4.0
            elif wc < 20:
                analysis, score = "Answer captured. Good start; add concrete steps and outcomes.", 5.8
            else:
                analysis, score = "Answer captured for recruiter review.", 6.8
            confidence_score = max(0.0, min(10.0, round(score - 0.4, 2)))
            communication_score = max(0.0, min(10.0, round(score, 2)))
            technical_depth_score = max(0.0, min(10.0, round(score - 0.2, 2)))
            authenticity_score = max(0.0, min(10.0, round(score - 0.1, 2)))
        else:
            raw_analysis, score = analyze_candidate_answer(
                content,
                job.title if job else "Software Engineer",
                candidate_info=candidate_info,
                full_history=history,
            )
            # Parse per-category scores if the analysis string is JSON
            try:
                if raw_analysis.strip().startswith("{"):
                    parsed_eval = _json.loads(raw_analysis)
                    confidence_score = float(parsed_eval.get("confidence_score", 0.0))
                    communication_score = float(parsed_eval.get("communication_score", 0.0))
                    technical_depth_score = float(parsed_eval.get("technical_depth_score", 0.0))
                    authenticity_score = float(parsed_eval.get("authenticity_score", 0.0))
                    analysis = str(parsed_eval.get("analysis", "")).strip() or raw_analysis
                else:
                    analysis = raw_analysis
            except Exception:
                analysis = raw_analysis

    turn = InterviewTurnLog(
        interview_id=interview_id,
        role=role,
        source=source,
        content=content,
        analysis=analysis,
        score=score,
        confidence_score=confidence_score,
        communication_score=communication_score,
        technical_depth_score=technical_depth_score,
        authenticity_score=authenticity_score,
    )
    db.add(turn)
    db.commit()
    db.refresh(turn)
    return turn


@router.get("/interviews/{interview_id}/security-events", response_model=list[InterviewSecurityEventOut])
def list_security_events(interview_id: UUID, db: Session = Depends(get_db)):
    events = db.execute(
        select(InterviewSecurityEvent)
        .where(InterviewSecurityEvent.interview_id == interview_id)
        .order_by(InterviewSecurityEvent.created_at.asc())
    ).scalars().all()
    return list(events)


@router.post("/interviews/{interview_id}/security-events", response_model=InterviewSecurityEventOut)
def add_security_event(interview_id: UUID, payload: InterviewSecurityEventCreate, db: Session = Depends(get_db)):
    import json as _json

    interview = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview session not found")

    event = InterviewSecurityEvent(
        interview_id=interview_id,
        event_type=payload.event_type.strip().lower(),
        severity=_normalize_severity(payload.severity),
        details=(payload.details or "").strip()[:1500],
        evidence_json=_json.dumps(payload.evidence or {}),
    )
    db.add(event)
    _recalculate_interview_integrity(db, interview)
    db.commit()
    db.refresh(event)
    return event


@router.get("/interviews/{interview_id}/qna-map")
def qna_map(interview_id: UUID, db: Session = Depends(get_db)):
    turns = db.execute(
        select(InterviewTurnLog)
        .where(InterviewTurnLog.interview_id == interview_id)
        .order_by(InterviewTurnLog.created_at.asc())
    ).scalars().all()

    pairs: list[dict] = []
    current_q = None
    for turn in turns:
        if turn.role == "assistant":
            current_q = {"question": turn.content, "answers": []}
            pairs.append(current_q)
            continue
        if turn.role == "candidate":
            if current_q is None:
                current_q = {"question": "", "answers": []}
                pairs.append(current_q)
            current_q["answers"].append(
                {"content": turn.content, "analysis": turn.analysis, "score": turn.score, "source": turn.source}
            )

    return {"interview_id": str(interview_id), "qna_pairs": pairs}


@router.get("/interviews/{interview_id}/state-trace")
def interview_state_trace(interview_id: UUID, db: Session = Depends(get_db)):
    turns = db.execute(
        select(InterviewTurnLog)
        .where(InterviewTurnLog.interview_id == interview_id)
        .order_by(InterviewTurnLog.created_at.asc())
    ).scalars().all()

    assistant_turns = [t for t in turns if t.role == "assistant"]
    candidate_turns = [t for t in turns if t.role == "candidate"]
    trace = [
        {"question": t.content, "rationale": t.analysis, "created_at": t.created_at.isoformat()}
        for t in assistant_turns
    ]
    security_count = db.execute(
        select(func.count())
        .select_from(InterviewSecurityEvent)
        .where(InterviewSecurityEvent.interview_id == interview_id)
    ).scalar_one()
    session = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    return {
        "interview_id": str(interview_id),
        "assistant_questions_count": len(assistant_turns),
        "candidate_answers_count": len(candidate_turns),
        "status": session.status if session else "unknown",
        "integrity_score": session.integrity_score if session else 0.0,
        "risk_level": session.risk_level if session else "unknown",
        "security_events_count": security_count,
        "trace": trace,
    }


@router.post("/interviews/send-link", response_model=SendInterviewLinkResponse)
def send_interview_link(payload: SendInterviewLinkRequest, db: Session = Depends(get_db)):
    row = db.execute(
        select(Candidate, Job)
        .join(Job, Job.id == Candidate.job_id)
        .where(Candidate.id == payload.candidate_id)
        .where(Job.id == payload.job_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Candidate/job combination not found")

    candidate, job = row
    ok, result = create_and_send_invite(db, candidate, job)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Mail send failed: {result}")

    latest = db.execute(
        select(InterviewSession)
        .where(InterviewSession.candidate_id == candidate.id)
        .where(InterviewSession.job_id == job.id)
        .order_by(InterviewSession.created_at.desc())
    ).scalars().first()

    return SendInterviewLinkResponse(
        interview_id=latest.id,
        interview_link=result,
        email_sent=True,
    )


@router.post("/interviews/send-links-for-job/{job_id}", response_model=BulkInviteResponse)
def send_links_for_job(job_id: UUID, db: Session = Depends(get_db)):
    job = db.execute(select(Job).where(Job.id == job_id)).scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    candidates = db.execute(select(Candidate).where(Candidate.job_id == job_id)).scalars().all()
    if not candidates:
        raise HTTPException(status_code=400, detail="No candidates found for this job")

    attempted = len(candidates)
    sent = 0
    failures: list[str] = []

    for candidate in candidates:
        ok, result = create_and_send_invite(db, candidate, job)
        if ok:
            sent += 1
        else:
            failures.append(result)

    return BulkInviteResponse(
        job_id=job_id,
        attempted=attempted,
        sent=sent,
        failed=attempted - sent,
        failures=failures,
    )


@router.get("/analytics/dashboard", response_model=DashboardStats)
def dashboard_stats(db: Session = Depends(get_db)):
    total_jobs = db.execute(select(func.count()).select_from(Job)).scalar_one()
    total_candidates = db.execute(select(func.count()).select_from(Candidate)).scalar_one()
    total_interviews = db.execute(select(func.count()).select_from(InterviewSession)).scalar_one()
    in_progress_interviews = db.execute(
        select(func.count()).select_from(InterviewSession).where(InterviewSession.status == "in_progress")
    ).scalar_one()
    completed_interviews = db.execute(
        select(func.count()).select_from(InterviewSession).where(InterviewSession.status == "completed")
    ).scalar_one()

    return DashboardStats(
        total_jobs=total_jobs,
        total_candidates=total_candidates,
        total_interviews=total_interviews,
        in_progress_interviews=in_progress_interviews,
        completed_interviews=completed_interviews,
    )
