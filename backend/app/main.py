from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.session import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    Base.metadata.create_all(bind=engine)
    # Keep older local DBs compatible with current model fields.
    with engine.begin() as conn:
        conn.execute(
            text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS question_bank TEXT NOT NULL DEFAULT ''")
        )
        conn.execute(
            text("ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS risk_level VARCHAR(32) NOT NULL DEFAULT 'low'")
        )
        conn.execute(
            text("ALTER TABLE interview_turn_logs ADD COLUMN IF NOT EXISTS source VARCHAR(32) NOT NULL DEFAULT 'speech'")
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS interview_security_events (
                    id UUID PRIMARY KEY,
                    interview_id UUID NOT NULL REFERENCES interview_sessions(id),
                    event_type VARCHAR(64) NOT NULL,
                    severity VARCHAR(16) NOT NULL DEFAULT 'medium',
                    event_index INTEGER NOT NULL DEFAULT 0,
                    prev_hash VARCHAR(128) NOT NULL DEFAULT '',
                    event_hash VARCHAR(128) NOT NULL DEFAULT '',
                    details TEXT NOT NULL DEFAULT '',
                    evidence_json TEXT NOT NULL DEFAULT '{}',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
        )
        conn.execute(
            text("ALTER TABLE interview_security_events ADD COLUMN IF NOT EXISTS event_index INTEGER NOT NULL DEFAULT 0")
        )
        conn.execute(
            text("ALTER TABLE interview_security_events ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(128) NOT NULL DEFAULT ''")
        )
        conn.execute(
            text("ALTER TABLE interview_security_events ADD COLUMN IF NOT EXISTS event_hash VARCHAR(128) NOT NULL DEFAULT ''")
        )
        conn.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS interview_evidence_snapshots (
                    id UUID PRIMARY KEY,
                    interview_id UUID NOT NULL REFERENCES interview_sessions(id),
                    security_event_id UUID NULL REFERENCES interview_security_events(id),
                    snapshot_type VARCHAR(32) NOT NULL DEFAULT 'camera',
                    image_data_url TEXT NOT NULL DEFAULT '',
                    image_hash VARCHAR(128) NOT NULL DEFAULT '',
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
                """
            )
        )
    yield


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    debug=settings.app_debug,
    lifespan=lifespan,
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)
