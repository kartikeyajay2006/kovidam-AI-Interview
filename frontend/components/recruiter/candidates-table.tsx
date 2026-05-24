"use client";

import { useState } from "react";

type CandidateDashboard = {
  id: string;
  job_id: string;
  job_title: string;
  name: string;
  email: string;
  phone: string;
  skills: string;
  invite_sent: boolean;
  interview_count: number;
  latest_interview_status: string;
};

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PRIMARY_API}${path}`, init);
  } catch {
    return fetch(`${FALLBACK_API}${path}`, init);
  }
}

export default function CandidatesTable({ candidates }: { candidates: CandidateDashboard[] }) {
  const [deletingId, setDeletingId] = useState<string>("");

  async function onDelete(candidateId: string, candidateName: string) {
    const ok = window.confirm(`Delete candidate "${candidateName}" and related interview history?`);
    if (!ok) return;

    try {
      setDeletingId(candidateId);
      const res = await fetchWithFallback(`/candidates/${candidateId}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        window.alert(`Delete failed (${res.status}): ${payload.detail || "unknown error"}`);
        return;
      }
      window.location.reload();
    } catch (err) {
      window.alert(`Delete failed: ${(err as Error).message}`);
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-[#12121a] p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-white">View Candidates</h2>
        <p className="text-sm text-slate-400">Saved candidate details and interview mail status</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Candidate</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Role</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Contact</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Skills</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Mail</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Interviews</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Latest Status</th>
              <th className="border-b border-white/10 px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                  No candidates added yet.
                </td>
              </tr>
            ) : (
              candidates.map((c) => (
                <tr key={c.id} className="hover:bg-white/5 transition-colors">
                  <td className="border-b border-white/5 px-3 py-3 text-slate-200 font-medium">{c.name || "-"}</td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">{c.job_title}</td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">
                    <div>{c.email || "-"}</div>
                    <div className="text-xs text-slate-500">{c.phone || "-"}</div>
                  </td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">{c.skills || "-"}</td>
                  <td className="border-b border-white/5 px-3 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${c.invite_sent ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                      {c.invite_sent ? "Sent" : "Not Sent"}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-3 py-3 text-slate-300">{c.interview_count}</td>
                  <td className="border-b border-white/5 px-3 py-3">
                    <span className="inline-flex rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-300">
                      {c.latest_interview_status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="border-b border-white/5 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onDelete(c.id, c.name || "candidate")}
                      disabled={deletingId === c.id}
                      className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === c.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
