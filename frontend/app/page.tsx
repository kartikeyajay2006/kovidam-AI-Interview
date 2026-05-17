"use client";
import Link from "next/link";
import { Home, ChevronDown, Sparkles, ArrowRight, ShieldCheck, Lock, Target, BrainCircuit, Activity } from "lucide-react";

export default function HomePage() {
  return (
    <main className="relative min-h-screen bg-mountains overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] ambient-glow rounded-full pointer-events-none" />

      {/* Navbar */}
      <div className="pt-6 px-4 md:px-8">
        <header className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Dolphin Logo SVG - Blue */}
            <svg viewBox="0 0 100 100" className="w-12 h-12 text-blue-500 fill-current">
              <path d="M72.9 44.8c-2.3-4.8-5.9-8.7-10.4-11.2-4.5-2.5-9.6-3.8-14.8-3.8-8.6 0-16.7 3.6-22.6 9.8C18.6 46.5 15 55.4 15 64.9c0 .4 0 .9.1 1.3 6.9-6.3 16.2-9.9 25.8-9.9 6.2 0 12.2 1.6 17.5 4.6 4.3 2.4 8 5.6 11.1 9.5 5.5-3.6 9.7-8.9 12-15.1 1.5-4.2 1.9-8.7 1.1-13.1-2.9 2-6.5 3-10 2.8.1-.1.2-.2.3-.2z"/>
              <path d="M37.9 35.1c4.5-5.9 11.2-9.9 18.6-11.2 5.1-1 10.3-.6 15.2 1.2-3.1-4.1-7.2-7.5-12-9.7-6.2-2.8-13.1-3.6-19.8-2.2-6.7 1.4-12.8 4.9-17.5 9.8-4.7 4.9-7.9 11.1-9.3 17.8-.3 1.4-.4 2.8-.5 4.2 3.8-5 8.7-9.1 14.3-12.1 3.5-1.9 7.2-3.3 11-4.2v.1-.1z"/>
            </svg>
            <span className="text-[22px] font-bold text-slate-900 uppercase tracking-wide flex items-center">
              KOVIA<span className="text-teal-600 font-medium tracking-normal ml-0.5 text-2xl" style={{fontFamily: "system-ui"}}>दम्</span>
            </span>
          </div>

          <nav className="hidden glass-nav rounded-full px-6 py-2.5 md:flex items-center gap-6 text-sm font-medium text-slate-600 shadow-sm">
            <Link href="/" className="flex items-center gap-1.5 text-teal-600 hover:text-teal-700 transition">
              <Home className="w-4 h-4" /> Home
            </Link>
            <Link href="/dashboard" className="flex items-center gap-1 hover:text-slate-900 transition-colors">
              AI Interview <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/demo" className="rounded-full bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-600/20 hover:bg-teal-700 transition-colors">
              Book a Demo
            </Link>
            <Link href="/dashboard" className="rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 transition-colors border border-slate-200">
              Login
            </Link>
          </div>
        </header>
      </div>

      <div className="mx-auto max-w-7xl px-4 md:px-8 pt-24 pb-32 flex flex-col lg:flex-row items-center gap-16 relative z-10">
        
        {/* Left Content */}
        <div className="flex-1 max-w-xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 mb-6 shadow-sm">
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span className="text-xs font-semibold text-teal-700 tracking-wide">AI-Powered Interview Intelligence</span>
          </div>

          <h1 className="text-5xl lg:text-7xl leading-[1.05] font-bold text-slate-900 mb-6">
            Autonomous AI <br/>
            <span className="text-teal-600">Interviews.</span>
          </h1>

          <p className="text-slate-500 text-lg mb-10 leading-relaxed font-medium">
            Exclusively for your selected candidates. Kovidam conducts deep, role-aware technical interviews with strict question graphs, high-context prompts, and real-time scoring.
          </p>

          <div className="flex items-center gap-4 mb-20">
            <Link href="/dashboard" className="rounded-full bg-teal-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-teal-600/25 hover:bg-teal-700 transition flex items-center gap-2">
              Start Interview <ArrowRight className="w-4 h-4" />
            </Link>
            <Link href="/dashboard/analytics" className="rounded-full bg-white border border-slate-300 px-7 py-3.5 text-sm font-bold text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition flex items-center gap-2 shadow-sm">
              View Analytics <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
             <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-teal-600" />
                <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Strict Candidate<br/>Scoring</span>
             </div>
             <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-slate-400" />
                <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Bias-Free<br/>Hiring</span>
             </div>
             <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-slate-400" />
                <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Enterprise-Grade<br/>Security</span>
             </div>
             <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-slate-400" />
                <span className="text-[11px] uppercase tracking-wider font-bold text-slate-600">Privacy<br/>First</span>
             </div>
          </div>
        </div>

        {/* Right Content - Circular Graph */}
        <div className="flex-1 relative w-full aspect-square max-w-[550px] flex items-center justify-center">
           {/* Rings */}
           <div className="absolute inset-0 border-[1.5px] border-teal-100 rounded-full animate-spin-slow" style={{ animationDuration: '60s' }}></div>
           <div className="absolute inset-12 border-[1.5px] border-teal-200/40 rounded-full border-dashed animate-spin-slow" style={{ animationDirection: 'reverse' }}></div>
           <div className="absolute inset-28 border-[1.5px] border-teal-100 rounded-full"></div>

           {/* Center Dolphin */}
           <div className="w-56 h-56 bg-white rounded-full shadow-[0_20px_60px_rgba(13,148,136,0.15)] flex items-center justify-center z-10 relative">
              <div className="w-40 h-40 bg-gradient-to-tr from-teal-50 to-white rounded-full flex items-center justify-center shadow-inner border border-teal-50">
                 <svg viewBox="0 0 100 100" className="w-24 h-24 text-teal-600 fill-current drop-shadow-md">
                    <path d="M72.9 44.8c-2.3-4.8-5.9-8.7-10.4-11.2-4.5-2.5-9.6-3.8-14.8-3.8-8.6 0-16.7 3.6-22.6 9.8C18.6 46.5 15 55.4 15 64.9c0 .4 0 .9.1 1.3 6.9-6.3 16.2-9.9 25.8-9.9 6.2 0 12.2 1.6 17.5 4.6 4.3 2.4 8 5.6 11.1 9.5 5.5-3.6 9.7-8.9 12-15.1 1.5-4.2 1.9-8.7 1.1-13.1-2.9 2-6.5 3-10 2.8.1-.1.2-.2.3-.2z"/>
                    <path d="M37.9 35.1c4.5-5.9 11.2-9.9 18.6-11.2 5.1-1 10.3-.6 15.2 1.2-3.1-4.1-7.2-7.5-12-9.7-6.2-2.8-13.1-3.6-19.8-2.2-6.7 1.4-12.8 4.9-17.5 9.8-4.7 4.9-7.9 11.1-9.3 17.8-.3 1.4-.4 2.8-.5 4.2 3.8-5 8.7-9.1 14.3-12.1 3.5-1.9 7.2-3.3 11-4.2v.1-.1z"/>
                 </svg>
              </div>
           </div>

           {/* Nodes */}
           <div className="absolute top-2 right-[15%] bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '0s' }}>
              System Design
           </div>
           <div className="absolute top-[25%] -right-8 bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '1s' }}>
              GitHub Analysis
           </div>
           <div className="absolute top-[20%] -left-6 bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '2s' }}>
              Technical Depth
           </div>
           <div className="absolute bottom-[28%] -right-8 bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '3s' }}>
              Problem Solving
           </div>
           <div className="absolute bottom-[25%] -left-8 bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '4s' }}>
              Communication
           </div>
           <div className="absolute bottom-4 right-[10%] bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '5s' }}>
              Resume Intelligence
           </div>
           <div className="absolute bottom-2 left-[15%] bg-white border border-slate-100 shadow-md px-5 py-2.5 rounded-full text-xs font-bold text-slate-800 animate-float" style={{ animationDelay: '6s' }}>
              Execution Maturity
           </div>
           
           {/* Connecting dots */}
           <div className="absolute top-[18%] left-[75%] w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]"></div>
           <div className="absolute top-[75%] left-[20%] w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]"></div>
           <div className="absolute top-[50%] left-[8%] w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]"></div>
           <div className="absolute top-[85%] left-[60%] w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]"></div>
           <div className="absolute top-[15%] left-[30%] w-2 h-2 bg-teal-400 rounded-full shadow-[0_0_10px_rgba(45,212,191,0.8)]"></div>
        </div>

      </div>
      
      {/* Ask Kovidam AI Floating button */}
      <div className="fixed bottom-8 right-8 z-50 flex items-center gap-3">
         <div className="bg-white px-5 py-3 rounded-full shadow-lg border border-slate-100 text-sm font-bold text-slate-800 cursor-pointer hover:-translate-y-1 transition-transform">
           Ask Kovidam AI
         </div>
         <button className="w-14 h-14 bg-teal-600 rounded-full shadow-lg shadow-teal-600/30 flex items-center justify-center text-white hover:bg-teal-700 transition hover:scale-105">
           <Sparkles className="w-6 h-6" />
         </button>
      </div>

    </main>
  );
}
