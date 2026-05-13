import json
from typing import Iterable

import httpx

from app.core.config import get_settings


def _fallback_question(role_title: str, resume_skills: str, history_len: int) -> tuple[str, str]:
    skills = [s.strip() for s in (resume_skills or "").split(",") if s.strip()]
    key_skill = skills[min(history_len, len(skills) - 1)] if skills else "your most important project"
    if history_len == 0:
        return (
            f"Let's start with your background. Tell me about a project where you used {key_skill} in production.",
            "Opening resume-based technical depth question.",
        )
    if history_len == 1:
        return (
            f"What was the hardest engineering trade-off you handled while working on {key_skill}?",
            "Follow-up to evaluate problem-solving depth.",
        )
    return (
        f"For the {role_title} role, what would you improve in that project if you had two more weeks?",
        "Assesses ownership and optimization mindset.",
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
        return _fallback_question(role_title, resume_skills, len(cleaned_history))

    prompt = {
        "role_title": role_title,
        "resume_skills": resume_skills,
        "resume_excerpt": (resume_text or "")[:3000],
        "history": cleaned_history,
        "instruction": (
            "You are a senior interviewer. Ask exactly one concise spoken question, based on resume and prior answer. "
            "If candidate answer seems vague, ask deeper technical follow-up. "
            "Return strict JSON: {\"question\":\"...\", \"rationale\":\"...\"}."
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
        "temperature": 0.4,
        "max_tokens": 220,
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

    return _fallback_question(role_title, resume_skills, len(cleaned_history))


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
