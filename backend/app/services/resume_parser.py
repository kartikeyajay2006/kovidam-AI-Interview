import os
import re
from pathlib import Path

import docx2txt
from pypdf import PdfReader

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
