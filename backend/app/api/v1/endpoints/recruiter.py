import shutil
import uuid
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models.entities import Candidate, InterviewSession, Job, Resume
from app.schemas.recruiter import (
    BulkInviteResponse,
    CandidateCreate,
    CandidateOut,
    DashboardStats,
    InterviewCreate,
    InterviewDetail,
    InterviewOut,
    JobCreate,
    JobOut,
    ResumeOut,
    SendInterviewLinkRequest,
    SendInterviewLinkResponse,
)
from app.services.email_service import send_interview_email
from app.services.resume_parser import (
    ensure_upload_dir,
    extract_email,
    extract_name,
    extract_phone,
    extract_skills,
    extract_text,
    sanitize_text,
)

router = APIRouter(tags=["recruiter"])
UPLOAD_DIR = ensure_upload_dir("/app/uploads")

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


def create_and_send_invite(db: Session, candidate: Candidate, job: Job) -> tuple[bool, str]:
    target_email = candidate.email
    if not is_deliverable_email(target_email):
        latest_resume = db.execute(
            select(Resume).where(Resume.candidate_id == candidate.id).order_by(Resume.created_at.desc())
        ).scalars().first()
        if latest_resume and latest_resume.extracted_email and is_deliverable_email(latest_resume.extracted_email):
            target_email = latest_resume.extracted_email
            candidate.email = target_email
            db.commit()
        else:
            return False, f"{candidate.name}: invalid recipient email"

    interview = InterviewSession(candidate_id=candidate.id, job_id=job.id, status="scheduled")
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
    job_exists = db.execute(select(Job.id).where(Job.id == payload.job_id)).first()
    if not job_exists:
        raise HTTPException(status_code=404, detail="Job not found")

    validate_recipient_email(payload.email)

    candidate = Candidate(**payload.model_dump())
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return candidate


@router.get("/candidates", response_model=list[CandidateOut])
def list_candidates(db: Session = Depends(get_db)):
    candidates = db.execute(select(Candidate).order_by(Candidate.created_at.desc())).scalars().all()
    return list(candidates)


@router.post("/interviews", response_model=InterviewOut)
def create_interview(payload: InterviewCreate, db: Session = Depends(get_db)):
    candidate_exists = db.execute(select(Candidate.id).where(Candidate.id == payload.candidate_id)).first()
    if not candidate_exists:
        raise HTTPException(status_code=404, detail="Candidate not found")

    job_exists = db.execute(select(Job.id).where(Job.id == payload.job_id)).first()
    if not job_exists:
        raise HTTPException(status_code=404, detail="Job not found")

    interview = InterviewSession(**payload.model_dump())
    db.add(interview)
    db.commit()
    db.refresh(interview)
    return interview


@router.get("/interviews", response_model=list[InterviewOut])
def list_interviews(db: Session = Depends(get_db)):
    interviews = db.execute(select(InterviewSession).order_by(InterviewSession.created_at.desc())).scalars().all()
    return list(interviews)


