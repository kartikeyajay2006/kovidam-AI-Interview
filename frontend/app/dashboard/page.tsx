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
    <main className="min-h-screen bg-[#050505] p-4 md:p-8">
      <div className="ambient-frame faint-grid mx-auto max-w-6xl rounded-[28px] border border-white/[0.07] bg-[#070707] p-6">
      <section className="glass rounded-2xl p-8">
        <p className="mono text-[10px] tracking-[0.24em] text-cyan-300/85">RECRUITER.CONSOLE</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight">Recruiter Dashboard</h1>
        <p className="mt-2 text-[#9CA3AF]">Live database-backed metrics and campaign pipeline.</p>

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
    <div className="card-hover rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
      <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/60">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}
