import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-12">
      <section className="glass rounded-2xl p-10">
        <p className="mb-4 text-sm uppercase tracking-[0.2em] text-accent">Kovidam</p>
        <h1 className="text-4xl font-semibold leading-tight md:text-6xl">
          AI Interview Platform
          <span className="block text-accent2">Human-like screening at enterprise scale.</span>
        </h1>
        <p className="mt-6 max-w-3xl text-muted">
          Foundation is now scaffolded. Next steps: auth, resume intelligence, realtime interview orchestration, proctoring, and recruiter analytics.
        </p>
        <div className="mt-8 flex gap-4">
          <Link className="rounded-lg bg-accent px-5 py-3 font-medium text-black" href="/dashboard">Recruiter Dashboard</Link>
          <Link className="rounded-lg border border-muted/40 px-5 py-3 font-medium text-text" href="/candidate/interview/demo-session">Candidate Interview</Link>
        </div>
      </section>
    </main>
  );
}
