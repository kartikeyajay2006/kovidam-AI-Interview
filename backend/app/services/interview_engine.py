import json
import random
import re
from typing import Iterable

import httpx

from app.core.config import get_settings


QUESTION_BANK = [
    {"main": "Tell me about a project you built recently."},
    {"main": "How do you debug an issue when your code is not working?"},
    {"main": "Explain the difference between frontend and backend development."},
    {"main": "What happens when you type a URL into a browser?"},
    {"main": "What is version control and why is Git important?"},
    {"main": "How do APIs work?"},
    {"main": "What is the difference between SQL and NoSQL databases?"},
    {"main": "How do you write clean and maintainable code?"},
    {"main": "Describe a time when you worked in a team on a technical project."},
]

PII_LINE_HINTS = ("email", "mail", "phone", "mobile", "address", "location", "contact", "github.com", "linkedin.com")
INTERVIEW_COMPLETE_SENTINEL = "__INTERVIEW_COMPLETE__"


def _redact_pii(text: str) -> str:
    cleaned = text or ""
    cleaned = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[redacted-email]", cleaned)
    cleaned = re.sub(r"(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{3,5}", "[redacted-number]", cleaned)
    cleaned = re.sub(r"\b\d{6}\b", "[redacted-postal-code]", cleaned)
    return cleaned


def _is_probable_contact_line(line: str) -> bool:
    lowered = (line or "").lower()
    return any(hint in lowered for hint in PII_LINE_HINTS)


def _sanitize_resume_text(resume_text: str) -> str:
    safe_lines: list[str] = []
    for raw in (resume_text or "").splitlines():
        line = _redact_pii(raw).strip(" -\t")
        if not line or _is_probable_contact_line(line):
            continue
        safe_lines.append(line)
    return "\n".join(safe_lines)


def _extract_resume_highlights(resume_text: str) -> list[str]:
    lines = [line.strip(" -\t") for line in (resume_text or "").splitlines()]
    cleaned = [line for line in lines if 20 <= len(line) <= 180]
    return cleaned[:6]


def _trim_history(history: Iterable[dict]) -> list[dict]:
    trimmed = []
    for turn in history:
        role = (turn.get("role") or "").strip().lower()
        content = (turn.get("content") or "").strip()
        if role in {"assistant", "candidate"} and content:
            trimmed.append({"role": role, "content": content})
    return trimmed


