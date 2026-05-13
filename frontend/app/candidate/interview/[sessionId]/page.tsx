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

  return (
    <main className="min-h-screen">
      {interview ? (
        <InterviewLauncher
          interviewId={interview.id}
          initialStatus={interview.status}
          candidateName={interview.candidate_name}
          candidateEmail={interview.candidate_email}
          jobTitle={interview.job_title}
          sessionId={sessionId}
        />
      ) : (
        <section className="glass mx-auto mt-8 max-w-5xl rounded-2xl border border-rose-400/30 p-8">
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
