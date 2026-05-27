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
WINDDOWN_START_MINUTES = 12.0
HARD_STOP_MINUTES = 15.0
FINAL_MINUTE_NOTICE_MINUTES = 14.0
DANGLING_TAIL_TOKENS = {
    "in",
    "on",
    "for",
    "with",
    "to",
    "of",
    "about",
    "around",
    "at",
    "particularly",
    "especially",
}
TOPIC_MIN_QUESTIONS = 5
TOPIC_MAX_QUESTIONS = 6


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


def _evaluate_answer_depth(text: str) -> dict:
    cleaned = (text or "").strip()
    words = re.findall(r"\b\w+\b", cleaned)
    lowered = cleaned.lower()
    step_markers = (
        "first",
        "then",
        "next",
        "after",
        "finally",
        "step",
        "started by",
        "i debugged",
        "i traced",
    )
    decision_markers = (
        "decided",
        "chose",
        "trade-off",
        "tradeoff",
        "because",
        "due to",
        "instead of",
    )
    result_markers = (
        "result",
        "outcome",
        "reduced",
        "improved",
        "increased",
        "decreased",
        "latency",
        "throughput",
        "impact",
        "metric",
        "%",
    )
    has_steps = any(m in lowered for m in step_markers)
    has_decision = any(m in lowered for m in decision_markers)
    has_result = any(m in lowered for m in result_markers) or bool(re.search(r"\b\d+(?:\.\d+)?%?\b", cleaned))
    depth_ok = len(words) >= 22 and has_steps and has_decision and has_result
    return {
        "word_count": len(words),
        "has_steps": has_steps,
        "has_decision": has_decision,
        "has_result": has_result,
        "depth_ok": depth_ok,
    }


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


def _last_turn_by_role(cleaned_history: list[dict], role: str) -> str:
    for turn in reversed(cleaned_history):
        if turn.get("role") == role:
            return str(turn.get("content") or "").strip()
    return ""


def _answer_signal(text: str) -> dict:
    cleaned = (text or "").strip()
    words = re.findall(r"\b\w+\b", cleaned)
    lowered = cleaned.lower()
    has_metric = bool(re.search(r"\b\d+(\.\d+)?%?\b", cleaned))
    action_verbs = ("implemented", "designed", "debugged", "optimized", "migrated", "built", "deployed", "measured")
    has_action = any(v in lowered for v in action_verbs)
    depth = _evaluate_answer_depth(cleaned)
    return {
        "word_count": len(words),
        "has_metric": has_metric,
        "has_action_verbs": has_action,
        "is_very_short": len(words) < 12,
        "is_vague": len(words) < 20 or not has_action,
        "depth_ok": bool(depth["depth_ok"]),
        "has_steps": bool(depth["has_steps"]),
        "has_decision": bool(depth["has_decision"]),
        "has_result": bool(depth["has_result"]),
    }


def _infer_interview_stage(cleaned_history: list[dict]) -> str:
    assistant_questions = [t for t in cleaned_history if t.get("role") == "assistant"]
    q_count = len(assistant_questions)
    if q_count <= 1:
        return "intro"
    if q_count <= 4:
        return "deep_dive"
    if q_count <= 7:
        return "stress_test"
    if q_count <= 10:
        return "behavioral"
    return "close"


def _plan_competency_ladder() -> list[str]:
    return [
        "role_fit_intro",
        "hands_on_implementation",
        "debugging_root_cause",
        "performance_tradeoffs",
        "system_design_scale",
        "stress_under_constraints",
        "ownership_communication",
        "behavioral_judgment",
        "closing_reflection",
    ]


def _determine_target_competency(cleaned_history: list[dict]) -> str:
    stage = _infer_interview_stage(cleaned_history)
    stage_default = {
        "intro": "role_fit_intro",
        "deep_dive": "hands_on_implementation",
        "stress_test": "stress_under_constraints",
        "behavioral": "behavioral_judgment",
        "close": "closing_reflection",
    }
    candidate_answers = [str(t.get("content") or "").lower() for t in cleaned_history if t.get("role") == "candidate"]
    if not candidate_answers:
        return stage_default.get(stage, "role_fit_intro")
    text = " ".join(candidate_answers[-8:])
    signals = {
        "role_fit_intro": ("introduce", "background", "experience"),
        "hands_on_implementation": ("implemented", "built", "designed", "developed"),
        "debugging_root_cause": ("debug", "issue", "incident", "root cause", "logs"),
        "performance_tradeoffs": ("latency", "throughput", "cache", "optimize", "trade-off", "tradeoff"),
        "system_design_scale": ("scale", "architecture", "distributed", "queue", "partition"),
        "stress_under_constraints": ("deadline", "incident", "pressure", "on-call", "downtime", "rollback"),
        "ownership_communication": ("stakeholder", "team", "ownership", "conflict", "decision"),
        "behavioral_judgment": ("feedback", "mistake", "learned", "collaborate", "mentor"),
        "closing_reflection": ("improve", "next time", "reflection", "lessons"),
    }
    covered = set()
    for key, words in signals.items():
        if any(w in text for w in words):
            covered.add(key)
    for step in _plan_competency_ladder():
        if step not in covered:
            return step
    return stage_default.get(stage, "ownership_communication")


def _tokenize_meaningful(text: str) -> set[str]:
    raw = re.findall(r"[A-Za-z][A-Za-z0-9+#./-]{2,}", (text or "").lower())
    stop = {
        "the", "and", "for", "that", "with", "this", "from", "your", "about", "into", "have", "what",
        "when", "where", "which", "could", "would", "should", "explain", "describe", "tell", "project",
        "experience", "role", "past", "briefly", "including", "exact", "steps", "result",
    }
    return {t for t in raw if t not in stop and len(t) >= 3}


def _is_off_topic_answer(last_question: str, last_answer: str) -> bool:
    q_tokens = _tokenize_meaningful(last_question)
    a_tokens = _tokenize_meaningful(last_answer)
    if not q_tokens or not a_tokens:
        return False
    overlap = len(q_tokens.intersection(a_tokens))
    ratio = overlap / max(1, min(len(q_tokens), 8))
    return ratio < 0.12 and len(a_tokens) >= 12


