"use client";

import { useEffect, useMemo, useState } from "react";

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";

const SUSPICIOUS_EVENT_HINTS = [
  "timeout",
  "mismatch",
  "multiple_faces",
  "face_not_visible",
  "screen_change",
  "screen_share_stopped",
  "tab_hidden",
  "camera_freeze",
  "voice_mismatch",
  "challenge_failed",
];

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
    id?: string;
    event_type: string;
    severity: string;
    event_index?: number;
    prev_hash?: string;
    event_hash?: string;
    details: string;
    created_at: string;
  }>;
  evidence_snapshots?: Array<{
    id: string;
    security_event_id?: string | null;
    snapshot_type: string;
    image_data_url: string;
    image_hash: string;
    created_at: string;
  }>;
  copilot?: {
    overall_recommendation: string;
    confidence: number;
    competency_scores: Array<{ competency: string; score: number; summary: string }>;
    red_flags: string[];
    evidence_links: string[];
  } | null;
};

type PlaybackPacket = {
  interview_id: string;
  timeline: Array<{
    timestamp: string;
    kind: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
};

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    const primary = await fetch(`${PRIMARY_API}${path}`, init);
    if (primary.status !== 502 && primary.status !== 503 && primary.status !== 504) {
      return primary;
    }
  } catch {
    // fallback below
  }
  return fetch(`${FALLBACK_API}${path}`, init);
}

