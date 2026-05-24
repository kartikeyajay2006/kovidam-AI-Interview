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
  const [questionBank, setQuestionBank] = useState("");
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
          question_bank: questionBank,
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
    <section className="glass-card mt-6 rounded-2xl p-8 border border-slate-200 shadow-sm">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">Recruiter Actions</h2>
      <p className="mt-2 text-sm text-slate-500">Create role, add candidates with parsed JSON, and send interview invites.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <form onSubmit={createJob} className="card-hover space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-teal-200">
          <p className="font-bold text-slate-800">1. Create Job</p>
          <input className="w-full rounded-md border border-slate-300 bg-slate-50 p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition" placeholder="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required />
          <textarea className="w-full rounded-md border border-slate-300 bg-slate-50 p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition placeholder-slate-400" placeholder="Enter hyper-detailed technical requirements and stack (e.g. 'Senior Distributed Systems Engineer. Design high-throughput microservices using FastAPI, Redis...')" rows={4} value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} required />
          <textarea className="w-full rounded-md border border-slate-300 bg-slate-50 p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition placeholder-slate-400" placeholder="Custom Question Bank (Optional). One question per line." rows={3} value={questionBank} onChange={(e) => setQuestionBank(e.target.value)} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setJobKind("job")}
              className={`mono rounded-full px-4 py-2 text-[11px] font-bold tracking-[0.1em] uppercase transition ${jobKind === "job" ? "bg-slate-800 text-white shadow-md" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              Job
            </button>
            <button
              type="button"
              onClick={() => setJobKind("internship")}
              className={`mono rounded-full px-4 py-2 text-[11px] font-bold tracking-[0.1em] uppercase transition ${jobKind === "internship" ? "bg-slate-800 text-white shadow-md" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
            >
              Internship
            </button>
          </div>
          <button className="rounded-full bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-teal-600/20 hover:bg-teal-700 transition w-full">Create Job</button>
        </form>

        <form onSubmit={createCandidate} className="card-hover space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-teal-200">
          <p className="font-bold text-slate-800">2. Add Candidate</p>
          <select className="w-full rounded-md border border-slate-300 bg-slate-50 p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
            <option value="" disabled>Select a role...</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <textarea className="mono w-full rounded-md border border-slate-300 bg-slate-50 p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition" rows={9} placeholder="Paste parsed resume JSON" value={parsedResumeJson} onChange={(e) => setParsedResumeJson(e.target.value)} />
          <button disabled={!canCreateCandidate} className="rounded-full bg-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-teal-600/20 hover:bg-teal-700 transition w-full disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-teal-600">
            Add Candidate
          </button>
        </form>

        <form onSubmit={sendInterviewMailToRole} className="card-hover space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-teal-200">
          <p className="font-bold text-slate-800">3. Send Interview Mail</p>
          <select className="w-full rounded-md border border-slate-300 bg-slate-50 p-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:border-teal-500 transition" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
            <option value="" disabled>Select a role...</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <p className="text-sm text-slate-500 leading-relaxed">Sends secure interview links to all candidates under selected role.</p>
          <button className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-400 w-full mt-auto">Send Invite to All</button>
        </form>
      </div>

      {status ? <p className="mt-6 text-sm font-medium text-teal-600 bg-teal-50 px-4 py-3 rounded-lg border border-teal-100 break-all">{status}</p> : null}
    </section>
  );
}
