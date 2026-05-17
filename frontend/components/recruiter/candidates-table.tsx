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
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">View Candidates</h2>
        <p className="text-sm text-slate-500">Saved candidate details and interview mail status</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Candidate</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Role</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Contact</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Skills</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Mail</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Interviews</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Latest Status</th>
              <th className="border-b border-slate-200 px-3 py-2 font-semibold">Action</th>
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
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-800 font-medium">{c.name || "-"}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{c.job_title}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    <div>{c.email || "-"}</div>
                    <div className="text-xs text-slate-500">{c.phone || "-"}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{c.skills || "-"}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${c.invite_sent ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {c.invite_sent ? "Sent" : "Not Sent"}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{c.interview_count}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                      {c.latest_interview_status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <button
                      type="button"
                      onClick={() => onDelete(c.id, c.name || "candidate")}
                      disabled={deletingId === c.id}
                      className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
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
