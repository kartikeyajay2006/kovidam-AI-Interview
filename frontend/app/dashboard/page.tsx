import DashboardControls from "../../components/recruiter/dashboard-controls";
import CandidatesTable from "../../components/recruiter/candidates-table";

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
    <main className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation Bar for Dashboard */}
      <header className="border-b border-slate-200 bg-white px-8 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 120 100" className="h-8 w-10 text-[#2b90d9] fill-current" preserveAspectRatio="xMidYMid meet">
            <path d="M49.6,18.8c-2.3-1.6-6-2.5-10.2-2.5c-4.2,0-8.2,1.1-11.4,3.2C21.8,23.7,16.5,31,14.6,39.3c-0.8,3.5-1.1,7.2-0.8,11.2c0.6,9.1,4.7,17.2,11.5,23.3c-2.6,3.6-6,6.3-9.9,7.6c-0.5,0.2-1,0.3-1.5,0.4c0.8-1,1.5-2,2.2-3c4.1-5.7,5.5-12.7,4.3-19.5C18.6,50.1,23.6,40.1,32,32.7c4.6-4.1,10.2-7.2,16.2-8.9c3.1-0.9,6.5-1.4,9.9-1.2C54.6,22.6,51.8,20.4,49.6,18.8z"/>
            <path d="M78.6,36.4c-4.3-2.1-9.5-3.3-14.7-3.3c-5.7,0-11,1.5-15.6,4c-4.8,2.6-8.7,6.3-11.5,10.7C33.7,52.5,32,58,31.7,63.9c-0.1,2.8,0.3,5.6,1,8.3c2.4-5.3,6.5-9.8,11.5-12.8c3.9-2.3,8.3-3.8,13-4.2c1.9-0.2,3.8-0.2,5.7-0.1C68.9,55.3,74.4,56.7,79,59c1.6-3.8,1.8-8,0.7-11.9C78.4,43.2,75.4,39.3,78.6,36.4z"/>
          </svg>
          <span className="text-xl font-extrabold text-[#0f172a] tracking-tight flex items-center ml-1">
            KOVIA<span className="text-[#0d9488] font-semibold tracking-normal ml-1" style={{fontFamily: "system-ui"}}>दम्</span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm font-semibold text-slate-600">
          <a href="/" className="hover:text-teal-600 transition">Back to Home</a>
        </div>
      </header>

      <div className="flex-1 w-full max-w-[1600px] mx-auto p-6 md:p-12">
        <section className="mb-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="mono text-[11px] tracking-[0.24em] text-teal-600 font-bold mb-2">RECRUITER.CONSOLE</p>
              <h1 className="text-4xl font-bold tracking-tight text-slate-900">Recruiter Dashboard</h1>
              <p className="mt-2 text-slate-500 font-medium text-lg">Live database-backed metrics and campaign pipeline.</p>
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
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md hover:border-teal-300 transition-all duration-200">
      <p className="text-xs uppercase tracking-[0.15em] text-slate-500 font-bold">{label}</p>
      <p className="mt-3 text-4xl font-extrabold text-slate-800">{value}</p>
    </div>
  );
}
