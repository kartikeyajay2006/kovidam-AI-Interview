"use client";
import Link from "next/link";
import { Home, Sparkles, Settings, ArrowRight, Mic, Shield, Brain, Eye, MessageSquare, Zap } from "lucide-react";

export default function HomePage() {
  return (
    <main className="relative min-h-screen bg-mountains overflow-hidden">

      {/* ── NAVBAR ── */}
      <div className="pt-5 px-6 md:px-12 relative z-20">
        <header className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt=""
              className="h-20 w-auto object-contain -scale-x-100"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
            <span
              className="text-[26px] font-extrabold text-white tracking-[0.15em] flex items-center uppercase"
              style={{ fontFamily: "Inter, sans-serif" }}
            >
              KOVI
              <span
                className="text-indigo-400 font-bold tracking-normal ml-1.5"
                style={{ fontFamily: "system-ui" }}
              >
                दम्
              </span>
            </span>
          </div>

          {/* Center Nav Pill */}
          <nav className="hidden md:flex items-center gap-1 bg-white/[0.03] rounded-full px-2 py-1.5 border border-white/[0.06] backdrop-blur-xl">
            <Link
              href="/"
              className="group flex items-center gap-2 px-5 py-2.5 rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-all duration-300"
            >
              <Home className="w-[18px] h-[18px]" strokeWidth={1.8} />
              <span className="text-[13px] font-medium">Home</span>
            </Link>
            <Link
              href="/dashboard"
              className="group flex items-center gap-2 px-5 py-2.5 rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-all duration-300"
            >
              <Sparkles className="w-[18px] h-[18px]" strokeWidth={1.8} />
              <span className="text-[13px] font-medium">Interview</span>
            </Link>
            <Link
              href="/settings"
              className="group flex items-center gap-2 px-5 py-2.5 rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-all duration-300"
            >
              <Settings className="w-[18px] h-[18px]" strokeWidth={1.8} />
              <span className="text-[13px] font-medium">Settings</span>
            </Link>
          </nav>

          {/* Right CTA */}
          <div className="flex items-center gap-3">
            <Link
              href="/demo"
              className="hidden sm:inline-flex rounded-full border border-white/10 px-5 py-2.5 text-[13px] font-semibold text-white/70 hover:text-white hover:border-white/20 transition-all duration-300"
            >
              Book a Demo
            </Link>
            <Link
              href="/dashboard"
              className="btn-primary !py-2.5 !px-6 !text-[13px]"
            >
              Login
            </Link>
          </div>
        </header>
      </div>

      {/* ── HERO SECTION — BALANCED CONTAINER ── */}
      <div className="mx-auto max-w-7xl px-6 md:px-12 pt-16 md:pt-24 pb-20 flex flex-col lg:flex-row items-center justify-between gap-12 lg:gap-16 relative z-10">

        {/* Left Content */}
        <div className="flex-1 max-w-xl animate-fade-up">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-indigo-500/[0.08] border border-indigo-500/20 rounded-full px-4 py-1.5 mb-8 animate-fade-up">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-[12px] font-semibold text-indigo-300 tracking-wide uppercase">
              AI-Powered Interview Platform
            </span>
          </div>

          <h1 className="text-[48px] md:text-[60px] lg:text-[72px] leading-[1.06] font-bold text-white mb-7 tracking-tight animate-fade-up animate-fade-up-delay-1">
            Conversational AI{" "}
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-blue-400 to-violet-400 animate-gradient">
              Interviews. Real Insights.
            </span>
          </h1>

          <p className="text-white/45 text-[17px] md:text-[18px] mb-10 leading-[1.7] max-w-xl font-medium animate-fade-up animate-fade-up-delay-2">
            Kovidam AI conducts live, deep technical interviews — analyzing
            communication, technical depth, and authenticity in real time.
            Completely bias-free candidate evaluation.
          </p>

          <div className="flex flex-wrap items-center gap-4 animate-fade-up animate-fade-up-delay-3">
            <Link href="/dashboard" className="btn-primary">
              Start Interviewing
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/demo" className="btn-secondary">
              Watch Demo
            </Link>
          </div>

          {/* Trust indicators */}
          <div className="flex flex-wrap items-center gap-6 mt-14 animate-fade-up animate-fade-up-delay-3">
            <div className="flex items-center gap-2 text-white/25">
              <Shield className="w-4 h-4" />
              <span className="text-[12px] font-medium">SOC 2 Compliant</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2 text-white/25">
              <Eye className="w-4 h-4" />
              <span className="text-[12px] font-medium">Anti-Cheat Detection</span>
            </div>
            <div className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2 text-white/25">
              <Zap className="w-4 h-4" />
              <span className="text-[12px] font-medium">Real-time Scoring</span>
            </div>
          </div>
        </div>

        {/* Right Content — Premium Orbit Visualization (Perfectly Proportioned) */}
        <div className="flex-1 relative w-full max-w-[470px] aspect-square flex items-center justify-center mx-auto lg:mx-0">

          {/* Ambient glow behind the orb */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[350px] h-[350px] rounded-full bg-indigo-500/[0.07] blur-[100px] animate-pulse-glow" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[220px] h-[220px] rounded-full bg-violet-500/[0.09] blur-[70px] animate-pulse-glow" style={{ animationDelay: "2s" }} />
          </div>

          {/* Orbit Rings */}
          <div className="orbit-ring orbit-ring-1">
            <div className="orbit-dot" style={{ top: "8%", right: "12%" }} />
            <div className="orbit-dot" style={{ bottom: "12%", left: "10%" }} />
          </div>
          <div className="orbit-ring orbit-ring-2" />
          <div className="orbit-ring orbit-ring-3" />

          {/* Curved Neural Connection Lines (Engages the screen beautifully) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0" viewBox="0 0 420 420">
            {/* Live Voice AI */}
            <path d="M 210,210 Q 260,90 320,15" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" strokeDasharray="3 3" className="animate-pulse" />
            {/* Anti-Cheating */}
            <path d="M 210,210 Q 330,160 410,75" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" />
            {/* Technical Depth */}
            <path d="M 210,210 Q 90,160 10,95" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" />
            {/* Confidence Scoring */}
            <path d="M 210,210 Q 350,260 415,290" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" />
            {/* System Design */}
            <path d="M 210,210 Q 80,250 -10,270" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" strokeDasharray="3 3" className="animate-pulse" />
            {/* Role-Specific */}
            <path d="M 210,210 Q 300,340 370,410" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" />
            {/* Communication */}
            <path d="M 210,210 Q 110,340 50,405" stroke="rgba(129, 140, 248, 0.3)" strokeWidth="1.2" fill="none" />
          </svg>

          {/* Center Orb — Dolphin with transparent BG */}
          <div className="center-orb">
            <div className="w-[120px] h-[120px] rounded-full bg-gradient-to-br from-[#14142e] to-[#0b0b18] flex items-center justify-center border border-white/[0.06] overflow-hidden">
              <img
                src="/logo.png"
                alt=""
                className="w-20 h-20 object-contain -scale-x-100 drop-shadow-[0_0_24px_rgba(139,92,246,0.6)]"
              />
            </div>
          </div>

          {/* Feature Tags — positioned around the orbit */}
          <div className="feature-tag absolute -top-2 right-[18%] animate-float" style={{ animationDelay: "0s" }}>
            <span className="flex items-center gap-2">
              <Mic className="w-3.5 h-3.5 text-indigo-400" />
              Live Voice AI
            </span>
          </div>
          <div className="feature-tag absolute top-[16%] -right-4 animate-float" style={{ animationDelay: "1s" }}>
            <span className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-rose-400" />
              Anti-Cheating
            </span>
          </div>
          <div className="feature-tag absolute top-[20%] -left-2 animate-float" style={{ animationDelay: "2s" }}>
            <span className="flex items-center gap-2">
              <Brain className="w-3.5 h-3.5 text-violet-400" />
              Technical Depth
            </span>
          </div>
          <div className="feature-tag absolute bottom-[30%] -right-6 animate-float" style={{ animationDelay: "3s" }}>
            <span className="flex items-center gap-2">
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
              Confidence Scoring
            </span>
          </div>
          <div className="feature-tag absolute bottom-[36%] -left-8 animate-float" style={{ animationDelay: "4s" }}>
            <span className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
              System Design
            </span>
          </div>
          <div className="feature-tag absolute -bottom-2 right-[10%] animate-float" style={{ animationDelay: "5s" }}>
            <span className="flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              Role-Specific
            </span>
          </div>
          <div className="feature-tag absolute bottom-2 left-[8%] animate-float" style={{ animationDelay: "6s" }}>
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
              Communication
            </span>
          </div>
        </div>
      </div>

      {/* ── FLOATING AI ASSISTANT ── */}
      <div className="fixed bottom-8 right-8 z-50 flex items-center gap-3">
        <div className="bg-[#0a0a14]/90 backdrop-blur-xl px-5 py-3 rounded-full shadow-lg border border-white/[0.06] text-[13px] font-semibold text-white/60 cursor-pointer hover:-translate-y-0.5 hover:text-white transition-all duration-300">
          Ask Kovidam AI
        </div>
        <button className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-full shadow-[0_0_24px_rgba(99,102,241,0.4)] flex items-center justify-center text-white hover:shadow-[0_0_32px_rgba(99,102,241,0.6)] transition-all duration-300 hover:scale-105">
          <Sparkles className="w-5 h-5" />
        </button>
      </div>

    </main>
  );
}
