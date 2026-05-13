"use client";

import { FormEvent, useMemo, useState } from "react";

type Job = { id: string; title: string };
type Candidate = { id: string; name: string; job_id: string };

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PRIMARY_API}${path}`, init);
  } catch {
    return fetch(`${FALLBACK_API}${path}`, init);
  }
}

export default function DashboardControls({ jobs, candidates }: { jobs: Job[]; candidates: Candidate[] }) {
  const [jobTitle, setJobTitle] = useState("");
  const [jobDesc, setJobDesc] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidateJobId, setCandidateJobId] = useState(jobs[0]?.id || "");
  const [resumeCandidateId, setResumeCandidateId] = useState(candidates[0]?.id || "");
  const [resumeJobId, setResumeJobId] = useState(candidates[0]?.job_id || jobs[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");

  const canUpload = useMemo(
    () => Boolean(file && resumeCandidateId && resumeJobId),
    [file, resumeCandidateId, resumeJobId]
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
      setStatus("Creating candidate...");
      const res = await fetchWithFallback("/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: candidateJobId,
          name: candidateName,
          email: candidateEmail,
          phone: "",
          skills: "",
        }),
      });
      if (!res.ok) {
        setStatus(`Failed to create candidate (${res.status})`);
        return;
      }
      setStatus("Candidate created. Refreshing...");
      window.location.reload();
    } catch (err) {
      setStatus(`Failed to create candidate: ${(err as Error).message}`);
    }
  }

  async function uploadResume(e: FormEvent) {
    e.preventDefault();
    try {
      if (!file) {
        setStatus("Please choose a PDF or DOCX file first.");
        return;
      }
      if (!resumeCandidateId || !resumeJobId) {
        setStatus("Create candidate and job first.");
        return;
      }

      const form = new FormData();
      form.append("candidate_id", resumeCandidateId);
      form.append("job_id", resumeJobId);
      form.append("file", file);

      setStatus("Uploading resume...");
      const res = await fetchWithFallback("/resumes/upload", { method: "POST", body: form });
      if (!res.ok) {
        const t = await res.text();
        setStatus(`Upload failed (${res.status}): ${t}`);
        return;
      }
      setStatus("Resume uploaded and parsed successfully. Refreshing...");
      window.location.reload();
    } catch (err) {
      setStatus(`Upload failed: ${(err as Error).message}`);
    }
  }

  return (
    <section className="glass mt-6 rounded-2xl p-8">
      <h2 className="text-2xl font-semibold">Recruiter Actions</h2>
      <p className="mt-2 text-sm text-muted">Create job, add candidate, upload shortlisted resume (PDF/DOCX).</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
        <form onSubmit={createJob} className="space-y-3 rounded-xl border border-muted/20 p-4">
          <p className="font-semibold">1. Create Job</p>
          <input className="w-full rounded bg-panel p-2" placeholder="Job title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} required />
          <textarea className="w-full rounded bg-panel p-2" placeholder="Description" value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} required />
          <button className="rounded bg-accent px-3 py-2 text-black">Create Job</button>
        </form>

        <form onSubmit={createCandidate} className="space-y-3 rounded-xl border border-muted/20 p-4">
          <p className="font-semibold">2. Add Candidate</p>
          <select className="w-full rounded bg-panel p-2" value={candidateJobId} onChange={(e) => setCandidateJobId(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <input className="w-full rounded bg-panel p-2" placeholder="Candidate name" value={candidateName} onChange={(e) => setCandidateName(e.target.value)} required />
          <input className="w-full rounded bg-panel p-2" placeholder="Candidate email" type="email" value={candidateEmail} onChange={(e) => setCandidateEmail(e.target.value)} required />
          <button className="rounded bg-accent px-3 py-2 text-black">Create Candidate</button>
        </form>

        <form onSubmit={uploadResume} className="space-y-3 rounded-xl border border-muted/20 p-4">
          <p className="font-semibold">3. Upload Resume</p>
          <select className="w-full rounded bg-panel p-2" value={resumeCandidateId} onChange={(e) => setResumeCandidateId(e.target.value)} required>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select className="w-full rounded bg-panel p-2" value={resumeJobId} onChange={(e) => setResumeJobId(e.target.value)} required>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <input
            className="w-full rounded bg-panel p-2"
            type="file"
            accept=".pdf,.docx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
          <button disabled={!canUpload} className="rounded bg-accent px-3 py-2 text-black disabled:cursor-not-allowed disabled:opacity-50">
            Upload Resume
          </button>
        </form>
      </div>

      {status ? <p className="mt-4 text-sm text-muted">{status}</p> : null}
    </section>
  );
}