def _tokenize_for_similarity(text: str) -> set[str]:
    return {
        t
        for t in re.findall(r"[A-Za-z][A-Za-z0-9+#./-]{2,}", (text or "").lower())
        if t not in {"the", "and", "for", "that", "with", "this", "from", "your", "about", "what", "when"}
    }


def _jaccard_similarity(a: str, b: str) -> float:
    ta = _tokenize_for_similarity(a)
    tb = _tokenize_for_similarity(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta.intersection(tb))
    union = len(ta.union(tb))
    return inter / max(1, union)


def _known_numeric_tokens(cleaned_history: list[dict], parsed_sections: dict) -> set[str]:
    pool = " ".join([str(t.get("content") or "") for t in cleaned_history[-30:]])
    if isinstance(parsed_sections, dict):
        projects = parsed_sections.get("projects")
        if isinstance(projects, list):
            for p in projects[:8]:
                if isinstance(p, dict):
                    pool += " " + str(p.get("description") or "")
                    highs = p.get("highlights")
                    if isinstance(highs, list):
                        pool += " " + " ".join([str(h) for h in highs[:6]])
    return set(re.findall(r"\b\d+(?:\.\d+)?%?\b", pool))


def _question_has_unseen_numbers(question: str, known_numbers: set[str]) -> bool:
    nums = set(re.findall(r"\b\d+(?:\.\d+)?%?\b", question or ""))
    if not nums:
        return False
    return any(n not in known_numbers for n in nums)


def _ensure_single_question_sentence(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "").strip().replace("\n", " "))
    cleaned = re.sub(r'^[\"\']+|[\"\']+$', "", cleaned).strip()
    if not cleaned:
        return ""
    # Keep content up to first question mark if multiple are generated.
    if cleaned.count("?") > 1:
        first = cleaned.find("?")
        cleaned = cleaned[: first + 1].strip()
    if "?" not in cleaned:
        cleaned = cleaned.rstrip(".! ") + "?"
    # Remove list-like prefixes.
    cleaned = re.sub(r"^(question\s*\d*[:\-]\s*)", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def _trim_question_to_word_limit(question: str, max_words: int = 36) -> str:
    words = question.split()
    if len(words) <= max_words:
        return question
    clipped = words[:max_words]
    while len(clipped) > 10 and clipped[-1].strip(" ,;:.!?").lower() in DANGLING_TAIL_TOKENS:
        clipped.pop()
    candidate = " ".join(clipped).rstrip(",;:.! ")
    if "?" not in candidate:
        candidate += "?"
    return candidate


def _repair_dangling_question_tail(question: str, role_title: str) -> str:
    q = (question or "").strip()
    if not q:
        return q
    core = q[:-1].strip() if q.endswith("?") else q
    tokens = core.split()
    if not tokens:
        return q
    if tokens[-1].strip(" ,;:.!?").lower() not in DANGLING_TAIL_TOKENS:
        return q
    while len(tokens) > 8 and tokens[-1].strip(" ,;:.!?").lower() in DANGLING_TAIL_TOKENS:
        tokens.pop()
    fixed = " ".join(tokens).rstrip(",;:.! ")
    if not fixed:
        fixed = f"Can you walk me through one project relevant to {role_title or 'this role'}"
    if "?" not in fixed:
        fixed += "?"
    return fixed


def _de_genericize_question(question: str, cleaned_history: list[dict], role_title: str, parsed_sections: dict, target_competency: str) -> str:
    q_low = (question or "").strip().lower()
    bad_prefixes = (
        "good start",
        "thanks, stay on this same question",
        "let's complete this answer properly",
    )
    if any(q_low.startswith(p) for p in bad_prefixes):
        return _fallback_next_question(cleaned_history, role_title, parsed_sections, target_competency)
    return question


def _postprocess_question(
    question: str,
    cleaned_history: list[dict],
    parsed_sections: dict,
    target_competency: str,
    role_title: str,
    topic_plan: dict | None = None,
) -> str:
    q = _ensure_single_question_sentence(question)
    if not q:
        return _fallback_next_question(cleaned_history, role_title, parsed_sections, target_competency)

    q = _de_genericize_question(q, cleaned_history, role_title, parsed_sections, target_competency)
    q = _trim_question_to_word_limit(q, max_words=36)
    q = _repair_dangling_question_tail(q, role_title)
    if _is_low_signal_question(q):
        q = _beast_followup_question(
            cleaned_history=cleaned_history,
            role_title=role_title,
            target_competency=target_competency,
            last_question=_last_turn_by_role(cleaned_history, "assistant"),
            last_answer=_last_turn_by_role(cleaned_history, "candidate"),
            axis_hint=str((topic_plan or {}).get("next_axis_hint") or _next_axis_hint(cleaned_history)),
            anchor_override=(topic_plan or {}).get("target_anchor", ""),
        )
        q = _trim_question_to_word_limit(_ensure_single_question_sentence(q), max_words=36)

    assistant_questions = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "assistant"]
    for prev in assistant_questions[-8:]:
        if _jaccard_similarity(q, prev) >= 0.62:
            return _fallback_next_question(cleaned_history, role_title, parsed_sections, target_competency)
    if _is_opening_repetitive(q, assistant_questions):
        q = _beast_followup_question(
            cleaned_history=cleaned_history,
            role_title=role_title,
            target_competency=target_competency,
            last_question=_last_turn_by_role(cleaned_history, "assistant"),
            last_answer=_last_turn_by_role(cleaned_history, "candidate"),
            axis_hint=str((topic_plan or {}).get("next_axis_hint") or _next_axis_hint(cleaned_history)),
            anchor_override=(topic_plan or {}).get("target_anchor", ""),
        )
        q = _trim_question_to_word_limit(_ensure_single_question_sentence(q), max_words=36)

    known_numbers = _known_numeric_tokens(cleaned_history, parsed_sections)
    if _question_has_unseen_numbers(q, known_numbers):
        return _fallback_next_question(cleaned_history, role_title, parsed_sections, target_competency)

    if _is_generic_or_repetitive_prompt(q, cleaned_history):
        q = _beast_followup_question(
            cleaned_history=cleaned_history,
            role_title=role_title,
            target_competency=target_competency,
            last_question=_last_turn_by_role(cleaned_history, "assistant"),
            last_answer=_last_turn_by_role(cleaned_history, "candidate"),
            axis_hint=str((topic_plan or {}).get("next_axis_hint") or _next_axis_hint(cleaned_history)),
            anchor_override=(topic_plan or {}).get("target_anchor", ""),
        )
        q = _trim_question_to_word_limit(_ensure_single_question_sentence(q), max_words=36)
    elif _is_axis_repetitive(q, cleaned_history):
        q = _beast_followup_question(
            cleaned_history=cleaned_history,
            role_title=role_title,
            target_competency=target_competency,
            last_question=_last_turn_by_role(cleaned_history, "assistant"),
            last_answer=_last_turn_by_role(cleaned_history, "candidate"),
            axis_hint=str((topic_plan or {}).get("next_axis_hint") or _next_axis_hint(cleaned_history)),
            anchor_override=(topic_plan or {}).get("target_anchor", ""),
        )
        q = _trim_question_to_word_limit(_ensure_single_question_sentence(q), max_words=36)
    if topic_plan and bool(topic_plan.get("enforce_anchor")):
        target_anchor = str(topic_plan.get("target_anchor") or "").strip()
        if target_anchor and not _question_matches_topic(q, target_anchor):
            q = _beast_followup_question(
                cleaned_history=cleaned_history,
                role_title=role_title,
                target_competency=target_competency,
                last_question=_last_turn_by_role(cleaned_history, "assistant"),
                last_answer=_last_turn_by_role(cleaned_history, "candidate"),
                axis_hint=str((topic_plan or {}).get("next_axis_hint") or _next_axis_hint(cleaned_history)),
                anchor_override=target_anchor,
            )
            q = _trim_question_to_word_limit(_ensure_single_question_sentence(q), max_words=36)
    if q.lower().startswith("candidate "):
        q = q[len("candidate ") :].strip()
    return q


