import json
import random
from typing import Iterable

import httpx

from app.core.config import get_settings


QUESTION_BANK = [
    {
        "main": "Tell me about a project you are most proud of.",
        "followups": [
            "What problem was this project solving?",
            "What was your exact contribution?",
            "What technical challenge did you face, and how did you solve it?",
        ],
    },
    {
        "main": "Explain a time when your code or solution failed.",
        "followups": [
            "How did you debug the issue?",
            "What did you learn from that failure?",
            "What would you do differently now?",
        ],
    },
    {
        "main": "How would you design a URL shortener like Bitly?",
        "followups": [
            "How would you generate unique short URLs?",
            "How would you handle millions of requests?",
            "How would you store analytics data?",
        ],
    },
    {
        "main": "Given a very large dataset, how would you find duplicate entries efficiently?",
        "followups": [
            "What data structure would you use?",
            "What is the time and space complexity?",
            "What changes if the dataset cannot fit into memory?",
        ],
    },
    {
        "main": "Tell me about a situation where you worked in a team and faced conflict.",
        "followups": [
            "How did you handle the disagreement?",
            "What was the final outcome?",
            "What did you learn about teamwork?",
        ],
    },
    {
        "main": "Why do you want to join this company/startup?",
        "followups": [
            "What excites you about our product?",
            "How do your skills align with this role?",
            "What kind of work environment helps you perform best?",
        ],
    },
]


def _resume_personalized_openers(resume_text: str, resume_skills: str) -> list[str]:
    skills = [s.strip() for s in (resume_skills or "").split(",") if s.strip()]
    highlights = _extract_resume_highlights(resume_text)
    openers: list[str] = []
    if highlights:
        openers.append(
            f"In your resume you mention '{highlights[0]}'. Walk me through the problem, your exact contribution, and one tough technical challenge you solved."
        )
    if len(highlights) > 1:
        openers.append(
            f"You also mention '{highlights[1]}'. What trade-offs did you make, and how did you validate the final approach?"
        )
    if skills:
        openers.append(
            f"You list {skills[0]}. Tell me about a production use-case where you used it and what failed initially."
        )
    return openers[:2]


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


def _normalize(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _next_question_from_bank(cleaned_history: list[dict]) -> tuple[str, str]:
    bank_map = {}
    for idx, item in enumerate(QUESTION_BANK):
        bank_map[_normalize(item["main"])] = (idx, "main")
        for fup in item["followups"]:
            bank_map[_normalize(fup)] = (idx, "followup")

    assistant_turns = [t for t in cleaned_history if t.get("role") == "assistant"]
    recognized = []
    for t in assistant_turns:
        key = _normalize(t.get("content", ""))
        if key in bank_map:
            recognized.append((bank_map[key][0], bank_map[key][1], key))

    if not recognized:
        first = QUESTION_BANK[0]["main"]
        return first, "Main question 1/6."

    last_main_idx, _, _ = recognized[-1]
    tail_same_main = []
    for rec in reversed(recognized):
        if rec[0] != last_main_idx:
            break
        tail_same_main.append(rec)
    tail_same_main.reverse()

    asked_followup_keys = {key for _, kind, key in tail_same_main if kind == "followup"}
    followup_count = len(asked_followup_keys)
    target_followups = 1 + (last_main_idx % 2)  # deterministic: 1 or 2 per main

    if followup_count < target_followups:
        candidates = [
            f for f in QUESTION_BANK[last_main_idx]["followups"] if _normalize(f) not in asked_followup_keys
        ]
        if candidates:
            return random.choice(candidates), f"Random follow-up {followup_count + 1}/{target_followups}."

    next_main_idx = min(last_main_idx + 1, len(QUESTION_BANK) - 1)
    if next_main_idx == last_main_idx:
        candidates = [
            f for f in QUESTION_BANK[last_main_idx]["followups"] if _normalize(f) not in asked_followup_keys
        ]
        if candidates:
            return random.choice(candidates), "Additional follow-up for deeper assessment."
        return QUESTION_BANK[last_main_idx]["main"], "Re-asking final main question for clarity."

    return QUESTION_BANK[next_main_idx]["main"], f"Main question {next_main_idx + 1}/{len(QUESTION_BANK)}."


def generate_interview_question(
    *,
    role_title: str,
    resume_text: str,
    resume_skills: str,
    history: list[dict],
) -> tuple[str, str]:
    cleaned_history = _trim_history(history)
    if not cleaned_history:
        personalized = _resume_personalized_openers(resume_text, resume_skills)
        if personalized:
            return personalized[0], "Personalized opener from resume/projects."
        return QUESTION_BANK[0]["main"], "Main question 1/6."

    # Ask 1 additional personalized question before moving to fixed bank if available.
    assistant_count = len([t for t in cleaned_history if t.get("role") == "assistant"])
    if assistant_count == 1:
        personalized = _resume_personalized_openers(resume_text, resume_skills)
        if len(personalized) > 1:
            return personalized[1], "Second personalized resume-based question."

    return _next_question_from_bank(cleaned_history)


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
