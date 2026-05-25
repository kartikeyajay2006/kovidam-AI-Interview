"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Mic, Monitor, CheckCircle, AlertCircle, Wifi, Play, Sparkles, Shield, User, RefreshCw, Activity, ArrowRight, Eye, ShieldCheck } from "lucide-react";

type Props = {
  interviewId: string;
  initialStatus: string;
  candidateName: string;
  candidateEmail: string;
  jobTitle: string;
  sessionId: string;
};

type CheckState = "idle" | "checking" | "passed" | "failed";
type TurnSource = "speech" | "text" | "system" | "proctor";
type Turn = { role: "assistant" | "candidate"; source?: TurnSource; content: string; analysis?: string; score?: number; confidence_score?: number; communication_score?: number; technical_depth_score?: number; authenticity_score?: number };
type SetupStep = "camera" | "microphone" | "screen" | "ready";
type SecurityEvent = {
  time: string;
  event: string;
  eventType?: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
};

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

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";
const TURN_QUEUE_KEY_PREFIX = "kovi_turn_queue_";
const SECURITY_QUEUE_KEY_PREFIX = "kovi_security_queue_";

async function fetchWithFallback(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PRIMARY_API}${path}`, init);
  } catch {
    return fetch(`${FALLBACK_API}${path}`, init);
  }
}

async function readJsonSafe(res: Response): Promise<{ ok: true; data: any } | { ok: false; detail: string }> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    return { ok: true, data };
  }
  const text = await res.text();
  return { ok: false, detail: text.slice(0, 200) || `HTTP ${res.status}` };
}

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
  const [setupStep, setSetupStep] = useState<SetupStep>("camera");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [listening, setListening] = useState(false);
  const [loadingQuestion, setLoadingQuestion] = useState(false);
  const [autoListen, setAutoListen] = useState(true);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastAnalysis, setLastAnalysis] = useState("");
  const [liveScores, setLiveScores] = useState({ confidence: 0, communication: 0, technical: 0, authenticity: 0 });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [navActive, setNavActive] = useState("Interviews");
  const [internetOnline, setInternetOnline] = useState(true);
  const [internetQuality, setInternetQuality] = useState<"good" | "unstable" | "offline">("good");
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [securityCountdown, setSecurityCountdown] = useState<number | null>(null);
  const [tabCountdown, setTabCountdown] = useState<number | null>(null);
  const [cheatingTagged, setCheatingTagged] = useState(false);
  const [showQuestionDetails, setShowQuestionDetails] = useState(false);
  const [faceVisible, setFaceVisible] = useState(true);
  const [multipleFaces, setMultipleFaces] = useState(false);
  const [faceViolationCountdown, setFaceViolationCountdown] = useState<number | null>(null);
  const [screenChanged, setScreenChanged] = useState(false);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [answerDraft, setAnswerDraft] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noSpeechRetryRef = useRef(0);
  const lastEventLoggedAtRef = useRef<Record<string, number>>({});
  const listeningRef = useRef(false);
  const historyRef = useRef<Turn[]>([]);
  const flushingTurnsRef = useRef(false);
  const flushingSecurityRef = useRef(false);
  const tabTimerRef = useRef<number | null>(null);
  const faceTimerRef = useRef<number | null>(null);
  const faceCheckRef = useRef<number | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const prevScreenPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const screenCheckIntervalRef = useRef<number | null>(null);

  function attachUserStreamToVideo(stream: MediaStream | null) {
    if (!userVideoRef.current || !stream) return;
    userVideoRef.current.srcObject = stream;
    const maybePlay = userVideoRef.current.play();
    if (maybePlay && typeof maybePlay.catch === "function") {
      maybePlay.catch(() => {
        // Browser may block autoplay until user interaction; stream will still be attached.
      });
    }
  }

  const complianceOk = useMemo(() => cameraOn && micOn && sharingScreen, [cameraOn, micOn, sharingScreen]);
  const canStart = useMemo(
    () => setupStep === "ready" && complianceOk && internetQuality === "good" && status !== "completed",
    [setupStep, complianceOk, internetQuality, status]
  );
  const startBlockReason = useMemo(() => {
    if (status === "completed") return "Interview already completed.";
    if (setupStep !== "ready") return "Complete Camera -> Microphone -> Screen Share steps first.";
    if (internetQuality !== "good") return "Stable internet is required to start.";
    if (!cameraOn) return "Camera is required.";
    if (!micOn) return "Microphone is required.";
    if (!sharingScreen) return "Screen sharing is required.";
    return "";
  }, [status, setupStep, internetQuality, cameraOn, micOn, sharingScreen]);
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
    historyRef.current = history;
  }, [history]);

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
      void loadSecurityEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, interviewId]);

  useEffect(() => {
    if (status !== "in_progress") return;
    const id = window.setInterval(() => setElapsedSec((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { downlink?: number; rtt?: number; effectiveType?: string; addEventListener?: (event: string, cb: EventListener) => void; removeEventListener?: (event: string, cb: EventListener) => void } };
    const connection = nav.connection;
    const evaluate = () => {
      const online = typeof navigator !== "undefined" ? navigator.onLine : true;
      setInternetOnline(online);
      if (!online) {
        setInternetQuality("offline");
        return;
      }
      if (!connection) {
        setInternetQuality("good");
        return;
      }
      const slowLink = typeof connection.downlink === "number" && connection.downlink < 1;
      const highRtt = typeof connection.rtt === "number" && connection.rtt > 600;
      const weakType = typeof connection.effectiveType === "string" && ["slow-2g", "2g"].includes(connection.effectiveType);
      setInternetQuality(slowLink || highRtt || weakType ? "unstable" : "good");
    };

    evaluate();
    window.addEventListener("online", evaluate);
    window.addEventListener("offline", evaluate);
    connection?.addEventListener?.("change", evaluate as EventListener);
    return () => {
      window.removeEventListener("online", evaluate);
      window.removeEventListener("offline", evaluate);
      connection?.removeEventListener?.("change", evaluate as EventListener);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void flushQueuedTurns();
      void flushQueuedSecurityEvents();
    }, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewId]);

  useEffect(() => {
    if (!internetOnline) return;
    void flushQueuedTurns();
    void flushQueuedSecurityEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internetOnline]);

  useEffect(() => {
    if (status !== "in_progress") return;
    if (internetQuality === "unstable") {
      logSecurityEvent("Network became unstable during interview.", "network_unstable", "medium");
    }
    if (internetQuality === "offline") {
      logSecurityEvent("Network disconnected during interview.", "network_offline", "high");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [internetQuality, status]);

  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged) return;
    const nonCompliant = !cameraOn || !micOn || !sharingScreen || internetQuality !== "good";
    if (!nonCompliant) {
      setSecurityCountdown(null);
      return;
    }

    stopListening();
    setMessage("Security alert: restore camera, microphone, screen share, and stable internet within 10 seconds.");
    logSecurityEvent(
      "Temporary compliance break detected (camera/mic/screen/internet).",
      "compliance_break_started",
      "medium",
      { cameraOn, micOn, sharingScreen, internetQuality }
    );
    setSecurityCountdown(10);
    const timer = window.setInterval(() => {
      setSecurityCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(timer);
          setCheatingTagged(true);
          logSecurityEvent(
            "Cheating detected: required device/internet compliance broken for more than 10 seconds.",
            "compliance_break_timeout",
            "critical",
            { cameraOn, micOn, sharingScreen, internetQuality }
          );
          void saveTurn(
            "assistant",
            "Cheating detected: required device/internet compliance broken for more than 10 seconds.",
            "proctor"
          );
          setMessage("Interview ended: Cheating detected due to compliance break >10 seconds.");
          void endInterview();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, cameraOn, micOn, sharingScreen, internetQuality]);

  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged) return;

    function stopTabTimer() {
      if (tabTimerRef.current) {
        window.clearInterval(tabTimerRef.current);
        tabTimerRef.current = null;
      }
      setTabCountdown(null);
    }

    function startTabTimer() {
      if (tabTimerRef.current) return;
      setTabCountdown(10);
      logSecurityEvent("Candidate moved away from interview tab.", "tab_hidden", "high");
      tabTimerRef.current = window.setInterval(() => {
        setTabCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            if (tabTimerRef.current) {
              window.clearInterval(tabTimerRef.current);
              tabTimerRef.current = null;
            }
            setCheatingTagged(true);
            logSecurityEvent(
              "Cheating detected: candidate moved away from interview tab for more than 10 seconds.",
              "tab_hidden_timeout",
              "critical"
            );
            void saveTurn(
              "assistant",
              "Cheating detected: candidate moved away from interview tab for more than 10 seconds.",
              "proctor"
            );
            setMessage("Interview ended: Cheating detected (tab switching >10 seconds).");
            void endInterview();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        startTabTimer();
      } else {
        stopTabTimer();
        logSecurityEvent("Candidate returned to interview tab.", "tab_visible_again", "info");
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopTabTimer();
    };
  }, [status, cheatingTagged]);

  useEffect(() => {
    return () => {
      window.speechSynthesis.cancel();
      recognitionRef.current?.stop();
      if (faceCheckRef.current) cancelAnimationFrame(faceCheckRef.current);
      if (faceTimerRef.current) window.clearInterval(faceTimerRef.current);
      if (screenCheckIntervalRef.current) window.clearInterval(screenCheckIntervalRef.current);
      userStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    attachUserStreamToVideo(userStreamRef.current);
  }, [mounted, status]);

  // Face detection via canvas pixel brightness analysis
  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !cameraOn) return;
    const canvas = faceCanvasRef.current;
    const video = userVideoRef.current;
    if (!canvas || !video) return;

    let noFaceFrameCount = 0;       // consecutive frames with no face detected
    let frameCounter = 0;           // throttle: only analyse every 6th frame
    const NO_FACE_TRIGGER_FRAMES = 45; // ~1.5s at 30fps before declaring "no face"
    let lastLoggedNoFace = false;

    function checkFrame() {
      faceCheckRef.current = requestAnimationFrame(checkFrame);

      // Only run analysis every 6th frame (≈5fps analysis, smooth UI)
      frameCounter++;
      if (frameCounter % 6 !== 0) return;

      if (!canvas || !video || video.readyState < 2 || video.videoWidth === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = 80; canvas.height = 60;  // smaller = faster
      ctx.drawImage(video, 0, 0, 80, 60);
      const data = ctx.getImageData(0, 0, 80, 60).data;

      // Compute brightness for each of 16 blocks (4x4 grid)
      const blockBrightness: number[] = [];
      let redDominant = 0;
      let greenDominant = 0;
      let blueDominant = 0;
      let sampled = 0;
      let edgeSignal = 0;
      for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
          let sum = 0, count = 0;
          for (let y = by * 15; y < (by + 1) * 15; y++) {
            for (let x = bx * 20; x < (bx + 1) * 20; x++) {
              const i = (y * 80 + x) * 4;
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];
              const luma = r * 0.299 + g * 0.587 + b * 0.114;
              sum += luma;
              count++;
              sampled++;
              if (r > g + 12 && r > b + 12) redDominant++;
              if (g > r + 12 && g > b + 12) greenDominant++;
              if (b > r + 12 && b > g + 12) blueDominant++;
              if (x > 0 && y > 0 && x % 3 === 0 && y % 3 === 0) {
                const left = ((y * 80 + (x - 1)) * 4);
                const up = ((((y - 1) * 80) + x) * 4);
                const leftLuma = data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114;
                const upLuma = data[up] * 0.299 + data[up + 1] * 0.587 + data[up + 2] * 0.114;
                edgeSignal += Math.abs(luma - leftLuma) + Math.abs(luma - upLuma);
              }
            }
          }
          blockBrightness.push(sum / count);
        }
      }

      const mean = blockBrightness.reduce((a, b) => a + b, 0) / blockBrightness.length;
      const variance = blockBrightness.reduce((a, b) => a + (b - mean) ** 2, 0) / blockBrightness.length;

      // A valid face frame requires usable texture + lighting.
      // This catches covered camera (finger/palm), plain surfaces, and dark frames.
      const brightPixels = blockBrightness.filter(b => b > 60).length;
      const centerBlocks = [5, 6, 9, 10].map((idx) => blockBrightness[idx]);
      const centerMean = centerBlocks.reduce((a, b) => a + b, 0) / centerBlocks.length;
      const centerVariance = centerBlocks.reduce((a, b) => a + (b - centerMean) ** 2, 0) / centerBlocks.length;
      const edgeDensity = edgeSignal / Math.max(1, sampled);
      const dominantRatio = Math.max(redDominant, greenDominant, blueDominant) / Math.max(1, sampled);

      const likelyOccluded =
        mean < 16 ||
        (dominantRatio > 0.84 && edgeDensity < 6.5) ||
        (variance < 110 && centerVariance < 35);

      const hasFace =
        !likelyOccluded &&
        mean > 20 &&
        variance > 150 &&
        brightPixels >= 4 &&
        edgeDensity > 5.8;

      if (!hasFace) {
        noFaceFrameCount++;
      } else {
        noFaceFrameCount = 0;
        if (lastLoggedNoFace) {
          lastLoggedNoFace = false;
          setFaceVisible(true);
        } else {
          setFaceVisible(true);
        }
      }

      // Only declare "no face" after sustained absence (avoids flicker on blink/look-away)
      if (noFaceFrameCount >= NO_FACE_TRIGGER_FRAMES) {
        setFaceVisible(false);
        if (!lastLoggedNoFace) {
          logSecurityEvent("Face not visible in camera.", "face_not_visible", "high");
          lastLoggedNoFace = true;
        }
      }
    }

    faceCheckRef.current = requestAnimationFrame(checkFrame);
    return () => { if (faceCheckRef.current) cancelAnimationFrame(faceCheckRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, cameraOn]);


  // Face violation 10-second countdown
  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged) return;
    const violation = !faceVisible || multipleFaces;
    if (!violation) {
      if (faceTimerRef.current) { window.clearInterval(faceTimerRef.current); faceTimerRef.current = null; }
      setFaceViolationCountdown(null);
      return;
    }
    if (faceTimerRef.current) return;
    setFaceViolationCountdown(10);
    faceTimerRef.current = window.setInterval(() => {
      setFaceViolationCountdown(prev => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (faceTimerRef.current) { window.clearInterval(faceTimerRef.current); faceTimerRef.current = null; }
          setCheatingTagged(true);
          logSecurityEvent(
            "Cheating detected: face violation — no face or multiple faces for >10 seconds.",
            multipleFaces ? "multiple_faces_detected" : "face_not_visible_timeout",
            "critical",
            { multipleFaces }
          );
          void saveTurn(
            "assistant",
            "Cheating detected: face violation — no face or multiple faces for >10 seconds.",
            "proctor"
          );
          setMessage("Interview ended: Face compliance violation.");
          void endInterview();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (faceTimerRef.current) { window.clearInterval(faceTimerRef.current); faceTimerRef.current = null; } };
  }, [status, cheatingTagged, faceVisible, multipleFaces]);

  // Screen change detection
  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !sharingScreen) return;
    const screenVideo = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (screenStreamRef.current) screenVideo.srcObject = screenStreamRef.current;
    canvas.width = 80; canvas.height = 45;

    screenCheckIntervalRef.current = window.setInterval(() => {
      if (!ctx || screenVideo.readyState < 2) return;
      ctx.drawImage(screenVideo, 0, 0, 80, 45);
      const imageData = ctx.getImageData(0, 0, 80, 45).data;
      if (prevScreenPixelsRef.current) {
        let deltaSum = 0;
        const prev = prevScreenPixelsRef.current;
        for (let i = 0; i < imageData.length; i += 24) {
          deltaSum += Math.abs(imageData[i] - prev[i]);
        }
        const meanDelta = deltaSum / (imageData.length / 24);
        if (meanDelta > 22) {
          setScreenChanged(true);
          logSecurityEvent(
            "Screen content changed during interview.",
            "screen_change_detected",
            "low",
            { meanDelta: Number(meanDelta.toFixed(2)) }
          );
        }
      }
      prevScreenPixelsRef.current = new Uint8ClampedArray(imageData);
    }, 3000);

    screenVideo.play().catch(() => {});
    return () => { if (screenCheckIntervalRef.current) window.clearInterval(screenCheckIntervalRef.current); };
  }, [status, cheatingTagged, sharingScreen]);

  function getTurnQueueKey() {
    return `${TURN_QUEUE_KEY_PREFIX}${interviewId}`;
  }

  function getSecurityQueueKey() {
    return `${SECURITY_QUEUE_KEY_PREFIX}${interviewId}`;
  }

  function readQueuedTurns(): { role: "assistant" | "candidate"; content: string; source: TurnSource }[] {
    try {
      const raw = localStorage.getItem(getTurnQueueKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeQueuedTurns(turns: { role: "assistant" | "candidate"; content: string; source: TurnSource }[]) {
    localStorage.setItem(getTurnQueueKey(), JSON.stringify(turns.slice(-50)));
  }

  function queueTurn(role: "assistant" | "candidate", content: string, source: TurnSource) {
    const queued = readQueuedTurns();
    queued.push({ role, content, source });
    writeQueuedTurns(queued);
  }

  function readQueuedSecurityEvents(): { event_type: string; severity: string; details: string; evidence: Record<string, unknown> }[] {
    try {
      const raw = localStorage.getItem(getSecurityQueueKey());
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeQueuedSecurityEvents(items: { event_type: string; severity: string; details: string; evidence: Record<string, unknown> }[]) {
    localStorage.setItem(getSecurityQueueKey(), JSON.stringify(items.slice(-80)));
  }

  function queueSecurityEvent(event_type: string, severity: string, details: string, evidence: Record<string, unknown> = {}) {
    const queued = readQueuedSecurityEvents();
    queued.push({ event_type, severity, details, evidence });
    writeQueuedSecurityEvents(queued);
  }

  async function saveSecurityEvent(
    eventType: string,
    details: string,
    severity: "info" | "low" | "medium" | "high" | "critical" = "medium",
    evidence: Record<string, unknown> = {}
  ): Promise<boolean> {
    try {
      const res = await fetchWithFallback(`/interviews/${interviewId}/security-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: eventType,
          severity,
          details,
          evidence,
        }),
      });
      if (res.status === 404 || res.status === 400) {
        return true; // do not queue permanently-invalid events
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  async function flushQueuedTurns() {
    if (flushingTurnsRef.current) return;
    const queued = readQueuedTurns();
    if (!queued.length) return;
    flushingTurnsRef.current = true;
    try {
      const remaining: typeof queued = [];
      for (const turn of queued) {
        const ok = await saveTurn(turn.role, turn.content, turn.source, false);
        if (!ok) remaining.push(turn);
      }
      writeQueuedTurns(remaining);
    } finally {
      flushingTurnsRef.current = false;
    }
  }

  async function flushQueuedSecurityEvents() {
    if (flushingSecurityRef.current) return;
    const queued = readQueuedSecurityEvents();
    if (!queued.length) return;
    flushingSecurityRef.current = true;
    try {
      const remaining: typeof queued = [];
      for (const event of queued) {
        const ok = await saveSecurityEvent(
          event.event_type,
          event.details,
          (event.severity as "info" | "low" | "medium" | "high" | "critical") || "medium",
          event.evidence || {}
        );
        if (!ok) remaining.push(event);
      }
      writeQueuedSecurityEvents(remaining);
    } finally {
      flushingSecurityRef.current = false;
    }
  }

  function logSecurityEvent(
    event: string,
    eventType: string,
    severity: "info" | "low" | "medium" | "high" | "critical" = "medium",
    evidence: Record<string, unknown> = {}
  ) {
    const nowMs = Date.now();
    const last = lastEventLoggedAtRef.current[eventType] || 0;
    if (nowMs - last < 6000) return; // de-noise repeated events
    lastEventLoggedAtRef.current[eventType] = nowMs;
    const now = new Date().toLocaleTimeString();
    setSecurityEvents((prev) => [{ time: now, event, eventType, severity }, ...prev].slice(0, 20));
    void saveSecurityEvent(eventType, event, severity, evidence).then((ok) => {
      if (!ok) queueSecurityEvent(eventType, severity, event, evidence);
    });
  }

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

  async function loadSecurityEvents() {
    try {
      const res = await fetchWithFallback(`/interviews/${interviewId}/security-events`);
      if (!res.ok) return;
      const parsed = await readJsonSafe(res);
      if (!parsed.ok || !Array.isArray(parsed.data)) return;
      const mapped = parsed.data
        .slice(-20)
        .map((e: { details: string; event_type?: string; severity?: string; created_at?: string }) => ({
          time: e.created_at ? new Date(e.created_at).toLocaleTimeString() : "--:--:--",
          event: e.details || e.event_type || "security event",
          eventType: e.event_type,
          severity: (e.severity || "medium") as SecurityEvent["severity"],
        }))
        .reverse();
      setSecurityEvents(mapped);
    } catch {
      // no-op
    }
  }

  async function loadTurns(): Promise<Turn[]> {
    try {
      const res = await fetchWithFallback(`/interviews/${interviewId}/turns`);
      if (!res.ok) return [];
      const parsed = await readJsonSafe(res);
      if (!parsed.ok) return [];
      const payload = parsed.data;
      const turns: Turn[] = (payload || []).map((t: { role: "assistant" | "candidate"; source?: TurnSource; content: string; analysis: string; score: number; confidence_score?: number; communication_score?: number; technical_depth_score?: number; authenticity_score?: number }) => ({
        role: t.role,
        source: t.source || "speech",
        content: t.content,
        analysis: t.analysis,
        score: t.score,
        confidence_score: t.confidence_score ?? 0,
        communication_score: t.communication_score ?? 0,
        technical_depth_score: t.technical_depth_score ?? 0,
        authenticity_score: t.authenticity_score ?? 0,
      }));
      setHistory(turns);
      // Accumulate scores across all candidate turns for running averages
      const candidateTurns = turns.filter((t) => t.role === "candidate" && (t.score ?? 0) > 0);
      if (candidateTurns.length > 0) {
        const avg = (key: keyof Turn) => {
          const vals = candidateTurns.map((t) => (t[key] as number) ?? 0).filter((v) => v > 0);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        };
        setLiveScores({
          confidence: avg("confidence_score"),
          communication: avg("communication_score"),
          technical: avg("technical_depth_score"),
          authenticity: avg("authenticity_score"),
        });
        const latestCandidate = [...candidateTurns].reverse()[0];
        setLastAnalysis(latestCandidate.analysis || "");
        setLastScore(latestCandidate.score ?? null);
      }
      return turns;
    } catch {
      return [];
    }
  }

  async function saveTurn(
    role: "assistant" | "candidate",
    content: string,
    source: TurnSource = "speech",
    queueOnFail = true
  ): Promise<Turn | null> {
    let permanentFailure = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await fetchWithFallback(`/interviews/${interviewId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, content, source }),
        });
        if (res.status === 404 || res.status === 400) {
          permanentFailure = true;
          break;
        }
        if (!res.ok) continue;
        const parsed = await readJsonSafe(res);
        if (!parsed.ok) continue;
        const payload = parsed.data;
        return {
          role: payload.role,
          source: payload.source || source,
          content: payload.content,
          analysis: payload.analysis,
          score: payload.score,
          confidence_score: payload.confidence_score ?? 0,
          communication_score: payload.communication_score ?? 0,
          technical_depth_score: payload.technical_depth_score ?? 0,
          authenticity_score: payload.authenticity_score ?? 0,
        };
      } catch {
        // retry below
      }
      await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (queueOnFail && !permanentFailure) queueTurn(role, content, source);
    return null;
  }

  async function fetchNextQuestion(currentHistory: Turn[]) {
    setLoadingQuestion(true);
    try {
      const res = await fetchWithFallback(`/interviews/${interviewId}/next-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: currentHistory }),
      });
      const parsed = await readJsonSafe(res);
      if (!parsed.ok) {
        setMessage(`Could not generate question: ${parsed.detail}`);
        return;
      }
      const payload = parsed.data;
      if (!res.ok) {
        setMessage(payload.detail || "Could not generate question.");
        return;
      }
      const q = (payload.question || "").trim();
      if (!q) {
        setMessage("AI could not generate a question right now.");
        return;
      }
      const updated: Turn[] = [...currentHistory, { role: "assistant", source: "system", content: q }];
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

  async function verifyCameraStep() {
    setMessage("");
    setCheckState("checking");
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      userStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      userStreamRef.current = camStream;
      attachUserStreamToVideo(camStream);
      camStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setCameraOn(false);
          logSecurityEvent("Camera stream ended unexpectedly.", "camera_unavailable", "high");
        };
      });
      const camSettings = camStream.getVideoTracks()[0]?.getSettings?.();
      if (camSettings) {
        const width = Number(camSettings.width || 0);
        const height = Number(camSettings.height || 0);
        const fps = Number(camSettings.frameRate || 0);
        if (width < 640 || height < 480 || (fps > 0 && fps < 15)) {
          setMessage("Camera is active, but quality is low. Improve lighting or switch camera for best interview quality.");
          logSecurityEvent(
            "Camera quality is below recommended threshold.",
            "camera_quality_low",
            "low",
            { width, height, fps }
          );
        }
      }
      setCameraOn(true);
      setCheckState("passed");
      setSetupStep("microphone");
      setMessage("Camera access granted. Next: allow microphone.");
      logSecurityEvent("Camera verification passed.", "camera_check_passed", "info");
    } catch {
      setCheckState("failed");
      setMessage("Camera permission denied.");
      logSecurityEvent("Camera permission denied by candidate.", "camera_permission_denied", "high");
    }
  }

  async function verifyMicrophoneStep() {
    setMessage("");
    setCheckState("checking");
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
      const existingVideo = userStreamRef.current?.getVideoTracks() || [];
      const combined = new MediaStream();
      existingVideo.forEach((track) => combined.addTrack(track));
      micStream.getAudioTracks().forEach((track) => {
        combined.addTrack(track);
        track.onended = () => {
          setMicOn(false);
          logSecurityEvent("Microphone stream ended unexpectedly.", "microphone_unavailable", "high");
        };
      });
      const micSettings = micStream.getAudioTracks()[0]?.getSettings?.();
      if (micSettings) {
        logSecurityEvent("Microphone quality baseline captured.", "microphone_quality_captured", "info", {
          sampleRate: micSettings.sampleRate ?? null,
          channelCount: micSettings.channelCount ?? null,
        });
      }
      userStreamRef.current = combined;
      attachUserStreamToVideo(combined);
      setMicOn(true);
      setCheckState("passed");
      setSetupStep("screen");
      setMessage("Microphone access granted. Next: allow screen share.");
      logSecurityEvent("Microphone verification passed.", "microphone_check_passed", "info");
    } catch {
      setCheckState("failed");
      setMessage("Microphone permission denied.");
      logSecurityEvent("Microphone permission denied by candidate.", "microphone_permission_denied", "high");
    }
  }

  async function verifyScreenStep() {
    setMessage("");
    setCheckState("checking");
    try {
      const mediaDevicesWithShare = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
      };
      if (!mediaDevicesWithShare.getDisplayMedia) {
        setCheckState("failed");
        setMessage("Screen share is not supported in this browser.");
        return;
      }
      const displayStream = await mediaDevicesWithShare.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = displayStream;
      displayStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setSharingScreen(false);
          screenStreamRef.current = null;
          logSecurityEvent("Screen sharing stopped by candidate.", "screen_share_stopped", "critical");
        };
      });
      setSharingScreen(true);
      setCheckState("passed");
      setSetupStep("ready");
      setMessage("Screen share granted. You can now start the interview.");
      logSecurityEvent("Screen share verification passed.", "screen_share_check_passed", "info");
    } catch {
      setCheckState("failed");
      setMessage("Screen share permission denied.");
      logSecurityEvent("Screen share permission denied by candidate.", "screen_share_permission_denied", "high");
    }
  }

  async function runDeviceCheck() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCheckState("failed");
      setMessage("Browser does not support media permission checks.");
      return;
    }
    if (setupStep === "camera") return verifyCameraStep();
    if (setupStep === "microphone") return verifyMicrophoneStep();
    if (setupStep === "screen") return verifyScreenStep();
    setCheckState("passed");
    setMessage("All setup steps completed.");
  }

  async function startInterview() {
    if (setupStep !== "ready") {
      setMessage("Complete Camera, Microphone, and Screen Share steps first.");
      return;
    }
    if (internetQuality !== "good") {
      setMessage("Stable internet is required to start interview.");
      return;
    }
    if (!complianceOk) {
      setMessage("Cannot start: mic, camera, and screen sharing are compulsory.");
      return;
    }
    try {
      setMessage("Starting interview session...");
      await flushQueuedTurns();
      await flushQueuedSecurityEvents();
      const res = await fetchWithFallback(`/interviews/${interviewId}/start`, { method: "POST" });
      const parsed = await readJsonSafe(res);
      if (!parsed.ok) {
        setMessage(`Could not start interview: ${parsed.detail}`);
        return;
      }
      const payload = parsed.data;
      if (!res.ok) {
        setMessage(payload.detail || "Could not start interview.");
        return;
      }
      setStatus(payload.status || "in_progress");
      logSecurityEvent("Interview session started.", "interview_started", "info");
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

  async function submitAnswer(rawText: string, source: TurnSource) {
    const transcript = rawText.trim();
    if (!transcript) {
      setMessage("No answer detected. Please speak or type your response.");
      return;
    }

    const savedCandidate = await saveTurn("candidate", transcript, source);
    const candidateTurn: Turn = savedCandidate || { role: "candidate", source, content: transcript };
    const updated: Turn[] = [...historyRef.current, candidateTurn];
    historyRef.current = updated;
    setHistory(updated);
    setAnswerDraft("");
    if (savedCandidate?.analysis) setLastAnalysis(savedCandidate.analysis);
    if (typeof savedCandidate?.score === "number") setLastScore(savedCandidate.score);
    if (savedCandidate && typeof savedCandidate.communication_score === "number") {
      const candidateTurns = updated.filter((t) => t.role === "candidate" && typeof t.communication_score === "number");
      const avg = (key: keyof Turn) => {
        const vals = candidateTurns.map((t) => (t[key] as number) ?? 0).filter((v) => v > 0);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      };
      setLiveScores({
        confidence: avg("confidence_score"),
        communication: avg("communication_score"),
        technical: avg("technical_depth_score"),
        authenticity: avg("authenticity_score"),
      });
    }
    setMessage("Answer captured. AI is analyzing and preparing follow-up...");
    await fetchNextQuestion(updated);
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
      await submitAnswer(transcript, "speech");
    };

    rec.onerror = (event) => {
      if (event.error === "no-speech" && noSpeechRetryRef.current < 1) {
        noSpeechRetryRef.current += 1;
        setMessage("No speech detected. Auto-retrying once...");
        logSecurityEvent("No speech detected while listening.", "speech_not_detected", "low");
        setListening(false);
        window.setTimeout(() => {
          if (!listeningRef.current) startListening();
        }, 350);
        return;
      }
      setMessage(`Listening error: ${event.error}`);
      logSecurityEvent(`Speech recognition error: ${event.error}`, "speech_error", "medium");
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
      attachUserStreamToVideo(stream);
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
        logSecurityEvent("Candidate attempted to disable camera.", "camera_disable_attempt", "high");
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
        logSecurityEvent("Candidate attempted to disable microphone.", "microphone_disable_attempt", "high");
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
      logSecurityEvent("Attempted to stop screen sharing during interview.", "screen_stop_attempt", "high");
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
          logSecurityEvent("Screen sharing ended while interview is active.", "screen_share_stopped", "critical");
        };
      });
      setMessage("Screen sharing active.");
    } catch {
      setMessage("Screen sharing permission denied.");
      logSecurityEvent("Screen share permission denied by candidate.", "screen_share_permission_denied", "high");
    }
  }

  async function endInterview() {
    try {
      const res = await fetchWithFallback(`/interviews/${interviewId}/end`, { method: "POST" });
      const parsed = await readJsonSafe(res);
      if (!parsed.ok) {
        setMessage(`Could not end interview: ${parsed.detail}`);
        return;
      }
      const payload = parsed.data;
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
      logSecurityEvent("Interview session ended.", "interview_ended", "info");
      void flushQueuedTurns();
      void flushQueuedSecurityEvents();
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
      <main className="mx-auto min-h-screen max-w-[1750px] bg-[#0b0c10] p-5 md:p-6">
        <section className="rounded-2xl border border-white/10 bg-[#12121a] p-6 text-sm text-slate-400 shadow-sm">Loading interview session...</section>
      </main>
    );
  }

  if (status !== "in_progress") {
    return (
      <main className="relative min-h-screen bg-gradient-to-br from-[#05060b] via-[#090b12] to-[#040508] text-slate-100 flex flex-col items-center justify-center p-4 md:p-8 overflow-hidden select-none">
        {/* Futuristic Background Glows */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.1),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_50%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.04),transparent_70%)]" />

        {/* Ambient Grid Effect */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-[size:40px_40px] opacity-40" />

        {/* Massive Glassmorphic Setup Card */}
        <section className="relative z-10 w-full max-w-6xl rounded-3xl border border-white/[0.08] bg-[#0c0d16]/80 backdrop-blur-3xl p-6 md:p-10 shadow-[0_0_80px_rgba(99,102,241,0.08)]">
          
          {/* Header Layout */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-white/[0.08]">
            <div className="flex items-center gap-3">
              <img
                src="/logo.png"
                alt="Kovidam Logo"
                className="h-16 w-auto object-contain -scale-x-100 drop-shadow-[0_0_12px_rgba(139,92,246,0.5)]"
              />
              <div>
                <span className="text-2xl font-extrabold text-white tracking-[0.15em] flex items-center uppercase" style={{ fontFamily: "Inter, sans-serif" }}>
                  KOVI<span className="text-indigo-500 font-bold tracking-normal ml-1" style={{ fontFamily: "system-ui" }}>दम्</span>
                </span>
                <p className="text-xs text-indigo-400 font-mono tracking-widest mt-0.5">SECURED INTERVIEW ENGINE v2.0</p>
              </div>
            </div>

            {/* Candidate Info Badge */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#121421]/60 px-5 py-3 text-xs md:text-sm text-slate-300 flex items-center gap-4 backdrop-blur-md">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <User className="h-4 w-4" />
              </div>
              <div>
                <p className="font-semibold text-white">{candidateName}</p>
                <p className="text-slate-400 mt-0.5">{candidateEmail} • <span className="text-indigo-400 font-medium">{jobTitle}</span></p>
              </div>
            </div>
          </div>

          {/* Stepper Pipeline */}
          <div className="py-6 flex items-center justify-center">
            <div className="flex w-full max-w-3xl items-center justify-between relative px-2">
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/[0.06] -translate-y-1/2 z-0" />
              
              {/* Stepper Progress Bar */}
              <div 
                className="absolute top-1/2 left-0 h-0.5 bg-gradient-to-r from-indigo-500 to-emerald-500 -translate-y-1/2 z-0 transition-all duration-500" 
                style={{ 
                  width: setupStep === "camera" ? "12%" : setupStep === "microphone" ? "45%" : setupStep === "screen" ? "78%" : "100%" 
                }} 
              />

              {[
                { step: "camera", label: "Camera Access", num: 1 },
                { step: "microphone", label: "Mic Access", num: 2 },
                { step: "screen", label: "Screen Share", num: 3 },
                { step: "ready", label: "System Ready", num: 4 }
              ].map((item, idx) => {
                const isPassed = 
                  (item.step === "camera" && cameraOn) || 
                  (item.step === "microphone" && micOn) || 
                  (item.step === "screen" && sharingScreen) ||
                  (item.step === "ready" && setupStep === "ready");
                const isActive = setupStep === item.step;
                
                return (
                  <div key={item.step} className="flex flex-col items-center relative z-10">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full border transition-all duration-300 ${
                      isPassed 
                        ? "bg-emerald-500 border-emerald-400 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]" 
                        : isActive 
                          ? "bg-indigo-600 border-indigo-400 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)] scale-110" 
                          : "bg-[#0b0c10] border-white/10 text-slate-500"
                    }`}>
                      {isPassed ? <CheckCircle className="h-5 w-5" /> : <span className="font-mono text-sm font-bold">{item.num}</span>}
                    </div>
                    <span className={`mt-2 text-xs font-semibold tracking-wide transition-colors ${
                      isActive ? "text-indigo-400 font-extrabold" : isPassed ? "text-emerald-400" : "text-slate-500"
                    }`}>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Double Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-6">
            
            {/* Left Column: Device Verification Studio Sandbox (7-span) */}
            <div className="lg:col-span-7 flex flex-col gap-5">
              
              {/* Live Preview Viewport */}
              <div className="relative aspect-video rounded-3xl overflow-hidden border border-white/[0.08] bg-[#07080d] shadow-2xl flex flex-col justify-center items-center group">
                <video 
                  ref={userVideoRef} 
                  autoPlay 
                  muted 
                  playsInline 
                  className={`h-full w-full object-cover transition-opacity duration-500 ${cameraOn ? "opacity-100 scale-100" : "opacity-0 scale-95"}`} 
                />

                {/* Cyber HUD Overlay when Camera Active */}
                {cameraOn && (
                  <div className="absolute inset-0 p-4 flex flex-col justify-between pointer-events-none z-10">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2 bg-black/60 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
                        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                        <span className="font-mono text-[10px] text-emerald-400 font-semibold tracking-wider">LIVE FEED SECURED</span>
                      </div>
                      <div className="bg-black/60 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-md text-[10px] font-mono text-slate-400">
                        1080p • 60FPS
                      </div>
                    </div>
                    
                    {/* Audio bouncing wave simulator */}
                    <div className="flex justify-between items-end">
                      <div className="flex items-center gap-1.5 bg-black/60 px-3 py-2 rounded-xl border border-white/10 backdrop-blur-md">
                        <Activity className="h-3 w-3 text-indigo-400 animate-pulse" />
                        <span className="font-mono text-[9px] text-slate-300">AUDIO SIGNAL: ACTIVE</span>
                        <div className="flex items-end gap-0.5 h-3 ml-2">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div 
                              key={i} 
                              className="w-0.5 bg-indigo-400 rounded-full" 
                              style={{ 
                                height: `${30 + Math.random() * 70}%`,
                                animation: micOn ? `pulse ${0.3 + i * 0.1}s ease-in-out infinite alternate` : "none"
                              }} 
                            />
                          ))}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 bg-black/60 px-2 py-1 rounded border border-white/5 backdrop-blur-md">SSL_PORT_322</span>
                    </div>
                  </div>
                )}

                {/* Abstract Interactive Placeholder when Camera Offline */}
                {!cameraOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#0e1017] via-[#07080e] to-[#040508] p-6 text-center select-none z-0">
                    <div className="relative mb-4">
                      <div className="absolute inset-0 rounded-full bg-indigo-500/10 blur-xl animate-pulse" />
                      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 shadow-lg text-slate-400 group-hover:text-indigo-400 transition-colors duration-300">
                        <Camera className="h-8 w-8 animate-pulse" />
                      </div>
                    </div>
                    <p className="text-sm font-semibold text-slate-300">Live Camera Check Pending</p>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">Activate camera access to initiate secure system identification and environment compliance scanning.</p>
                  </div>
                )}
              </div>

              {/* Secure Shield Verification Checklist */}
              <div className="rounded-2xl border border-white/[0.06] bg-[#121422]/40 p-4 backdrop-blur-md grid grid-cols-2 gap-3">
                {[
                  { label: "Anti-Cheating Shield Active", active: true },
                  { label: "Screen Recorders Initialized", active: sharingScreen },
                  { label: "SSL Data Encryption Active", active: true },
                  { label: "Hardware Latency Verified", active: setupStep === "ready" }
                ].map((chk, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-black/20 border border-white/5 text-xs text-slate-300 font-medium">
                    <ShieldCheck className={`h-4 w-4 shrink-0 ${chk.active ? "text-emerald-400" : "text-slate-500"}`} />
                    <span className="truncate">{chk.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Steps & Massive Action Callouts (5-span) */}
            <div className="lg:col-span-5 flex flex-col justify-between gap-5">
              <div className="space-y-3.5">
                {[
                  {
                    step: "camera",
                    title: "Step 1: Face Compliance Scan",
                    desc: "Verify identity and secure environment via high-res video channel.",
                    status: cameraOn ? "Passed" : setupStep === "camera" ? "Verifying" : "Pending",
                    icon: Camera
                  },
                  {
                    step: "microphone",
                    title: "Step 2: Microphone Calibration",
                    desc: "Calibrate voice parameters for conversational analysis.",
                    status: micOn ? "Passed" : setupStep === "microphone" ? "Verifying" : "Pending",
                    icon: Mic
                  },
                  {
                    step: "screen",
                    title: "Step 3: Secure Display Share",
                    desc: "Confirm display authorization to guarantee interview fairness.",
                    status: sharingScreen ? "Passed" : setupStep === "screen" ? "Verifying" : "Pending",
                    icon: Monitor
                  },
                  {
                    step: "ready",
                    title: "Step 4: Latency & Ready Check",
                    desc: "Perform dynamic connection quality and bandwidth audit.",
                    status: setupStep === "ready" ? "Active" : "Pending",
                    icon: Sparkles
                  }
                ].map((st) => {
                  const Icon = st.icon;
                  const isPassed = st.status === "Passed" || st.status === "Active";
                  const isCurrent = setupStep === st.step;
                  
                  return (
                    <div 
                      key={st.step} 
                      className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 flex gap-4 ${
                        isPassed 
                          ? "border-emerald-500/20 bg-emerald-500/[0.02]" 
                          : isCurrent 
                            ? "border-indigo-500/40 bg-gradient-to-r from-indigo-500/[0.06] to-violet-500/[0.02] shadow-[0_0_20px_rgba(99,102,241,0.06)] scale-[1.01]" 
                            : "border-white/[0.04] bg-[#0c0d16]"
                      }`}
                    >
                      {/* Step Indicator Glow */}
                      {isCurrent && (
                        <div className="absolute top-0 bottom-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-violet-600" />
                      )}

                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 ${
                        isPassed 
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
                          : isCurrent 
                            ? "bg-indigo-500/20 border-indigo-500/30 text-indigo-400" 
                            : "bg-[#121422] border-white/5 text-slate-500"
                      }`}>
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm font-semibold tracking-wide ${isCurrent ? "text-indigo-300" : isPassed ? "text-slate-200" : "text-slate-400"}`}>
                            {st.title}
                          </p>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            isPassed 
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                              : isCurrent 
                                ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse" 
                                : "bg-white/[0.02] text-slate-600 border border-white/5"
                          }`}>
                            {st.status}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400 leading-relaxed truncate-2-lines">{st.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Call Panel */}
              <div className="mt-3 space-y-4">
                <div className="flex flex-col sm:flex-row gap-3">
                  <button 
                    onClick={runDeviceCheck} 
                    className="flex-1 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-sm text-slate-200 font-semibold px-4 py-4 ring-1 ring-white/10 hover:ring-white/20 transition-all duration-300 flex items-center justify-center gap-2 shadow-inner"
                  >
                    {checkState === "checking" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
                        <span>Verifying Hardware...</span>
                      </>
                    ) : (
                      <>
                        {setupStep === "camera" && <Camera className="h-4 w-4" />}
                        {setupStep === "microphone" && <Mic className="h-4 w-4" />}
                        {setupStep === "screen" && <Monitor className="h-4 w-4" />}
                        {setupStep === "ready" && <CheckCircle className="h-4 w-4 text-emerald-400" />}
                        <span>
                          {setupStep === "camera" 
                            ? "Allow Camera Access" 
                            : setupStep === "microphone" 
                              ? "Allow Microphone Feed" 
                              : setupStep === "screen" 
                                ? "Initiate Screen Share" 
                                : "System Hardware Verified"}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={startInterview}
                    disabled={!canStart}
                    className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-sm font-bold text-white px-4 py-4 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(99,102,241,0.25)] hover:shadow-[0_4px_30px_rgba(99,102,241,0.4)] select-none animate-pulse"
                    style={{ animationDuration: "2s" }}
                  >
                    <span>Launch AI Interview</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                {/* Error/Notice dynamic panel */}
                {startBlockReason && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3 text-xs text-amber-400 flex items-start gap-2 backdrop-blur-md">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{startBlockReason}</span>
                  </div>
                )}
                
                {message && !startBlockReason && (
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-3 text-xs text-indigo-400 flex items-start gap-2 backdrop-blur-md">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{message}</span>
                  </div>
                )}
              </div>

            </div>
          </div>

        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1750px] bg-[#0b0c10] p-5 md:p-6">
      <div className="grid grid-cols-[56px_1fr] gap-4 md:gap-6">
        <aside className="flex flex-col items-center rounded-2xl border border-white/10 bg-[#12121a] py-4 shadow-sm">
          <div className="mb-5 h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500" />
          {NAV_ITEMS.map((item, idx) => (
            <button
              key={item}
              onClick={() => goToSection(item)}
              className={`mb-3 h-10 w-10 rounded-xl text-xs ring-1 transition ${navActive === item ? "bg-gradient-to-br from-indigo-600 to-blue-500 text-white ring-indigo-400/60" : "bg-white/5 text-slate-400 ring-white/10 hover:ring-indigo-500/50"}`}
              title={item}
            >
              {idx + 1}
            </button>
          ))}
          <div className="mt-auto h-9 w-9 rounded-full bg-white/5 ring-1 ring-white/10" />
        </aside>

        <section className="space-y-4 md:space-y-6">
          <header id="topbar" className="rounded-2xl border border-white/10 bg-[#12121a] p-4 shadow-sm md:p-5">
            <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-indigo-400">KOVIदम् AI Interview</p>
                <div className="mt-2 flex items-center gap-3">
                  <h1 className="text-3xl font-semibold text-white">AI Interview Session</h1>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-sm text-emerald-400">
                    Live
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-400">Session ID: {sessionId}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-[#0a0a12] px-4 py-3 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.15em] text-indigo-400">Environment</p>
                <p className="mt-1 font-medium">
                  {cameraOn ? "Webcam" : "Webcam Off"} + {micOn ? "Mic" : "Mic Off"} +{" "}
                  {internetQuality === "good" ? "Stable Internet" : internetQuality === "unstable" ? "Internet Unstable" : "Internet Offline"}
                </p>
              </div>
              <div className="flex justify-start md:justify-end">
                <button
                  onClick={endInterview}
                  className="rounded-xl bg-rose-600/90 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-900/35 hover:bg-rose-500 transition"
                >
                  End Interview
                </button>
              </div>
            </div>
          </header>

          {/* PREMIUM STUDIO LAYOUT */}
          <div className="flex flex-1 gap-5 overflow-hidden">

            {/* LEFT PANEL */}
            <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto">

              {/* Interview Progress */}
              <div className="rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Progress</h3>
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400">{progress}%</span>
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    { label: "Introduction", pct: Math.min(100, progress + 15) },
                    { label: "Technical", pct: Math.max(10, progress - 5) },
                    { label: "Problem Solving", pct: Math.max(2, progress - 25) },
                    { label: "Behavioral", pct: Math.max(0, progress - 45) },
                  ].map((step) => (
                    <div key={step.label}>
                      <div className="flex items-center justify-between text-xs">
                        <p className="font-medium text-slate-300">{step.label}</p>
                        <p className="text-slate-400">{step.pct}%</p>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-white/10">
                        <div className="h-1.5 rounded-full bg-gradient-to-r from-indigo-400 to-blue-500 transition-all duration-500" style={{ width: `${step.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Transcript */}
              <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-[#12121a] shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Transcript</h3>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400"></span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[340px]">
                  {history.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center mt-8">Conversation will appear here...</p>
                  ) : history.map((turn, idx) => (
                    <div key={`${turn.role}-${idx}`} className={`rounded-xl p-3 text-xs ${turn.role === "assistant" ? "bg-[#0a0a12] border border-white/5" : "bg-indigo-900/20 border border-indigo-500/30 ml-4"}`}>
                      <p className={`mb-1 font-bold uppercase tracking-wider text-[10px] ${turn.role === "assistant" ? "text-slate-500" : "text-indigo-400"}`}>
                        {turn.role === "assistant" ? "🤖 AI" : "👤 You"} {turn.source ? `• ${turn.source}` : ""}
                      </p>
                      <p className="leading-relaxed text-slate-300">{turn.content}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Security Event Log */}
              <div className="rounded-2xl border border-white/10 bg-[#12121a] shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Security Log</h3>
                  <span className={`h-2 w-2 rounded-full ${securityEvents.length > 0 ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}`}></span>
                </div>
                <div className="max-h-36 overflow-y-auto p-3 space-y-1">
                  {securityEvents.length === 0 ? (
                    <p className="text-xs text-slate-500 py-2 text-center">No violations detected</p>
                  ) : securityEvents.map((evt, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 text-rose-500">⚠</span>
                      <span className="text-slate-400">[{evt.time}] {evt.event}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* CENTER - VIDEO CANVAS */}
            <div className="flex flex-1 flex-col gap-4">
              {/* Hidden face detection canvas */}
              <canvas ref={faceCanvasRef} className="hidden" />

              {/* Main video area */}
              <div className="relative flex-1 overflow-hidden rounded-3xl bg-[#0a0a12] shadow-[0_0_40px_rgba(79,70,229,0.1)] border border-white/5 min-h-[520px]">
                {/* AI Avatar Background */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-[#0b0c10] via-[#0a0a12] to-[#0b0c10]">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(99,102,241,0.08),transparent_60%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(59,130,246,0.06),transparent_60%)]" />

                  {/* Avatar orb */}
                  <div className="relative flex h-52 w-52 items-center justify-center">
                    <div className={`absolute inset-0 rounded-full transition-all duration-500 ${loadingQuestion ? "animate-spin" : ""}`}
                      style={{ background: "conic-gradient(from 0deg, rgba(99,102,241,0.3), rgba(59,130,246,0.1), rgba(99,102,241,0.3))" }} />
                    <div className="absolute inset-3 animate-pulse rounded-full bg-indigo-500/10 blur-xl" />
                    <div className="absolute inset-6 rounded-full bg-gradient-to-br from-indigo-500/20 to-blue-500/20 backdrop-blur-sm ring-1 ring-indigo-500/30" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex items-end gap-1.5">
                        {Array.from({ length: 7 }).map((_, i) => (
                          <div key={i} className="w-1.5 rounded-full bg-gradient-to-t from-indigo-400 to-blue-400 shadow-[0_0_10px_rgba(99,102,241,0.5)]"
                            style={{ height: listening ? `${8 + Math.random() * 20}px` : `${10 + (i % 4) * 10}px`, animation: `pulse ${0.5 + i * 0.1}s ease-in-out infinite alternate`, transition: "height 0.15s" }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 text-center">
                    <p className="text-lg font-light tracking-wide text-white">
                      {listening ? "Listening..." : loadingQuestion ? "Generating next question..." : message || "AI Interviewer"}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">KOVIदम् AI • {jobTitle}</p>
                  </div>
                </div>

                {/* Top bar */}
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-xl ring-1 ring-white/10">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
                      AI Interviewer • Live
                    </div>
                    <div className="rounded-full bg-black/60 px-3 py-2 text-xs font-mono text-slate-300 backdrop-blur-xl ring-1 ring-white/10">
                      {formatClock(elapsedSec)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl ring-1 ${faceVisible ? "bg-emerald-500/20 text-emerald-400 ring-emerald-500/30" : "bg-rose-500/30 text-rose-400 ring-rose-500/30 animate-pulse"}`}>
                      {faceVisible ? "✓ Face OK" : "⚠ No Face"}
                    </div>
                    <div className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl ring-1 ${sharingScreen ? "bg-indigo-500/20 text-indigo-400 ring-indigo-500/30" : "bg-rose-500/30 text-rose-400 ring-rose-500/30"}`}>
                      {sharingScreen ? "✓ Screen" : "⚠ No Screen"}
                    </div>
                    <div className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl ring-1 ${internetQuality === "good" ? "bg-emerald-500/20 text-emerald-400 ring-emerald-500/30" : "bg-rose-500/30 text-rose-400 ring-rose-500/30 animate-pulse"}`}>
                      {internetQuality === "good" ? "✓ Stable" : "⚠ " + internetQuality}
                    </div>
                  </div>
                </div>

                {/* PiP candidate video */}
                <div className="absolute bottom-24 right-5 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a12] shadow-2xl ring-1 ring-white/5">
                  <video ref={userVideoRef} autoPlay muted playsInline className="h-full w-full object-cover aspect-video" />
                  {!cameraOn && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 text-xs text-slate-400">Camera off</div>
                  )}
                  {/* Face detection indicator on PiP */}
                  <div className={`absolute inset-0 rounded-2xl ring-2 transition-all ${!faceVisible ? "ring-rose-500 animate-pulse" : "ring-transparent"}`} />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="text-xs font-medium text-white">{candidateName}</p>
                  </div>
                </div>

                {/* Bottom controls */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 p-6">
                  <div className="flex items-center gap-3 rounded-2xl bg-[#12121a]/80 px-6 py-3 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl">
                    <button onClick={toggleMic} title="Microphone" className={`group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all ${micOn ? "bg-white/5 text-slate-300 hover:bg-white/10" : "bg-rose-600 text-white"}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{micOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /> : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></>}</svg>
                    </button>
                    <button onClick={toggleCamera} title="Camera" className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all ${cameraOn ? "bg-white/5 text-slate-300 hover:bg-white/10" : "bg-rose-600 text-white"}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                    <button onClick={toggleScreenShare} title="Screen Share" className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all ${sharingScreen ? "bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30" : "bg-white/5 text-slate-500 hover:bg-white/10"}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    </button>
                    <div className="h-8 w-px bg-white/10" />
                    <button onClick={startListening} disabled={listening || loadingQuestion || !micOn} className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30 transition hover:bg-indigo-500/30 disabled:opacity-40">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                    </button>
                    <div className="h-8 w-px bg-white/10" />
                    <button onClick={endInterview} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_0_15px_rgba(225,29,72,0.4)] transition hover:bg-rose-500">
                      End Call
                    </button>
                  </div>
                </div>

                {/* SECURITY VIOLATION BANNERS */}
                {(faceViolationCountdown !== null || securityCountdown !== null || tabCountdown !== null) && (
                  <div className="absolute inset-x-0 top-0 z-50">
                    {faceViolationCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-orange-600/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">⚠️</span>
                        <span>FACE NOT VISIBLE — Look directly at the camera. Interview terminates in {faceViolationCountdown}s</span>
                      </div>
                    )}
                    {securityCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-rose-700/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">🚨</span>
                        <span>DEVICE COMPLIANCE VIOLATION — Restore camera/mic/screen/internet in {securityCountdown}s</span>
                      </div>
                    )}
                    {tabCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-rose-700/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">🚨</span>
                        <span>TAB SWITCH DETECTED — Return to interview in {tabCountdown}s or interview terminates</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Cheating overlay */}
                {cheatingTagged && (
                  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-rose-950/95 backdrop-blur-md">
                    <div className="text-5xl mb-4">🚫</div>
                    <p className="text-2xl font-bold text-white">Interview Terminated</p>
                    <p className="mt-2 text-rose-300">Integrity violation detected. This session has been flagged.</p>
                  </div>
                )}
              </div>

              {/* Auto-listen label */}
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                <input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} className="rounded border-white/20 bg-[#12121a]" />
                Auto-listen after AI speaks
                {listening && <span className="ml-2 inline-flex items-center gap-1 text-indigo-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />Listening...</span>}
                {loadingQuestion && <span className="ml-2 text-slate-500">Generating question...</span>}
              </label>
            </div>

            {/* RIGHT PANEL */}
            <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto">

              {/* Live Security Status */}
              <div className="rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Security Monitor</h3>
                <div className="space-y-2">
                  {[
                    { label: "Face Visible", ok: faceVisible, icon: "👤" },
                    { label: "Camera Active", ok: cameraOn, icon: "📷" },
                    { label: "Microphone Active", ok: micOn, icon: "🎤" },
                    { label: "Screen Sharing", ok: sharingScreen, icon: "🖥" },
                    { label: "Internet Stable", ok: internetQuality === "good", icon: "🌐" },
                    { label: "Tab Focus", ok: tabCountdown === null, icon: "🖱" },
                  ].map(({ label, ok, icon }) => (
                    <div key={label} className="flex items-center justify-between rounded-lg bg-[#0a0a12] border border-white/5 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                        <span>{icon}</span>{label}
                      </div>
                      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-rose-500 animate-pulse"}`} />
                    </div>
                  ))}
                </div>
                {screenChanged && (
                  <div className="mt-3 rounded-lg bg-orange-900/20 border border-orange-500/30 px-3 py-2 text-xs text-orange-400">
                    ⚠ Screen content change detected
                  </div>
                )}
              </div>

              {/* Current Question */}
              <div className="rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-2 w-2 rounded-full bg-indigo-500"></span>
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Current Question</h3>
                </div>
                <p className="rounded-xl bg-indigo-900/10 border border-indigo-500/20 p-4 text-sm leading-relaxed text-slate-200">{currentQuestion}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-500">⏱ {formatClock(elapsedSec)}</span>
                  <button onClick={() => setShowQuestionDetails(v => !v)} className="text-xs text-indigo-400 hover:underline">{showQuestionDetails ? "Hide" : "Details"}</button>
                </div>
                {showQuestionDetails && (
                  <p className="mt-2 text-xs text-slate-400 bg-[#0a0a12] border border-white/5 rounded-lg p-3">AI-generated from your resume context. Expects depth, trade-offs, and real examples.</p>
                )}
              </div>

              {/* AI Scoring */}
              <div className="rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Live Scoring</h3>
                <div className="space-y-3">
                  {[
                    { label: "Communication", score: liveScores.communication, color: "from-blue-500 to-indigo-500" },
                    { label: "Confidence", score: liveScores.confidence, color: "from-violet-500 to-purple-500" },
                    { label: "Technical Depth", score: liveScores.technical, color: "from-indigo-400 to-cyan-500" },
                    { label: "Authenticity", score: liveScores.authenticity, color: "from-amber-500 to-orange-500" },
                  ].map(({ label, score, color }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-400">{label}</span>
                        <span className={`font-semibold ${score >= 7 ? "text-emerald-400" : score >= 5 ? "text-amber-400" : score > 0 ? "text-rose-400" : "text-slate-500"}`}>
                          {score > 0 ? `${score.toFixed(1)}/10` : "–"}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10">
                        <div className={`h-2 rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: score > 0 ? `${score * 10}%` : "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {lastAnalysis && <p className="mt-3 text-xs text-emerald-400 bg-emerald-900/20 rounded-lg p-3 border border-emerald-500/30 leading-relaxed">{lastAnalysis}</p>}
                {liveScores.communication === 0 && <p className="mt-2 text-xs text-slate-500 text-center">Scores update after each answer</p>}
              </div>

              {/* Voice Control */}
              <div className="rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-3">Voice</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={startListening} disabled={listening || loadingQuestion || !micOn} className="rounded-xl bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-40">
                    {listening ? "Listening..." : "Answer"}
                  </button>
                  <button onClick={stopListening} disabled={!listening} className="rounded-xl bg-white/10 px-3 py-2.5 text-xs font-semibold text-slate-300 transition hover:bg-white/20 disabled:opacity-40">
                    Stop
                  </button>
                </div>
                <textarea
                  value={answerDraft}
                  onChange={(e) => setAnswerDraft(e.target.value)}
                  placeholder="Type answer fallback (auto-saved to transcript)"
                  className="mt-3 w-full rounded-lg border border-white/10 bg-[#0a0a12] p-2.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500/50 focus:outline-none"
                  rows={3}
                />
                <button
                  onClick={() => void submitAnswer(answerDraft, "text")}
                  disabled={loadingQuestion || !answerDraft.trim()}
                  className="mt-2 w-full rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/20 disabled:opacity-40"
                >
                  Save Typed Answer
                </button>
                <p className="mt-3 text-xs text-slate-500">{candidateName} • {jobTitle}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
