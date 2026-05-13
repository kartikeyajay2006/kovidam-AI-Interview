import shutil
import uuid
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import DataError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import Candidate, InterviewSession, Job, Resume
from app.schemas.recruiter import (
    CandidateCreate,
    CandidateOut,
    DashboardStats,
    InterviewCreate,
    InterviewOut,
    JobCreate,
    JobOut,
    ResumeOut,
)
from app.services.resume_parser import (
    ensure_upload_dir,
    extract_email,
    extract_phone,
    extract_skills,
    extract_text,
    sanitize_text,
)

router = APIRouter(tags=["recruiter"])
UPLOAD_DIR = ensure_upload_dir("/app/uploads")


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

    cand = db.execute(select(Candidate.id).where(Candidate.id == candidate_id)).first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    job = db.execute(select(Job.id).where(Job.id == job_id)).first()
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
