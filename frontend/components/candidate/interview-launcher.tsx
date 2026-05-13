"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  interviewId: string;
  initialStatus: string;
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

export default function InterviewLauncher({ interviewId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [autoListen, setAutoListen] = useState(true);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noSpeechRetryRef = useRef(0);

  const canStart = useMemo(() => checkState === "passed" && status !== "completed", [checkState, status]);

  useEffect(() => {
    if (status === "in_progress") {
      void loadTurns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, interviewId]);

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
      setMessage("AI asked next question.");
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setCheckState("passed");
      setMessage("Camera and microphone are ready.");
    } catch {
      setCheckState("failed");
      setMessage("Permission denied. Please allow camera/microphone and retry.");
    }
  }

  async function startInterview() {
    try {
      setMessage("Starting interview session...");
      const res = await fetch(`${API}/interviews/${interviewId}/start`, { method: "POST" });
      const payload = await res.json();
      if (!res.ok) {
        setMessage(payload.detail || "Could not start interview.");
        return;
      }
      setStatus(payload.status || "in_progress");
      setMessage("Interview started. AI interviewer is preparing first question...");
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
      if (savedCandidate?.analysis) {
        setLastAnalysis(savedCandidate.analysis);
      }
      if (typeof savedCandidate?.score === "number") {
        setLastScore(savedCandidate.score);
      }
      setMessage("Answer captured. Generating follow-up...");
      await fetchNextQuestion(updated);
    };

    rec.onerror = (event) => {
      if (event.error === "no-speech" && noSpeechRetryRef.current < 1) {
        noSpeechRetryRef.current += 1;
        setMessage("No speech detected. Try speaking closer to mic. Auto-retrying...");
        rec.start();
        return;
      }
      setMessage(`Listening error: ${event.error}`);
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    rec.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  return (
    <div className="mt-6 rounded-xl border border-muted/20 bg-panel/50 p-4">
      <p className="text-sm font-medium">Start Interview</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          onClick={runDeviceCheck}
          className="rounded bg-panel px-4 py-2 text-sm ring-1 ring-muted/30 transition hover:bg-panel/80"
          disabled={checkState === "checking"}
        >
          {checkState === "checking" ? "Checking..." : "Check Camera & Mic"}
        </button>
        <button
          onClick={startInterview}
          disabled={!canStart}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start Interview
        </button>
      </div>

      <p className="mt-3 text-sm text-muted">Current status: {status}</p>
      {status === "in_progress" ? (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={autoListen}
              onChange={(e) => setAutoListen(e.target.checked)}
              className="h-4 w-4 rounded border-muted/30 bg-panel"
            />
            Auto-start listening after AI finishes speaking
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={startListening}
              disabled={listening || loadingQuestion}
              className="rounded bg-panel px-4 py-2 text-sm ring-1 ring-muted/30 transition hover:bg-panel/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {listening ? "Listening..." : "Start Listening"}
            </button>
            <button
              onClick={stopListening}
              disabled={!listening}
              className="rounded bg-panel px-4 py-2 text-sm ring-1 ring-muted/30 transition hover:bg-panel/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop Listening
            </button>
          </div>

          <div className="max-h-72 space-y-2 overflow-auto rounded-lg border border-muted/20 bg-[#0a1228] p-3">
            {history.length === 0 ? (
              <p className="text-sm text-muted">AI conversation will appear here.</p>
            ) : (
              history.map((turn, idx) => (
                <div key={`${turn.role}-${idx}`} className="text-sm">
                  <span className={turn.role === "assistant" ? "text-sky-300" : "text-emerald-300"}>
                    {turn.role === "assistant" ? "AI" : "You"}:
                  </span>{" "}
                  <span className="text-muted">{turn.content}</span>
                </div>
              ))
            )}
          </div>
          {lastAnalysis ? (
            <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3">
              <p className="text-sm font-medium text-emerald-200">Latest Answer Analysis</p>
              <p className="mt-1 text-sm text-emerald-100/90">{lastAnalysis}</p>
              <p className="mt-1 text-xs text-emerald-200/90">
                Score: {typeof lastScore === "number" ? `${lastScore.toFixed(1)} / 10` : "N/A"}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
    </div>
  );
}
