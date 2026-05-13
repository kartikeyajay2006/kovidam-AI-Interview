"use client";

import { useMemo, useState } from "react";

type Props = {
  interviewId: string;
  initialStatus: string;
};

type CheckState = "idle" | "checking" | "passed" | "failed";

const API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";

export default function InterviewLauncher({ interviewId, initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [message, setMessage] = useState("");

  const canStart = useMemo(() => checkState === "passed" && status !== "completed", [checkState, status]);

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
      setMessage("Interview started. AI interviewer setup is now active.");
    } catch (err) {
      setMessage(`Failed to start interview: ${(err as Error).message}`);
    }
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
      {message ? <p className="mt-2 text-sm text-muted">{message}</p> : null}
    </div>
  );
}