export default function InterviewReviewPanel() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [selectedInterviewId, setSelectedInterviewId] = useState("");
  const [packet, setPacket] = useState<ReviewPacket | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingInterviewId, setDeletingInterviewId] = useState("");
  const [playback, setPlayback] = useState<PlaybackPacket | null>(null);
  const [message, setMessage] = useState("");
  const [severityFilter, setSeverityFilter] = useState<"all" | "critical" | "high" | "medium" | "low" | "info">("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [suspiciousOnly, setSuspiciousOnly] = useState(false);
  const [playbackKindFilter, setPlaybackKindFilter] = useState<"all" | "question" | "answer" | "security_event" | "snapshot">("all");
  const [playbackQuery, setPlaybackQuery] = useState("");

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
      setSeverityFilter("all");
      setEventTypeFilter("all");
      setSuspiciousOnly(false);
      setPlaybackKindFilter("all");
      setPlaybackQuery("");
      const playbackRes = await fetchWithFallback(`/interviews/${interviewId}/playback`);
      if (playbackRes.ok) {
        const playbackData = await playbackRes.json();
        setPlayback(playbackData);
      } else {
        setPlayback(null);
      }
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

  async function copyForensicBundle() {
    if (!packet) return;
    const payload = {
      interview: {
        id: packet.interview_id,
        candidate_name: packet.candidate_name,
        candidate_email: packet.candidate_email,
        job_title: packet.job_title,
        status: packet.status,
        integrity_score: packet.integrity_score,
        risk_level: packet.risk_level,
      },
      copilot: packet.copilot || null,
      security_events: packet.security_events,
      evidence_snapshots: packet.evidence_snapshots || [],
      playback: playback?.timeline || [],
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setMessage("Forensic investigation bundle copied to clipboard.");
    } catch {
      setMessage("Could not copy forensic bundle.");
    }
  }

  async function copyIncidentReport() {
    if (!packet) return;
    const events = filteredSecurityEvents;
    const suspicious = suspiciousEvents;
    const topFindings = suspicious
      .slice(0, 8)
      .map((e, i) => `${i + 1}. [${new Date(e.created_at).toLocaleString()}] ${e.event_type} (${e.severity}) - ${e.details}`)
      .join("\n");
    const report = [
      `# Interview Incident Report`,
      ``,
      `Candidate: ${packet.candidate_name} (${packet.candidate_email})`,
      `Role: ${packet.job_title}`,
      `Interview ID: ${packet.interview_id}`,
      `Status: ${packet.status}`,
      `Integrity: ${packet.integrity_score.toFixed(2)} (${packet.risk_level})`,
      ``,
      `## Security Summary`,
      `- Critical: ${securitySummary.critical}`,
      `- High: ${securitySummary.high}`,
      `- Medium: ${securitySummary.medium}`,
      `- Low: ${securitySummary.low}`,
      `- Info: ${securitySummary.info}`,
      `- Suspicious Events: ${suspicious.length}`,
      ``,
      `## Top Findings`,
      topFindings || "No suspicious findings.",
      ``,
      `## Decision Context`,
      `- Copilot Recommendation: ${packet.copilot?.overall_recommendation || "n/a"}`,
      `- Copilot Confidence: ${Math.round((packet.copilot?.confidence || 0) * 100)}%`,
      ``,
      `## Filtered Timeline Count`,
      `- Currently visible events: ${events.length}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(report);
      setMessage("Incident report copied to clipboard.");
    } catch {
      setMessage("Could not copy incident report.");
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
        setPlayback(null);
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

  const snapshotsByEventId = useMemo(() => {
    const map = new Map<string, Array<NonNullable<ReviewPacket["evidence_snapshots"]>[number]>>();
    if (!packet?.evidence_snapshots?.length) return map;
    for (const snap of packet.evidence_snapshots) {
      const key = (snap.security_event_id || "").trim();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(snap);
    }
    return map;
  }, [packet]);

  const securitySummary = useMemo(() => {
    const events = packet?.security_events || [];
    const counts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    for (const e of events) {
      const key = (e.severity || "medium") as keyof typeof counts;
      if (key in counts) counts[key] += 1;
    }
    return counts;
  }, [packet]);

  const eventTypeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of packet?.security_events || []) {
      if (e.event_type) set.add(e.event_type);
    }
    return ["all", ...Array.from(set)];
  }, [packet]);

  const filteredSecurityEvents = useMemo(() => {
    const events = packet?.security_events || [];
    return events.filter((e) => {
      const sevOk = severityFilter === "all" ? true : e.severity === severityFilter;
      const typeOk = eventTypeFilter === "all" ? true : e.event_type === eventTypeFilter;
      const suspiciousHit =
        e.severity === "critical" ||
        e.severity === "high" ||
        SUSPICIOUS_EVENT_HINTS.some((hint) => (e.event_type || "").includes(hint));
      const suspiciousOk = suspiciousOnly ? suspiciousHit : true;
      return sevOk && typeOk && suspiciousOk;
    });
  }, [packet, severityFilter, eventTypeFilter, suspiciousOnly]);

  const suspiciousEvents = useMemo(() => {
    const events = packet?.security_events || [];
    return events.filter(
      (e) =>
        e.severity === "critical" ||
        e.severity === "high" ||
        SUSPICIOUS_EVENT_HINTS.some((hint) => (e.event_type || "").includes(hint))
    );
  }, [packet]);

  const filteredPlayback = useMemo(() => {
    const timeline = playback?.timeline || [];
    const q = playbackQuery.trim().toLowerCase();
    return timeline.filter((entry) => {
      const kindOk = playbackKindFilter === "all" ? true : entry.kind === playbackKindFilter;
      if (!kindOk) return false;
      if (!q) return true;
      const content = `${entry.kind} ${entry.content} ${JSON.stringify(entry.metadata || {})}`.toLowerCase();
      return content.includes(q);
    });
  }, [playback, playbackKindFilter, playbackQuery]);

  const decisionBadge = useMemo(() => {
    const integrity = packet?.integrity_score || 0;
    const severe = (securitySummary.critical || 0) + (securitySummary.high || 0);
    if (integrity >= 85 && severe === 0) {
      return { label: "Low Risk Interview", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" };
    }
    if (integrity >= 70 && severe <= 2) {
      return { label: "Moderate Risk Interview", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
    }
    return { label: "High Risk Interview", tone: "bg-rose-500/15 text-rose-300 border-rose-500/30" };
  }, [packet, securitySummary]);

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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void copyForAiAnalysis()}
                className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20"
              >
                Copy Q&A JSON
              </button>
              <button
                type="button"
                onClick={() => void copyForensicBundle()}
                className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
              >
                Copy Forensic Bundle
              </button>
              <button
                type="button"
                onClick={() => void copyIncidentReport()}
                className="rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/20"
              >
                Copy Incident Report
              </button>
            </div>
          </div>

          <div className={`mt-4 rounded-lg border px-3 py-2 text-xs font-semibold ${decisionBadge.tone}`}>
            Decision Signal: {decisionBadge.label}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              Critical: {securitySummary.critical}
            </div>
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-300">
              High: {securitySummary.high}
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Medium: {securitySummary.medium}
            </div>
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
              Low: {securitySummary.low}
            </div>
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              Info: {securitySummary.info}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {packet.copilot ? (
              <div className="rounded-xl border border-white/10 bg-[#0f1119] p-3 lg:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Recruiter Copilot</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-indigo-300">
                    Recommendation: {packet.copilot.overall_recommendation}
                  </span>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
                    Confidence: {Math.round((packet.copilot.confidence || 0) * 100)}%
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(packet.copilot.competency_scores || []).map((c) => (
                    <div key={c.competency} className="rounded-lg border border-white/10 bg-[#0a0c12] p-2 text-xs">
                      <p className="font-semibold text-slate-200">{c.competency} • {c.score.toFixed(1)}</p>
                      <p className="mt-1 text-slate-400">{c.summary}</p>
                    </div>
                  ))}
                </div>
                {(packet.copilot.red_flags || []).length > 0 && (
                  <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-2 text-xs">
                    <p className="font-semibold text-rose-300">Red Flags</p>
                    {(packet.copilot.red_flags || []).slice(0, 5).map((flag, idx) => (
                      <p key={`${flag}-${idx}`} className="mt-1 text-slate-300">• {flag}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Security Timeline</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSuspiciousOnly((v) => !v)}
                    className={`rounded border px-2 py-1 text-[11px] ${
                      suspiciousOnly
                        ? "border-rose-500/40 bg-rose-500/15 text-rose-300"
                        : "border-white/20 bg-[#0a0c12] text-slate-300"
                    }`}
                  >
                    {suspiciousOnly ? "Suspicious Only: ON" : "Suspicious Only: OFF"}
                  </button>
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
                    className="rounded border border-white/20 bg-[#0a0c12] px-2 py-1 text-[11px] text-slate-300"
                  >
                    <option value="all">All Severity</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Info</option>
                  </select>
                  <select
                    value={eventTypeFilter}
                    onChange={(e) => setEventTypeFilter(e.target.value)}
                    className="rounded border border-white/20 bg-[#0a0c12] px-2 py-1 text-[11px] text-slate-300"
                  >
                    {eventTypeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === "all" ? "All Event Types" : opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
                {filteredSecurityEvents.length === 0 ? (
                  <p className="text-xs text-slate-500">No security events matched current filters.</p>
                ) : (
                  filteredSecurityEvents.map((event, idx) => (
                    <div key={`${event.created_at}-${idx}`} className="rounded-lg border border-white/10 bg-[#0a0c12] p-2 text-xs">
                      <p className="font-semibold text-rose-300">
                        {event.event_type} • {event.severity}
                        {typeof event.event_index === "number" ? ` • #${event.event_index}` : ""}
                      </p>
                      <p className="mt-1 text-slate-300">{event.details}</p>
                      {event.event_hash ? <p className="mt-1 break-all text-[10px] text-slate-500">hash: {event.event_hash}</p> : null}
                      <p className="mt-1 text-slate-500">{new Date(event.created_at).toLocaleString()}</p>

                      {(() => {
                        const eventId = String(event.id || "");
                        const snaps = eventId ? snapshotsByEventId.get(eventId) || [] : [];
                        if (!snaps.length) return null;
                        const before = snaps.find((s) => s.snapshot_type === "screen_before");
                        const after = snaps.find((s) => s.snapshot_type === "screen_after" || s.snapshot_type === "screen");
                        const camera = snaps.find((s) => s.snapshot_type === "camera");
                        const challenge = snaps.find((s) => s.snapshot_type === "camera_challenge");
                        return (
                          <div className="mt-2 space-y-2">
                            {(before || after) ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="rounded border border-white/10 bg-black/20 p-1">
                                  <p className="mb-1 text-[10px] text-slate-400">Screen Before</p>
                                  {before ? (
                                    <img src={before.image_data_url} alt="screen before" className="h-24 w-full rounded object-cover" />
                                  ) : (
                                    <div className="flex h-24 items-center justify-center rounded bg-white/5 text-[10px] text-slate-500">Not captured</div>
                                  )}
                                </div>
                                <div className="rounded border border-white/10 bg-black/20 p-1">
                                  <p className="mb-1 text-[10px] text-slate-400">Screen After</p>
                                  {after ? (
                                    <img src={after.image_data_url} alt="screen after" className="h-24 w-full rounded object-cover" />
                                  ) : (
                                    <div className="flex h-24 items-center justify-center rounded bg-white/5 text-[10px] text-slate-500">Not captured</div>
                                  )}
                                </div>
                              </div>
                            ) : null}

                            {(camera || challenge) ? (
                              <div className="grid grid-cols-2 gap-2">
                                <div className="rounded border border-white/10 bg-black/20 p-1">
                                  <p className="mb-1 text-[10px] text-slate-400">Camera Snapshot</p>
                                  {camera ? (
                                    <img src={camera.image_data_url} alt="camera snapshot" className="h-20 w-full rounded object-cover" />
                                  ) : (
                                    <div className="flex h-20 items-center justify-center rounded bg-white/5 text-[10px] text-slate-500">Not captured</div>
                                  )}
                                </div>
                                <div className="rounded border border-white/10 bg-black/20 p-1">
                                  <p className="mb-1 text-[10px] text-slate-400">Challenge Snapshot</p>
                                  {challenge ? (
                                    <img src={challenge.image_data_url} alt="challenge snapshot" className="h-20 w-full rounded object-cover" />
                                  ) : (
                                    <div className="flex h-20 items-center justify-center rounded bg-white/5 text-[10px] text-slate-500">Not captured</div>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {packet.evidence_snapshots && packet.evidence_snapshots.length > 0 ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-[#0f1119] p-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Evidence Snapshots</p>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                {packet.evidence_snapshots.slice(-8).map((snap) => (
                  <div key={snap.id} className="rounded-lg border border-white/10 bg-[#0a0c12] p-2">
                    <img src={snap.image_data_url} alt={snap.snapshot_type} className="h-20 w-full rounded object-cover" />
                    <p className="mt-1 text-[10px] text-slate-400">{snap.snapshot_type}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {playback ? (
            <details className="mt-4 rounded-xl border border-white/10 bg-[#0f1119] p-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-slate-400">
                Playback Timeline
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={playbackKindFilter}
                  onChange={(e) => setPlaybackKindFilter(e.target.value as typeof playbackKindFilter)}
                  className="rounded border border-white/20 bg-[#0a0c12] px-2 py-1 text-[11px] text-slate-300"
                >
                  <option value="all">All Kinds</option>
                  <option value="question">Questions</option>
                  <option value="answer">Answers</option>
                  <option value="security_event">Security Events</option>
                  <option value="snapshot">Snapshots</option>
                </select>
                <input
                  value={playbackQuery}
                  onChange={(e) => setPlaybackQuery(e.target.value)}
                  placeholder="Search playback..."
                  className="rounded border border-white/20 bg-[#0a0c12] px-2 py-1 text-[11px] text-slate-300 placeholder:text-slate-500"
                />
              </div>
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto text-xs">
                {filteredPlayback.map((entry, idx) => (
                  <div key={`${entry.kind}-${idx}`} className="rounded-md border border-white/10 bg-[#0a0c12] p-2">
                    <p className="text-slate-500">
                      {entry.kind} • {new Date(entry.timestamp).toLocaleString()}
                    </p>
                    <p className="mt-1 text-slate-200">{entry.content}</p>
                  </div>
                ))}
                {filteredPlayback.length === 0 ? (
                  <p className="text-xs text-slate-500">No playback entries matched current filters.</p>
                ) : null}
              </div>
            </details>
          ) : null}

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
