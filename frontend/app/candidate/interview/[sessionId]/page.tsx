import InterviewLauncher from "../../../../components/candidate/interview-launcher";

interface CandidateInterviewProps {
  params: Promise<{ sessionId: string }>;
}

type InterviewDetail = {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  job_id: string;
  job_title: string;
  status: string;
  integrity_score: number;
};

async function getInterview(sessionId: string): Promise<InterviewDetail | null> {
  try {
    const res = await fetch(`http://localhost:8000/api/v1/interviews/${sessionId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function CandidateInterviewPage({ params }: CandidateInterviewProps) {
  const { sessionId } = await params;
  const interview = await getInterview(sessionId);
  const statusTone =
    interview?.status === "completed"
      ? "text-emerald-300"
      : interview?.status === "in_progress"
        ? "text-sky-300"
        : "text-amber-300";

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <section className="glass rounded-2xl p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-muted">Kovidam AI Interview</p>
            <h1 className="mt-2 text-3xl font-semibold">Candidate Interview Lobby</h1>
            <p className="mt-3 text-sm text-muted">Session ID: {sessionId}</p>
          </div>
          <div className="rounded-xl border border-muted/20 bg-panel/60 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.15em] text-muted">Environment</p>
            <p className="mt-1">Webcam + Mic + Stable Internet</p>
          </div>
        </div>
      </section>

      {interview ? (
        <section className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="glass rounded-2xl p-6 md:col-span-2">
            <h2 className="text-xl font-semibold">Interview Summary</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoCard label="Candidate" value={interview.candidate_name} />
              <InfoCard label="Email" value={interview.candidate_email} />
              <InfoCard label="Role" value={interview.job_title} />
              <InfoCard label="Status" value={interview.status} valueClassName={statusTone} />
            </div>

            <div className="mt-6 rounded-xl border border-muted/20 bg-panel/50 p-4">
              <p className="text-sm font-medium">Interview Flow</p>
              <ul className="mt-3 space-y-2 text-sm text-muted">
                <li>1. Identity and environment check</li>
                <li>2. Resume-based technical interview</li>
                <li>3. Adaptive follow-up and depth questions</li>
                <li>4. Communication and behavioral signals capture</li>
              </ul>
            </div>
          </div>

          <div className="glass rounded-2xl p-6">
            <h3 className="text-lg font-semibold">Readiness Checklist</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted">
              <li>Camera permission granted</li>
              <li>Microphone permission granted</li>
              <li>Quiet room with good lighting</li>
              <li>Laptop charger connected</li>
              <li>No tab switching during interview</li>
            </ul>
            <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              Interview session is valid. You can proceed when prompted by the recruiter workflow.
            </div>
            <InterviewLauncher interviewId={interview.id} initialStatus={interview.status} />
          </div>
        </section>
      ) : (
        <section className="glass mt-6 rounded-2xl border border-rose-400/30 p-8">
          <h2 className="text-2xl font-semibold text-rose-200">Interview Link Invalid or Expired</h2>
          <p className="mt-3 text-rose-100/90">
            We could not find an active interview session for this link. Please contact your recruiter and request a
            fresh interview invite.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 text-sm text-muted md:grid-cols-2">
            <div className="rounded-xl border border-muted/20 bg-panel/50 p-4">
              <p className="font-medium text-text">What to share with recruiter</p>
              <p className="mt-2">Session ID: {sessionId}</p>
            </div>
            <div className="rounded-xl border border-muted/20 bg-panel/50 p-4">
              <p className="font-medium text-text">Quick troubleshooting</p>
              <p className="mt-2">Open the latest email invite and use the newest interview button.</p>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function InfoCard({ label, value, valueClassName = "" }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded-xl border border-muted/20 bg-panel/60 p-4">
      <p className="text-xs uppercase tracking-[0.15em] text-muted">{label}</p>
      <p className={`mt-2 text-base font-medium ${valueClassName}`}>{value}</p>
    </div>
  );
}