def _fallback_intro_question(candidate_name: str, role_title: str, parsed_sections: dict) -> str:
    name = candidate_name.strip().split()[0] if candidate_name.strip() else "there"
    role = role_title.strip() or "this role"
    projects = parsed_sections.get("projects") if isinstance(parsed_sections, dict) else []
    if isinstance(projects, list):
        for project in projects:
            if isinstance(project, dict):
                title = str(project.get("title") or "").strip()
                if title:
                    return (
                        f"Hi {name}, could you briefly introduce yourself and then walk me through your {title} project, "
                        f"including your exact responsibilities and impact relevant to {role}?"
                    )
    skills = parsed_sections.get("skills") if isinstance(parsed_sections, dict) else []
    if isinstance(skills, list) and skills:
        focus_skill = str(skills[0]).strip()
        if focus_skill:
            return (
                f"Hi {name}, please give a brief introduction and then describe one project where you used {focus_skill}, "
                f"including what you personally built and the outcome."
            )
    return (
        f"Hi {name}, could you briefly introduce yourself and walk me through one project most relevant to {role}, "
        "including your exact contribution and final result?"
    )


def _fallback_next_question(cleaned_history: list[dict], role_title: str, parsed_sections: dict, target_competency: str) -> str:
    last_candidate = ""
    for turn in reversed(cleaned_history):
        if turn.get("role") == "candidate":
            last_candidate = str(turn.get("content") or "").strip()
            break
    stage = _infer_interview_stage(cleaned_history)
    if last_candidate:
        kws = _extract_keywords(last_candidate, limit=2)
        if kws:
            if target_competency == "debugging_root_cause":
                return (
                    f"Thanks. On {kws[0]}, what was the first concrete signal that pointed to the root cause, "
                    "and how did you verify the fix?"
                )
            if target_competency == "performance_tradeoffs":
                return (
                    f"You mentioned {kws[0]}. Which trade-offs did you choose, what did you measure before/after, "
                    "and what did you consciously not optimize?"
                )
            if target_competency == "system_design_scale":
                return (
                    f"Good context. If traffic suddenly 10x on {kws[0]}, what would break first, "
                    "and how would you redesign it step by step?"
                )
            if stage in {"intro", "deep_dive"}:
                return (
                    f"Thanks, that's helpful. On {kws[0]}"
                    + (f" and {kws[1]}" if len(kws) > 1 else "")
                    + ", what exactly did you build yourself, what was the toughest issue, and how did you resolve it?"
                )
            return (
                f"You mentioned {kws[0]}"
                + (f" and {kws[1]}" if len(kws) > 1 else "")
                + ". Can you explain the exact steps you took, one challenge you hit, and how you measured success?"
            )
        return "Could you give one concrete example with your exact implementation steps, trade-offs you made, and the final outcome?"

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
    models: list[str] = []
    primary = str(getattr(settings, "openai_model", "") or "").strip()
    if primary:
        models.append(primary)
    fallback = str(getattr(settings, "openai_fallback_model", "") or "").strip()
    if fallback and fallback not in models:
        models.append(fallback)
    if not models:
        raise ValueError("No model configured")

    last_exc: Exception | None = None
    with httpx.Client(timeout=18.0) as client:
        for model in models:
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": json.dumps(prompt)},
                ],
                "temperature": temperature,
                "max_tokens": max_tokens,
                "response_format": {"type": "json_object"},
            }
            try:
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
            except Exception as exc:
                last_exc = exc
                continue
    raise last_exc or ValueError("Model call failed")


