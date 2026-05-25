from fastapi import APIRouter

from app.api.v1.endpoints.health import router as health_router
from app.api.v1.endpoints.interview_realtime import router as interview_realtime_router
from app.api.v1.endpoints.recruiter import router as recruiter_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(recruiter_router)
api_router.include_router(interview_realtime_router)
