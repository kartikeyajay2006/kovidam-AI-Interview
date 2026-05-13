interface CandidateInterviewProps {
  params: Promise<{ sessionId: string }>;
}

export default async function CandidateInterviewPage({ params }: CandidateInterviewProps) {
  const { sessionId } = await params;

  return (
    <main className="mx-auto min-h-screen max-w-5xl p-6">
      <div className="glass rounded-2xl p-8">
        <h1 className="text-3xl font-semibold">Candidate Interview Session</h1>
        <p className="mt-3 text-muted">Session: {sessionId}</p>
        <p className="mt-2 text-muted">Realtime audio/video interview orchestration will be mounted in this route.</p>
      </div>
    </main>
  );
}