def _normalize(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _build_default_human_bank() -> list[dict]:
    items: list[dict] = []
    for idx, entry in enumerate(QUESTION_BANK, start=1):
        items.append(
            {
                "id": f"Q{idx:02d}",
                "question": entry["main"],
                "type": "main",
                "difficulty": "medium",
                "competency_bucket": "technical_depth",
            }
        )
    return items


def _extract_parsed_sections(parsed_resume_json: dict) -> dict:
    data = parsed_resume_json.get("data") if isinstance(parsed_resume_json, dict) else {}
    if not isinstance(data, dict):
        return {"skills": [], "projects": [], "experience": [], "work_experience_years": ""}

    skills = []
    skills_section = data.get("skills_section", {})
    if isinstance(skills_section, dict) and isinstance(skills_section.get("items"), list):
        skills = [str(s).strip() for s in skills_section["items"] if str(s).strip()][:40]

    projects = []
    projects_section = data.get("projects_section", {})
    if isinstance(projects_section, dict) and isinstance(projects_section.get("items"), list):
        for item in projects_section["items"][:8]:
            if isinstance(item, dict):
                projects.append(
                    {
                        "title": str(item.get("title") or "").strip(),
                        "description": str(item.get("description") or "").strip(),
                        "tech_stack": item.get("tech_stack") if isinstance(item.get("tech_stack"), list) else [],
                        "highlights": item.get("highlights") if isinstance(item.get("highlights"), list) else [],
                    }
                )

    experience = []
    experience_section = data.get("experience_section", {})
    if isinstance(experience_section, dict) and isinstance(experience_section.get("items"), list):
        for item in experience_section["items"][:10]:
            if isinstance(item, dict):
                experience.append(item)
            elif isinstance(item, str) and item.strip():
                experience.append({"summary": item.strip()})

    return {
        "skills": skills,
        "projects": projects,
        "experience": experience,
        "work_experience_years": str(data.get("work_experience_years") or "").strip(),
    }


def _infer_bucket(text: str) -> str:
    t = _normalize(text)
    if any(k in t for k in ("design", "architecture", "scale", "throughput", "latency")):
        return "system_design"
    if any(k in t for k in ("debug", "failed", "failure", "incident", "bug")):
        return "debugging"
    if any(k in t for k in ("trade-off", "complexity", "data structure", "algorithm")):
        return "problem_solving"
    if any(k in t for k in ("team", "conflict", "ownership", "collaborat")):
        return "ownership_communication"
    return "technical_depth"


def _build_coverage_state(cleaned_history: list[dict]) -> dict:
    covered: dict[str, int] = {}
    for turn in cleaned_history:
        if turn.get("role") != "assistant":
            continue
        bucket = _infer_bucket(turn.get("content", ""))
        covered[bucket] = covered.get(bucket, 0) + 1
    priority = ["technical_depth", "problem_solving", "debugging", "system_design", "ownership_communication"]
    uncovered = [b for b in priority if b not in covered]
    return {"covered_counts": covered, "uncovered_priority": uncovered}


def _is_repetitive(candidate_question: str, asked_questions: list[str]) -> bool:
    q_norm = _normalize(candidate_question)
    if not q_norm:
        return True
    q_tokens = set(q_norm.split())
    for asked in asked_questions:
        a_norm = _normalize(asked)
        if not a_norm:
            continue
        if q_norm == a_norm:
            return True
        a_tokens = set(a_norm.split())
        overlap = len(q_tokens & a_tokens)
        denom = max(1, min(len(q_tokens), len(a_tokens)))
        if overlap / denom >= 0.8:
            return True
    return False


def _fallback_question(role_title: str, resume_skills: str, resume_text: str, history: list[dict]) -> tuple[str, str]:
    skills = [s.strip() for s in (resume_skills or "").split(",") if s.strip()]
    highlights = _extract_resume_highlights(_sanitize_resume_text(resume_text))

    if not history:
        if highlights:
            return (
                f"Your resume mentions: '{highlights[0]}'. Can you walk me through your exact contribution and impact?",
                "Fallback resume-grounded opening question.",
            )
        if skills:
            return (
                f"Pick one project where you used {skills[0]} and explain architecture, scale, and one production issue.",
                "Fallback skill-grounded opening question.",
            )
        return (
            f"For the {role_title} role, describe your strongest project and the toughest technical challenge you solved.",
            "Fallback general opening question.",
        )

    return (
        "In your previous answer, what trade-off did you choose, and what alternative did you reject?",
        "Fallback adaptive follow-up.",
    )


def _select_current_main(asked_assistant_questions: list[str], bank: list[dict]) -> tuple[int, str]:
    main_questions = [b["question"] for b in bank if b.get("type") == "main" and b.get("question")]
    if not main_questions:
        return 0, "Tell me about a project you built recently."
    asked = [_normalize(a) for a in asked_assistant_questions]
    for idx, q in enumerate(main_questions):
        if _normalize(q) not in asked:
            return idx, q
    return len(main_questions) - 1, main_questions[-1]


def _count_followups_after_main(cleaned_history: list[dict], main_question: str) -> int:
    norm_main = _normalize(main_question)
    assistant_turns = [t for t in cleaned_history if t.get("role") == "assistant"]
    pos = -1
    for i, t in enumerate(assistant_turns):
        if _normalize(t.get("content", "")) == norm_main:
            pos = i
    if pos == -1:
        return 0
    return max(0, len(assistant_turns) - pos - 1)


def _determine_main_state(cleaned_history: list[dict], main_questions: list[str]) -> tuple[int, int]:
    """
    Returns (current_main_idx, followups_done_for_current_main).
    Each topic consists of exactly 3 questions (1 main + 2 followups).
    """
    assistant_turns = [t for t in cleaned_history if t.get("role") == "assistant"]
    total = len(assistant_turns)
    
    if not assistant_turns or not main_questions:
        return 0, 0

    current_main_idx = total // 3
    followups_done = total % 3

    if current_main_idx >= len(main_questions):
        # Prevent index out of bounds if conversation goes too long
        current_main_idx = len(main_questions) - 1
        followups_done = 2
        
    return current_main_idx, followups_done


def _generate_ai_followups(
    *,
    settings,
    main_question: str,
    role_title: str,
    job_description: str,
    interview_type: str,
    difficulty: str,
    parsed_sections: dict,
    cleaned_history: list[dict],
) -> tuple[str, str]:
    if not settings.openai_api_key:
        return "What would you improve if you rebuilt it today?", "api_skipped:no_openai_key"

    prompt = {
        "task": "Generate EXACTLY ONE technical follow-up interview question based deeply on the candidate's last answer.",
        "main_question": main_question,
        "job_context": {
            "role_title": role_title,
            "job_description": (job_description or "")[:3000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "candidate_context": {
            "skills": parsed_sections.get("skills", []),
            "projects": parsed_sections.get("projects", []),
            "experience": parsed_sections.get("experience", []),
            "work_experience_years": parsed_sections.get("work_experience_years", ""),
        },
        "full_interview_history": cleaned_history,
        "constraints": [
            "Return strict JSON only",
            "Do not repeat earlier asked questions",
            "CRITICAL: If the candidate's incredibly recent answer appears cut-off in the middle of a sentence, abruptly ended, or too short (as if their microphone paused or glitched), DO NOT ask a new technical question. Instead, warmly and naturally ask them if they want to finish their thought (e.g. 'Oh, it sounded like your mic cut out there, take your time if you wanted to add more to that.').",
            "Act incredibly human. Acknowledge their answers using empathetic conversational fillers like 'Ah, I see', 'Makes perfect sense', or 'That is actually a really clever approach'.",
            "Draw bold connections between their current answer and things they said MUCH earlier in the interview (cross-referencing full history) to make it feel cohesive.",
            "Ask a concrete, technical, evaluable question that pushes deep into exactly what they just explained.",
        ],
        "output_schema": {"followup": "string"},
    }

    body = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system", 
                "content": (
                    "You are a warm, conversational senior technical interviewer. "
                    "Speak naturally like a real human. Return strict JSON only."
                )
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.25,
        "max_tokens": 150,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=20) as client:
            resp = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
                json=body,
            )
            resp.raise_for_status()
            parsed = json.loads(resp.json()["choices"][0]["message"]["content"])
            q = str(parsed.get("followup") or "").strip()
            if q:
                return q, "api_success"
            return "What would you improve if you rebuilt it today?", "api_invalid_followups_shape"
    except Exception as exc:
        return "What would you improve if you rebuilt it today?", f"api_error:{str(exc)[:120]}"


def _generate_ai_main_question(
    *,
    settings,
    main_topic: str,
    role_title: str,
    job_description: str,
    interview_type: str,
    difficulty: str,
    parsed_sections: dict,
    cleaned_history: list[dict],
) -> tuple[str, str]:
    if not settings.openai_api_key:
        return main_topic, "api_skipped:no_openai_key"

    prompt = {
        "task": "Generate one human-like technical interview question.",
        "target_main_topic": main_topic,
        "job_context": {
            "role_title": role_title,
            "job_description": (job_description or "")[:3000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "candidate_context": {
            "skills": parsed_sections.get("skills", []),
            "projects": parsed_sections.get("projects", []),
            "experience": parsed_sections.get("experience", []),
            "work_experience_years": parsed_sections.get("work_experience_years", ""),
        },
        "history": cleaned_history,
        "constraints": [
            "Return strict JSON only",
            "Question should sound warm, natural, and highly conversational (e.g. 'I see you worked on X, could you tell me more about...')",
            "CRITICAL: If the candidate's very last answer seems cut-off, prematurely stopped, or unnaturally short (as if their microphone dropped), DO NOT blindly plow forward with the new main topic. Instead, politely check in and let them finish (e.g., 'Before we move on, it sounded like your mic cut out... did you want to finish your thought?').",
            "Keep one question only (no multi-question chaining)",
            "Tie the new topic back to something they said earlier in the interview to make the transition incredibly natural.",
            "Technically evaluable and role-relevant",
        ],
        "output_schema": {"question": "string"},
    }
    body = {
        "model": settings.openai_model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a warm, conversational senior technical interviewer. "
                    "Speak naturally like a real human interviewer while staying concise and technical. "
                    "Return strict JSON only."
                ),
            },
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.35,
        "max_tokens": 150,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=20) as client:
            resp = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
                json=body,
            )
            resp.raise_for_status()
            parsed = json.loads(resp.json()["choices"][0]["message"]["content"])
            q = str(parsed.get("question") or "").strip()
            if q:
                return q, "api_success"
            return main_topic, "api_invalid_main_shape"
    except Exception as exc:
        return main_topic, f"api_error:{str(exc)[:120]}"


