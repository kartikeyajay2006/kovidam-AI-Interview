from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class JobCreate(BaseModel):
    title: str = Field(min_length=2)
    description: str = Field(min_length=5)
    difficulty: str = "medium"
    interview_type: str = "mixed"
    duration_minutes: int = 45


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    description: str
    difficulty: str
    interview_type: str
    duration_minutes: int


class CandidateCreate(BaseModel):
    job_id: UUID
    name: str
    email: str
    phone: str = ""
    skills: str = ""


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    name: str
    email: str
    phone: str
    skills: str


class InterviewCreate(BaseModel):
    candidate_id: UUID
    job_id: UUID
    status: str = "scheduled"


class InterviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    candidate_id: UUID
    job_id: UUID
    status: str
    integrity_score: float


class ResumeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    candidate_id: UUID
    job_id: UUID
    file_name: str
    file_path: str
    mime_type: str
    extracted_email: str
    extracted_phone: str
    extracted_skills: str


class DashboardStats(BaseModel):
    total_jobs: int
    total_candidates: int
    total_interviews: int
    in_progress_interviews: int
    completed_interviews: int