def _generate_ai_intro_question(
    *,
    settings,
    candidate_name: str,
    role_title: str,
    job_description: str,
    interview_type: str,
    difficulty: str,
    parsed_sections: dict,
) -> tuple[str, str]:
    prompt = {
        "task": "Generate the very first interview question.",
        "context": {
            "candidate_name": candidate_name,
            "role_title": role_title,
            "job_description": (job_description or "")[:2000],
            "interview_type": interview_type,
            "difficulty": difficulty,
            "candidate_resume": {
                "skills": (parsed_sections.get("skills") or [])[:8] if isinstance(parsed_sections, dict) else [],
                "project_titles": [
                    str(p.get("title") or "").strip()
                    for p in ((parsed_sections.get("projects") or []) if isinstance(parsed_sections, dict) else [])
                    if isinstance(p, dict) and str(p.get("title") or "").strip()
                ][:5],
            },
        },
        "constraints": [
            "Return strict JSON only",
            "Greet naturally if a candidate name is provided (do not force fixed phrasing)",
            "Ask for BOTH: a brief introduction and one past project/experience",
            "Ground the question in role and resume context when available",
            "Keep it conversational and human, not robotic",
            "Use plain spoken English",
            "Single question only",
            "Avoid repeating the same opening wording across interviews",
            "Do not invent projects, metrics, or technologies",
            "Do not end with dangling fragments like 'particularly in?' or 'perhaps something?'",
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
    target_competency: str,
    topic_plan: dict,
) -> tuple[str, str]:
    last_assistant = _last_turn_by_role(cleaned_history, "assistant")
    last_candidate = _last_turn_by_role(cleaned_history, "candidate")
    signal = _answer_signal(last_candidate)
    stage = _infer_interview_stage(cleaned_history)
    axis_hint = str(topic_plan.get("next_axis_hint") or _next_axis_hint(cleaned_history))
    recent_assistant_questions = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "assistant"][-6:]
    recent_axes = [_question_axis(q) for q in recent_assistant_questions]
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
        "recent_exchange": {
            "last_interviewer_question": last_assistant,
            "last_candidate_answer": last_candidate,
            "answer_signal": signal,
        },
        "interview_stage": stage,
        "axis_diversity_plan": {
            "next_axis_hint": axis_hint,
            "recent_axes": recent_axes,
            "rule": "Avoid repeating the same axis for more than 2 consecutive interviewer questions.",
        },
        "topic_continuity_plan": topic_plan,
        "enforced_flow": ["intro", "deep_dive", "stress_test", "behavioral", "close"],
        "target_competency": target_competency,
        "interviewer_rubric": [
            "prioritize evidence over claims",
            "probe ownership: what exactly candidate did",
            "test reasoning under constraints and trade-offs",
            "maintain conversational continuity and realism",
        ],
        "constraints": [
            "Return strict JSON only",
            "Ask exactly one interviewer-style prompt that ends with a single '?'",
            "Use natural spoken interviewer style, not textbook style",
            "Must connect directly to candidate's latest answer",
            "Ask like a real hiring panel interviewer for a live technical round",
            "Do not repeat previous questions",
            "Do not invent candidate achievements or metrics",
            "If candidate answer is clear, include a short natural acknowledgement (max 8 words) before the question",
            "If candidate answer is vague, ask a clarifying question first instead of jumping to a new topic",
            "If candidate answer is weak/vague, ask for one concrete example with steps and outcome",
            "If candidate answer is strong, ask a deeper follow-up on trade-offs, failure handling, scalability, or debugging",
            "Bias the next question toward target_competency",
            "Prefer specific implementation details over theory",
            "Topic continuity is mandatory according to topic_continuity_plan",
            "If topic_streak is below min_topic_questions, stay on current_anchor and do not switch",
            "If should_switch_topic_now is true, switch to target_anchor and avoid old topic phrasing",
            "Use axis_diversity_plan.next_axis_hint as the primary question shape",
            "Keep topic continuity: do not switch domains abruptly unless previous answer is fully complete",
            "No topic jump: if depth is insufficient, keep probing same topic",
            "Do not repeat the same question axis as the last 2 interviewer questions",
            "Use next_axis_hint when possible",
            "In stress_test stage, challenge constraints and failure modes",
            "In behavioral stage, probe ownership, communication, and decisions under ambiguity",
            "Prefer scenario-driven prompts over generic prompts",
            "Avoid coaching language; ask an evaluative interview question",
            "Keep concise and high-signal (max 35 words)",
            "Do not use generic filler lines like 'Good start' or 'Thanks, stay on this question'",
            "Do not produce generic coaching statements; ask a concrete interview question only",
        ],
        "output_schema": {"question": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "question",
        0.25,
        110,
        "You are a senior platform-engineering interviewer running a real hiring loop. Ask one sharp, realistic, evaluative question only. Return strict JSON.",
    )
    return q, "api_success"


