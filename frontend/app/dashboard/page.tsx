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

async function getStats(): Promise<DashboardStats> {
  try {
    const res = await fetch("http://localhost:8000/api/v1/analytics/dashboard", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load dashboard stats");
    return res.json();
  } catch {
    return {
      total_jobs: 0,
      total_candidates: 0,
      total_interviews: 0,
      in_progress_interviews: 0,
      completed_interviews: 0,
    };
  }
}

async function getJobs(): Promise<Job[]> {
  try {
    const res = await fetch("http://localhost:8000/api/v1/jobs", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load jobs");
    return res.json();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [stats, jobs] = await Promise.all([getStats(), getJobs()]);

  return (
    <main className="min-h-screen bg-mountains p-4 md:p-8">
      <div className="mx-auto max-w-6xl rounded-[28px] border border-slate-200 bg-white/70 backdrop-blur-xl p-6 shadow-xl shadow-teal-900/5">
        <section className="glass-card rounded-2xl p-8 border border-white/80">
          <p className="mono text-[10px] tracking-[0.24em] text-teal-600 font-bold">RECRUITER.CONSOLE</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-900">Recruiter Dashboard</h1>
          <p className="mt-2 text-slate-500 font-medium">Live database-backed metrics and campaign pipeline.</p>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-5">
            <StatCard label="Jobs" value={stats.total_jobs} />
            <StatCard label="Candidates" value={stats.total_candidates} />
            <StatCard label="Interviews" value={stats.total_interviews} />
            <StatCard label="In Progress" value={stats.in_progress_interviews} />
            <StatCard label="Completed" value={stats.completed_interviews} />
          </div>
        </section>

        <DashboardControls jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} />
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-hover rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:border-teal-200">
      <p className="mono text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">{label}</p>
      <p className="mt-2 text-3xl font-bold text-slate-800">{value}</p>
    </div>
  );
}
