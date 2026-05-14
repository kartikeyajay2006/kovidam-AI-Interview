"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  interviewId: string;
  initialStatus: string;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  sessionId: string;
};

type CheckState = "idle" | "checking" | "passed" | "failed";
type Turn = { role: "assistant" | "candidate"; content: string; analysis?: string; score?: number };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";

const NAV_ITEMS = ["Home", "Interviews", "Analytics", "Reports", "Settings", "Profile"];

export default function InterviewLauncher({
  interviewId,
  initialStatus,
  candidateName,
  candidateEmail,
  jobTitle,
  sessionId,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [autoListen, setAutoListen] = useState(true);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState("");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [navActive, setNavActive] = useState("Interviews");
  const [internetOnline, setInternetOnline] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [warningCount, setWarningCount] = useState(0);
  const [showQuestionDetails, setShowQuestionDetails] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noSpeechRetryRef = useRef(0);
  const listeningRef = useRef(false);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const complianceOk = useMemo(() => cameraOn && micOn && sharingScreen, [cameraOn, micOn, sharingScreen]);
  const canStart = useMemo(
    () => (checkState === "passed" || complianceOk) && complianceOk && status !== "completed",
    [checkState, complianceOk, status]
  );
  const startBlockReason = useMemo(() => {
    if (status === "completed") return "Interview already completed.";
    if (checkState !== "passed" && !complianceOk) return "Run 'Check Devices' and grant permissions first.";
    if (!cameraOn) return "Camera is required.";
    if (!micOn) return "Microphone is required.";
    if (!sharingScreen) return "Screen sharing is required.";
    return "";
  }, [status, checkState, cameraOn, micOn, sharingScreen]);
  const currentQuestion = useMemo(
    () => [...history].reverse().find((t) => t.role === "assistant")?.content || "AI is preparing your next question...",
    [history]
  );
  const progress = useMemo(() => {
    const candidateTurns = history.filter((t) => t.role === "candidate").length;
    return Math.min(100, Math.round((candidateTurns / 10) * 100));
  }, [history]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    const onOnline = () => setInternetOnline(true);
    const onOffline = () => setInternetOnline(false);
    setInternetOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (status === "in_progress") {
      void loadTurns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, interviewId]);

  useEffect(() => {
    if (status !== "in_progress") return;
    const id = window.setInterval(() => setElapsedSec((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    if (status !== "in_progress") return;
    if (complianceOk) return;
    const nextWarnings = warningCount + 1;
    setWarningCount(nextWarnings);
    stopListening();
    if (nextWarnings >= 3) {
      setMessage("Final warning exceeded. Interview is ending due to disabled required devices.");
      void endInterview();
      return;
    }
    setMessage(`Warning ${nextWarnings}/3: mic, camera, and screen share must stay ON. Re-enable immediately.`);
  }, [status, complianceOk, warningCount]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      recognitionRef.current?.stop();
      userStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function formatClock(totalSec: number): string {
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function speak(text: string) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.lang = "en-US";
    utterance.onend = () => {
      if (autoListen) startListening();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async function loadTurns(): Promise<Turn[]> {
    try {
      const res = await fetch(`${API}/interviews/${interviewId}/turns`);
      if (!res.ok) return [];
      const payload = await res.json();
      const turns: Turn[] = (payload || []).map((t: { role: "assistant" | "candidate"; content: string; analysis: string; score: number }) => ({
        role: t.role,
        content: t.content,
        analysis: t.analysis,
        score: t.score,
      }));
      setHistory(turns);
      const latestCandidate = [...turns].reverse().find((t) => t.role === "candidate" && (t.analysis || t.score));
      if (latestCandidate) {
        setLastAnalysis(latestCandidate.analysis || "");
        setLastScore(typeof latestCandidate.score === "number" ? latestCandidate.score : null);
      }
      return turns;
    } catch {
      return [];
    }
  }

  async function saveTurn(role: "assistant" | "candidate", content: string): Promise<Turn | null> {
    try {
      const res = await fetch(`${API}/interviews/${interviewId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content }),
      });
      if (!res.ok) return null;
      const payload = await res.json();
      return {
        role: payload.role,
        content: payload.content,
        analysis: payload.analysis,
        score: payload.score,
      };
    } catch {
      return null;
    }
  }

  async function fetchNextQuestion(currentHistory: Turn[]) {
    setLoadingQuestion(true);
    try {
      const res = await fetch(`${API}/interviews/${interviewId}/next-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: currentHistory }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setMessage(payload.detail || "Could not generate question.");
        return;
      }
      const q = (payload.question || "").trim();
      if (!q) {
        setMessage("AI could not generate a question right now.");
        return;
      }
      const updated: Turn[] = [...currentHistory, { role: "assistant", content: q }];
      setHistory(updated);
      speak(q);
      setMessage("AI interviewer is speaking...");
      void loadTurns();
    } catch (err) {
      setMessage(`Question generation failed: ${(err as Error).message}`);
    } finally {
      setLoadingQuestion(false);
    }
  }

  async function runDeviceCheck() {
    setMessage("");
    setCheckState("checking");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCheckState("failed");
        setMessage("Browser does not support camera/microphone check.");
        return;
      }
      const mediaDevicesWithShare = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
      };
      if (!mediaDevicesWithShare.getDisplayMedia) {
        setCheckState("failed");
        setMessage("Screen share is not supported in this browser.");
        return;
      }

      const camMicStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      userStreamRef.current?.getTracks().forEach((t) => t.stop());
      userStreamRef.current = camMicStream;
      if (userVideoRef.current) userVideoRef.current.srcObject = camMicStream;
      camMicStream.getVideoTracks().forEach((track) => {
        track.onended = () => setCameraOn(false);
      });
      camMicStream.getAudioTracks().forEach((track) => {
        track.onended = () => setMicOn(false);
      });

      const displayStream = await mediaDevicesWithShare.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = displayStream;
      displayStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setSharingScreen(false);
          screenStreamRef.current = null;
        };
      });

      setCheckState("passed");
      setWarningCount(0);
      setCameraOn(true);
      setMicOn(true);
      setSharingScreen(true);
      setMessage("Camera, microphone, and screen sharing are active.");
    } catch {
      setCheckState("failed");
      setMessage("Permission denied. Please allow mic, camera, and screen sharing.");
    }
  }

  async function startInterview() {
    if (!complianceOk) {
      setMessage("Cannot start: mic, camera, and screen sharing are compulsory.");
      return;
    }
    try {
      setMessage("Starting interview session...");
      const res = await fetch(`${API}/interviews/${interviewId}/start`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        setMessage(payload.detail || "Could not start interview.");
        return;
      }
      setStatus(payload.status || "in_progress");
      const existingTurns = await loadTurns();
      await fetchNextQuestion(existingTurns);
    } catch (err) {
      setMessage(`Failed to start interview: ${(err as Error).message}`);
    }
  }

  function buildRecognition(): SpeechRecognitionLike | null {
    const windowWithSpeech = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = windowWithSpeech.SpeechRecognition || windowWithSpeech.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    return rec;
  }

  function startListening() {
    if (listening) return;
    setMessage("");
    const rec = buildRecognition();
    if (!rec) {
      setMessage("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }
    recognitionRef.current = rec;
    setListening(true);
    noSpeechRetryRef.current = 0;

    rec.onresult = async (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        setMessage("No speech detected. Please try again.");
        return;
      }
      const savedCandidate = await saveTurn("candidate", transcript);
      const candidateTurn: Turn = savedCandidate || { role: "candidate", content: transcript };
      const updated: Turn[] = [...history, candidateTurn];
      setHistory(updated);
      if (savedCandidate?.analysis) setLastAnalysis(savedCandidate.analysis);
      if (typeof savedCandidate?.score === "number") setLastScore(savedCandidate.score);
      setMessage("Answer captured. AI is analyzing and preparing follow-up...");
      await fetchNextQuestion(updated);
    };

    rec.onerror = (event) => {
      if (event.error === "no-speech" && noSpeechRetryRef.current < 1) {
        noSpeechRetryRef.current += 1;
        setMessage("No speech detected. Auto-retrying once...");
        setListening(false);
        window.setTimeout(() => {
          if (!listeningRef.current) startListening();
        }, 350);
        return;
      }
      setMessage(`Listening error: ${event.error}`);
      setListening(false);
    };

    rec.onend = () => setListening(false);
    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function ensureCameraStream() {
    if (userStreamRef.current) return userStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    userStreamRef.current = stream;
    if (userVideoRef.current) {
      userVideoRef.current.srcObject = stream;
    }
    setCameraOn(true);
    setMicOn(true);
    return stream;
  }

  async function toggleCamera() {
    try {
      const stream = await ensureCameraStream();
      const tracks = stream.getVideoTracks();
      if (!tracks.length) {
        setMessage("No camera track available.");
        return;
      }
      const isActive = tracks.some((t) => t.enabled);
      if (isActive) {
        setMessage("Camera is mandatory and cannot be turned off during interview.");
        return;
      }
      tracks.forEach((t) => {
        t.enabled = true;
      });
      setCameraOn(true);
      setMessage("Camera enabled.");
    } catch {
      setMessage("Unable to access camera.");
    }
  }

  async function toggleMic() {
    try {
      const stream = await ensureCameraStream();
      const tracks = stream.getAudioTracks();
      if (!tracks.length) {
        setMessage("No microphone track available.");
        return;
      }
      const isActive = tracks.some((t) => t.enabled);
      if (isActive) {
        setMessage("Microphone is mandatory and cannot be turned off during interview.");
        return;
      }
      tracks.forEach((t) => {
        t.enabled = true;
      });
      setMicOn(true);
      if (status === "in_progress" && !listening) startListening();
      setMessage("Microphone enabled.");
    } catch {
      setMessage("Unable to access microphone.");
    }
  }

  async function toggleScreenShare() {
    if (sharingScreen) {
      setMessage("Screen sharing is mandatory and cannot be stopped during interview.");
      return;
    }
    try {
      const mediaDevicesWithShare = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
      };
      if (!mediaDevicesWithShare.getDisplayMedia) {
        setMessage("Screen share is not supported in this browser.");
        return;
      }
      const stream = await mediaDevicesWithShare.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      setSharingScreen(true);
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setSharingScreen(false);
          screenStreamRef.current = null;
        };
      });
      setMessage("Screen sharing active.");
    } catch {
      setMessage("Screen sharing permission denied.");
    }
  }

  async function endInterview() {
    try {
      const res = await fetch(`${API}/interviews/${interviewId}/end`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        setMessage(payload.detail || "Could not end interview.");
        return;
      }
      setStatus(payload.status || "completed");
      stopListening();
      window.speechSynthesis.cancel();
      userStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      userStreamRef.current = null;
      screenStreamRef.current = null;
      setCameraOn(false);
      setMicOn(false);
      setSharingScreen(false);
      setMessage("Interview ended and saved.");
    } catch (err) {
      setMessage(`Failed to end interview: ${(err as Error).message}`);
    }
  }

  function goToSection(section: string) {
    setNavActive(section);
    const idMap: Record<string, string> = {
      Home: "topbar",
      Interviews: "studio",
      Analytics: "ai-notes",
      Reports: "transcript",
      Settings: "controls",
      Profile: "candidate-video",
    };
    const target = document.getElementById(idMap[section]);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!mounted) {
    return (
      <main className="mx-auto min-h-screen max-w-[1750px] p-5 md:p-6">
        <section className="glass rounded-2xl p-6 text-sm text-muted">Loading interview session...</section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1750px] p-5 md:p-6">
      <div className="grid grid-cols-[56px_1fr] gap-4 md:gap-6">
        <aside className="glass flex flex-col items-center rounded-2xl py-4">
          <div className="mb-5 h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-accent2" />
          {NAV_ITEMS.map((item, idx) => (
            <button
              key={item}
              onClick={() => goToSection(item)}
              className={`mb-3 h-10 w-10 rounded-xl text-xs ring-1 ring-muted/20 transition hover:ring-accent/60 ${navActive === item ? "bg-gradient-to-br from-[#3f2f6a] to-[#16214a] text-accent" : "bg-panel/60 text-muted"}`}
              title={item}
            >
              {idx + 1}
            </button>
          ))}
          <div className="mt-auto h-9 w-9 rounded-full bg-panel/70 ring-1 ring-muted/30" />
        </aside>

        <section className="space-y-4 md:space-y-6">
          <header id="topbar" className="glass rounded-2xl p-4 md:p-5">
            <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-muted">Kovidam AI Interview</p>
                <div className="mt-2 flex items-center gap-3">
                  <h1 className="text-3xl font-semibold">AI Interview Session</h1>
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-sm text-emerald-200">
                    Live
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted">Session ID: {sessionId}</p>
              </div>
              <div className="rounded-xl border border-muted/20 bg-panel/55 px-4 py-3 text-sm">
                <p className="text-xs uppercase tracking-[0.15em] text-muted">Environment</p>
                <p className="mt-1">
                  {cameraOn ? "Webcam" : "Webcam Off"} + {micOn ? "Mic" : "Mic Off"} +{" "}
                  {internetOnline ? "Stable Internet" : "Internet Unstable"}
                </p>
              </div>
              <div className="flex justify-start md:justify-end">
                <button
                  onClick={endInterview}
                  className="rounded-xl bg-rose-600/90 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-900/35"
                >
                  End Interview
                </button>
              </div>
            </div>
          </header>

          <div id="studio" className="grid grid-cols-1 gap-4 xl:grid-cols-[330px_1fr_330px]">
            <div className="space-y-4">
              <div id="transcript" className="glass rounded-2xl p-5">
                <h3 className="text-2xl font-semibold">Interview Progress</h3>
                <div className="mt-5 space-y-4">
                  {[
                    { label: "Introduction", pct: Math.min(100, progress + 15) },
                    { label: "Technical Discussion", pct: Math.max(10, progress - 5) },
                    { label: "Problem Solving", pct: Math.max(2, progress - 25) },
                    { label: "Behavioral Round", pct: Math.max(0, progress - 45) },
                  ].map((step) => (
                    <div key={step.label}>
                      <div className="flex items-center justify-between text-sm">
                        <p>{step.label}</p>
                        <p className="text-muted">{step.pct}%</p>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-panel/80">
                        <div
                          className="h-2 rounded-full bg-gradient-to-r from-[#8a5bff] to-[#45d5ff]"
                          style={{ width: `${step.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass rounded-2xl p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-2xl font-semibold">Live Transcript</h3>
                  <span className="text-xs text-muted">Auto-scroll</span>
                </div>
                <div className="max-h-[440px] space-y-3 overflow-auto pr-1">
                  {history.length === 0 ? (
                    <p className="text-sm text-muted">Conversation will appear here when interview starts.</p>
                  ) : (
                    history.map((turn, idx) => (
                      <div
                        key={`${turn.role}-${idx}`}
                        className={`rounded-xl border p-3 text-sm ${turn.role === "assistant" ? "border-violet-400/30 bg-violet-500/10" : "border-emerald-400/30 bg-emerald-500/10"}`}
                      >
                        <p className={`mb-1 text-xs font-semibold uppercase tracking-[0.1em] ${turn.role === "assistant" ? "text-violet-200" : "text-emerald-200"}`}>
                          {turn.role === "assistant" ? "AI Interviewer" : "Candidate"}
                        </p>
                        <p className="text-[#dbe7ff]">{turn.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="glass overflow-hidden rounded-2xl border border-cyan-300/25">
                <div className="relative aspect-video bg-[radial-gradient(circle_at_60%_0%,rgba(118,94,255,0.25),transparent_38%),linear-gradient(120deg,#1f2438,#111527)]">
                  <div className="absolute left-4 top-4 rounded-lg bg-black/45 px-3 py-1 text-sm text-violet-200 ring-1 ring-violet-300/35">
                    AI Interviewer
                  </div>
                  <div className="absolute right-4 top-4 flex gap-1">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <span key={i} className="inline-block w-1 animate-pulse rounded bg-cyan-300/90" style={{ height: `${6 + (i % 6) * 3}px`, animationDelay: `${i * 45}ms` }} />
                    ))}
                  </div>
                  <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
                    <button
                      onClick={toggleMic}
                      className={`rounded-xl px-4 py-2 text-sm ring-1 ${micOn ? "bg-emerald-600/90 text-white ring-emerald-300/25" : "bg-black/40 text-white ring-white/15"}`}
                    >
                      Mic
                    </button>
                    <button
                      onClick={toggleCamera}
                      className={`rounded-xl px-4 py-2 text-sm ring-1 ${cameraOn ? "bg-emerald-600/90 text-white ring-emerald-300/25" : "bg-black/40 text-white ring-white/15"}`}
                    >
                      Cam
                    </button>
                    <button
                      onClick={toggleScreenShare}
                      className={`rounded-xl px-4 py-2 text-sm ring-1 ${sharingScreen ? "bg-cyan-600/90 text-white ring-cyan-300/25" : "bg-black/40 text-white ring-white/15"}`}
                    >
                      Share
                    </button>
                    <button onClick={endInterview} className="rounded-xl bg-rose-600 px-4 py-2 text-sm text-white ring-1 ring-rose-300/25">
                      End
                    </button>
                  </div>
                </div>
              </div>

              <div id="candidate-video" className="glass overflow-hidden rounded-2xl border border-emerald-300/20">
                <div className="relative aspect-[16/5] bg-[radial-gradient(circle_at_25%_10%,rgba(45,212,191,0.18),transparent_38%),linear-gradient(120deg,#1b2235,#131927)]">
                  <video ref={userVideoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-85" />
                  <div className="absolute left-4 top-3 rounded-lg bg-black/45 px-3 py-1 text-sm text-emerald-200 ring-1 ring-emerald-300/30">
                    You
                  </div>
                  <div className="absolute right-4 top-3 text-xs text-muted">{candidateName}</div>
                </div>
              </div>

              <div id="ai-notes" className="glass rounded-2xl p-5">
                <p className="text-xl font-semibold text-violet-100">AI Interviewer is Speaking...</p>
                <div className="mt-4 flex items-end gap-[3px]">
                  {Array.from({ length: 90 }).map((_, i) => (
                    <span
                      key={i}
                      className="inline-block w-[4px] animate-pulse rounded-full bg-gradient-to-b from-violet-400 to-cyan-300"
                      style={{ height: `${4 + (i % 9) * 3}px`, animationDelay: `${i * 20}ms` }}
                    />
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted">{message || "Listening to your response..."}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="glass rounded-2xl p-5">
                <h3 className="text-2xl font-semibold">Readiness Checklist</h3>
                <ul className="mt-4 space-y-2 text-sm text-muted">
                  <li>Camera: {cameraOn ? "Active" : "Inactive"}</li>
                  <li>Microphone: {micOn ? "Active" : "Inactive"}</li>
                  <li>Screen Share: {sharingScreen ? "Active" : "Inactive"}</li>
                  <li>Internet: Stable</li>
                  <li>No Tab Switching</li>
                  <li>Environment: Good</li>
                </ul>
              </div>

              <div className="glass rounded-2xl p-5">
                <h3 className="text-2xl font-semibold">AI Notes (Live)</h3>
                <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
                  <li>Communication: {lastScore && lastScore > 7 ? "Strong" : "In Progress"}</li>
                  <li>Confidence: {history.length > 2 ? "Improving" : "Baseline"}</li>
                  <li>Technical Clarity: {lastScore && lastScore > 6 ? "Good" : "Needs detail"}</li>
                  <li>Practical Examples: {history.filter((t) => t.role === "candidate").length > 1 ? "Present" : "Waiting"}</li>
                </ul>
                {lastAnalysis ? <p className="mt-3 text-sm text-emerald-200/90">{lastAnalysis}</p> : null}
              </div>

              <div className="glass rounded-2xl p-5">
                <h3 className="text-2xl font-semibold">Current Question</h3>
                <p className="mt-2 text-xs uppercase tracking-[0.1em] text-cyan-200">Technical • Adaptive</p>
                <p className="mt-3 text-lg leading-relaxed">{currentQuestion}</p>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted">Timer: {formatClock(elapsedSec)}</p>
                  <button
                    onClick={() => setShowQuestionDetails((v) => !v)}
                    className="rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-muted/25"
                  >
                    {showQuestionDetails ? "Hide Details" : "View Details"}
                  </button>
                </div>
                {showQuestionDetails ? (
                  <div className="mt-3 rounded-lg border border-cyan-400/20 bg-cyan-500/10 p-3 text-sm text-cyan-100">
                    This question is generated from resume + latest answer context. AI expects architecture depth, trade-offs, and production examples.
                  </div>
                ) : null}
              </div>

              <div id="controls" className="glass rounded-2xl p-5">
                <h3 className="text-xl font-semibold">Interview Controls</h3>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button onClick={runDeviceCheck} className="rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-muted/30">
                    {checkState === "checking" ? "Checking..." : "Check Devices"}
                  </button>
                  <button
                    onClick={startInterview}
                    disabled={!canStart}
                    className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black disabled:opacity-60"
                  >
                    Start
                  </button>
                  <button
                    onClick={startListening}
                    disabled={listening || loadingQuestion || status !== "in_progress" || !micOn}
                    className="rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-muted/30 disabled:opacity-60"
                  >
                    {listening ? "Listening..." : "Listen"}
                  </button>
                  <button
                    onClick={stopListening}
                    disabled={!listening}
                    className="rounded-lg bg-panel px-3 py-2 text-sm ring-1 ring-muted/30 disabled:opacity-60"
                  >
                    Stop
                  </button>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} />
                  Auto listen after AI speech
                </label>
                <p className="mt-2 text-xs text-muted">
                  Candidate: {candidateName} • {candidateEmail}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Role: {jobTitle} • Status: {status}
                </p>
                {!canStart ? <p className="mt-2 text-xs text-amber-300">{startBlockReason}</p> : null}
                {warningCount > 0 && status === "in_progress" ? (
                  <p className="mt-1 text-xs text-rose-300">Compliance warnings: {warningCount}/3</p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