def _generate_ai_precision_probe(
    *,
    settings,
    role_title: str,
    target_competency: str,
    last_question: str,
    last_candidate_answer: str,
) -> tuple[str, str]:
    prompt = {
        "task": "Generate one interviewer follow-up when the candidate response is generic or low-signal.",
        "context": {
            "role_title": role_title,
            "target_competency": target_competency,
            "last_question": last_question,
            "last_candidate_answer": last_candidate_answer,
        },
        "constraints": [
            "Return strict JSON only",
            "One concise follow-up ending with '?'",
            "Ask for concrete actions, decisions, and measurable result",
            "Do not switch topic; stay tightly connected to last question",
            "Natural human interviewer tone",
            "Avoid stock filler phrases (e.g., 'Good start')",
            "Ask one concrete follow-up with technical specifics",
        ],
        "output_schema": {"question": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "question",
        0.2,
        90,
        "You are a senior interviewer. Ask sharp, concrete follow-ups. Return strict JSON only.",
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


def _generate_ai_incomplete_probe(*, settings, last_question: str, last_candidate_turn: str, role_title: str) -> tuple[str, str]:
    prompt = {
        "task": "Candidate answer was incomplete. Ask one concise follow-up that helps them finish the same answer.",
        "context": {
            "role_title": role_title,
            "last_question": last_question,
            "candidate_partial_answer": last_candidate_turn,
        },
        "constraints": [
            "Return strict JSON only",
            "One short interviewer prompt ending with '?'",
            "Stay on the same topic as the last question",
            "Ask for concrete steps, ownership, and result",
            "Human conversational tone",
        ],
        "output_schema": {"question": "string"},
    }
    q = _chat_json(
        settings,
        prompt,
        "question",
        0.25,
        80,
        "You are a senior interviewer. Keep continuity and ask one concise follow-up. Return strict JSON.",
    )
    return q, "api_success"


def _build_clarify_prompt(last_question: str, last_answer: str) -> str:
    depth = _evaluate_answer_depth(last_answer)
    missing: list[str] = []
    if not depth["has_steps"]:
        missing.append("the exact steps")
    if not depth["has_decision"]:
        missing.append("the decision/trade-off")
    if not depth["has_result"]:
        missing.append("the measurable result")
    if not missing:
        return "Can you give one concrete example with your exact steps, decision, and measurable result?"
    if len(missing) == 1:
        need = missing[0]
    else:
        need = ", ".join(missing[:-1]) + f", and {missing[-1]}"
    question_focus = _extract_keywords(last_question, limit=1)
    focus_clause = f" on {question_focus[0]}" if question_focus else ""
    if last_question:
        return f"Before we move on, can you finish the same answer{focus_clause} and include {need}?"
    return f"Can you answer with {need} so I can evaluate it fairly?"


def _beast_followup_question(
    *,
    cleaned_history: list[dict],
    role_title: str,
    target_competency: str,
    last_question: str,
    last_answer: str,
    axis_hint: str = "",
    anchor_override: str = "",
) -> str:
    kws = _extract_keywords(last_answer or last_question, limit=2)
    anchor = anchor_override.strip() or (kws[0] if kws else (role_title.strip() or "your recent project"))
    anchor_topic_questions = 0
    for turn in cleaned_history:
        if turn.get("role") != "assistant":
            continue
        q = str(turn.get("content") or "")
        if _question_matches_topic(q, anchor):
            anchor_topic_questions += 1
    variant = (anchor_topic_questions + len(anchor)) % 4
    templates: dict[str, list[str]] = {
        "hands_on_implementation": [
            f"In {anchor}, which exact technologies and tools did you use, and why were they a better fit than alternatives?",
            f"For {anchor}, what was your implementation sequence from setup to deployment, and what tooling was critical?",
            f"Which integration point in {anchor} was hardest technically, and what concrete implementation choice solved it?",
            f"If you rebuilt {anchor} today, which tooling choice would you keep and which would you replace first?",
        ],
        "debugging_root_cause": [
            f"On {anchor}, what exact signal first indicated root cause, and how did you validate the fix end-to-end?",
            f"For {anchor}, which logs or traces narrowed the failure path, and what changed after your patch?",
            f"Walk me through your debugging timeline for {anchor}: hypothesis, test, fix, and verification evidence.",
            f"What was the hardest false lead while debugging {anchor}, and how did you rule it out technically?",
        ],
        "performance_tradeoffs": [
            f"In {anchor}, what trade-off did you choose, what metric moved, and what cost did you accept?",
            f"For {anchor}, which optimization gave the highest impact, and what did you intentionally not optimize?",
            f"How did you measure before/after for {anchor}, and what constraints limited further performance gains?",
            f"What scaling bottleneck remains in {anchor}, and what is your next technical mitigation plan?",
        ],
        "system_design_scale": [
            f"If {anchor} traffic grows 10x, what breaks first and how would you redesign it step-by-step?",
            f"For {anchor}, describe the current architecture and the first two changes you would make for reliability.",
            f"Which failure mode in {anchor} worries you most in production, and what guardrail would you add?",
            f"How would you partition responsibilities in {anchor} services to reduce coupling under high load?",
        ],
        "ownership_communication": [
            f"In {anchor}, what key decision did you personally own, and how did you align the team on it?",
            f"When {anchor} failed, how did you communicate risk and recovery plan to stakeholders?",
            f"What conflict or disagreement happened around {anchor}, and how did you resolve it with technical evidence?",
            f"For {anchor}, what would your incident postmortem include as the top three corrective actions?",
        ],
        "stress_under_constraints": [
            f"Under deadline pressure in {anchor}, what did you cut, what did you protect, and why?",
            f"If {anchor} breaks during release, what is your rollback and stabilization playbook?",
            f"For {anchor}, how would you prioritize fixes if you only had 60 minutes before customer impact escalates?",
            f"What was your highest-risk call in {anchor}, and what data justified that decision?",
        ],
    }
    axis_to_competency = {
        "tooling": "hands_on_implementation",
        "tradeoff": "performance_tradeoffs",
        "failure_mode": "stress_under_constraints",
        "scale_design": "system_design_scale",
        "metrics": "performance_tradeoffs",
        "ownership": "ownership_communication",
        "steps_debug": "debugging_root_cause",
    }
    selected_competency = axis_to_competency.get(axis_hint, target_competency)
    pool = templates.get(selected_competency) or templates.get(target_competency) or templates["ownership_communication"]
    return pool[variant]


def _is_generic_or_repetitive_prompt(question: str, cleaned_history: list[dict]) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return True
    banned = (
        "good start",
        "thanks, stay on this same question",
        "let's complete this answer properly",
        "please include",
        "before we move on, please finish",
    )
    if any(b in q for b in banned):
        return True
    assistant_questions = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "assistant"]
    for prev in assistant_questions[-4:]:
        if _jaccard_similarity(prev, question) >= 0.58:
            return True
    return False


def _is_low_signal_question(question: str) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return True
    if len(re.findall(r"\b\w+\b", q)) < 10:
        return True
    high_signal_markers = (
        "step",
        "trade-off",
        "tradeoff",
        "why",
        "measure",
        "metric",
        "debug",
        "root cause",
        "failure",
        "scale",
        "decision",
        "validate",
        "constraint",
    )
    return not any(m in q for m in high_signal_markers)


def _opening_signature(question: str) -> str:
    words = re.findall(r"[A-Za-z0-9+#./-]+", (question or "").lower())
    if not words:
        return ""
    return " ".join(words[:5])


def _is_opening_repetitive(question: str, assistant_questions: list[str]) -> bool:
    sig = _opening_signature(question)
    if not sig:
        return False
    recent_sigs = [_opening_signature(q) for q in assistant_questions[-4:]]
    return recent_sigs.count(sig) >= 1


def _question_axis(question: str) -> str:
    q = (question or "").lower()
    if any(k in q for k in ("trade-off", "tradeoff", "cost", "chose", "decision")):
        return "tradeoff"
    if any(k in q for k in ("metric", "measure", "measurable", "improve", "latency", "throughput", "%")):
        return "metrics"
    if any(k in q for k in ("failure", "incident", "rollback", "risk", "breaks first", "guardrail")):
        return "failure_mode"
    if any(k in q for k in ("scale", "10x", "architecture", "redesign", "partition")):
        return "scale_design"
    if any(k in q for k in ("tool", "technology", "stack", "library", "framework")):
        return "tooling"
    if any(k in q for k in ("stakeholder", "team", "communicate", "align", "ownership")):
        return "ownership"
    if any(k in q for k in ("step", "walk me through", "timeline", "exactly did you do", "debug")):
        return "steps_debug"
    return "general"


def _is_axis_repetitive(question: str, cleaned_history: list[dict]) -> bool:
    axis = _question_axis(question)
    if axis == "general":
        return False
    recent_assistant = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "assistant"][-3:]
    if len(recent_assistant) < 2:
        return False
    recent_axes = [_question_axis(q) for q in recent_assistant]
    # If same axis is already used repeatedly in recent prompts, force diversity.
    return recent_axes.count(axis) >= 2


