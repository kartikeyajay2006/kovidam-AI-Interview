import Link from "next/link";

const NAV = ["Product", "Pricing", "Docs"];

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] px-4 py-6 text-white md:px-8">
      <div className="ambient-frame faint-grid mx-auto max-w-7xl rounded-[28px] border border-white/[0.07] bg-[#060606] p-4 md:p-8">
        <header className="sticky top-4 z-40 mx-auto mb-12 flex max-w-5xl items-center justify-between rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-2 backdrop-blur-md">
          <div className="flex items-center gap-3 rounded-full bg-white/[0.03] px-3 py-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.85)]" />
            <span className="mono text-[11px] tracking-[0.22em] text-white/75">KOVIDAM.OS</span>
          </div>
          <nav className="hidden items-center gap-2 md:flex">
            {NAV.map((item) => (
              <a
                key={item}
                className="rounded-full px-4 py-2 text-sm text-white/70 transition hover:bg-white/[0.08] hover:text-white"
                href="#"
              >
                {item}
              </a>
            ))}
          </nav>
          <Link href="/dashboard" className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black">
            Open App
          </Link>
        </header>

        <section className="mx-auto max-w-5xl text-center">
          <p className="mono text-[11px] tracking-[0.24em] text-cyan-300/90">LLM.REASONING LAYER / DETERMINISTIC FLOW</p>
          <h1 className="mt-5 text-5xl font-bold tracking-tight text-white md:text-7xl">
            Technical Interviews
            <span className="block text-white/85">That Feel Like Senior Engineers</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-sm text-[#9CA3AF] md:text-base">
            Build deep, role-aware interview sessions with strict question graphs, high-context prompts, and real-time
            scoring signals across communication, system depth, and ownership quality.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link href="/dashboard" className="rounded-full bg-white px-6 py-3 text-sm font-bold text-black">
              Launch Recruiter Console
            </Link>
            <Link
              href="/candidate/interview/demo-session"
              className="mono rounded-full border border-white/[0.16] px-6 py-3 text-[11px] tracking-[0.2em] text-white shadow-[0_2px_10px_rgba(255,255,255,0.1)] transition hover:border-white/30"
            >
              RUN CANDIDATE PREVIEW
            </Link>
          </div>
        </section>

        <section className="mx-auto mt-10 max-w-6xl rounded-3xl border border-white/[0.08] bg-[#0b0b0b] p-4 md:p-6">
          <div className="mesh rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
              <p className="mono text-[10px] tracking-[0.22em] text-white/55">LIVE INTERVIEW ENGINE</p>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="mono rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 tracking-[0.16em] text-cyan-200">ACTIVE</span>
                <span className="mono rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 tracking-[0.16em] text-emerald-200">SNAPSHOT: HEALTHY</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <article className="card-hover rounded-2xl border border-white/[0.07] bg-[#0d0d0d] p-4">
                <p className="mono text-[10px] tracking-[0.2em] text-white/50">QUESTION GRAPH</p>
                <p className="mt-3 text-sm text-white/80">Adaptive branching based on candidate trade-offs, failures, and system reasoning.</p>
                <svg viewBox="0 0 220 120" className="mt-4 h-24 w-full text-cyan-300/70">
                  <path d="M10 60 H80 M80 60 L130 20 M80 60 L130 100 M130 20 H210 M130 100 H210" stroke="currentColor" strokeWidth="1" fill="none" />
                  <circle cx="80" cy="60" r="4" fill="currentColor" />
                  <circle cx="130" cy="20" r="4" fill="currentColor" />
                  <circle cx="130" cy="100" r="4" fill="currentColor" />
                </svg>
              </article>

              <article className="card-hover rounded-2xl border border-white/[0.07] bg-[#0d0d0d] p-4">
                <p className="mono text-[10px] tracking-[0.2em] text-white/50">EXECUTION TIMELINE</p>
                <ul className="mt-3 space-y-2 text-sm text-white/75">
                  <li className="flex items-center justify-between border-b border-white/[0.06] pb-2"><span>Prompt Assembly</span><span className="mono text-[10px] text-cyan-200">31ms</span></li>
                  <li className="flex items-center justify-between border-b border-white/[0.06] pb-2"><span>Reasoning Loop</span><span className="mono text-[10px] text-emerald-200">97ms</span></li>
                  <li className="flex items-center justify-between"><span>Score Normalization</span><span className="mono text-[10px] text-amber-300">11ms</span></li>
                </ul>
              </article>

              <article className="card-hover rounded-2xl border border-white/[0.07] bg-[#0d0d0d] p-4">
                <p className="mono text-[10px] tracking-[0.2em] text-white/50">RISK FLAGS</p>
                <div className="mt-3 space-y-2 text-sm">
                  <p className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 text-red-200">Low authenticity confidence on memorized response pattern</p>
                  <p className="rounded-xl border border-orange-500/35 bg-orange-500/10 px-3 py-2 text-orange-200">Needs deeper architecture ownership evidence</p>
                  <p className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-emerald-200">Strong debugging clarity under pressure</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="mx-auto mt-8 grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3">
          {[
            {
              title: "Role-Aware Questioning",
              tag: "CONTEXT.NODE",
              body: "Derives question depth from JD, tech stack, and candidate portfolio context.",
            },
            {
              title: "Industrial Evaluation",
              tag: "SCORE.LENS",
              body: "Calibrated signal extraction for communication, technical depth, and execution maturity.",
            },
            {
              title: "Recruiter Velocity",
              tag: "OPS.SPEED",
              body: "Move from candidate import to live interviews in minutes with deterministic runs.",
            },
          ].map((item) => (
            <article key={item.title} className="card-hover mesh rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
              <div className="border-b border-white/[0.08] pb-3">
                <p className="mono text-[10px] tracking-[0.22em] text-white/55">{item.tag}</p>
              </div>
              <h3 className="mt-4 text-lg font-bold tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm text-[#9CA3AF]">{item.body}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
