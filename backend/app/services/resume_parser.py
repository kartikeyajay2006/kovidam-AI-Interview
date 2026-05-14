import os
import re
import json
from pathlib import Path

import docx2txt
import httpx
from pypdf import PdfReader

from app.core.config import get_settings

SKILL_KEYWORDS = [
    "python", "java", "javascript", "typescript", "react", "next.js", "node.js",
    "fastapi", "django", "flask", "postgresql", "redis", "docker", "kubernetes",
    "aws", "gcp", "azure", "tensorflow", "pytorch", "langchain", "sql",
]


def extract_text(file_path: Path) -> str:
    try:
        suffix = file_path.suffix.lower()
        if suffix == ".pdf":
            reader = PdfReader(str(file_path))
            return "\n".join((page.extract_text() or "") for page in reader.pages)
        if suffix == ".docx":
            return docx2txt.process(str(file_path)) or ""
        return ""
    except Exception:
        return ""


def sanitize_text(text: str) -> str:
    return text.replace("\x00", "")


def extract_email(text: str) -> str:
    m = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)
    return m.group(0) if m else ""


def extract_phone(text: str) -> str:
    m = re.search(r"(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)?\d{3}[\s-]?\d{4}", text)
    return m.group(0) if m else ""


def extract_name(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if "@" in stripped or len(stripped) > 60:
            continue
        if re.search(r"\d", stripped):
            continue
        # Likely top line name
        words = stripped.split()
        if 1 < len(words) < 6:
            return stripped.title()
    return ""


def extract_skills(text: str) -> str:
    lowered = text.lower()
    found = [skill for skill in SKILL_KEYWORDS if skill in lowered]
    return ", ".join(sorted(set(found)))


def ensure_upload_dir(path: str) -> Path:
    upload_dir = Path(path)
    os.makedirs(upload_dir, exist_ok=True)
    return upload_dir


def extract_resume_sections(text: str) -> dict[str, str]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    section_aliases = {
        "projects": "projects",
        "project": "projects",
        "experience": "experience",
        "work experience": "experience",
        "professional experience": "experience",
        "internship": "experience",
        "internships": "experience",
    }
    stop_heads = {
        "education",
        "skills",
        "technical skills",
        "certifications",
        "achievements",
        "summary",
        "contact",
        "profile",
        "objective",
        "languages",
    }

    sections = {"projects": [], "experience": []}
    current = None
    heading_re = re.compile(
        r"(?i)^(projects?|work experience|professional experience|experience|internships?|education|skills?|technical skills|certifications?|achievements?|summary|objective|profile|contact)$"
    )
    for line in lines:
        key = re.sub(r"[^a-z ]", "", line.lower()).strip()
        if key in section_aliases or heading_re.match(key):
            if key in section_aliases:
                current = section_aliases[key]
            elif key in stop_heads:
                current = None
            continue
        if key in stop_heads:
            current = None
            continue
        if current:
            sections[current].append(line)

    return {
        "projects_section": "\n".join(sections["projects"]).strip(),
        "experience_section": "\n".join(sections["experience"]).strip(),
    }


def extract_structured_sections_fallback(text: str) -> dict[str, list[dict[str, str]]]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    projects: list[dict[str, str]] = []
    experience: list[dict[str, str]] = []
    current_block = []
    current_mode = None

    def flush_block(mode: str | None, block: list[str]) -> None:
        if not mode or not block:
            return
        title = block[0][:140]
        description = " ".join(block[1:5]).strip() if len(block) > 1 else ""
        item = {"title": title, "description": description}
        if mode == "projects":
            projects.append(item)
        elif mode == "experience":
            experience.append(item)

    for line in lines:
        key = re.sub(r"[^a-z ]", "", line.lower()).strip()
        if key in {"projects", "project"}:
            flush_block(current_mode, current_block)
            current_block = []
            current_mode = "projects"
            continue
        if key in {"experience", "work experience", "professional experience", "internship", "internships"}:
            flush_block(current_mode, current_block)
            current_block = []
            current_mode = "experience"
            continue
        if key in {"education", "skills", "technical skills", "summary", "objective", "contact"}:
            flush_block(current_mode, current_block)
            current_block = []
            current_mode = None
            continue
        if current_mode:
            current_block.append(line)
    flush_block(current_mode, current_block)

    return {"projects_items": projects[:12], "experience_items": experience[:12]}


def extract_structured_with_api(text: str) -> dict[str, str]:
    settings = get_settings()
    if not settings.groq_api_key:
        return {}

    prompt = {
        "resume_text": (text or "")[:12000],
        "instruction": (
            "Extract resume data strictly as JSON with keys: "
            "candidate_name, extracted_email, extracted_phone, extracted_skills, "
            "projects_section, experience_section. "
            "If missing, return empty string for that field."
        ),
    }
    payload = {
        "model": settings.groq_model,
        "messages": [
            {"role": "system", "content": "You extract structured data from resumes."},
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.0,
        "max_tokens": 800,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=25) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            parsed = json.loads(resp.json()["choices"][0]["message"]["content"])

            def as_text(value: object) -> str:
                if isinstance(value, str):
                    return value.strip()
                if isinstance(value, list):
                    lines = []
                    for item in value:
                        if isinstance(item, str):
                            if item.strip():
                                lines.append(item.strip())
                        elif isinstance(item, dict):
                            parts = []
                            for k in ("project_name", "project_title", "project_description", "company_name", "job_title", "duration", "description", "title"):
                                v = item.get(k)
                                if isinstance(v, str) and v.strip():
                                    parts.append(v.strip())
                            if parts:
                                lines.append(" | ".join(parts))
                    return "\n".join(lines).strip()
                if isinstance(value, dict):
                    parts = []
                    for k, v in value.items():
                        if isinstance(v, str) and v.strip():
                            parts.append(f"{k}: {v.strip()}")
                    return "\n".join(parts).strip()
                return ""

            def as_scalar(value: object) -> str:
                if isinstance(value, str):
                    return value.strip()
                if isinstance(value, list):
                    for item in value:
                        txt = as_text(item)
                        if txt:
                            return txt
                    return ""
                if isinstance(value, dict):
                    return as_text(value)
                return ""

            projects_text = as_text(parsed.get("projects_section"))
            experience_text = as_text(parsed.get("experience_section"))
            if not projects_text:
                projects_text = as_text(parsed.get("projects"))
            if not experience_text:
                experience_text = as_text(parsed.get("experience"))

            return {
                "candidate_name": as_scalar(parsed.get("candidate_name")),
                "extracted_email": as_scalar(parsed.get("extracted_email")),
                "extracted_phone": as_scalar(parsed.get("extracted_phone")),
                "extracted_skills": as_scalar(parsed.get("extracted_skills")),
                "projects_section": projects_text,
                "experience_section": experience_text,
                "api_error": "",
            }
    except Exception as exc:
        return {"api_error": str(exc)}


def save_parsed_resume(
    *,
    parsed_dir: Path,
    source_file_name: str,
    source_file_path: str,
    candidate_name: str,
    extracted_email: str,
    extracted_phone: str,
    extracted_skills: str,
    extracted_text: str,
) -> Path:
    os.makedirs(parsed_dir, exist_ok=True)
    output_path = parsed_dir / f"{Path(source_file_path).stem}.json"
    sections = extract_resume_sections(extracted_text)
    structured_fallback = extract_structured_sections_fallback(extracted_text)
    api_data = extract_structured_with_api(extracted_text)
    payload = {
        "source_file_name": source_file_name,
        "source_file_path": source_file_path,
        "candidate_name": api_data.get("candidate_name") or candidate_name,
        "extracted_email": api_data.get("extracted_email") or extracted_email,
        "extracted_phone": api_data.get("extracted_phone") or extracted_phone,
        "extracted_skills": api_data.get("extracted_skills") or extracted_skills,
        "projects_section": api_data.get("projects_section") or sections["projects_section"],
        "experience_section": api_data.get("experience_section") or sections["experience_section"],
        "projects_items": structured_fallback["projects_items"],
        "experience_items": structured_fallback["experience_items"],
        "extracted_text_preview": extracted_text[:1500],
        "extracted_text_full": extracted_text,
        "parsed_by": "groq_api" if api_data else "local_regex",
        "api_error": api_data.get("api_error", ""),
    }
    output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    return output_path