def _is_probe_like_question(question: str) -> bool:
    q = (question or "").strip().lower()
    if not q:
        return False
    probe_markers = (
        "before we move on",
        "can you answer with",
        "include the exact steps",
        "include the measurable result",
        "finish the same answer",
        "same question",
        "ownership and the final outcome",
    )
    return any(m in q for m in probe_markers)


def _recent_probe_streak(cleaned_history: list[dict]) -> int:
    streak = 0
    for turn in reversed(cleaned_history):
        if turn.get("role") != "assistant":
            continue
        content = str(turn.get("content") or "").strip()
        if _is_probe_like_question(content):
            streak += 1
            continue
        break
    return streak


def _next_axis_hint(cleaned_history: list[dict]) -> str:
    recent_assistant = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "assistant"][-4:]
    recent_axes = {_question_axis(q) for q in recent_assistant}
    priority = ["tooling", "tradeoff", "failure_mode", "scale_design", "metrics", "ownership", "steps_debug"]
    for axis in priority:
        if axis not in recent_axes:
            return axis
    return "tradeoff"


def _next_axis_hint_for_topic(cleaned_history: list[dict], topic_anchor: str) -> str:
    if not topic_anchor:
        return _next_axis_hint(cleaned_history)
    topic_recent: list[str] = []
    for turn in cleaned_history:
        if turn.get("role") != "assistant":
            continue
        q = str(turn.get("content") or "")
        if _question_matches_topic(q, topic_anchor):
            topic_recent.append(q)
    recent_axes = {_question_axis(q) for q in topic_recent[-5:]}
    priority = ["tooling", "steps_debug", "tradeoff", "failure_mode", "scale_design", "metrics", "ownership"]
    for axis in priority:
        if axis not in recent_axes:
            return axis
    return "tradeoff"


def _topic_tokens(topic: str) -> set[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9+#./-]{2,}", (topic or "").lower())
    stop = {
        "project",
        "system",
        "role",
        "engineering",
        "engineer",
        "implementation",
        "details",
        "experience",
        "technical",
        "technology",
    }
    return {t for t in tokens if t not in stop}


def _build_topic_catalog(parsed_sections: dict, role_title: str, cleaned_history: list[dict]) -> list[str]:
    topics: list[str] = []
    blocked_dynamic_topics = {
        "built",
        "build",
        "used",
        "using",
        "chose",
        "choose",
        "debugged",
        "improved",
        "issue",
        "result",
        "system",
        "project",
        "backend",
        "frontend",
        "implemented",
        "implementation",
        "measured",
        "measure",
        "metric",
        "metrics",
        "logs",
        "log",
    }

    def _push(topic: str) -> None:
        val = (topic or "").strip()
        if not val:
            return
        if val.lower() not in {t.lower() for t in topics}:
            topics.append(val)

    projects = parsed_sections.get("projects") if isinstance(parsed_sections, dict) else []
    if isinstance(projects, list):
        for project in projects[:8]:
            if isinstance(project, dict):
                _push(str(project.get("title") or ""))

    skills = parsed_sections.get("skills") if isinstance(parsed_sections, dict) else []
    if isinstance(skills, list):
        for skill in skills[:10]:
            _push(str(skill))

    if role_title.strip():
        _push(role_title.strip())

    candidate_turns = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "candidate"][-4:]
    for answer in candidate_turns:
        for kw in _extract_keywords(answer, limit=2):
            if kw.lower() in blocked_dynamic_topics:
                continue
            _push(kw)

    return topics[:12]


def _question_topic_anchor(question: str, topic_catalog: list[str]) -> str:
    if not question or not topic_catalog:
        return ""
    q_tokens = _topic_tokens(question)
    q_low = question.lower()
    best_topic = ""
    best_score = 0.0
    for topic in topic_catalog:
        t_tokens = _topic_tokens(topic)
        if not t_tokens:
            continue
        overlap = len(q_tokens.intersection(t_tokens))
        contains = 1.0 if topic.lower() in q_low else 0.0
        score = overlap + contains
        if score > best_score:
            best_score = score
            best_topic = topic
    if best_score <= 0:
        return ""
    return best_topic


def _question_matches_topic(question: str, topic_anchor: str) -> bool:
    if not question or not topic_anchor:
        return False
    q_tokens = _topic_tokens(question)
    t_tokens = _topic_tokens(topic_anchor)
    if not q_tokens or not t_tokens:
        return False
    overlap = len(q_tokens.intersection(t_tokens))
    return overlap >= 1 or topic_anchor.lower() in question.lower()


