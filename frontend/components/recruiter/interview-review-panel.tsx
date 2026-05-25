"use client";

import { useEffect, useMemo, useState } from "react";

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";

type FeedItem = {
  interview_id: string;
  candidate_name: string;
  candidate_email: string;
  job_title: string;
  status: string;
  integrity_score: number;
  risk_level: string;
  turns_count: number;
  security_events_count: number;
  created_at: string;
};

type ReviewPacket = {
  interview_id: string;
  candidate_name: string;
  candidate_email: string;
  job_title: string;
  status: string;
  integrity_score: number;
  risk_level: string;
  transcript: Array<{
    role: "assistant" | "candidate";
    source: string;
    content: string;
    analysis: string;
    score: number;
  }>;
  qna_pairs: Array<{
    question: string;
    answers: Array<{
      content: string;
      analysis: string;
      score: number;
      source: string;
      created_at: string;
    }>;
  }>;
  security_events: Array<{
    event_type: string;
    severity: string;
    details: string;
    created_at: string;
  }>;
};

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PRIMARY_API}${path}`, init);
  } catch {
    return fetch(`${FALLBACK_API}${path}`, init);
  }
}

export default function InterviewReviewPanel() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [selectedInterviewId, setSelectedInterviewId] = useState("");
  const [packet, setPacket] = useState<ReviewPacket | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingInterviewId, setDeletingInterviewId] = useState("");
  const [message, setMessage] = useState("");

  async function loadFeed() {
    try {
      const res = await fetchWithFallback("/interviews/review-feed?limit=40");
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setFeed(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage(`Could not load interview review feed: ${(err as Error).message}`);
    }
  }

  async function loadPacket(interviewId: string) {
    try {
      setLoading(true);
      setMessage("");
      const res = await fetchWithFallback(`/interviews/${interviewId}/review-packet`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.detail || `Failed (${res.status})`);
      }
      const data = await res.json();
      setPacket(data);
      setSelectedInterviewId(interviewId);
    } catch (err) {
      setMessage(`Could not load interview details: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function copyForAiAnalysis() {
    if (!packet) return;
    const payload = {
      interview_id: packet.interview_id,
      candidate_name: packet.candidate_name,
      candidate_email: packet.candidate_email,
      job_title: packet.job_title,
      status: packet.status,
      integrity_score: packet.integrity_score,
      risk_level: packet.risk_level,
      qna_pairs: packet.qna_pairs,
      security_events: packet.security_events,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setMessage("Interview Q&A + security telemetry copied to clipboard.");
    } catch {
      setMessage("Could not copy to clipboard. Please copy manually from transcript.");
    }
  }

  async function deleteInterview(item: FeedItem) {
    const ok = window.confirm(
      `Delete interview for "${item.candidate_name}" (${item.job_title})?\n\nThis removes transcript and security timeline permanently.`
    );
    if (!ok) return;

    try {
      setDeletingInterviewId(item.interview_id);
      const res = await fetchWithFallback(`/interviews/${item.interview_id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.detail || `Failed (${res.status})`);
      }

      setFeed((prev) => prev.filter((f) => f.interview_id !== item.interview_id));
      if (selectedInterviewId === item.interview_id) {
        setSelectedInterviewId("");
        setPacket(null);
      }
      setMessage("Interview deleted.");
    } catch (err) {
      setMessage(`Could not delete interview: ${(err as Error).message}`);
    } finally {
      setDeletingInterviewId("");
    }
  }

  const selectedFeed = useMemo(
    () => feed.find((f) => f.interview_id === selectedInterviewId) || null,
    [feed, selectedInterviewId]
  );

  useEffect(() => {
    void loadFeed();
  }, []);

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-[#12121a] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Interview Review</h2>
          <p className="mt-1 text-sm text-slate-400">
            Saved human-like Q&A, candidate answers, and proctoring signals for post-interview AI analysis.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadFeed()}
          className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
        >
          Refresh Feed
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Candidate</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Role</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Status</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Integrity</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Security Events</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {feed.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No interviews found yet.
                </td>
              </tr>
            ) : (
              feed.map((item) => (
                <tr key={item.interview_id} className="hover:bg-white/5 transition-colors">
                  <td className="border-b border-white/5 px-3 py-3 text-slate-200">{item.candidate_name || "-"}</td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">{item.job_title}</td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">{item.status}</td>
                  <td className="border-b border-white/5 px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.integrity_score >= 85 ? "bg-emerald-500/20 text-emerald-400" : item.integrity_score >= 65 ? "bg-amber-500/20 text-amber-400" : "bg-rose-500/20 text-rose-400"}`}>
                      {item.integrity_score.toFixed(1)} • {item.risk_level}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">{item.security_events_count}</td>
                  <td className="border-b border-white/5 px-3 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void loadPacket(item.interview_id)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${selectedInterviewId === item.interview_id ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-300" : "border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"}`}
                      >
                        {selectedInterviewId === item.interview_id ? "Opened" : "Open"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteInterview(item)}
                        disabled={deletingInterviewId === item.interview_id}
                        className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingInterviewId === item.interview_id ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedFeed && packet && (
        <div className="mt-6 rounded-xl border border-white/10 bg-[#0a0a12] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-white font-semibold">{packet.candidate_name} • {packet.job_title}</p>
              <p className="text-xs text-slate-500">{packet.candidate_email}</p>
            </div>
            <button
              type="button"
              onClick={() => void copyForAiAnalysis()}
              className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
            >
              Copy Q&A JSON for AI Analysis
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-[#0f1119] p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Questions & Answers</p>
              <div className="mt-3 max-h-[360px] space-y-3 overflow-y-auto">
                {packet.qna_pairs.length === 0 ? (
                  <p className="text-xs text-slate-500">No Q&A captured yet.</p>
                ) : (
                  packet.qna_pairs.map((pair, idx) => (
                    <div key={`${pair.question}-${idx}`} className="rounded-lg border border-white/10 bg-[#0a0c12] p-3 text-xs">
                      <p className="font-semibold text-indigo-300">Q{idx + 1}. {pair.question || "Question unavailable"}</p>
                      {pair.answers.length === 0 ? (
                        <p className="mt-2 text-slate-500">No candidate answer saved.</p>
                      ) : (
                        pair.answers.map((ans, aIdx) => (
                          <div key={`${ans.created_at}-${aIdx}`} className="mt-2 rounded-md border border-indigo-500/20 bg-indigo-500/5 p-2">
                            <p className="text-slate-200">{ans.content}</p>
                            {ans.analysis ? <p className="mt-1 text-emerald-400">{ans.analysis}</p> : null}
                            <p className="mt-1 text-slate-500">score {ans.score.toFixed(1)} • source {ans.source}</p>
                          </div>
                        ))
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-[#0f1119] p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Security Timeline</p>
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
                {packet.security_events.length === 0 ? (
                  <p className="text-xs text-slate-500">No security events recorded.</p>
                ) : (
                  packet.security_events.map((event, idx) => (
                    <div key={`${event.created_at}-${idx}`} className="rounded-lg border border-white/10 bg-[#0a0c12] p-2 text-xs">
                      <p className="font-semibold text-rose-300">{event.event_type} • {event.severity}</p>
                      <p className="mt-1 text-slate-300">{event.details}</p>
                      <p className="mt-1 text-slate-500">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <details className="mt-4 rounded-xl border border-white/10 bg-[#0f1119] p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-slate-400">
              Full Transcript
            </summary>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto text-xs">
              {packet.transcript.map((t, idx) => (
                <div key={`${t.role}-${idx}`} className="rounded-md border border-white/10 bg-[#0a0c12] p-2">
                  <p className="text-slate-500">{t.role} • {t.source}</p>
                  <p className="mt-1 text-slate-200">{t.content}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {loading ? <p className="mt-4 text-sm text-indigo-400">Loading interview review packet...</p> : null}
      {message ? <p className="mt-4 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-300">{message}</p> : null}
    </section>
  );
}
