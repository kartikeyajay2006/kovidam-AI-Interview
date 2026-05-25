import json
import time
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.entities import Candidate, InterviewSession, InterviewTurnLog, Job
from app.services.interview_engine import INTERVIEW_COMPLETE_SENTINEL, generate_interview_question

router = APIRouter(tags=["realtime"])


def _safe_source(value: str) -> str:
    src = (value or "speech").strip().lower()
    if src in {"speech", "text", "system", "proctor"}:
        return src
    return "speech"


def _lightweight_candidate_scoring(content: str) -> tuple[str, float, float, float, float, float]:
    wc = len((content or "").split())
    if wc < 8:
        analysis, score = "Answer captured. Please expand with more specifics.", 4.0
    elif wc < 20:
        analysis, score = "Answer captured. Good start; add concrete steps and outcomes.", 5.8
    else:
        analysis, score = "Answer captured for recruiter review.", 6.8
    confidence = max(0.0, min(10.0, round(score - 0.4, 2)))
    communication = max(0.0, min(10.0, round(score, 2)))
    technical = max(0.0, min(10.0, round(score - 0.2, 2)))
    authenticity = max(0.0, min(10.0, round(score - 0.1, 2)))
    return analysis, score, confidence, communication, technical, authenticity


def _build_resume_context(parsed_resume_json: dict) -> tuple[str, str]:
    if not isinstance(parsed_resume_json, dict) or not parsed_resume_json:
        return "", ""

    data = parsed_resume_json.get("data") if isinstance(parsed_resume_json.get("data"), dict) else {}
    skills: list[str] = []
    skills_section = data.get("skills_section", {})
    if isinstance(skills_section, dict) and isinstance(skills_section.get("items"), list):
        skills = [str(s).strip() for s in skills_section.get("items", []) if str(s).strip()][:25]

    project_lines: list[str] = []
    projects_section = data.get("projects_section", {})
    if isinstance(projects_section, dict) and isinstance(projects_section.get("items"), list):
        for item in projects_section["items"][:3]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            description = str(item.get("description") or "").strip()
            highlights = item.get("highlights", [])
            joined = "; ".join(str(h).strip() for h in highlights[:3] if str(h).strip()) if isinstance(highlights, list) else ""
            line = " | ".join([p for p in [title, description, joined] if p])
            if line:
                project_lines.append(line)

    resume_text = "\n".join(project_lines) or str(data.get("raw_text_preview") or "").strip()
    return resume_text[:3000], ", ".join(skills)


def _serialize_history(turns: list[InterviewTurnLog]) -> list[dict]:
    history: list[dict] = []
    for t in turns:
        if t.role == "assistant" and t.source == "proctor":
            continue
        content = (t.content or "").strip()
        if not content:
            continue
        history.append({"role": t.role, "content": content})
    return history


@router.websocket("/ws/interviews/{interview_id}")
async def interview_realtime_socket(websocket: WebSocket, interview_id: str):
    try:
        interview_uuid = UUID(interview_id)
    except ValueError:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    db = SessionLocal()
    try:
        await websocket.send_json({"type": "hello", "interview_id": interview_id, "protocol": "interview-v1"})
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except Exception:
                await websocket.send_json({"type": "error", "detail": "Invalid JSON payload"})
                continue

            msg_type = str(payload.get("type") or "").strip().lower()
            if msg_type == "ping":
                await websocket.send_json({"type": "pong", "ts": int(time.time() * 1000)})
                continue

            row = db.execute(
                select(InterviewSession, Candidate, Job)
                .join(Candidate, Candidate.id == InterviewSession.candidate_id)
                .join(Job, Job.id == InterviewSession.job_id)
                .where(InterviewSession.id == interview_uuid)
            ).first()
            if not row:
                await websocket.send_json({"type": "error", "detail": "Interview session not found"})
                continue

            interview, candidate, job = row
            if interview.status == "scheduled":
                interview.status = "in_progress"
                db.commit()

            if msg_type == "candidate_answer":
                content = str(payload.get("content") or "").strip()
                if not content:
                    await websocket.send_json({"type": "error", "detail": "Answer content is required"})
                    continue
                source = _safe_source(str(payload.get("source") or "speech"))
                analysis, score, conf, comm, tech, auth = _lightweight_candidate_scoring(content)
                turn = InterviewTurnLog(
                    interview_id=interview_uuid,
                    role="candidate",
                    source=source,
                    content=content,
                    analysis=analysis,
                    score=score,
                    confidence_score=conf,
                    communication_score=comm,
                    technical_depth_score=tech,
                    authenticity_score=auth,
                )
                db.add(turn)
                db.commit()
                db.refresh(turn)
                await websocket.send_json(
                    {
                        "type": "ack_turn",
                        "role": "candidate",
                        "source": source,
                        "content": content,
                        "analysis": analysis,
                        "score": score,
                    }
                )
            elif msg_type not in {"request_next", "candidate_answer"}:
                await websocket.send_json({"type": "error", "detail": "Unsupported message type"})
                continue

            turns = db.execute(
                select(InterviewTurnLog)
                .where(InterviewTurnLog.interview_id == interview_uuid)
                .order_by(InterviewTurnLog.created_at.asc())
            ).scalars().all()
            history = _serialize_history(turns)

            try:
                resume_json = json.loads(candidate.parsed_resume_json or "{}")
            except Exception:
                resume_json = {}
            resume_text, parsed_skills = _build_resume_context(resume_json)
            resume_skills = parsed_skills or (candidate.skills or "")

            start_ms = time.perf_counter()
            question, rationale = generate_interview_question(
                role_title=job.title,
                job_description=job.description,
                interview_type=job.interview_type,
                difficulty=job.difficulty,
                resume_text=resume_text,
                resume_skills=resume_skills,
                parsed_resume_json=resume_json,
                human_question_bank=[],
                history=history,
                candidate_name=candidate.name,
            )
            latency_ms = int((time.perf_counter() - start_ms) * 1000)

            if question == INTERVIEW_COMPLETE_SENTINEL:
                interview.status = "completed"
                db.commit()
                await websocket.send_json(
                    {
                        "type": "interview_completed",
                        "detail": "Interview complete. Thank you for your responses.",
                        "latency_ms": latency_ms,
                    }
                )
                continue

            rationale = f"{rationale} job={job.title} jd_excerpt={job.description[:120]}"
            db.add(
                InterviewTurnLog(
                    interview_id=interview_uuid,
                    role="assistant",
                    source="system",
                    content=question,
                    analysis=rationale,
                    score=0.0,
                )
            )
            db.commit()

            await websocket.send_json(
                {
                    "type": "next_question",
                    "question": question,
                    "rationale": rationale,
                    "latency_ms": latency_ms,
                    "target_met": latency_ms < 1500,
                }
            )
    except WebSocketDisconnect:
        return
    finally:
        db.close()