@router.get("/interviews/{interview_id}", response_model=InterviewDetail)
def get_interview(interview_id: UUID, db: Session = Depends(get_db)):
    row = db.execute(
        select(InterviewSession, Candidate, Job)
        .join(Candidate, Candidate.id == InterviewSession.candidate_id)
        .join(Job, Job.id == InterviewSession.job_id)
        .where(InterviewSession.id == interview_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Interview session not found")

    interview, candidate, job = row
    return InterviewDetail(
        id=interview.id,
        candidate_id=candidate.id,
        candidate_name=candidate.name,
        candidate_email=candidate.email,
        job_id=job.id,
        job_title=job.title,
        status=interview.status,
        integrity_score=interview.integrity_score,
    )


@router.post("/interviews/{interview_id}/start", response_model=InterviewOut)
def start_interview(interview_id: UUID, db: Session = Depends(get_db)):
    interview = db.execute(select(InterviewSession).where(InterviewSession.id == interview_id)).scalars().first()
    if not interview:
        raise HTTPException(status_code=404, detail="Interview session not found")

    if interview.status == "completed":
        raise HTTPException(status_code=400, detail="Interview is already completed")

    interview.status = "in_progress"
    db.commit()
    db.refresh(interview)
    return interview


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


@router.post("/resumes/upload-and-register", response_model=ResumeOut)
def upload_resume_and_register(
    job_id: UUID = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported")

    job = db.execute(select(Job).where(Job.id == job_id)).scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    saved_name = f"{uuid.uuid4()}{suffix}"
    saved_path = UPLOAD_DIR / saved_name

    with saved_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    text = sanitize_text(extract_text(saved_path))
    extracted_email = extract_email(text)
    extracted_phone = extract_phone(text)
    extracted_skills = extract_skills(text)
    extracted_name = extract_name(text) or Path(file.filename).stem.replace("_", " ").replace("-", " ").title()

    if not extracted_email:
        raise HTTPException(status_code=400, detail="Could not extract candidate email from resume")

    existing_candidate = db.execute(
        select(Candidate).where(Candidate.job_id == job_id).where(Candidate.email == extracted_email)
    ).scalars().first()

    if existing_candidate:
        candidate = existing_candidate
        if extracted_name:
            candidate.name = extracted_name
        if extracted_phone:
            candidate.phone = extracted_phone
        if extracted_skills:
            candidate.skills = extracted_skills
    else:
        candidate = Candidate(
            job_id=job_id,
            name=extracted_name,
            email=extracted_email,
            phone=extracted_phone,
            skills=extracted_skills,
        )
        db.add(candidate)
        db.flush()

    resume = Resume(
        candidate_id=candidate.id,
        job_id=job_id,
        file_name=file.filename,
        file_path=str(saved_path),
        mime_type=file.content_type or "",
        extracted_text=text,
        extracted_email=extracted_email,
        extracted_phone=extracted_phone,
        extracted_skills=extracted_skills,
    )
    db.add(resume)

    try:
        db.commit()
    except DataError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Resume contains unsupported binary text. Please upload a text-based PDF/DOCX.")

    db.refresh(resume)
    return resume


@router.post("/resumes/upload", response_model=ResumeOut)
def upload_resume(
    candidate_id: UUID = Form(...),
    job_id: UUID = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing file name")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".pdf", ".docx"}:
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported")

    cand = db.execute(select(Candidate).where(Candidate.id == candidate_id)).scalars().first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    job = db.execute(select(Job).where(Job.id == job_id)).scalars().first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    saved_name = f"{uuid.uuid4()}{suffix}"
    saved_path = UPLOAD_DIR / saved_name

    with saved_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    text = sanitize_text(extract_text(saved_path))
    extracted_email = extract_email(text)
    extracted_phone = extract_phone(text)
    extracted_skills = extract_skills(text)

    if extracted_email and (not is_deliverable_email(cand.email)) and is_deliverable_email(extracted_email):
        cand.email = extracted_email

    if extracted_phone:
        cand.phone = extracted_phone
    if extracted_skills:
        cand.skills = extracted_skills

    resume = Resume(
        candidate_id=candidate_id,
        job_id=job_id,
        file_name=file.filename,
        file_path=str(saved_path),
        mime_type=file.content_type or "",
        extracted_text=text,
        extracted_email=extracted_email,
        extracted_phone=extracted_phone,
        extracted_skills=extracted_skills,
    )
    db.add(resume)
    try:
        db.commit()
    except DataError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Resume contains unsupported binary text. Please upload a text-based PDF/DOCX.")
    db.refresh(resume)
    return resume


@router.get("/resumes", response_model=list[ResumeOut])
def list_resumes(db: Session = Depends(get_db)):
    resumes = db.execute(select(Resume).order_by(Resume.created_at.desc())).scalars().all()
    return list(resumes)


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
