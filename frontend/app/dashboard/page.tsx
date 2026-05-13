import DashboardControls from "../../components/recruiter/dashboard-controls";

type DashboardStats = {
  total_jobs: number;
  total_candidates: number;
  total_interviews: number;
  in_progress_interviews: number;
  completed_interviews: number;
};

type Job = {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  interview_type: string;
  duration_minutes: number;
};

type Candidate = {
  id: string;
  job_id: string;
  name: string;
};

type Resume = {
  id: string;
  file_name: string;
  extracted_email: string;
  extracted_phone: string;
  extracted_skills: string;
};

async function getStats(): Promise<DashboardStats> {
  const res = await fetch("http://localhost:8000/api/v1/analytics/dashboard", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load dashboard stats");
  return res.json();
}

async function getJobs(): Promise<Job[]> {
  const res = await fetch("http://localhost:8000/api/v1/jobs", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load jobs");
  return res.json();
}

async function getCandidates(): Promise<Candidate[]> {
  const res = await fetch("http://localhost:8000/api/v1/candidates", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load candidates");
  return res.json();
}

async function getResumes(): Promise<Resume[]> {
  const res = await fetch("http://localhost:8000/api/v1/resumes", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load resumes");
  return res.json();
}

export default async function DashboardPage() {
  const [stats, jobs, candidates, resumes] = await Promise.all([getStats(), getJobs(), getCandidates(), getResumes()]);

  return (
    <main className="mx-auto min-h-screen max-w-6xl p-6">
      <section className="glass rounded-2xl p-8">
        <h1 className="text-3xl font-semibold">Recruiter Dashboard</h1>
        <p className="mt-2 text-muted">Live database-backed metrics and campaign pipeline.</p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-5">
          <StatCard label="Jobs" value={stats.total_jobs} />
          <StatCard label="Candidates" value={stats.total_candidates} />
          <StatCard label="Interviews" value={stats.total_interviews} />
          <StatCard label="In Progress" value={stats.in_progress_interviews} />
          <StatCard label="Completed" value={stats.completed_interviews} />
        </div>
      </section>

      <DashboardControls jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} candidates={candidates.map((c) => ({ id: c.id, name: c.name, job_id: c.job_id }))} />

      <section className="glass mt-6 rounded-2xl p-8">
        <h2 className="text-2xl font-semibold">Uploaded Shortlisted Resumes</h2>
        {resumes.length === 0 ? (
          <p className="mt-4 text-muted">No resumes uploaded yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {resumes.map((r) => (
              <div key={r.id} className="rounded-xl border border-muted/20 p-4">
                <p className="font-semibold">{r.file_name}</p>
                <p className="text-sm text-muted">Email: {r.extracted_email || "-"}</p>
                <p className="text-sm text-muted">Phone: {r.extracted_phone || "-"}</p>
                <p className="text-sm text-muted">Skills: {r.extracted_skills || "-"}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-muted/20 bg-panel/60 p-4">
      <p className="text-xs uppercase tracking-[0.15em] text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}