def generate_interview_question(
    *,
    role_title: str,
    job_description: str,
    interview_type: str,
    difficulty: str,
    resume_text: str,
    resume_skills: str,
    parsed_resume_json: dict,
    human_question_bank: list[dict],
    history: list[dict],
) -> tuple[str, str]:
    cleaned_history = _trim_history(history)
    settings = get_settings()

    bank = human_question_bank if human_question_bank else _build_default_human_bank()
    parsed_sections = _extract_parsed_sections(parsed_resume_json)
    safe_resume_text = _sanitize_resume_text(resume_text)[:4000]
    main_questions = [b["question"] for b in bank if b.get("type") == "main" and b.get("question")]
    if not main_questions:
        main_questions = [q["main"] for q in QUESTION_BANK]
    asked_questions = [t["content"] for t in cleaned_history if t.get("role") == "assistant"]
    current_main_idx, followups_done = _determine_main_state(cleaned_history, main_questions)

    # No main asked yet -> ask first (AI wording over configured main topic).
    if not asked_questions:
        ai_main_q, main_meta = _generate_ai_main_question(
            settings=settings,
            main_topic=main_questions[0],
            role_title=role_title,
            job_description=job_description,
            interview_type=interview_type,
            difficulty=difficulty,
            parsed_sections=parsed_sections,
            cleaned_history=cleaned_history,
        )
        return ai_main_q, f"source=main state=main_1_start {main_meta}"

    # If last main is complete (2 followups done), move to next main.
    if followups_done >= 2:
        next_main_idx = current_main_idx + 1
        if next_main_idx >= len(main_questions):
            return INTERVIEW_COMPLETE_SENTINEL, "source=complete state=all_main_completed"
        ai_main_q, main_meta = _generate_ai_main_question(
            settings=settings,
            main_topic=main_questions[next_main_idx],
            role_title=role_title,
            job_description=job_description,
            interview_type=interview_type,
            difficulty=difficulty,
            parsed_sections=parsed_sections,
            cleaned_history=cleaned_history,
        )
        return ai_main_q, f"source=main state=main_{next_main_idx + 1}_start {main_meta}"

    current_main_question = main_questions[current_main_idx]
    followup_q, followup_meta = _generate_ai_followups(
        settings=settings,
        main_question=current_main_question,
        role_title=role_title,
        job_description=job_description,
        interview_type=interview_type,
        difficulty=difficulty,
        parsed_sections=parsed_sections,
        cleaned_history=cleaned_history,
    )
    if followups_done < 2:
        if not _is_repetitive(followup_q, asked_questions):
            return followup_q, (
                f"source=ai_followup state=main_{current_main_idx + 1} "
                f"followup={followups_done + 1}/2 {followup_meta}"
            )
        # If generated follow-up repeats, use a deterministic safe fallback follow-up.
        safe_followup = (
            "What was the hardest technical challenge in that context?"
            if followups_done == 0
            else "What would you improve if you rebuilt it today?"
        )
        return safe_followup, (
            f"source=fallback_followup state=main_{current_main_idx + 1} "
            f"followup={followups_done + 1}/2 reason=repetitive"
        )

    return _fallback_question(role_title, resume_skills, safe_resume_text, cleaned_history)


