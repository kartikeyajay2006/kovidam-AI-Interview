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
            trimmed.append({"role": role, "content": content[:1000]})
    return trimmed[-12:]


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
) -> list[str]:
    if not settings.groq_api_key:
        return [
            "What was the hardest technical challenge in that context?",
            "What would you improve if you rebuilt it today?",
        ]

    prompt = {
        "task": "Generate exactly 2 technical follow-up interview questions.",
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
        "history": cleaned_history[-10:],
        "constraints": [
            "Return strict JSON only",
            "Do not repeat earlier asked questions",
            "Ask concrete, technical, evaluable questions",
            "Follow-ups must directly deepen the main question",
        ],
        "output_schema": {"followups": ["q1", "q2"]},
    }

    body = {
        "model": settings.groq_model,
        "messages": [
            {"role": "system", "content": "You are a senior technical interviewer. Return strict JSON only."},
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": 0.2,
        "max_tokens": 180,
        "response_format": {"type": "json_object"},
    }
    try:
        with httpx.Client(timeout=20) as client:
            resp = client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}", "Content-Type": "application/json"},
                json=body,
            )
            resp.raise_for_status()
            parsed = json.loads(resp.json()["choices"][0]["message"]["content"])
            followups = parsed.get("followups", [])
            if isinstance(followups, list):
                cleaned = [str(f).strip() for f in followups if str(f).strip()]
                if len(cleaned) >= 2:
                    return cleaned[:2]
    except Exception:
        pass
    return [
        "What was the hardest technical challenge in that context?",
        "What would you improve if you rebuilt it today?",
    ]


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
    asked_questions = [t["content"] for t in cleaned_history if t.get("role") == "assistant"]
    last_candidate_answer = ""
    for t in reversed(cleaned_history):
        if t.get("role") == "candidate" and t.get("content"):
            last_candidate_answer = t["content"][:800]
            break
    coverage_state = _build_coverage_state(cleaned_history)

    main_questions = [b["question"] for b in bank if b.get("type") == "main" and b.get("question")]
    if not main_questions:
        main_questions = [q["main"] for q in QUESTION_BANK]

    # Enforced interview rhythm:
    # Main Q -> AI Follow-up 1 -> AI Follow-up 2 -> Next Main Q
    asked_norm = [_normalize(q) for q in asked_questions]
    current_main_idx = 0
    current_main_question = main_questions[0]
    for idx, mq in enumerate(main_questions):
        if _normalize(mq) not in asked_norm:
            current_main_idx = idx
            current_main_question = mq
            break
    else:
        current_main_idx = len(main_questions) - 1
        current_main_question = main_questions[-1]

    if _normalize(current_main_question) not in asked_norm:
        return current_main_question, f"Main question {current_main_idx + 1}/{len(main_questions)}."

    followups_done = _count_followups_after_main(cleaned_history, current_main_question)

    followups = _generate_ai_followups(
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
        next_fup = followups[followups_done]
        if not _is_repetitive(next_fup, asked_questions):
            return next_fup, f"AI follow-up {followups_done + 1}/2 for main question {current_main_idx + 1}."
        # If generated follow-up repeats, use a deterministic safe fallback follow-up.
        safe_followup = (
            "What was the hardest technical challenge in that context?"
            if followups_done == 0
            else "What would you improve if you rebuilt it today?"
        )
        return safe_followup, f"Fallback follow-up {followups_done + 1}/2 for main question {current_main_idx + 1}."

    # Exactly after 2 follow-ups, move to next main question.
    next_main_idx = current_main_idx + 1
    if next_main_idx < len(main_questions):
        return main_questions[next_main_idx], f"Main question {next_main_idx + 1}/{len(main_questions)}."

    if not settings.groq_api_key:
        return _fallback_question(role_title, resume_skills, safe_resume_text, cleaned_history)

    payload = {
        "job_context": {
            "title": role_title,
            "description": (job_description or "")[:4000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "candidate_context": {
            "parsed_resume": {
                "skills_section": {"items": parsed_sections["skills"]},
                "projects_section": {"items": parsed_sections["projects"]},
                "experience_section": {"items": parsed_sections["experience"]},
                "work_experience_years": parsed_sections["work_experience_years"],
            },
            "resume_skills_csv": resume_skills,
            "resume_text_excerpt": safe_resume_text,
        },
        "human_question_bank": bank,
        "interview_runtime_state": {
            "history": cleaned_history,
            "asked_questions": asked_questions,
            "last_candidate_answer": last_candidate_answer,
            "coverage_state": coverage_state,
        },
        "instruction_policy": {
            "goal": "Pick next best technical interview question",
            "constraints": [
                "Use JD + skills/projects/experience context",
                "Avoid repeating previously asked questions",
                "Ask exactly one clear question",
                "Prefer deeper probing when candidate answers are strong",
                "If weak signal, ask evidence-seeking clarification",
                "Question must be concrete, specific, and technically evaluable",
                "No generic motivation or culture-fit unless explicitly asked by interviewer stage",
                "Prioritize uncovered competency buckets first",
            ],
            "allow_question_rewrite_from_human_bank": True,
            "strict_json_only": True,
        },
        "required_output_schema": {
            "question_id": "string",
            "question": "string",
            "why_this_question_now": "string",
            "target_skill": "string",
            "competency_bucket": "string",
            "difficulty": "easy|medium|hard",
            "expected_signal": "string",
            "follow_up_if_strong": "string",
            "follow_up_if_weak": "string",
            "anti_repeat_key": "string",
        },
    }

    request_body = {
        "model": settings.groq_model,
        "messages": [
            {
                "role": "system",
                "content": (
                "You are a senior technical interviewer. "
                    "Return strict JSON only with the exact keys from required_output_schema. "
                    "Produce one high-quality technical question only."
                ),
            },
            {"role": "user", "content": json.dumps(payload)},
        ],
        "temperature": 0.15,
        "max_tokens": 420,
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
                json=request_body,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            parsed = json.loads(content)

            question = str(parsed.get("question") or "").strip()
            if not question:
                return _fallback_question(role_title, resume_skills, safe_resume_text, cleaned_history)
            if _is_repetitive(question, asked_questions):
                return _fallback_question(role_title, resume_skills, safe_resume_text, cleaned_history)
            if len(question.split()) < 7:
                return _fallback_question(role_title, resume_skills, safe_resume_text, cleaned_history)

            rationale = str(parsed.get("why_this_question_now") or "").strip() or "LLM-selected next best question."
            target_skill = str(parsed.get("target_skill") or "").strip()
            bucket = str(parsed.get("competency_bucket") or "").strip()
            qid = str(parsed.get("question_id") or "").strip()
            difficulty_out = str(parsed.get("difficulty") or "").strip()

            final_rationale = (
                f"{rationale} "
                f"[question_id={qid or 'n/a'} | skill={target_skill or 'n/a'} | bucket={bucket or 'n/a'} | difficulty={difficulty_out or 'n/a'}]"
            )
            return question[:500], final_rationale[:1000]
    except Exception:
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
    if not settings.groq_api_key:
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
            "Return strict JSON only: "
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
        "model": settings.groq_model,
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
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.groq_api_key}",
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
