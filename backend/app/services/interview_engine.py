import json
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


def _is_repeat_request(text: str) -> bool:
    t = _normalize(text)
    if not t:
        return False
    repeat_patterns = (
        "repeat",
        "say that again",
        "come again",
        "didn't catch",
        "did not catch",
        "can you rephrase",
        "could you rephrase",
        "rephrase the question",
        "can you ask again",
        "could you ask again",
        "what was the question",
        "pardon",
        "sorry can you repeat",
    )
    return any(p in t for p in repeat_patterns)


def _is_incomplete_answer(text: str) -> bool:
    cleaned = (text or "").strip()
    if not cleaned:
        return True
    words = re.findall(r"\b\w+\b", cleaned)
    if len(words) < 8:
        return True
    weak_phrases = (
        "i can tell you",
        "that's it",
        "not sure",
        "i don't know",
        "i dont know",
        "maybe",
    )
    low = cleaned.lower()
    return any(p in low for p in weak_phrases) and len(words) < 15


def _extract_keywords(text: str, limit: int = 3) -> list[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#./-]{3,}", (text or "").lower())
    stop = {
        "that", "this", "with", "from", "have", "your", "about", "because", "would", "could",
        "there", "their", "while", "where", "what", "when", "which", "into", "under", "over",
        "like", "just", "really", "created", "system", "project", "projects", "thing", "things",
        "able", "tell", "work", "working", "using", "used",
    }
    ordered: list[str] = []
    seen: set[str] = set()
    for tok in tokens:
        if tok in stop or tok in seen:
            continue
        seen.add(tok)
        ordered.append(tok)
        if len(ordered) >= limit:
            break
    return ordered


def _fallback_intro_question(candidate_name: str, role_title: str) -> str:
    name = candidate_name.strip().split()[0] if candidate_name.strip() else "there"
    role = role_title.strip() or "this role"
    return (
        f"Hi {name}, could you walk me through one backend project you built that's most relevant to {role}, "
        "and what your exact contribution was?"
    )


def _fallback_next_question(cleaned_history: list[dict], role_title: str, parsed_sections: dict) -> str:
    last_candidate = ""
    for turn in reversed(cleaned_history):
        if turn.get("role") == "candidate":
            last_candidate = str(turn.get("content") or "").strip()
            break
    if last_candidate:
        kws = _extract_keywords(last_candidate, limit=2)
        if kws:
            return (
                f"You mentioned {kws[0]}"
                + (f" and {kws[1]}" if len(kws) > 1 else "")
                + ". Can you explain the exact steps you took, one challenge you hit, and how you measured success?"
            )
        return "Can you give one concrete example with your exact implementation steps, trade-offs, and final outcome?"

    skills = parsed_sections.get("skills") if isinstance(parsed_sections, dict) else []
    if isinstance(skills, list) and skills:
        skill = str(skills[0]).strip()
        if skill:
            return f"Let's go deeper on {skill}: where did it break in production, and what did you change to fix it?"
    role = role_title.strip() or "this role"
    return f"For {role}, can you describe a production incident you debugged and the step-by-step approach you used to resolve it?"


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


def _build_coverage_state(cleaned_history: list[dict]) -> dict:
    covered: dict[str, int] = {}
    priority = ["technical_depth", "problem_solving", "debugging", "system_design", "ownership_communication"]
    return {"covered_counts": covered, "uncovered_priority": priority}


def _build_contextual_main_questions(
    *,
    role_title: str,
    job_description: str,
    parsed_sections: dict,
    resume_skills: str,
) -> list[str]:
    topics: list[str] = []
    role = (role_title or "").strip()
    jd = (job_description or "").strip()

    if role:
        topics.append(f"Hands-on architecture and engineering decisions for the {role} role")

    skills_from_resume = []
    if isinstance(parsed_sections.get("skills"), list):
        skills_from_resume = [str(s).strip() for s in parsed_sections["skills"] if str(s).strip()][:6]

    skills_text = [s.strip() for s in (resume_skills or "").split(",") if s.strip()]
    all_skills = []
    for s in skills_from_resume + skills_text:
        if s.lower() not in {x.lower() for x in all_skills}:
            all_skills.append(s)
    for skill in all_skills[:4]:
        topics.append(f"Practical problem-solving and trade-offs using {skill}")

    project_titles = []
    if isinstance(parsed_sections.get("projects"), list):
        for project in parsed_sections["projects"][:3]:
            if isinstance(project, dict):
                title = str(project.get("title") or "").strip()
                if title:
                    project_titles.append(title)
    for title in project_titles:
        topics.append(f"Deep dive into project implementation details for {title}")

    if jd:
        jd_tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#./-]{2,}", jd)
        common = {
            "and", "with", "for", "the", "that", "this", "from", "your", "you", "will", "have", "using",
            "experience", "engineering", "developer", "development", "design", "system", "systems", "work",
        }
        picked: list[str] = []
        for tok in jd_tokens:
            low = tok.lower()
            if low in common or low.isdigit():
                continue
            if low not in {p.lower() for p in picked}:
                picked.append(tok)
            if len(picked) >= 3:
                break
        for tok in picked:
            topics.append(f"Real-world implementation, debugging, and scaling with {tok}")

    if not topics:
        return [q["main"] for q in QUESTION_BANK]

    return topics[:8]


def _determine_main_state(cleaned_history: list[dict], main_questions: list[str]) -> tuple[int, int]:
    assistant_turns = [t for t in cleaned_history if t.get("role") == "assistant"]
    total = len(assistant_turns)
    if not assistant_turns or not main_questions:
        return 0, 0
    current_main_idx = total // 3
    followups_done = total % 3
    if current_main_idx >= len(main_questions):
        current_main_idx = len(main_questions) - 1
        followups_done = 2
    return current_main_idx, followups_done


def _chat_json(settings, prompt: dict, schema_key: str, temperature: float, max_tokens: int, system_msg: str) -> str:
    body = {
        "model": settings.openai_model,
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": json.dumps(prompt)},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=10) as client:
        resp = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"},
            json=body,
        )
        resp.raise_for_status()
        parsed = json.loads(resp.json()["choices"][0]["message"]["content"])
        value = str(parsed.get(schema_key) or "").strip()
        if not value:
            raise ValueError(f"{schema_key} was empty in model response")
        return value


def _generate_ai_intro_question(*, settings, candidate_name: str, role_title: str, job_description: str, interview_type: str, difficulty: str) -> tuple[str, str]:
    prompt = {
        "task": "Generate the very first interview question.",
        "context": {
            "candidate_name": candidate_name,
            "role_title": role_title,
            "job_description": (job_description or "")[:2000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "constraints": [
            "Return strict JSON only",
            "Greet naturally if a candidate name is provided (do not force fixed phrasing)",
            "Ask a natural opening interview question grounded in role or resume context",
            "Keep it conversational and human, not robotic",
            "Use plain spoken English",
            "Single question only",
            "Avoid repeating the same opening wording across interviews",
        ],
        "output_schema": {"question": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "question",
        0.4,
        120,
        "You are a warm, human senior technical interviewer. Return strict JSON only.",
    )
    return q, "api_success"


def _generate_ai_main_question(*, settings, main_topic: str, role_title: str, job_description: str, interview_type: str, difficulty: str, parsed_sections: dict, cleaned_history: list[dict]) -> tuple[str, str]:
    prompt = {
        "task": "Generate one technical interview question.",
        "target_main_topic": main_topic,
        "job_context": {
            "role_title": role_title,
            "job_description": (job_description or "")[:3000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "candidate_context": parsed_sections,
        "history": cleaned_history,
        "constraints": [
            "Return strict JSON only",
            "One single question sentence ending with a question mark",
            "Keep one question only (no multi-question chaining)",
            "Technically evaluable and role-relevant",
            "Sound like a real interviewer with a natural transition from previous context",
            "Use concise natural spoken language (20-35 words)",
            "Avoid textbook phrasing and generic buzzwords",
            "Ask for concrete decisions, trade-offs, or debugging steps",
            "Never invent project names, metrics, or system details",
            "Only mention a metric/system if it appears verbatim in interview history or parsed candidate context",
        ],
        "output_schema": {"question": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "question",
        0.35,
        150,
        "You are a senior technical interviewer. Ask concise, deep, role-relevant, evaluable questions. Return strict JSON only.",
    )
    return q, "api_success"


def _generate_ai_followups(*, settings, main_question: str, role_title: str, job_description: str, interview_type: str, difficulty: str, parsed_sections: dict, cleaned_history: list[dict]) -> tuple[str, str]:
    coverage_state = _build_coverage_state(cleaned_history)
    target_bucket = coverage_state["uncovered_priority"][0]
    prompt = {
        "task": "Generate exactly one technical follow-up question based on the candidate's most recent answer.",
        "main_question": main_question,
        "job_context": {
            "role_title": role_title,
            "job_description": (job_description or "")[:3000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "candidate_context": parsed_sections,
        "full_interview_history": cleaned_history,
        "target_coverage_bucket": target_bucket,
        "constraints": [
            "Return strict JSON only",
            "One single question sentence ending with a question mark",
            "Do not repeat earlier asked questions",
            "Be specific and technically evaluable",
            "Sound like a real interviewer: brief acknowledgement + one sharp follow-up",
            "Keep it human and direct; avoid formal essay language",
            "Focus on depth: ask for evidence, edge cases, metrics, or failure handling",
            "Use the candidate's last answer as your primary anchor",
            "If the previous answer is vague, ask one clarifying follow-up instead of assuming details",
            "Never fabricate project names, performance numbers, or stack components",
        ],
        "output_schema": {"followup": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "followup",
        0.25,
        150,
        "You are a senior technical interviewer. Ask concise, deep, role-relevant, evaluable questions. Return strict JSON only.",
    )
    return q, "api_success"


def _generate_ai_next_question(
    *,
    settings,
    role_title: str,
    job_description: str,
    interview_type: str,
    difficulty: str,
    parsed_sections: dict,
    cleaned_history: list[dict],
) -> tuple[str, str]:
    prompt = {
        "task": "Generate the next interview question based on the full live conversation.",
        "job_context": {
            "role_title": role_title,
            "job_description": (job_description or "")[:3000],
            "interview_type": interview_type,
            "difficulty": difficulty,
        },
        "candidate_context": parsed_sections,
        "conversation_history": cleaned_history[-24:],
        "constraints": [
            "Return strict JSON only",
            "Ask exactly one question ending with '?'",
            "Use natural spoken interviewer style",
            "Must connect directly to candidate's latest answer",
            "Do not repeat previous questions",
            "Do not invent candidate achievements or metrics",
            "If candidate answer is weak, ask for one concrete example",
            "Keep concise and high-signal",
        ],
        "output_schema": {"question": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "question",
        0.25,
        110,
        "You are an expert human interviewer. Ask one relevant, realistic next question only. Return strict JSON.",
    )
    return q, "api_success"


def _generate_ai_repeat_response(*, settings, last_question: str, candidate_request: str) -> tuple[str, str]:
    prompt = {
        "task": "Candidate asked to repeat or rephrase. Return one natural assistant response.",
        "last_question": last_question,
        "candidate_request": candidate_request,
        "constraints": [
            "Return strict JSON only",
            "Acknowledge briefly and repeat/rephrase the same question",
            "Do not introduce a new topic",
            "Single concise response",
        ],
        "output_schema": {"response": "string"},
    }
    msg = _chat_json(
        settings,
        prompt,
        "response",
        0.3,
        140,
        "You are a human interviewer. Return strict JSON only.",
    )
    return msg, "api_success"


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
    candidate_name: str = "",
) -> tuple[str, str]:
    cleaned_history = _trim_history(history)
    settings = get_settings()
    use_ai = bool((settings.openai_api_key or "").strip())

    parsed_sections = _extract_parsed_sections(parsed_resume_json)
    _ = [b["question"] for b in human_question_bank if b.get("type") == "main" and b.get("question")]

    last_candidate_turn = None
    for turn in reversed(cleaned_history):
        if turn.get("role") == "candidate":
            last_candidate_turn = str(turn.get("content", "")).strip()
            break

    if last_candidate_turn and _is_repeat_request(last_candidate_turn):
        last_assistant_question = ""
        for turn in reversed(cleaned_history):
            if turn.get("role") == "assistant":
                last_assistant_question = str(turn.get("content", "")).strip()
                break
        if last_assistant_question:
            if use_ai:
                try:
                    ai_repeat, repeat_meta = _generate_ai_repeat_response(
                        settings=settings,
                        last_question=last_assistant_question,
                        candidate_request=last_candidate_turn,
                    )
                    return ai_repeat, f"source=repeat_guard state=hold {repeat_meta}"
                except Exception:
                    pass
            return f"Sure, let me repeat that: {last_assistant_question}", "source=repeat_guard state=hold fallback=local"

    if last_candidate_turn and _is_incomplete_answer(last_candidate_turn):
        return (
            "Thanks. Could you expand on that with one concrete example, your exact steps, and the result?",
            "source=incomplete_answer_guard state=hold",
        )

    asked_questions = [t["content"] for t in cleaned_history if t.get("role") == "assistant"]
    _ = _sanitize_resume_text(resume_text)
    _ = resume_skills

    if not asked_questions:
        if use_ai:
            try:
                intro_q, intro_meta = _generate_ai_intro_question(
                    settings=settings,
                    candidate_name=candidate_name,
                    role_title=role_title,
                    job_description=job_description,
                    interview_type=interview_type,
                    difficulty=difficulty,
                )
                return intro_q, f"source=intro state=interview_start {intro_meta}"
            except Exception:
                pass
        return _fallback_intro_question(candidate_name, role_title), "source=intro state=interview_start fallback=local"

    if use_ai:
        try:
            next_q, next_meta = _generate_ai_next_question(
                settings=settings,
                role_title=role_title,
                job_description=job_description,
                interview_type=interview_type,
                difficulty=difficulty,
                parsed_sections=parsed_sections,
                cleaned_history=cleaned_history,
            )
            return next_q, f"source=ai_dynamic_next state=live_flow {next_meta}"
        except Exception:
            pass

    return _fallback_next_question(cleaned_history, role_title, parsed_sections), "source=ai_dynamic_next state=live_flow fallback=local"


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
