import json
from typing import Iterable

import httpx

from app.core.config import get_settings


def _extract_resume_highlights(resume_text: str) -> list[str]:
    lines = [line.strip(" -\t") for line in (resume_text or "").splitlines()]
    cleaned = [line for line in lines if 20 <= len(line) <= 180]
    return cleaned[:6]


def _fallback_question(
    role_title: str,
    resume_skills: str,
    resume_text: str,
    history: list[dict],
) -> tuple[str, str]:
    skills = [s.strip() for s in (resume_skills or "").split(",") if s.strip()]
    highlights = _extract_resume_highlights(resume_text)
    last_candidate_answer = ""
    for turn in reversed(history):
        if turn.get("role") == "candidate" and turn.get("content"):
            last_candidate_answer = turn["content"][:240]
            break

    if not history:
        if highlights:
            return (
                f"Your resume mentions: '{highlights[0]}'. Can you walk me through your exact contribution and impact?",
                "Resume-grounded opening question.",
            )
        if skills:
            return (
                f"Pick one project where you used {skills[0]} and explain architecture, scale, and one production issue.",
                "Skill-grounded opening question.",
            )
        return (
            f"For the {role_title} role, describe your strongest project and the toughest technical challenge you solved.",
            "General opening question.",
        )

    if last_candidate_answer:
        return (
            f"You mentioned '{last_candidate_answer}'. What trade-off did you choose, and what alternative did you reject?",
            "Adaptive follow-up based on candidate answer.",
        )

    if len(skills) > 1:
        return (
            f"How did you combine {skills[0]} with {skills[1]} in a real production workflow, and what bottleneck appeared?",
            "Cross-skill depth follow-up.",
        )

    return (
        f"If you had to redesign your most recent system for 10x traffic, what would you change first and why?",
        "System design pressure follow-up.",
    )


def _trim_history(history: Iterable[dict]) -> list[dict]:
    trimmed = []
    for turn in history:
        role = (turn.get("role") or "").strip().lower()
        content = (turn.get("content") or "").strip()
        if role in {"assistant", "candidate"} and content:
            trimmed.append({"role": role, "content": content[:1000]})
    return trimmed[-8:]


def generate_interview_question(
    *,
    role_title: str,
    resume_text: str,
    resume_skills: str,
    history: list[dict],
) -> tuple[str, str]:
    settings = get_settings()
    cleaned_history = _trim_history(history)

    if not settings.groq_api_key:
        return _fallback_question(role_title, resume_skills, resume_text, cleaned_history)

    prompt = {
        "role_title": role_title,
        "resume_skills": resume_skills,
        "resume_excerpt": (resume_text or "")[:5000],
        "history": cleaned_history,
        "instruction": (
            "You are a senior interviewer in a live voice interview.\n"
            "Requirements:\n"
            "1) Ask exactly one strong, non-generic question.\n"
            "2) The question must be grounded in resume details or candidate's last answer.\n"
            "3) Force depth: ask about architecture, trade-offs, scale, failure, debugging, or production impact.\n"
            "4) Avoid yes/no questions and avoid repeating prior questions.\n"
            "5) Keep it concise and spoken-friendly (max 35 words).\n"
            "Return strict JSON only: {\"question\":\"...\", \"rationale\":\"...\"}."
        ),
    }

    payload = {
        "model": settings.groq_model,
        "messages": [
            {
                "role": "system",
                "content": "You are an expert technical interviewer creating adaptive interview questions.",
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.25,
        "max_tokens": 260,
        "response_format": {"type": "json_object"},
    }

    try:
        with httpx.Client(timeout=25) as client:
            response = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            question = (parsed.get("question") or "").strip()
            rationale = (parsed.get("rationale") or "").strip()
            if question:
                return question, rationale or "Adaptive resume-based question."
    except Exception:
        pass

    return _fallback_question(role_title, resume_skills, resume_text, cleaned_history)


def analyze_candidate_answer(answer: str, role_title: str) -> tuple[str, float]:
    cleaned = (answer or "").strip()
    if not cleaned:
        return "No answer provided.", 0.0

    settings = get_settings()
    if not settings.groq_api_key:
        word_count = len(cleaned.split())
        if word_count < 10:
            return "Answer is very short. Needs more technical depth.", 3.5
        if word_count < 25:
            return "Answer is clear but could include more concrete examples.", 6.0
        return "Good detail level. Continue probing architecture and trade-offs.", 7.5

    prompt = {
        "role_title": role_title,
        "candidate_answer": cleaned[:2000],
        "instruction": (
            "Evaluate answer for technical depth, clarity, and confidence. "
            "Return strict JSON: {\"analysis\":\"...\", \"score\": number} where score is 0-10."
        ),
    }

    payload = {
        "model": settings.groq_model,
        "messages": [
            {"role": "system", "content": "You are a strict technical interview evaluator."},
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.2,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
    }

    try:
        with httpx.Client(timeout=20) as client:
            response = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            analysis = (parsed.get("analysis") or "").strip() or "No analysis."
            score = float(parsed.get("score", 0.0))
            score = max(0.0, min(10.0, score))
            return analysis, score
    except Exception:
        pass

    return "Answer captured for review.", 5.0