def _next_topic_anchor(topic_catalog: list[str], current_anchor: str) -> str:
    if not topic_catalog:
        return current_anchor
    if current_anchor and current_anchor in topic_catalog and len(topic_catalog) > 1:
        idx = topic_catalog.index(current_anchor)
        return topic_catalog[(idx + 1) % len(topic_catalog)]
    for topic in topic_catalog:
        if topic != current_anchor:
            return topic
    return current_anchor or topic_catalog[0]


def _build_topic_plan(cleaned_history: list[dict], parsed_sections: dict, role_title: str) -> dict:
    topic_catalog = _build_topic_catalog(parsed_sections, role_title, cleaned_history)
    assistant_questions = [str(t.get("content") or "") for t in cleaned_history if t.get("role") == "assistant"]
    anchored_history = [_question_topic_anchor(q, topic_catalog) for q in assistant_questions]
    current_anchor = ""
    for anchor in reversed(anchored_history):
        if anchor:
            current_anchor = anchor
            break
    if not current_anchor and topic_catalog:
        current_anchor = topic_catalog[0]

    streak = 0
    if current_anchor:
        for anchor in reversed(anchored_history):
            if not anchor:
                break
            if anchor == current_anchor:
                streak += 1
                continue
            break

    target_anchor = current_anchor
    if current_anchor and streak >= TOPIC_MAX_QUESTIONS:
        target_anchor = _next_topic_anchor(topic_catalog, current_anchor)
    elif not current_anchor and topic_catalog:
        target_anchor = topic_catalog[0]

    must_stay = bool(current_anchor and streak < TOPIC_MIN_QUESTIONS)
    should_switch = bool(current_anchor and streak >= TOPIC_MAX_QUESTIONS and target_anchor != current_anchor)
    enforce_anchor = bool(target_anchor)
    next_axis_hint = _next_axis_hint_for_topic(cleaned_history, target_anchor)
    return {
        "topic_catalog": topic_catalog[:8],
        "current_anchor": current_anchor,
        "target_anchor": target_anchor,
        "topic_streak": streak,
        "min_topic_questions": TOPIC_MIN_QUESTIONS,
        "max_topic_questions": TOPIC_MAX_QUESTIONS,
        "must_stay_on_current_topic": must_stay,
        "should_switch_topic_now": should_switch,
        "enforce_anchor": enforce_anchor,
        "next_axis_hint": next_axis_hint,
    }


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
    elapsed_minutes: float | None = None,
) -> tuple[str, str]:
    cleaned_history = _trim_history(history)
    settings = get_settings()
    use_ai = bool((settings.openai_api_key or "").strip())

    parsed_sections = _extract_parsed_sections(parsed_resume_json)
    target_competency = _determine_target_competency(cleaned_history)
    topic_plan = _build_topic_plan(cleaned_history, parsed_sections, role_title)
    _ = [b["question"] for b in human_question_bank if b.get("type") == "main" and b.get("question")]

    last_candidate_turn = None
    for turn in reversed(cleaned_history):
        if turn.get("role") == "candidate":
            last_candidate_turn = str(turn.get("content", "")).strip()
            break
    last_assistant_question = _last_turn_by_role(cleaned_history, "assistant")
    probe_streak = _recent_probe_streak(cleaned_history)
    allow_strict_probe = probe_streak < 1

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

    if last_candidate_turn and _is_incomplete_answer(last_candidate_turn) and allow_strict_probe:
        if use_ai:
            try:
                probe_q, probe_meta = _generate_ai_incomplete_probe(
                    settings=settings,
                    last_question=last_assistant_question,
                    last_candidate_turn=last_candidate_turn,
                    role_title=role_title,
                )
                refined_probe = _postprocess_question(
                    probe_q,
                    cleaned_history,
                    parsed_sections,
                    target_competency,
                    role_title,
                    topic_plan,
                )
                return refined_probe, f"source=incomplete_answer_guard state=hold {probe_meta}"
            except Exception:
                pass
        kws = _extract_keywords(last_candidate_turn, limit=2)
        if kws:
            local_q = (
                f"Thanks. Could you go deeper on {kws[0]}"
                + (f" and {kws[1]}" if len(kws) > 1 else "")
                + " with your exact steps, your ownership, and the final outcome?"
            )
        else:
            local_q = _beast_followup_question(
                cleaned_history=cleaned_history,
                role_title=role_title,
                target_competency=target_competency,
                last_question=last_assistant_question,
                last_answer=last_candidate_turn,
                anchor_override=str(topic_plan.get("target_anchor") or ""),
            )
        refined_local_q = _postprocess_question(local_q, cleaned_history, parsed_sections, target_competency, role_title, topic_plan)
        return refined_local_q, "source=incomplete_answer_guard state=hold fallback=local"

    if last_candidate_turn and last_assistant_question and _is_off_topic_answer(last_assistant_question, last_candidate_turn) and allow_strict_probe:
        kws = _extract_keywords(last_assistant_question, limit=2)
        if use_ai:
            try:
                probe_q, probe_meta = _generate_ai_incomplete_probe(
                    settings=settings,
                    last_question=last_assistant_question,
                    last_candidate_turn=last_candidate_turn,
                    role_title=role_title,
                )
                refined_probe = _postprocess_question(
                    probe_q,
                    cleaned_history,
                    parsed_sections,
                    target_competency,
                    role_title,
                    topic_plan,
                )
                return refined_probe, f"source=off_topic_guard state=hold {probe_meta}"
            except Exception:
                pass
        if kws:
            local_q = (
                f"Let's refocus briefly on {kws[0]}"
                + (f" and {kws[1]}" if len(kws) > 1 else "")
                + ". What exactly did you do, and what was the measurable outcome?"
            )
        else:
            local_q = _beast_followup_question(
                cleaned_history=cleaned_history,
                role_title=role_title,
                target_competency=target_competency,
                last_question=last_assistant_question,
                last_answer=last_candidate_turn,
                anchor_override=str(topic_plan.get("target_anchor") or ""),
            )
        refined_local_q = _postprocess_question(local_q, cleaned_history, parsed_sections, target_competency, role_title, topic_plan)
        return refined_local_q, "source=off_topic_guard state=hold fallback=local"

    if last_candidate_turn and allow_strict_probe:
        signal = _answer_signal(last_candidate_turn)
        if signal["is_vague"] and signal["word_count"] < 28 and last_assistant_question:
            if use_ai:
                try:
                    precision_q, precision_meta = _generate_ai_precision_probe(
                        settings=settings,
                        role_title=role_title,
                        target_competency=target_competency,
                        last_question=last_assistant_question,
                        last_candidate_answer=last_candidate_turn,
                    )
                    refined_precision = _postprocess_question(
                        precision_q,
                        cleaned_history,
                        parsed_sections,
                        target_competency,
                        role_title,
                        topic_plan,
                    )
                    return refined_precision, f"source=precision_probe state=hold {precision_meta}"
                except Exception:
                    pass

    asked_questions = [t["content"] for t in cleaned_history if t.get("role") == "assistant"]
    if not asked_questions:
        topic_plan["enforce_anchor"] = False
    stage = _infer_interview_stage(cleaned_history)
    _ = _sanitize_resume_text(resume_text)
    _ = resume_skills
    elapsed = float(elapsed_minutes or 0.0)

    if last_candidate_turn and last_assistant_question and allow_strict_probe:
        depth = _evaluate_answer_depth(last_candidate_turn)
        if not depth["depth_ok"] and depth["word_count"] >= 8:
            if use_ai:
                try:
                    probe_q, probe_meta = _generate_ai_precision_probe(
                        settings=settings,
                        role_title=role_title,
                        target_competency=target_competency,
                        last_question=last_assistant_question,
                        last_candidate_answer=last_candidate_turn,
                    )
                    refined_probe = _postprocess_question(
                        probe_q,
                        cleaned_history,
                        parsed_sections,
                        target_competency,
                        role_title,
                        topic_plan,
                    )
                    return refined_probe, f"source=answer_depth_gate state=hold {probe_meta}"
                except Exception:
                    pass
            local_probe = _build_clarify_prompt(last_assistant_question, last_candidate_turn)
            refined_local_probe = _postprocess_question(
                local_probe,
                cleaned_history,
                parsed_sections,
                target_competency,
                role_title,
                topic_plan,
            )
            return refined_local_probe, "source=answer_depth_gate state=hold fallback=local"

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
                    parsed_sections=parsed_sections,
                )
                refined_intro = _postprocess_question(
                    intro_q,
                    cleaned_history,
                    parsed_sections,
                    target_competency,
                    role_title,
                    topic_plan,
                )
                return refined_intro, f"source=intro state=interview_start {intro_meta}"
            except Exception:
                pass
        fallback_intro = _fallback_intro_question(candidate_name, role_title, parsed_sections)
        refined_intro = _postprocess_question(
            fallback_intro,
            cleaned_history,
            parsed_sections,
            target_competency,
            role_title,
            topic_plan,
        )
        return refined_intro, "source=intro state=interview_start fallback=local"

    last_q_low = asked_questions[-1].lower() if asked_questions else ""
    last_role = str(cleaned_history[-1].get("role") or "").strip().lower() if cleaned_history else ""
    has_time_notice = any("scheduled interview time" in q.lower() for q in asked_questions[-8:])
    has_final_minute_prompt = any("final 1-minute closing summary" in q.lower() for q in asked_questions[-8:])

    if len(asked_questions) >= 14 and elapsed < FINAL_MINUTE_NOTICE_MINUTES:
        return (
            "As we begin wrapping up, what is one key engineering lesson from this interview, and what would you improve first in your most recent project?",
            f"source=flow_guard state=winddown elapsed_min={elapsed:.2f}",
        )

    if elapsed >= FINAL_MINUTE_NOTICE_MINUTES and not has_time_notice:
        return (
            "We are nearing the end of our scheduled interview time. Please share the most important point you want us to remember about your fit for this role in about one minute.",
            f"source=time_guard state=one_minute_notice elapsed_min={elapsed:.2f}",
        )

    if elapsed >= HARD_STOP_MINUTES:
        if not has_final_minute_prompt:
            return (
                "We are now at the end of our scheduled time. Please give your final 1-minute closing summary, including your strongest technical contribution and the immediate value you can add in this role.",
                f"source=time_guard state=final_1min_prompt elapsed_min={elapsed:.2f}",
            )
        if has_final_minute_prompt and last_role == "candidate":
            return INTERVIEW_COMPLETE_SENTINEL, f"source=time_guard state=soft_close_after_final elapsed_min={elapsed:.2f}"
        return (
            "Please share your final closing summary now so we can conclude the interview professionally.",
            f"source=time_guard state=final_1min_reminder elapsed_min={elapsed:.2f}",
        )

    if elapsed >= WINDDOWN_START_MINUTES:
        if "as we begin wrapping up" in last_q_low:
            return (
                "Before we close, what is one concrete technical improvement you would make in the next 30 days, and how would you measure success?",
                f"source=time_guard state=winddown_followup elapsed_min={elapsed:.2f}",
            )
        return (
            "As we begin wrapping up, what is one key engineering lesson from this interview, and what would you improve first in your most recent project?",
            f"source=time_guard state=winddown elapsed_min={elapsed:.2f}",
        )

    if stage == "close":
        return (
            "Before we close, what is one technical decision you would improve in your past project and why?",
            "source=flow_guard state=closing_prompt",
        )

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
                target_competency=target_competency,
                topic_plan=topic_plan,
            )
            refined_next = _postprocess_question(
                next_q,
                cleaned_history,
                parsed_sections,
                target_competency,
                role_title,
                topic_plan,
            )
            return refined_next, f"source=ai_dynamic_next state=live_flow {next_meta}"
        except Exception:
            pass

    fallback_next = _fallback_next_question(cleaned_history, role_title, parsed_sections, target_competency)
    refined_next = _postprocess_question(
        fallback_next,
        cleaned_history,
        parsed_sections,
        target_competency,
        role_title,
        topic_plan,
    )
    return refined_next, "source=ai_dynamic_next state=live_flow fallback=local"


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
