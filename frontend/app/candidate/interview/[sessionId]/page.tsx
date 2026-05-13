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
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="glass rounded-2xl p-8">
        <h1 className="text-3xl font-semibold">Candidate Interview Session</h1>
        <p className="mt-3 text-muted">Session: {sessionId}</p>

        {interview ? (
          <div className="mt-6 space-y-2 text-muted">
            <p>Candidate: {interview.candidate_name} ({interview.candidate_email})</p>
            <p>Role: {interview.job_title}</p>
            <p>Status: {interview.status}</p>
            <p>Integrity Score: {interview.integrity_score}</p>
          </div>
        ) : (
          <p className="mt-6 text-red-300">Interview session not found. Ask recruiter to resend interview link.</p>
        )}
      </div>
    </main>
  );
}
