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
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidatePhone, setCandidatePhone] = useState("");
  const [candidateSkills, setCandidateSkills] = useState("");
  const [parsedResumeJson, setParsedResumeJson] = useState("");
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id || "");
  const [status, setStatus] = useState("");

  const canCreateCandidate = useMemo(
    () => Boolean(selectedJobId && candidateName.trim() && candidateEmail.trim()),
    [selectedJobId, candidateName, candidateEmail]
  );

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
          interview_type: "mixed",
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
          name: candidateName,
          email: candidateEmail,
          phone: candidatePhone,
          skills: candidateSkills,
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
      <h2 className="text-2xl font-semibold">Recruiter Actions</h2>
      <p className="mt-2 text-sm text-muted">Create role, add candidates with parsed JSON, and send interview invites.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <form onSubmit={createJob} className="space-y-3 rounded-xl border border-muted/20 p-4">
          <p className="font-semibold">1. Create Job</p>
          <input className="w-full rounded bg-panel p-2" placeholder="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required />
          <textarea className="w-full rounded bg-panel p-2" placeholder="Description" value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} required />
          <button className="rounded bg-accent px-3 py-2 text-black">Create Job</button>
        </form>

        <form onSubmit={createCandidate} className="space-y-3 rounded-xl border border-muted/20 p-4">
          <p className="font-semibold">2. Add Candidate</p>
          <select className="w-full rounded bg-panel p-2" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <input className="w-full rounded bg-panel p-2" placeholder="Candidate name" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} required />
          <input className="w-full rounded bg-panel p-2" placeholder="Candidate email" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} required />
          <input className="w-full rounded bg-panel p-2" placeholder="Phone (optional)" value={candidatePhone} onChange={(e) => setCandidatePhone(e.target.value)} />
          <input className="w-full rounded bg-panel p-2" placeholder="Skills CSV (optional)" value={candidateSkills} onChange={(e) => setCandidateSkills(e.target.value)} />
          <textarea className="w-full rounded bg-panel p-2" rows={5} placeholder="Paste parsed resume JSON (optional)" value={parsedResumeJson} onChange={(e) => setParsedResumeJson(e.target.value)} />
          <button disabled={!canCreateCandidate} className="rounded bg-accent px-3 py-2 text-black disabled:cursor-not-allowed disabled:opacity-50">
            Add Candidate
          </button>
        </form>

        <form onSubmit={sendInterviewMailToRole} className="space-y-3 rounded-xl border border-muted/20 p-4">
          <p className="font-semibold">3. Send Interview Mail</p>
          <select className="w-full rounded bg-panel p-2" value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <p className="text-xs text-muted">Sends secure interview links to all candidates under selected role.</p>
          <button className="rounded bg-accent px-3 py-2 text-black">Send Invite to All</button>
        </form>
      </div>

      {status ? <p className="mt-4 text-sm text-muted break-all">{status}</p> : null}
    </section>
  );
}
