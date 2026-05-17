"use client";

import { FormEvent, useMemo, useState } from "react";

type Job = { id: string; title: string };

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PRIMARY_API}${path}`, init);
  } catch {
    return fetch(`${FALLBACK_API}${path}`, init);
  }
}

export default function DashboardControls({ jobs }: { jobs: Job[] }) {
  const [jobTitle, setJobTitle] = useState("");
  const [jobDesc, setJobDesc] = useState("");
  const [jobKind, setJobKind] = useState<"job" | "internship">("job");
  const [parsedResumeJson, setParsedResumeJson] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id || "");
  const [status, setStatus] = useState("");

  const canCreateCandidate = useMemo(() => Boolean(selectedJobId && parsedResumeJson.trim()), [selectedJobId, parsedResumeJson]);

  async function createJob(e: FormEvent) {
    e.preventDefault();
    try {
      setStatus("Creating job...");
      const res = await fetchWithFallback("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: jobTitle,
          description: jobDesc,
          difficulty: "medium",
          interview_type: jobKind,
          duration_minutes: 45,
        }),
      });
      if (!res.ok) {
        setStatus(`Failed to create job (${res.status})`);
        return;
      }
      setStatus("Job created. Refreshing...");
      window.location.reload();
    } catch (err) {
      setStatus(`Failed to create job: ${(err as Error).message}`);
    }
  }

  async function createCandidate(e: FormEvent) {
    e.preventDefault();
    try {
      if (!selectedJobId) {
        setStatus("Please select a role first.");
        return;
      }
      let parsed: Record<string, unknown> = {};
      if (parsedResumeJson.trim()) {
        try {
          parsed = JSON.parse(parsedResumeJson);
        } catch {
          setStatus("Parsed resume JSON is invalid.");
          return;
        }
      }

      setStatus("Creating candidate...");
      const res = await fetchWithFallback("/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: selectedJobId,
          parsed_resume_json: parsed,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setStatus(`Failed to create candidate (${res.status}): ${payload.detail || "unknown error"}`);
        return;
      }
      setStatus("Candidate created. Refreshing...");
      window.location.reload();
    } catch (err) {
      setStatus(`Create candidate failed: ${(err as Error).message}`);
    }
  }

  async function sendInterviewMailToRole(e: FormEvent) {
    e.preventDefault();
    try {
      if (!selectedJobId) {
        setStatus("Please select a role first.");
        return;
      }
      setStatus("Sending interview invites to all candidates in this role...");
      const res = await fetchWithFallback(`/interviews/send-links-for-job/${selectedJobId}`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        setStatus(`Mail send failed (${res.status}): ${payload.detail || "unknown error"}`);
        return;
      }
      if (payload.failed > 0) {
        setStatus(`Invites sent: ${payload.sent}/${payload.attempted}. Failed: ${payload.failed}. ${payload.failures.join(" | ")}`);
      } else {
        setStatus(`Invites sent successfully to all ${payload.sent} candidates.`);
      }
      window.location.reload();
    } catch (err) {
      setStatus(`Mail send failed: ${(err as Error).message}`);
    }
  }

  return (
    <section className="glass mt-6 rounded-2xl p-8">
      <h2 className="text-2xl font-bold tracking-tight">Recruiter Actions</h2>
      <p className="mt-2 text-sm text-[#9CA3AF]">Create role, add candidates with parsed JSON, and send interview invites.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <form onSubmit={createJob} className="mesh card-hover space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.01] p-4">
          <p className="font-semibold">1. Create Job</p>
          <input className="w-full rounded border border-white/[0.07] bg-black/50 p-2" placeholder="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required />
          <textarea className="w-full rounded border border-white/[0.07] bg-black/50 p-2" placeholder="Description" value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} required />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setJobKind("job")}
              className={`mono rounded-full px-3 py-2 text-[11px] tracking-[0.18em] ${jobKind === "job" ? "bg-white text-black" : "border border-white/[0.12] bg-transparent text-white/70"}`}
            >
              Job
            </button>
            <button
              type="button"
              onClick={() => setJobKind("internship")}
              className={`mono rounded-full px-3 py-2 text-[11px] tracking-[0.18em] ${jobKind === "internship" ? "bg-white text-black" : "border border-white/[0.12] bg-transparent text-white/70"}`}
            >
              Internship
            </button>
          </div>
          <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black">Create Job</button>
        </form>

        <form onSubmit={createCandidate} className="mesh card-hover space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.01] p-4">
          <p className="font-semibold">2. Add Candidate</p>
          <select className="w-full rounded border border-white/[0.07] bg-black/50 p-2" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <textarea className="mono w-full rounded border border-white/[0.07] bg-black/50 p-2 text-xs" rows={10} placeholder="Paste parsed resume JSON" value={parsedResumeJson} onChange={(e) => setParsedResumeJson(e.target.value)} />
          <button disabled={!canCreateCandidate} className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50">
            Add Candidate
          </button>
        </form>

        <form onSubmit={sendInterviewMailToRole} className="mesh card-hover space-y-3 rounded-xl border border-white/[0.07] bg-white/[0.01] p-4">
          <p className="font-semibold">3. Send Interview Mail</p>
          <select className="w-full rounded border border-white/[0.07] bg-black/50 p-2" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <p className="text-xs text-[#9CA3AF]">Sends secure interview links to all candidates under selected role.</p>
          <button className="rounded-full border border-white/[0.14] px-4 py-2 text-sm text-white shadow-[0_2px_10px_rgba(255,255,255,0.1)] transition hover:border-white/[0.24]">Send Invite to All</button>
        </form>
      </div>

      {status ? <p className="mt-4 text-sm text-[#9CA3AF] break-all">{status}</p> : null}
    </section>
  );
}
