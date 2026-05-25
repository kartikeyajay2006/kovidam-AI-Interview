import DashboardControls from "../../components/recruiter/dashboard-controls";
import CandidatesTable from "../../components/recruiter/candidates-table";
import InterviewReviewPanel from "../../components/recruiter/interview-review-panel";

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

async function getCandidatesDashboard(): Promise<CandidateDashboard[]> {
  try {
    const res = await fetch("http://localhost:8000/api/v1/candidates/dashboard", { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load candidates");
    return res.json();
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const [stats, jobs, candidates] = await Promise.all([getStats(), getJobs(), getCandidatesDashboard()]);

  return (
    <main className="min-h-screen bg-[#0b0c10] flex flex-col">
      {/* Top Navigation Bar for Dashboard */}
      <header className="border-b border-white/10 bg-[#0a0a12] px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-16 object-contain -scale-x-100 drop-shadow-[0_0_10px_rgba(139,92,246,0.5)]" />
            <span className="text-xl font-extrabold text-white tracking-widest flex items-center ml-2 uppercase" style={{fontFamily: "Inter, sans-serif"}}>
              KOVI<span className="text-indigo-500 font-bold tracking-normal ml-2" style={{fontFamily: "system-ui"}}>दम्</span>
            </span>
        </div>
        <div className="flex items-center gap-4 text-sm font-semibold text-slate-400">
          <a href="/" className="hover:text-indigo-400 transition">Back to Home</a>
        </div>
      </header>

      <div className="flex-1 w-full max-w-[1600px] mx-auto p-6 md:p-12 text-slate-200">
        <section className="mb-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="mono text-[11px] tracking-[0.24em] text-indigo-500 font-bold mb-2">RECRUITER.CONSOLE</p>
              <h1 className="text-4xl font-bold tracking-tight text-white">Recruiter Dashboard</h1>
              <p className="mt-2 text-slate-400 font-medium text-lg">Live database-backed metrics and campaign pipeline.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Jobs" value={stats.total_jobs} />
            <StatCard label="Candidates" value={stats.total_candidates} />
            <StatCard label="Interviews" value={stats.total_interviews} />
            <StatCard label="In Progress" value={stats.in_progress_interviews} />
            <StatCard label="Completed" value={stats.completed_interviews} />
          </div>
        </section>

        <DashboardControls jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} />

        <CandidatesTable candidates={candidates} />
        <InterviewReviewPanel />
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#12121a] p-6 shadow-sm hover:shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:border-indigo-500/50 transition-all duration-200">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-400 font-bold">{label}</p>
      <p className="mt-3 text-4xl font-extrabold text-white">{value}</p>
    </div>
  );
}