def analyze_candidate_answer(
    answer: str,
    role_title: str,
    candidate_info: dict | None = None,
    full_history: list[dict] | None = None,
) -> tuple[str, float]:
    cleaned = (answer or "").strip()
    if not cleaned:
        return "No answer provided.", 0.0

    settings = get_settings()
    if not settings.openai_api_key:
        word_count = len(cleaned.split())
        if word_count < 10:
            return "Answer is very short. Needs more technical depth.", 3.5
        if word_count < 25:
            return "Answer is clear but could include more concrete examples.", 6.0
        return "Good detail level. Continue probing architecture and trade-offs.", 7.5

    prompt = {
        "role_title": role_title,
        "candidate_info": candidate_info or {},
        "interview_history_from_start": (full_history or [])[-80:],
        "candidate_answer": cleaned[:2000],
        "instruction": (
            "Analyze the candidate answer deeply. Evaluate communication, technical knowledge, confidence, "
            "problem-solving, ownership, clarity of thought, and authenticity (including signs of memorized answers). "
            "Do not reveal scores to candidate-facing text. "
            "Return strict JSON only. Do not wrap the JSON in any other object like 'evaluation'. "
            "Your response must be a single flat JSON object with EXACTLY these keys: "
            "{\"analysis\":\"candidate-facing concise feedback\","
            "\"confidence_score\": number,"
            "\"communication_score\": number,"
            "\"technical_depth_score\": number,"
            "\"authenticity_score\": number,"
            "\"hiring_recommendation\":\"strong_yes|yes|lean_yes|lean_no|no|strong_no\","
            "\"reasoning\":\"detailed internal reasoning\","
            "\"score\": number} "
            "where all numeric scores are 0-10 and `score` is overall normalized score."
        ),
    }

    request_body = {
        "model": settings.openai_model,
        "messages": [
            {"role": "system", "content": "You are a strict technical interview evaluator."},
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.2,
        "max_tokens": 220,
        "response_format": {"type": "json_object"},
    }

    try:
        with httpx.Client(timeout=20) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=request_body,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            analysis = (parsed.get("analysis") or "").strip() or "No analysis."
            score = float(parsed.get("score", 0.0))
            score = max(0.0, min(10.0, score))
            return analysis, score
    except Exception:
        pass

    return "Answer captured for review.", 5.0
