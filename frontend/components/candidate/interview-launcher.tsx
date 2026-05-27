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

type FaceDetectorLike = {
  detect: (image: CanvasImageSource) => Promise<Array<{ boundingBox?: { width?: number; height?: number } }>>;
};

type CameraFrameAssessment = {
  mean: number;
  variance: number;
  edgeDensity: number;
  dominantRatio: number;
  centerVariance: number;
  brightBlocks: number;
  hardOcclusion: boolean;
  likelyOccluded: boolean;
  usableFrame: boolean;
};

type FaceRegionSummary = {
  count: number;
  largeCount: number;
  largestAreaRatio: number;
  secondLargestAreaRatio: number;
};

const PRIMARY_API = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/proxy/api/v1";
const FALLBACK_API = "http://127.0.0.1:8000/api/v1";
const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE_URL || "";
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

function buildRealtimeSocketUrl(interviewId: string): string {
  if (WS_BASE) {
    const normalized = WS_BASE.replace(/\/+$/, "");
    return `${normalized}/api/v1/ws/interviews/${interviewId}`;
  }
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://localhost:8000/api/v1/ws/interviews/${interviewId}`;
  }
  return `ws://localhost:8000/api/v1/ws/interviews/${interviewId}`;
}

const NAV_ITEMS = ["Home", "Interviews", "Analytics", "Reports", "Settings", "Profile"];
const CAMERA_VERIFICATION_PHOTO_COUNT = 2;
const CAMERA_POSE_GUIDES = [
  "Look straight at the camera.",
  "Turn your face slightly to your left.",
];
const MIC_VERIFICATION_PHRASES = [
  "I confirm this is my voice for interview verification.",
  "I am ready for this interview and speaking from my own device.",
  "This is a live voice check for my interview session.",
];
const STRICT_SECURITY_ENFORCEMENT = false;
const WARNING_ONLY_GRACE_SECONDS = 10;

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
  const [screenViolationCountdown, setScreenViolationCountdown] = useState<number | null>(null);
  const [lipSyncSuspicious, setLipSyncSuspicious] = useState(false);
  const [lipSyncViolationCountdown, setLipSyncViolationCountdown] = useState<number | null>(null);
  const [mouthMotionLevel, setMouthMotionLevel] = useState(0);
  const [cameraFreezeSuspicious, setCameraFreezeSuspicious] = useState(false);
  const [cameraFreezeCountdown, setCameraFreezeCountdown] = useState<number | null>(null);
  const [cameraObstructionDetected, setCameraObstructionDetected] = useState(false);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [answerDraft, setAnswerDraft] = useState("");
  const [cameraSnapshots, setCameraSnapshots] = useState<string[]>([]);
  const [cameraIdentityVerified, setCameraIdentityVerified] = useState(false);
  const [cameraPoseGuideIdx, setCameraPoseGuideIdx] = useState(0);
  const [cameraVerificationHint, setCameraVerificationHint] = useState("");
  const [cameraCaptureFlash, setCameraCaptureFlash] = useState(false);
  const [micVerificationPhrase, setMicVerificationPhrase] = useState(MIC_VERIFICATION_PHRASES[0]);
  const [micVerificationTranscript, setMicVerificationTranscript] = useState("");
  const [micIdentityVerified, setMicIdentityVerified] = useState(false);
  const [micVerificationInProgress, setMicVerificationInProgress] = useState(false);
  const [micVerificationError, setMicVerificationError] = useState("");
  const [micVerificationScore, setMicVerificationScore] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [startingInterview, setStartingInterview] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [voiceprintBaseline, setVoiceprintBaseline] = useState<number[] | null>(null);
  const [voiceMismatchSuspicious, setVoiceMismatchSuspicious] = useState(false);
  const [securityChallenge, setSecurityChallenge] = useState<{
    prompt: string;
    expiresAt: number;
    action: "turn_left" | "turn_right" | "nod_down";
    baselineX: number;
    baselineY: number;
  } | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const faceDetectorRef = useRef<FaceDetectorLike | null>(null);
  const noSpeechRetryRef = useRef(0);
  const speechBufferRef = useRef("");
  const speechSilenceTimerRef = useRef<number | null>(null);
  const speechSubmittedRef = useRef(false);
  const lastEventLoggedAtRef = useRef<Record<string, number>>({});
  const listeningRef = useRef(false);
  const historyRef = useRef<Turn[]>([]);
  const flushingTurnsRef = useRef(false);
  const flushingSecurityRef = useRef(false);
  const tabTimerRef = useRef<number | null>(null);
  const faceTimerRef = useRef<number | null>(null);
  const screenViolationTimerRef = useRef<number | null>(null);
  const lipSyncTimerRef = useRef<number | null>(null);
  const lipSyncCheckIntervalRef = useRef<number | null>(null);
  const cameraFreezeTimerRef = useRef<number | null>(null);
  const faceCheckRef = useRef<number | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const prevScreenPixelsRef = useRef<Uint8ClampedArray | null>(null);
  const screenCheckIntervalRef = useRef<number | null>(null);
  const screenChangeBurstRef = useRef<{ count: number; windowStartMs: number }>({ count: 0, windowStartMs: 0 });
  const screenFreezeCountRef = useRef(0);
  const screenBlackCountRef = useRef(0);
  const elapsedSecRef = useRef(0);
  const statusRef = useRef(initialStatus);
  const terminatingForSecurityRef = useRef(false);
  const lipSyncPrevFrameRef = useRef<Uint8ClampedArray | null>(null);
  const lipSyncLowMotionCountRef = useRef(0);
  const lipSyncSuspiciousRef = useRef(false);
  const cameraFreezeSuspiciousRef = useRef(false);
  const micLevelRef = useRef(0);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micMeterRAFRef = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsAwaitingNextQuestionRef = useRef(false);
  const wsFallbackTimerRef = useRef<number | null>(null);
  const wsRetryCountRef = useRef(0);
  const wsIgnoreNextQuestionRef = useRef(false);
  const securityChallengeTimerRef = useRef<number | null>(null);
  const incompleteAnswerCountRef = useRef(0);
  const recentScreenSnapshotRef = useRef("");
  const prevScreenSnapshotRef = useRef("");
  const currentFaceCenterRef = useRef<{ x: number; y: number; areaRatio: number }>({ x: 0.5, y: 0.5, areaRatio: 0 });

  function clearSpeechSilenceTimer() {
    if (speechSilenceTimerRef.current) {
      window.clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
  }

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

  function attachScreenStreamToVideo(stream: MediaStream | null) {
    if (!screenVideoRef.current || !stream) return;
    screenVideoRef.current.srcObject = stream;
    const maybePlay = screenVideoRef.current.play();
    if (maybePlay && typeof maybePlay.catch === "function") {
      maybePlay.catch(() => {
        // Browser policy may delay autoplay.
      });
    }
  }

  function upsertAssistantQuestion(prev: Turn[], question: string): Turn[] {
    const clean = (question || "").trim();
    if (!clean) return prev;
    const next = [...prev];
    const last = next[next.length - 1];
    if (last && last.role === "assistant") {
      // Never keep two consecutive AI questions without a candidate turn in between.
      next[next.length - 1] = { role: "assistant", source: "system", content: clean };
      return next;
    }
    next.push({ role: "assistant", source: "system", content: clean });
    return next;
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
    const idx = Math.floor(Math.random() * MIC_VERIFICATION_PHRASES.length);
    setMicVerificationPhrase(MIC_VERIFICATION_PHRASES[idx]);
  }, []);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    elapsedSecRef.current = elapsedSec;
  }, [elapsedSec]);

  useEffect(() => {
    statusRef.current = status;
    if (status !== "in_progress") {
      terminatingForSecurityRef.current = false;
      setCameraObstructionDetected(false);
    }
  }, [status]);

  useEffect(() => {
    if (status !== "in_progress") {
      if (wsFallbackTimerRef.current) {
        window.clearTimeout(wsFallbackTimerRef.current);
        wsFallbackTimerRef.current = null;
      }
      wsAwaitingNextQuestionRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let closedByCleanup = false;
    const socket = new WebSocket(buildRealtimeSocketUrl(interviewId));
    wsRef.current = socket;

    socket.onopen = () => {
      wsRetryCountRef.current = 0;
      setWsConnected(true);
    };
    socket.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data || "{}");
        const type = String(payload.type || "");
        if (type === "next_question") {
          if (wsIgnoreNextQuestionRef.current) {
            wsIgnoreNextQuestionRef.current = false;
            return;
          }
          wsAwaitingNextQuestionRef.current = false;
          if (wsFallbackTimerRef.current) {
            window.clearTimeout(wsFallbackTimerRef.current);
            wsFallbackTimerRef.current = null;
          }
          const q = String(payload.question || "").trim();
          if (!q) return;
          setLoadingQuestion(false);
          setHistory((prev) => {
            const next = upsertAssistantQuestion(prev, q);
            historyRef.current = next;
            return next;
          });
          setMessage("AI interviewer is speaking...");
          speak(q);
          void loadTurns();
          return;
        }
        if (type === "interview_completed") {
          wsAwaitingNextQuestionRef.current = false;
          setLoadingQuestion(false);
          setMessage(String(payload.detail || "Interview completed."));
          setStatus("completed");
          return;
        }
      } catch {
        // no-op
      }
    };
    socket.onclose = () => {
      setWsConnected(false);
      if (wsAwaitingNextQuestionRef.current && statusRef.current === "in_progress") {
        wsAwaitingNextQuestionRef.current = false;
        void (async () => {
          const turns = await loadTurns();
          const last = turns[turns.length - 1];
          if (last && last.role === "assistant" && last.content?.trim()) {
            setLoadingQuestion(false);
            setMessage("Continuing with saved question.");
            speak(last.content.trim());
            return;
          }
          await fetchNextQuestion(turns);
        })();
      }
      if (!closedByCleanup && wsRetryCountRef.current < 2 && statusRef.current === "in_progress") {
        wsRetryCountRef.current += 1;
        window.setTimeout(() => {
          setWsConnected(false);
        }, 600 * wsRetryCountRef.current);
      }
    };
    socket.onerror = () => {
      setWsConnected(false);
    };

    return () => {
      closedByCleanup = true;
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, interviewId]);

  useEffect(() => {
    micLevelRef.current = micLevel;
  }, [micLevel]);

  useEffect(() => {
    lipSyncSuspiciousRef.current = lipSyncSuspicious;
  }, [lipSyncSuspicious]);

  useEffect(() => {
    cameraFreezeSuspiciousRef.current = cameraFreezeSuspicious;
  }, [cameraFreezeSuspicious]);

  useEffect(() => {
    if (status !== "in_progress" || !listening || !voiceprintBaseline || cheatingTagged) {
      setVoiceMismatchSuspicious(false);
      return;
    }
    const id = window.setInterval(() => {
      const probe = getVoiceprintVector();
      if (!probe) return;
      const similarity = cosineSimilarity(voiceprintBaseline, probe);
      if (similarity < 0.6) {
        setVoiceMismatchSuspicious(true);
        logSecurityEvent(
          "Voiceprint mismatch detected during live response.",
          "voice_mismatch_detected",
          "high",
          { similarity: Number(similarity.toFixed(3)) }
        );
      } else {
        setVoiceMismatchSuspicious(false);
      }
    }, 1800);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, listening, voiceprintBaseline, cheatingTagged]);

  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !voiceMismatchSuspicious) return;
    terminateInterviewForSecurity(
      "Voice identity mismatch detected against the verified candidate baseline.",
      "voice_mismatch_timeout"
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, voiceMismatchSuspicious]);

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
    if (status !== "in_progress" || cheatingTagged) return;
    if (elapsedSec < 180 || elapsedSec % 150 !== 0 || securityChallenge) return;
    const actionPool: Array<{
      action: "turn_left" | "turn_right" | "nod_down";
      prompt: string;
    }> = [
      { action: "turn_left", prompt: "Liveness check: turn your face slightly to your left, then click challenge complete." },
      { action: "turn_right", prompt: "Liveness check: turn your face slightly to your right, then click challenge complete." },
      { action: "nod_down", prompt: "Liveness check: nod your head down once, then click challenge complete." },
    ];
    const picked = actionPool[Math.floor(Math.random() * actionPool.length)];
    const prompt = picked.prompt;
    const expiresAt = Date.now() + 20000;
    const baseline = currentFaceCenterRef.current;
    setSecurityChallenge({
      prompt,
      expiresAt,
      action: picked.action,
      baselineX: baseline.x,
      baselineY: baseline.y,
    });
    setMessage(prompt);
    logSecurityEvent("Random security challenge issued.", "random_security_challenge_issued", "medium", {
      prompt,
      action: picked.action,
      baselineX: Number(baseline.x.toFixed(3)),
      baselineY: Number(baseline.y.toFixed(3)),
    });
    if (securityChallengeTimerRef.current) {
      window.clearTimeout(securityChallengeTimerRef.current);
    }
    securityChallengeTimerRef.current = window.setTimeout(() => {
      if (statusRef.current !== "in_progress") return;
      terminateInterviewForSecurity(
        "Random security challenge timed out.",
        "random_security_challenge_timeout"
      );
    }, 20000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, elapsedSec, securityChallenge]);

  useEffect(() => {
    if (!securityChallenge && securityChallengeTimerRef.current) {
      window.clearTimeout(securityChallengeTimerRef.current);
      securityChallengeTimerRef.current = null;
    }
  }, [securityChallenge]);

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
    if (setupStep === "microphone" && micOn) {
      void startMicLevelMonitor();
      return;
    }
    stopMicLevelMonitor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupStep, micOn]);

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
    setMessage(
      `Security alert: restore camera, microphone, screen share, and stable internet within ${WARNING_ONLY_GRACE_SECONDS} seconds.`
    );
    logSecurityEvent(
      "Temporary compliance break detected (camera/mic/screen/internet).",
      "compliance_break_started",
      "medium",
      { cameraOn, micOn, sharingScreen, internetQuality }
    );
    setSecurityCountdown(WARNING_ONLY_GRACE_SECONDS);
    const timer = window.setInterval(() => {
      setSecurityCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(timer);
          warnOnlySecurityViolation(
            "Required device/internet compliance remained broken for more than 10 seconds.",
            "compliance_break_timeout",
            { cameraOn, micOn, sharingScreen, internetQuality }
          );
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
      setTabCountdown(WARNING_ONLY_GRACE_SECONDS);
      logSecurityEvent("Candidate moved away from interview tab.", "tab_hidden", "high");
      tabTimerRef.current = window.setInterval(() => {
        setTabCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            if (tabTimerRef.current) {
              window.clearInterval(tabTimerRef.current);
              tabTimerRef.current = null;
            }
            warnOnlySecurityViolation(
              "Candidate moved away from interview tab for more than 10 seconds.",
              "tab_hidden_timeout"
            );
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
      clearSpeechSilenceTimer();
      stopMicLevelMonitor();
      if (faceCheckRef.current) cancelAnimationFrame(faceCheckRef.current);
      if (faceTimerRef.current) window.clearInterval(faceTimerRef.current);
      if (screenViolationTimerRef.current) window.clearInterval(screenViolationTimerRef.current);
      if (screenCheckIntervalRef.current) window.clearInterval(screenCheckIntervalRef.current);
      if (lipSyncTimerRef.current) window.clearInterval(lipSyncTimerRef.current);
      if (lipSyncCheckIntervalRef.current) window.clearInterval(lipSyncCheckIntervalRef.current);
      if (cameraFreezeTimerRef.current) window.clearInterval(cameraFreezeTimerRef.current);
      if (securityChallengeTimerRef.current) window.clearTimeout(securityChallengeTimerRef.current);
      if (wsFallbackTimerRef.current) window.clearTimeout(wsFallbackTimerRef.current);
      wsRef.current?.close();
      userStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    attachUserStreamToVideo(userStreamRef.current);
  }, [mounted, status]);

  useEffect(() => {
    attachScreenStreamToVideo(screenStreamRef.current);
  }, [mounted, status, sharingScreen]);

  useEffect(() => {
    const maybeWindow = window as Window & {
      FaceDetector?: new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;
    };
    if (maybeWindow.FaceDetector && !faceDetectorRef.current) {
      faceDetectorRef.current = new maybeWindow.FaceDetector({ fastMode: false, maxDetectedFaces: 6 });
    }
  }, []);

  // Face detection via canvas pixel brightness analysis
  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !cameraOn) return;
    const canvas = faceCanvasRef.current;
    const video = userVideoRef.current;
    if (!canvas || !video) return;

    let noFaceFrameCount = 0;       // consecutive frames with no face detected
    let hardOcclusionFrameCount = 0;
    let frameCounter = 0;           // throttle: only analyse every 6th frame
    const NO_FACE_TRIGGER_FRAMES = 55;
    const HARD_OCCLUSION_TRIGGER_FRAMES = 12;
    let lastLoggedNoFace = false;
    let detectorBusy = false;
    let detectorFaceFrames = 0;
    let detectorMultiFaceFrames = 0;
    let heuristicMultiFacePositiveFrames = 0;
    let heuristicMultiFaceNegativeFrames = 0;
    let heuristicFaceFrames = 0;
    let prevFrameData: Uint8ClampedArray | null = null;
    let lowMotionFrames = 0;
    const detectorCanvas = document.createElement("canvas");
    detectorCanvas.width = 320;
    detectorCanvas.height = 240;
    const detectorCtx = detectorCanvas.getContext("2d");

    function checkFrame() {
      faceCheckRef.current = requestAnimationFrame(checkFrame);

      // Only run analysis every 6th frame (≈5fps analysis, smooth UI)
      frameCounter++;
      if (frameCounter % 6 !== 0) return;

      if (!canvas || !video || video.readyState < 2 || video.videoWidth === 0) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = 128;
      canvas.height = 96;
      ctx.drawImage(video, 0, 0, 128, 96);
      const data = ctx.getImageData(0, 0, 128, 96).data;

      let frameMotion = 0;
      if (prevFrameData) {
        let sampledMotion = 0;
        for (let i = 0; i < data.length; i += 32) {
          const currLuma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const prevLuma = prevFrameData[i] * 0.299 + prevFrameData[i + 1] * 0.587 + prevFrameData[i + 2] * 0.114;
          frameMotion += Math.abs(currLuma - prevLuma);
          sampledMotion += 1;
        }
        frameMotion = frameMotion / Math.max(1, sampledMotion);
      }
      prevFrameData = new Uint8ClampedArray(data);

      const frameAssessment = analyzeCameraFrameData(data, 128, 96);
      const hardOcclusion = frameAssessment.hardOcclusion;
      const likelyOccluded = frameAssessment.likelyOccluded;

      // Prefer real face detection when supported to reduce false positives.
      if (!detectorBusy && faceDetectorRef.current && frameCounter % 6 === 0) {
        detectorBusy = true;
        const targetW = Math.min(640, Math.max(320, video.videoWidth || 320));
        const sourceAspect = (video.videoHeight || 240) / Math.max(1, video.videoWidth || 320);
        const targetH = Math.min(480, Math.max(240, Math.round(targetW * sourceAspect)));
        if (detectorCanvas.width !== targetW || detectorCanvas.height !== targetH) {
          detectorCanvas.width = targetW;
          detectorCanvas.height = targetH;
        }
        if (detectorCtx) {
          detectorCtx.drawImage(video, 0, 0, detectorCanvas.width, detectorCanvas.height);
        }
        void faceDetectorRef.current
          .detect(detectorCtx ? detectorCanvas : canvas)
          .then((faces) => {
            const validFaces = (faces || []).filter((f) => {
              const w = Number(f.boundingBox?.width || 0);
              const h = Number(f.boundingBox?.height || 0);
              const areaRatio = (w * h) / (detectorCanvas.width * detectorCanvas.height);
              const aspect = w / Math.max(1, h);
              return w >= 18 && h >= 18 && areaRatio >= 0.012 && aspect > 0.5 && aspect < 2.1;
            });
            if (validFaces.length >= 1) {
              const ranked = [...validFaces].sort((a, b) => {
                const aw = Number(a.boundingBox?.width || 0);
                const ah = Number(a.boundingBox?.height || 0);
                const bw = Number(b.boundingBox?.width || 0);
                const bh = Number(b.boundingBox?.height || 0);
                return bw * bh - aw * ah;
              });
              const lead = ranked[0];
              const bb = lead.boundingBox || {};
              const cx = ((Number((bb as { x?: number }).x || 0) + Number(bb.width || 0) / 2) / detectorCanvas.width) || 0.5;
              const cy = ((Number((bb as { y?: number }).y || 0) + Number(bb.height || 0) / 2) / detectorCanvas.height) || 0.5;
              const areaRatio = (Number(bb.width || 0) * Number(bb.height || 0)) / (detectorCanvas.width * detectorCanvas.height);
              currentFaceCenterRef.current = { x: cx, y: cy, areaRatio };
            }
            detectorMultiFaceFrames = validFaces.length > 1 ? 9 : Math.max(0, detectorMultiFaceFrames - 3);
            if (validFaces.length >= 1) {
              detectorFaceFrames = 12;
              noFaceFrameCount = 0;
              hardOcclusionFrameCount = 0;
              if (lastLoggedNoFace) lastLoggedNoFace = false;
              setFaceVisible(true);
            }
          })
          .catch(() => {
            // Fallback to heuristic path.
          })
          .finally(() => {
            detectorBusy = false;
          });
      }

      const regionSummary = estimateFaceRegionSummary(data, 128, 96);
      const heuristicFaceRegions = regionSummary.count;
      const heuristicFacePresent =
        !hardOcclusion &&
        frameAssessment.usableFrame &&
        (regionSummary.largeCount >= 1 || regionSummary.largestAreaRatio >= 0.025);
      if (heuristicFacePresent) {
        heuristicFaceFrames = Math.min(12, heuristicFaceFrames + 1);
      } else {
        heuristicFaceFrames = Math.max(0, heuristicFaceFrames - 2);
      }

      const heuristicMultipleFaces =
        frameAssessment.usableFrame &&
        (regionSummary.largeCount >= 2 || (heuristicFaceRegions >= 2 && regionSummary.secondLargestAreaRatio >= 0.014));
      if (heuristicMultipleFaces) {
        heuristicMultiFacePositiveFrames += 1;
        heuristicMultiFaceNegativeFrames = 0;
      } else {
        heuristicMultiFaceNegativeFrames += 1;
        heuristicMultiFacePositiveFrames = Math.max(0, heuristicMultiFacePositiveFrames - 1);
      }

      const detectorSupported = Boolean(faceDetectorRef.current);
      const hasFace = detectorSupported
        ? detectorFaceFrames > 0 || (detectorBusy && heuristicFaceFrames > 0)
        : heuristicFaceFrames > 0;

      const combinedMultiFace = detectorMultiFaceFrames > 0 || heuristicMultiFacePositiveFrames >= 3;
      if (combinedMultiFace) {
        setMultipleFaces(true);
      } else if (heuristicMultiFaceNegativeFrames >= 5 && detectorMultiFaceFrames === 0) {
        setMultipleFaces(false);
      }

      if (detectorFaceFrames > 0) detectorFaceFrames -= 1;
      if (detectorMultiFaceFrames > 0) detectorMultiFaceFrames -= 1;

      const suspiciousFreezeEligible = listeningRef.current && micLevelRef.current > 18 && hasFace && !multipleFaces;
      if (suspiciousFreezeEligible && prevFrameData && frameMotion < 0.55) {
        lowMotionFrames += 1;
      } else {
        lowMotionFrames = Math.max(0, lowMotionFrames - 2);
      }
      const freezeSuspicious = lowMotionFrames >= 18;
      if (freezeSuspicious !== cameraFreezeSuspiciousRef.current) {
        cameraFreezeSuspiciousRef.current = freezeSuspicious;
        setCameraFreezeSuspicious(freezeSuspicious);
      }

      if (!hasFace) {
        noFaceFrameCount++;
        hardOcclusionFrameCount = hardOcclusion ? hardOcclusionFrameCount + 1 : Math.max(0, hardOcclusionFrameCount - 1);
      } else {
        noFaceFrameCount = 0;
        hardOcclusionFrameCount = 0;
        setCameraObstructionDetected(false);
        if (lastLoggedNoFace) {
          lastLoggedNoFace = false;
          setFaceVisible(true);
        } else {
          setFaceVisible(true);
        }
      }

      if (hardOcclusionFrameCount >= HARD_OCCLUSION_TRIGGER_FRAMES) {
        setCameraObstructionDetected(true);
        setFaceVisible(false);
        if (!lastLoggedNoFace) {
          logSecurityEvent(
            "Camera appears blocked or tampered (covered lens / unusable frame).",
            "camera_obstruction_detected",
            "critical",
            {
              mean: Number(frameAssessment.mean.toFixed(2)),
              variance: Number(frameAssessment.variance.toFixed(2)),
              edgeDensity: Number(frameAssessment.edgeDensity.toFixed(2)),
              dominantRatio: Number(frameAssessment.dominantRatio.toFixed(3)),
              centerVariance: Number(frameAssessment.centerVariance.toFixed(2)),
            }
          );
          lastLoggedNoFace = true;
        }
        return;
      }

      // Declare no-face after sustained absence.
      if (
        noFaceFrameCount >= NO_FACE_TRIGGER_FRAMES &&
        (detectorSupported || hardOcclusionFrameCount >= 6 || likelyOccluded || heuristicFaceFrames === 0)
      ) {
        setCameraObstructionDetected(hardOcclusionFrameCount >= 6 || likelyOccluded);
        setFaceVisible(false);
        if (!lastLoggedNoFace) {
          let noFaceSnapshot = "";
          try {
            noFaceSnapshot = canvas.toDataURL("image/jpeg", 0.8);
          } catch {
            // no-op
          }
          logSecurityEvent("Face not visible in camera.", "face_not_visible", "high", {
            camera_snapshot: noFaceSnapshot,
            noFaceFrameCount,
          });
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
    if (!multipleFaces && !cameraObstructionDetected && elapsedSecRef.current < 25) {
      // Grace period at interview start to avoid false-positive exits during camera warm-up.
      return;
    }
    if (faceTimerRef.current) return;
    let remaining = multipleFaces ? 8 : cameraObstructionDetected ? 6 : 10;
    setFaceViolationCountdown(remaining);
    faceTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setFaceViolationCountdown(remaining);
      if (remaining > 0) return;
      if (faceTimerRef.current) {
        window.clearInterval(faceTimerRef.current);
        faceTimerRef.current = null;
      }
      const timeoutSnapshot = captureVideoSnapshot(userVideoRef.current, 320, 240);
      warnOnlySecurityViolation(
        "Face compliance warning: no face or multiple faces persisted for more than 10 seconds.",
        multipleFaces ? "multiple_faces_detected" : "face_not_visible_timeout",
        { multipleFaces, camera_snapshot: timeoutSnapshot }
      );
    }, 1000);
    return () => { if (faceTimerRef.current) { window.clearInterval(faceTimerRef.current); faceTimerRef.current = null; } };
  }, [status, cheatingTagged, faceVisible, multipleFaces, cameraObstructionDetected]);

  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged) return;
    if (!multipleFaces) return;
    logSecurityEvent(
      "Multiple faces detected in camera feed.",
      "multiple_faces_warning",
      "high"
    );
    setMessage("Security warning: multiple faces detected. Keep only one person in frame.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, multipleFaces]);

  // Screen change detection
  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !sharingScreen) return;
    const screenVideo = screenVideoRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!screenVideo) return;
    canvas.width = 80; canvas.height = 45;

    screenCheckIntervalRef.current = window.setInterval(() => {
      if (!ctx || screenVideo.readyState < 2) return;
      ctx.drawImage(screenVideo, 0, 0, 80, 45);
      const imageData = ctx.getImageData(0, 0, 80, 45).data;
      try {
        recentScreenSnapshotRef.current = canvas.toDataURL("image/jpeg", 0.72);
      } catch {
        // no-op
      }
      const previousScreen = prevScreenSnapshotRef.current;
      const currentScreen = recentScreenSnapshotRef.current;
      if (prevScreenPixelsRef.current) {
        let deltaSum = 0;
        let changedSamples = 0;
        let samples = 0;
        const prev = prevScreenPixelsRef.current;
        for (let i = 0; i < imageData.length; i += 16) {
          const currLuma = imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114;
          const prevLuma = prev[i] * 0.299 + prev[i + 1] * 0.587 + prev[i + 2] * 0.114;
          const diff = Math.abs(currLuma - prevLuma);
          deltaSum += diff;
          if (diff > 18) changedSamples += 1;
          samples += 1;
        }
        const meanDelta = deltaSum / Math.max(1, samples);
        const changedRatio = changedSamples / Math.max(1, samples);
        const avgBrightness = imageData.reduce((acc, _, idx) => {
          if (idx % 4 !== 0) return acc;
          const r = imageData[idx];
          const g = imageData[idx + 1];
          const b = imageData[idx + 2];
          return acc + (r * 0.299 + g * 0.587 + b * 0.114);
        }, 0) / Math.max(1, imageData.length / 4);

        if (avgBrightness < 7) {
          screenBlackCountRef.current += 1;
          if (screenBlackCountRef.current >= 3) {
            terminateInterviewForSecurity(
              "Blacked-out screen share feed detected.",
              "screen_black_frame_timeout",
              {
                avgBrightness: Number(avgBrightness.toFixed(2)),
                prev_screen_snapshot: previousScreen,
                screen_snapshot: currentScreen,
              }
            );
          }
        } else {
          screenBlackCountRef.current = Math.max(0, screenBlackCountRef.current - 1);
        }

        if (meanDelta < 0.22) {
          screenFreezeCountRef.current += 1;
          if (screenFreezeCountRef.current >= 6) {
            logSecurityEvent(
              "Screen feed looks frozen or static for an extended duration.",
              "screen_frozen_warning",
              "high",
              {
                meanDelta: Number(meanDelta.toFixed(3)),
                prev_screen_snapshot: previousScreen,
                screen_snapshot: currentScreen,
              }
            );
          }
        } else {
          screenFreezeCountRef.current = 0;
        }

        if (meanDelta > 9.2 || changedRatio > 0.2) {
          setScreenChanged(true);
          const beforeSnapshot = previousScreen || captureScreenSnapshot();
          const afterSnapshot = currentScreen || captureScreenSnapshot();
          logSecurityEvent(
            "Screen content changed during interview.",
            "screen_change_detected",
            "medium",
            {
              meanDelta: Number(meanDelta.toFixed(2)),
              changedRatio: Number(changedRatio.toFixed(3)),
              prev_screen_snapshot: beforeSnapshot,
              screen_snapshot: afterSnapshot,
            }
          );
          const nowMs = Date.now();
          const burst = screenChangeBurstRef.current;
          if (!burst.windowStartMs || nowMs - burst.windowStartMs > 20000) {
            screenChangeBurstRef.current = { count: 1, windowStartMs: nowMs };
          } else {
            screenChangeBurstRef.current = { count: burst.count + 1, windowStartMs: burst.windowStartMs };
          }
          if (screenChangeBurstRef.current.count >= 2 && screenViolationTimerRef.current === null) {
            let remaining = 8;
            setScreenViolationCountdown(remaining);
            screenViolationTimerRef.current = window.setInterval(() => {
              remaining -= 1;
              setScreenViolationCountdown(remaining);
              if (remaining > 0) return;
              if (screenViolationTimerRef.current) {
                window.clearInterval(screenViolationTimerRef.current);
                screenViolationTimerRef.current = null;
              }
              warnOnlySecurityViolation(
                "Excessive screen switching/content changes were detected.",
                "screen_change_timeout",
                {
                  burstCount: screenChangeBurstRef.current.count,
                  prev_screen_snapshot: beforeSnapshot,
                  screen_snapshot: afterSnapshot,
                }
              );
            }, 1000);
          }
        } else if (screenViolationTimerRef.current && meanDelta < 6.5 && changedRatio < 0.08) {
          if (screenViolationTimerRef.current) {
            window.clearInterval(screenViolationTimerRef.current);
            screenViolationTimerRef.current = null;
          }
          setScreenViolationCountdown(null);
          screenChangeBurstRef.current = { count: 0, windowStartMs: Date.now() };
          logSecurityEvent("Screen stabilized after previous switches.", "screen_stabilized", "info");
        }
      }
      prevScreenPixelsRef.current = new Uint8ClampedArray(imageData);
      prevScreenSnapshotRef.current = currentScreen;
    }, 1800);

    screenVideo.play().catch(() => {});
    return () => {
      if (screenCheckIntervalRef.current) window.clearInterval(screenCheckIntervalRef.current);
      if (screenViolationTimerRef.current) {
        window.clearInterval(screenViolationTimerRef.current);
        screenViolationTimerRef.current = null;
      }
      setScreenViolationCountdown(null);
    };
  }, [status, cheatingTagged, sharingScreen]);

  // Speech/video consistency: warns when strong audio appears without expected mouth-region motion.
  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !cameraOn || !micOn) return;
    const video = userVideoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = 64;
    canvas.height = 48;
    lipSyncLowMotionCountRef.current = 0;
    lipSyncPrevFrameRef.current = null;
    setLipSyncSuspicious(false);
    setMouthMotionLevel(0);

    lipSyncCheckIntervalRef.current = window.setInterval(() => {
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return;
      ctx.drawImage(video, 0, 0, 64, 48);
      const current = ctx.getImageData(0, 0, 64, 48).data;

      if (!lipSyncPrevFrameRef.current) {
        lipSyncPrevFrameRef.current = new Uint8ClampedArray(current);
        return;
      }

      let delta = 0;
      let samples = 0;
      for (let y = 26; y < 45; y += 1) {
        for (let x = 20; x < 45; x += 1) {
          const i = (y * 64 + x) * 4;
          const currLuma = current[i] * 0.299 + current[i + 1] * 0.587 + current[i + 2] * 0.114;
          const prev = lipSyncPrevFrameRef.current;
          const prevLuma = prev[i] * 0.299 + prev[i + 1] * 0.587 + prev[i + 2] * 0.114;
          delta += Math.abs(currLuma - prevLuma);
          samples += 1;
        }
      }

      const meanMouthMotion = delta / Math.max(1, samples);
      setMouthMotionLevel(Number(meanMouthMotion.toFixed(2)));
      const audioActive = listeningRef.current && micLevelRef.current > 18;
      const eligible = audioActive && faceVisible && !multipleFaces;
      const dynamicMotionThreshold = micLevelRef.current > 35 ? 2.6 : 1.9;

      if (eligible && meanMouthMotion < dynamicMotionThreshold) {
        lipSyncLowMotionCountRef.current += 1;
      } else {
        lipSyncLowMotionCountRef.current = Math.max(0, lipSyncLowMotionCountRef.current - 2);
      }

      const suspicious = lipSyncLowMotionCountRef.current >= 9;
      if (suspicious !== lipSyncSuspiciousRef.current) {
        lipSyncSuspiciousRef.current = suspicious;
        setLipSyncSuspicious(suspicious);
      }
      lipSyncPrevFrameRef.current = new Uint8ClampedArray(current);
    }, 500);

    return () => {
      if (lipSyncCheckIntervalRef.current) {
        window.clearInterval(lipSyncCheckIntervalRef.current);
        lipSyncCheckIntervalRef.current = null;
      }
      lipSyncPrevFrameRef.current = null;
      lipSyncLowMotionCountRef.current = 0;
      setLipSyncSuspicious(false);
      setMouthMotionLevel(0);
    };
  }, [status, cheatingTagged, cameraOn, micOn, faceVisible, multipleFaces]);

  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !listening) return;
    if (!lipSyncSuspicious) {
      if (lipSyncTimerRef.current) {
        window.clearInterval(lipSyncTimerRef.current);
        lipSyncTimerRef.current = null;
      }
      setLipSyncViolationCountdown(null);
      return;
    }
    if (lipSyncTimerRef.current) return;
    logSecurityEvent(
      "Speech and lip motion seem inconsistent. Candidate asked to keep face fully visible while speaking.",
      "lip_sync_warning",
      "high",
      { mouthMotionLevel }
    );
    let remaining = 12;
    setLipSyncViolationCountdown(remaining);
    lipSyncTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setLipSyncViolationCountdown(remaining);
      if (remaining > 0) return;
      if (lipSyncTimerRef.current) {
        window.clearInterval(lipSyncTimerRef.current);
        lipSyncTimerRef.current = null;
      }
      terminateInterviewForSecurity(
        "Prolonged speech/lip-motion mismatch detected.",
        "lip_sync_timeout",
        { mouthMotionLevel }
      );
    }, 1000);
    return () => {
      if (lipSyncTimerRef.current) {
        window.clearInterval(lipSyncTimerRef.current);
        lipSyncTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, lipSyncSuspicious, listening]);

  useEffect(() => {
    if (status !== "in_progress" || cheatingTagged || !listening) return;
    if (!cameraFreezeSuspicious) {
      if (cameraFreezeTimerRef.current) {
        window.clearInterval(cameraFreezeTimerRef.current);
        cameraFreezeTimerRef.current = null;
      }
      setCameraFreezeCountdown(null);
      return;
    }
    if (cameraFreezeTimerRef.current) return;
    logSecurityEvent(
      "Camera feed appears static while candidate is speaking.",
      "camera_freeze_warning",
      "high"
    );
    let remaining = 10;
    setCameraFreezeCountdown(remaining);
    cameraFreezeTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setCameraFreezeCountdown(remaining);
      if (remaining > 0) return;
      if (cameraFreezeTimerRef.current) {
        window.clearInterval(cameraFreezeTimerRef.current);
        cameraFreezeTimerRef.current = null;
      }
      terminateInterviewForSecurity(
        "Static camera feed detected while speaking.",
        "camera_freeze_timeout"
      );
    }, 1000);
    return () => {
      if (cameraFreezeTimerRef.current) {
        window.clearInterval(cameraFreezeTimerRef.current);
        cameraFreezeTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, cheatingTagged, cameraFreezeSuspicious, listening]);

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

  async function buildEventEvidence(
    severity: "info" | "low" | "medium" | "high" | "critical",
    eventType: string,
    base: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const enriched: Record<string, unknown> = { ...base };
    const captureSnapshot = severity === "high" || severity === "critical" || eventType.includes("timeout") || eventType.includes("detected");
    if (!captureSnapshot) return enriched;
    const camera = captureVideoSnapshot(userVideoRef.current, 320, 240);
    if (camera) enriched.camera_snapshot = camera;
    const screen = captureScreenSnapshot();
    if (screen) enriched.screen_snapshot = screen;
    return enriched;
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

  function terminateInterviewForSecurity(
    details: string,
    eventType: string,
    evidence: Record<string, unknown> = {}
  ) {
    if (!STRICT_SECURITY_ENFORCEMENT) {
      logSecurityEvent(details, eventType, "high", evidence);
      void saveTurn("assistant", `Security warning: ${details}`, "proctor");
      setMessage(`Security warning: ${details}`);
      return;
    }
    if (terminatingForSecurityRef.current) return;
    terminatingForSecurityRef.current = true;
    setCheatingTagged(true);
    logSecurityEvent(details, eventType, "critical", evidence);
    void saveTurn("assistant", details, "proctor");
    setMessage(`Interview ended: ${details}`);
    void endInterview();
  }

  function warnOnlySecurityViolation(
    details: string,
    eventType: string,
    evidence: Record<string, unknown> = {}
  ) {
    logSecurityEvent(details, eventType, "high", evidence);
    void saveTurn("assistant", `Security warning: ${details}`, "proctor");
    setMessage(`Security warning: ${details}`);
  }

  function logSecurityEvent(
    event: string,
    eventType: string,
    severity: "info" | "low" | "medium" | "high" | "critical" = "medium",
    evidence: Record<string, unknown> = {}
  ) {
    const nowMs = Date.now();
    const last = lastEventLoggedAtRef.current[eventType] || 0;
    const minIntervalMs = eventType === "screen_change_detected" ? 900 : 6000;
    if (nowMs - last < minIntervalMs) return; // de-noise repeated events
    lastEventLoggedAtRef.current[eventType] = nowMs;
    const now = new Date().toLocaleTimeString();
    setSecurityEvents((prev) => [{ time: now, event, eventType, severity }, ...prev].slice(0, 20));
    void buildEventEvidence(severity, eventType, evidence).then((fullEvidence) => {
      void saveSecurityEvent(eventType, event, severity, fullEvidence).then((ok) => {
        if (!ok) queueSecurityEvent(eventType, severity, event, fullEvidence);
      });
    });
  }

  function formatClock(totalSec: number): string {
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function normalizeSpeech(text: string): string[] {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
  }

  function speechMatchScore(expected: string, actual: string): number {
    const expectedTokens = normalizeSpeech(expected);
    const actualTokens = normalizeSpeech(actual);
    if (!expectedTokens.length || !actualTokens.length) return 0;
    const actualSet = new Set(actualTokens);
    const matched = expectedTokens.filter((t) => actualSet.has(t)).length;
    return matched / expectedTokens.length;
  }

  function evaluateAnswerDepth(text: string, currentQuestion: string = ""): {
    words: number;
    hasSteps: boolean;
    hasDecision: boolean;
    hasResult: boolean;
    hasProjectSignal: boolean;
    depthOk: boolean;
    missing: string[];
  } {
    const cleaned = (text || "").trim().toLowerCase();
    const question = (currentQuestion || "").trim().toLowerCase();
    const words = cleaned.split(/\s+/).filter(Boolean);
    const hasSteps = /(first|then|next|after|finally|step)/.test(cleaned);
    const hasDecision = /(because|decided|chose|trade.?off|instead)/.test(cleaned);
    const hasResult = /(result|outcome|improved|reduced|increased|%|\d+)/.test(cleaned);
    const hasProjectSignal = /(project|built|build|implemented|worked|experience|system|agent|backend|frontend|api)/.test(
      cleaned
    );

    const isIntro = /(introduce|brief introduction|about yourself|background)/.test(question);
    const isChallenge = /(challenge|resolved|debug|issue|problem|fix)/.test(question);
    const isTradeoffHeavy = /(trade.?off|decision|optimiz|latency|performance|scale)/.test(question);

    let minWords = 14;
    let needSteps = false;
    let needDecision = false;
    let needResult = false;
    let needProjectSignal = false;

    if (isIntro) {
      minWords = 12;
      needProjectSignal = true;
    } else if (isTradeoffHeavy) {
      minWords = 16;
      needDecision = true;
      needResult = true;
      needSteps = true;
    } else if (isChallenge) {
      minWords = 16;
      needSteps = true;
      needResult = true;
    } else {
      minWords = 14;
    }

    const missing: string[] = [];
    if (words.length < minWords) missing.push("a bit more detail");
    if (needProjectSignal && !hasProjectSignal) missing.push("one concrete project/experience");
    if (needSteps && !hasSteps) missing.push("the exact steps you took");
    if (needDecision && !hasDecision) missing.push("the key decision or trade-off");
    if (needResult && !hasResult) missing.push("the measurable result");

    const baseSignals = [hasSteps, hasDecision, hasResult, hasProjectSignal].filter(Boolean).length;
    const genericPass = words.length >= minWords && baseSignals >= 2;
    const targetedPass = missing.length === 0;
    const depthOk = isIntro || isChallenge || isTradeoffHeavy ? targetedPass : genericPass;

    return {
      words: words.length,
      hasSteps,
      hasDecision,
      hasResult,
      hasProjectSignal,
      depthOk,
      missing,
    };
  }

  function answerHasDepth(text: string, currentQuestion: string = ""): boolean {
    return evaluateAnswerDepth(text, currentQuestion).depthOk;
  }

  function buildDepthFollowup(answer: string, currentQuestion: string): string {
    const depth = evaluateAnswerDepth(answer, currentQuestion);
    const missing = [...depth.missing].filter((m) => m !== "a bit more detail");

    const softLead =
      incompleteAnswerCountRef.current >= 1
        ? "Let's make this high-signal before moving ahead."
        : "Helpful start.";

    if (missing.length === 0) {
      return `${softLead} Can you add one concrete incident with exact steps, key decision/trade-off, and measurable outcome?`;
    }
    const missingText =
      missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    return `${softLead} Can you answer the same question with ${missingText}?`;
  }

  function isFrustrationReply(text: string): boolean {
    const cleaned = (text || "").toLowerCase();
    return /(already|again and again|same question|i answered|why asking)/.test(cleaned);
  }

  async function speakDepthFollowup(answer: string, currentQuestion: string) {
    const followup = buildDepthFollowup(answer, currentQuestion);
    incompleteAnswerCountRef.current += 1;
    setMessage(followup);
    setHistory((prev) => {
      const next = [...prev, { role: "assistant" as const, source: "system" as const, content: followup }];
      historyRef.current = next;
      return next;
    });
    void saveTurn("assistant", followup, "system");
    speak(followup);
  }

  function nextMicPhrase() {
    const pool = MIC_VERIFICATION_PHRASES.filter((p) => p !== micVerificationPhrase);
    const pick = pool[Math.floor(Math.random() * pool.length)] || MIC_VERIFICATION_PHRASES[0];
    setMicVerificationPhrase(pick);
    setMicVerificationTranscript("");
    setMicVerificationError("");
    setMicVerificationScore(0);
  }

  function analyzeCameraFrameData(data: Uint8ClampedArray, width: number, height: number): CameraFrameAssessment {
    const blockCols = 4;
    const blockRows = 4;
    const blockW = Math.max(1, Math.floor(width / blockCols));
    const blockH = Math.max(1, Math.floor(height / blockRows));
    const blockBrightness: number[] = [];
    let redDominant = 0;
    let greenDominant = 0;
    let blueDominant = 0;
    let sampled = 0;
    let edgeSignal = 0;

    for (let by = 0; by < blockRows; by += 1) {
      for (let bx = 0; bx < blockCols; bx += 1) {
        const startX = bx * blockW;
        const endX = bx === blockCols - 1 ? width : Math.min(width, (bx + 1) * blockW);
        const startY = by * blockH;
        const endY = by === blockRows - 1 ? height : Math.min(height, (by + 1) * blockH);
        let sum = 0;
        let count = 0;
        for (let y = startY; y < endY; y += 1) {
          for (let x = startX; x < endX; x += 1) {
            const i = (y * width + x) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const luma = r * 0.299 + g * 0.587 + b * 0.114;
            sum += luma;
            count += 1;
            sampled += 1;
            if (r > g + 12 && r > b + 12) redDominant += 1;
            if (g > r + 12 && g > b + 12) greenDominant += 1;
            if (b > r + 12 && b > g + 12) blueDominant += 1;
            if (x > 0 && y > 0 && x % 3 === 0 && y % 3 === 0) {
              const left = (y * width + (x - 1)) * 4;
              const up = (((y - 1) * width) + x) * 4;
              const leftLuma = data[left] * 0.299 + data[left + 1] * 0.587 + data[left + 2] * 0.114;
              const upLuma = data[up] * 0.299 + data[up + 1] * 0.587 + data[up + 2] * 0.114;
              edgeSignal += Math.abs(luma - leftLuma) + Math.abs(luma - upLuma);
            }
          }
        }
        blockBrightness.push(count ? sum / count : 0);
      }
    }

    const mean = blockBrightness.reduce((a, b) => a + b, 0) / Math.max(1, blockBrightness.length);
    const variance =
      blockBrightness.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, blockBrightness.length);
    const edgeDensity = edgeSignal / Math.max(1, sampled);
    const dominantRatio = Math.max(redDominant, greenDominant, blueDominant) / Math.max(1, sampled);
    const brightBlocks = blockBrightness.filter((b) => b > 60).length;
    const centerIndices = [5, 6, 9, 10];
    const centerValues = centerIndices
      .map((idx) => blockBrightness[idx])
      .filter((v) => Number.isFinite(v));
    const centerMean = centerValues.reduce((a, b) => a + b, 0) / Math.max(1, centerValues.length);
    const centerVariance =
      centerValues.reduce((a, b) => a + (b - centerMean) ** 2, 0) / Math.max(1, centerValues.length);

    const hardOcclusion =
      mean < 8.5 ||
      (dominantRatio > 0.9 && edgeDensity < 6.4) ||
      (variance < 62 && centerVariance < 16) ||
      (variance < 52 && edgeDensity < 5.1);

    const likelyOccluded =
      mean < 10 ||
      (dominantRatio > 0.87 && edgeDensity < 7.2) ||
      (variance < 70 && centerVariance < 20);

    const usableFrame =
      !hardOcclusion &&
      !likelyOccluded &&
      brightBlocks >= 2 &&
      mean > 11 &&
      (variance > 48 || edgeDensity > 4.2);

    return {
      mean,
      variance,
      edgeDensity,
      dominantRatio,
      centerVariance,
      brightBlocks,
      hardOcclusion,
      likelyOccluded,
      usableFrame,
    };
  }

  function estimateFaceRegionSummary(data: Uint8ClampedArray, width: number, height: number): FaceRegionSummary {
    const sampleW = Math.max(8, Math.floor(width / 2));
    const sampleH = Math.max(8, Math.floor(height / 2));
    const mask = new Uint8Array(sampleW * sampleH);

    for (let sy = 0; sy < sampleH; sy += 1) {
      for (let sx = 0; sx < sampleW; sx += 1) {
        const srcX = Math.min(width - 1, sx * 2);
        const srcY = Math.min(height - 1, sy * 2);
        const idx = (srcY * width + srcX) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        const skinLike = y > 35 && y < 235 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
        mask[sy * sampleW + sx] = skinLike ? 1 : 0;
      }
    }

    const visited = new Uint8Array(sampleW * sampleH);
    const queueX = new Int16Array(sampleW * sampleH);
    const queueY = new Int16Array(sampleW * sampleH);
    const areaRatios: number[] = [];

    for (let y = 0; y < sampleH; y += 1) {
      for (let x = 0; x < sampleW; x += 1) {
        const startIdx = y * sampleW + x;
        if (!mask[startIdx] || visited[startIdx]) continue;
        let qStart = 0;
        let qEnd = 0;
        queueX[qEnd] = x;
        queueY[qEnd] = y;
        qEnd += 1;
        visited[startIdx] = 1;
        let area = 0;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;

        while (qStart < qEnd) {
          const cx = queueX[qStart];
          const cy = queueY[qStart];
          qStart += 1;
          area += 1;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          const neighbors = [
            [cx + 1, cy],
            [cx - 1, cy],
            [cx, cy + 1],
            [cx, cy - 1],
          ];
          for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= sampleW || ny >= sampleH) continue;
            const nIdx = ny * sampleW + nx;
            if (!mask[nIdx] || visited[nIdx]) continue;
            visited[nIdx] = 1;
            queueX[qEnd] = nx;
            queueY[qEnd] = ny;
            qEnd += 1;
          }
        }

        const boxW = maxX - minX + 1;
        const boxH = maxY - minY + 1;
        const aspect = boxW / Math.max(1, boxH);
        const compactEnough = area >= 30 && boxW >= 5 && boxH >= 5 && aspect > 0.45 && aspect < 2.4;
        if (compactEnough) {
          areaRatios.push(area / (sampleW * sampleH));
        }
      }
    }
    areaRatios.sort((a, b) => b - a);
    const largestAreaRatio = areaRatios[0] || 0;
    const secondLargestAreaRatio = areaRatios[1] || 0;
    const largeCount = areaRatios.filter((r) => r >= 0.02).length;
    return {
      count: areaRatios.length,
      largeCount,
      largestAreaRatio,
      secondLargestAreaRatio,
    };
  }

  function assessLiveCameraFrame(video: HTMLVideoElement | null): CameraFrameAssessment | null {
    if (!video || video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 80, 60);
    const frame = ctx.getImageData(0, 0, 80, 60).data;
    return analyzeCameraFrameData(frame, 80, 60);
  }

  function snapshotDifferenceScore(prevDataUrl: string, nextDataUrl: string): Promise<number> {
    return new Promise((resolve) => {
      const prevImg = new Image();
      const nextImg = new Image();
      let loaded = 0;
      const done = () => {
        loaded += 1;
        if (loaded < 2) return;
        const canvas = document.createElement("canvas");
        canvas.width = 80;
        canvas.height = 60;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(1);

        ctx.drawImage(prevImg, 0, 0, 80, 60);
        const prevData = ctx.getImageData(0, 0, 80, 60).data;
        ctx.drawImage(nextImg, 0, 0, 80, 60);
        const nextData = ctx.getImageData(0, 0, 80, 60).data;

        let delta = 0;
        for (let i = 0; i < prevData.length; i += 16) {
          delta += Math.abs(prevData[i] - nextData[i]);
        }
        resolve(delta / (prevData.length / 16));
      };
      prevImg.onload = done;
      nextImg.onload = done;
      prevImg.src = prevDataUrl;
      nextImg.src = nextDataUrl;
    });
  }

  function getVoiceprintVector(): number[] | null {
    const analyser = micAnalyserRef.current;
    if (!analyser) return null;
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    const segment = Math.max(1, Math.floor(bins.length / 8));
    const vector: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      let sum = 0;
      let count = 0;
      for (let j = i * segment; j < Math.min(bins.length, (i + 1) * segment); j += 1) {
        sum += bins[j];
        count += 1;
      }
      vector.push(count ? sum / count : 0);
    }
    return vector;
  }

  function cosineSimilarity(a: number[], b: number[]): number {
    if (!a.length || !b.length || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  function captureVideoSnapshot(video: HTMLVideoElement | null, width: number, height: number): string {
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return "";
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.75);
  }

  function captureScreenSnapshot(): string {
    const fromLive = captureVideoSnapshot(screenVideoRef.current, 320, 180);
    if (fromLive) return fromLive;
    return recentScreenSnapshotRef.current || "";
  }

  function stopMicLevelMonitor() {
    if (micMeterRAFRef.current) {
      cancelAnimationFrame(micMeterRAFRef.current);
      micMeterRAFRef.current = null;
    }
    if (micAudioContextRef.current) {
      void micAudioContextRef.current.close().catch(() => undefined);
      micAudioContextRef.current = null;
    }
    micAnalyserRef.current = null;
    setMicLevel(0);
  }

  async function startMicLevelMonitor() {
    stopMicLevelMonitor();
    const stream = userStreamRef.current;
    const hasAudio = stream?.getAudioTracks()?.length;
    if (!stream || !hasAudio) return;
    const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    try {
      const audioCtx = new Ctx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      micAudioContextRef.current = audioCtx;
      micAnalyserRef.current = analyser;
      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!micAnalyserRef.current) return;
        micAnalyserRef.current.getByteFrequencyData(buffer);
        const avg = buffer.reduce((a, b) => a + b, 0) / buffer.length;
        setMicLevel(Math.min(100, (avg / 160) * 100));
        micMeterRAFRef.current = requestAnimationFrame(tick);
      };
      micMeterRAFRef.current = requestAnimationFrame(tick);
    } catch {
      // ignore meter failures
    }
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
      const updated: Turn[] = upsertAssistantQuestion(currentHistory, q);
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
          camStream.getTracks().forEach((t) => t.stop());
          userStreamRef.current = null;
          if (userVideoRef.current) userVideoRef.current.srcObject = null;
          setCameraOn(false);
          setCheckState("failed");
          setMessage("Camera quality failed: minimum 640x480 and 15 FPS required.");
          logSecurityEvent(
            "Camera quality is below required threshold.",
            "camera_quality_low",
            "high",
            { width, height, fps }
          );
          return;
        }
      }
      let setupAssessment: CameraFrameAssessment | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 220));
        setupAssessment = assessLiveCameraFrame(userVideoRef.current);
        if (setupAssessment) break;
      }
      if (!setupAssessment || setupAssessment.hardOcclusion || !setupAssessment.usableFrame) {
        camStream.getTracks().forEach((t) => t.stop());
        userStreamRef.current = null;
        if (userVideoRef.current) userVideoRef.current.srcObject = null;
        setCameraOn(false);
        setCheckState("failed");
        setMessage("Camera security check failed. Uncover lens, improve lighting, and retry.");
        logSecurityEvent(
          "Camera verification failed due to obstructed/low-integrity camera frame.",
          "camera_security_precheck_failed",
          "high",
          setupAssessment
            ? {
                mean: Number(setupAssessment.mean.toFixed(2)),
                variance: Number(setupAssessment.variance.toFixed(2)),
                edgeDensity: Number(setupAssessment.edgeDensity.toFixed(2)),
                dominantRatio: Number(setupAssessment.dominantRatio.toFixed(3)),
                brightBlocks: setupAssessment.brightBlocks,
              }
            : { reason: "frame_unavailable" }
        );
        return;
      }
      setCameraOn(true);
      setCheckState("passed");
      setCameraSnapshots([]);
      setCameraIdentityVerified(false);
      setCameraPoseGuideIdx(0);
      setCameraVerificationHint("");
      setSetupStep("camera");
      setMessage("Camera access granted. Capture 2 verification photos to continue.");
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
      setMicIdentityVerified(false);
      setMicVerificationTranscript("");
      setMicVerificationError("");
      setMicVerificationScore(0);
      setSetupStep("microphone");
      setMessage("Microphone access granted. Read the phrase aloud to verify voice.");
      await startMicLevelMonitor();
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
      const displaySurface = displayStream.getVideoTracks()[0]?.getSettings?.().displaySurface;
      if (displaySurface && displaySurface !== "monitor") {
        displayStream.getTracks().forEach((t) => t.stop());
        setCheckState("failed");
        setSharingScreen(false);
        setMessage("Please share your entire screen (not a single window or browser tab).");
        logSecurityEvent(
          "Screen share rejected: candidate shared window/tab instead of entire monitor.",
          "screen_share_not_fullscreen",
          "high",
          { displaySurface }
        );
        return;
      }
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = displayStream;
      attachScreenStreamToVideo(displayStream);
      displayStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setSharingScreen(false);
          screenStreamRef.current = null;
          if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
          recentScreenSnapshotRef.current = "";
          prevScreenSnapshotRef.current = "";
          logSecurityEvent("Screen sharing stopped by candidate.", "screen_share_stopped", "critical");
          if (statusRef.current === "in_progress") {
            terminateInterviewForSecurity(
              "Screen sharing stopped during the interview.",
              "screen_share_stopped_timeout"
            );
          }
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
    if (setupStep === "camera") {
      if (!cameraOn) return verifyCameraStep();
      if (!cameraIdentityVerified) return captureCameraVerificationPhoto();
      setSetupStep("microphone");
      return;
    }
    if (setupStep === "microphone") {
      if (!micOn) return verifyMicrophoneStep();
      if (!micIdentityVerified) return startMicVerification();
      setSetupStep("screen");
      return;
    }
    if (setupStep === "screen") return verifyScreenStep();
    setCheckState("passed");
    setMessage("All setup steps completed.");
  }

  async function captureCameraVerificationPhoto() {
    if (!userVideoRef.current || !cameraOn) {
      setMessage("Enable camera first.");
      return;
    }
    const video = userVideoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      setMessage("Camera is warming up. Please wait a moment and capture again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setMessage("Unable to capture photo right now.");
      return;
    }
    const frameAssessment = assessLiveCameraFrame(video);
    if (!frameAssessment || frameAssessment.hardOcclusion || !frameAssessment.usableFrame) {
      setCameraVerificationHint("Camera frame is blocked/unclear. Keep lens uncovered and face well lit.");
      setMessage("Camera quality/security check failed. Adjust camera and capture again.");
      logSecurityEvent(
        "Camera snapshot rejected due to obstructed or low-integrity frame.",
        "camera_snapshot_rejected",
        "high",
        frameAssessment
          ? {
              mean: Number(frameAssessment.mean.toFixed(2)),
              variance: Number(frameAssessment.variance.toFixed(2)),
              edgeDensity: Number(frameAssessment.edgeDensity.toFixed(2)),
              dominantRatio: Number(frameAssessment.dominantRatio.toFixed(3)),
            }
          : { reason: "frame_unavailable" }
      );
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (faceDetectorRef.current) {
      try {
        const detected = await faceDetectorRef.current.detect(canvas);
        const validFaces = (detected || []).filter((f) => {
          const w = Number(f.boundingBox?.width || 0);
          const h = Number(f.boundingBox?.height || 0);
          return w > 12 && h > 12;
        });
        if (validFaces.length > 1 || (validFaces.length === 1 && multipleFaces)) {
          setCameraVerificationHint("Multiple faces detected. Only one face should be visible.");
          setMessage("Multiple faces detected. Please keep only your face in frame.");
          logSecurityEvent("Multiple faces detected during camera verification photo.", "multiple_faces_detected", "high");
          return;
        }
        if (validFaces.length < 1) {
          setCameraVerificationHint("No clear face detected. Center your face and capture again.");
          setMessage("No clear face detected. Please look at camera and capture again.");
          return;
        }
      } catch {
        // fallback to runtime face flags below
      }
    } else if (multipleFaces) {
      setCameraVerificationHint("Multiple faces detected in camera stream.");
      setMessage("Multiple faces detected. Please keep only one person in frame.");
      return;
    }
    const shot = canvas.toDataURL("image/jpeg", 0.85);
    setCameraCaptureFlash(true);
    window.setTimeout(() => setCameraCaptureFlash(false), 180);

    const prev = cameraSnapshots[cameraSnapshots.length - 1];
    if (prev) {
      const diffScore = await snapshotDifferenceScore(prev, shot);
      if (diffScore < 5.8) {
        setCameraVerificationHint("Second photo is too similar. Change pose/angle slightly and capture again.");
        setMessage("Please change your face angle and capture again.");
        return;
      }
    }

    setCameraSnapshots((curr) => {
      const next = [...curr, shot].slice(0, CAMERA_VERIFICATION_PHOTO_COUNT);
      setCameraPoseGuideIdx(Math.min(next.length, CAMERA_VERIFICATION_PHOTO_COUNT - 1));
      setCameraVerificationHint("");
      if (next.length >= CAMERA_VERIFICATION_PHOTO_COUNT) {
        setCameraIdentityVerified(true);
        setSetupStep("microphone");
        setMessage("Camera identity check completed. Proceed to microphone verification.");
        logSecurityEvent("Camera identity verification completed with two snapshots.", "camera_identity_verified", "info");
      } else {
        setMessage(`Photo ${next.length}/${CAMERA_VERIFICATION_PHOTO_COUNT} captured. Now: ${CAMERA_POSE_GUIDES[1]}`);
      }
      return next;
    });
  }

  function retakeCameraVerification() {
    setCameraSnapshots([]);
    setCameraIdentityVerified(false);
    setCameraPoseGuideIdx(0);
    setCameraVerificationHint("");
    setSetupStep("camera");
    setMessage("Camera snapshots cleared. Capture two photos again.");
  }

  async function completeSecurityChallenge() {
    if (!securityChallenge) return;
    const current = captureVideoSnapshot(userVideoRef.current, 320, 240);
    let diff = 10;
    const baseline = cameraSnapshots[cameraSnapshots.length - 1];
    if (baseline && current) {
      diff = await snapshotDifferenceScore(baseline, current);
    }
    const live = currentFaceCenterRef.current;
    const dx = live.x - securityChallenge.baselineX;
    const dy = live.y - securityChallenge.baselineY;
    const actionPassed =
      securityChallenge.action === "turn_left"
        ? dx <= -0.04
        : securityChallenge.action === "turn_right"
          ? dx >= 0.04
          : dy >= 0.035;
    const pass = faceVisible && !multipleFaces && diff > 4.2 && actionPassed;
    if (pass) {
      setSecurityChallenge(null);
      setMessage("Security challenge passed.");
      logSecurityEvent(
        "Random liveness challenge passed.",
        "random_security_challenge_passed",
        "info",
        {
          diff: Number(diff.toFixed(2)),
          action: securityChallenge.action,
          dx: Number(dx.toFixed(3)),
          dy: Number(dy.toFixed(3)),
          camera_challenge_snapshot: current,
        }
      );
      return;
    }
    terminateInterviewForSecurity(
      "Random liveness/security challenge failed.",
      "random_security_challenge_failed",
      {
        diff: Number(diff.toFixed(2)),
        faceVisible,
        multipleFaces,
        action: securityChallenge.action,
        dx: Number(dx.toFixed(3)),
        dy: Number(dy.toFixed(3)),
        camera_challenge_snapshot: current,
      }
    );
  }

  function startMicVerification() {
    if (micVerificationInProgress) return;
    if (!micOn) {
      setMessage("Enable microphone first.");
      return;
    }
    const rec = buildRecognition();
    if (!rec) {
      setMicVerificationError("Speech recognition not supported. Use Chrome.");
      return;
    }
    setMicVerificationInProgress(true);
    setMicVerificationError("");
    setMicVerificationTranscript("");
    setMicVerificationScore(0);
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
      setMicVerificationTranscript(transcript);
      const score = speechMatchScore(micVerificationPhrase, transcript);
      setMicVerificationScore(score);
      if (score >= 0.65) {
        const baseline = getVoiceprintVector();
        if (baseline && baseline.length) {
          setVoiceprintBaseline(baseline);
          logSecurityEvent("Voiceprint baseline captured during microphone verification.", "voiceprint_baseline_captured", "info");
        }
        setMicIdentityVerified(true);
        setSetupStep("screen");
        setMessage("Microphone voice verification passed. Proceed to screen share.");
        logSecurityEvent("Microphone voice phrase verified.", "microphone_phrase_verified", "info", { score: Number(score.toFixed(2)) });
      } else {
        setMicIdentityVerified(false);
        setMicVerificationError(`Verification mismatch (${Math.round(score * 100)}%). Read clearly and try again.`);
        logSecurityEvent("Microphone voice phrase mismatch.", "microphone_phrase_mismatch", "medium", { score: Number(score.toFixed(2)) });
      }
    };
    rec.onerror = (event) => {
      setMicVerificationError(`Voice verification failed: ${event.error}`);
      setMicIdentityVerified(false);
      setMicVerificationInProgress(false);
      logSecurityEvent(`Microphone verification speech error: ${event.error}`, "microphone_phrase_error", "medium");
    };
    rec.onend = () => {
      setMicVerificationInProgress(false);
    };
    rec.start();
  }

  async function startInterview() {
    if (startingInterview) return;
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
      setStartingInterview(true);
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
      const hasTurns = existingTurns.length > 0;
      const lastTurn = hasTurns ? existingTurns[existingTurns.length - 1] : null;
      const hasPendingAssistantQuestion = !!lastTurn && lastTurn.role === "assistant";
      if (hasPendingAssistantQuestion) {
        setMessage("Continuing from your pending interview question.");
        if (typeof lastTurn?.content === "string" && lastTurn.content.trim()) {
          speak(lastTurn.content.trim());
        }
        return;
      }

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        setLoadingQuestion(true);
        wsAwaitingNextQuestionRef.current = true;
        wsIgnoreNextQuestionRef.current = false;
        wsRef.current.send(JSON.stringify({ type: "request_next" }));
      } else {
        await fetchNextQuestion(existingTurns);
      }
    } catch (err) {
      setMessage(`Failed to start interview: ${(err as Error).message}`);
    } finally {
      setStartingInterview(false);
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
    const latestQuestion =
      [...historyRef.current].reverse().find((t) => t.role === "assistant")?.content || currentQuestion;
    const depth = evaluateAnswerDepth(transcript, latestQuestion);
    const tooShort = depth.words < 8;
    const frustrated = isFrustrationReply(transcript);
    const canUseWs = wsRef.current && wsRef.current.readyState === WebSocket.OPEN;
    let savedCandidate: Turn | null = null;
    if (!canUseWs) {
      savedCandidate = await saveTurn("candidate", transcript, source);
    }
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
    if (tooShort || !answerHasDepth(transcript, latestQuestion)) {
      incompleteAnswerCountRef.current += 1;
      if (frustrated) {
        setMessage("Answer captured. Moving forward with deeper follow-up questions.");
      } else {
        setMessage("Answer captured. The next question will probe deeper technical details.");
      }
    } else {
      incompleteAnswerCountRef.current = 0;
    }
    setMessage("Answer captured. AI is analyzing and preparing follow-up...");
    if (canUseWs && wsRef.current) {
      setLoadingQuestion(true);
      wsAwaitingNextQuestionRef.current = true;
      wsIgnoreNextQuestionRef.current = false;
      wsRef.current.send(JSON.stringify({ type: "candidate_answer", content: transcript, source }));
      return;
    }
    await fetchNextQuestion(updated);
  }

  async function finalizeSpeechAnswer() {
    if (speechSubmittedRef.current) return;
    speechSubmittedRef.current = true;
    clearSpeechSilenceTimer();
    const transcript = speechBufferRef.current.trim();
    speechBufferRef.current = "";
    if (!transcript) {
      setMessage("No speech detected. Please try again.");
      return;
    }
    await submitAnswer(transcript, "speech");
  }

  function scheduleSpeechFinalize() {
    clearSpeechSilenceTimer();
    speechSilenceTimerRef.current = window.setTimeout(() => {
      recognitionRef.current?.stop();
      void finalizeSpeechAnswer();
    }, 2600);
  }

  function startListening() {
    if (listening) return;
    setMessage("");
    const rec = buildRecognition();
    if (!rec) {
      setMessage("Speech recognition is not supported in this browser. Please use Chrome.");
      return;
    }
    speechSubmittedRef.current = false;
    speechBufferRef.current = "";
    clearSpeechSilenceTimer();
    setAnswerDraft("");
    rec.interimResults = true;
    rec.continuous = true;
    recognitionRef.current = rec;
    setListening(true);
    noSpeechRetryRef.current = 0;

    rec.onresult = async (event) => {
      let finalChunk = "";
      let interimChunk = "";
      const eventWithIndex = event as {
        resultIndex?: number;
        results: ArrayLike<{ [index: number]: { transcript: string }; isFinal?: boolean }>;
      };
      const startAt = typeof eventWithIndex.resultIndex === "number" ? eventWithIndex.resultIndex : 0;
      const total = eventWithIndex.results?.length || 0;
      for (let i = startAt; i < total; i += 1) {
        const result = eventWithIndex.results?.[i];
        const text = result?.[0]?.transcript?.trim() || "";
        if (!text) continue;
        if (result?.isFinal) {
          finalChunk += `${text} `;
        } else {
          interimChunk = text;
        }
      }
      if (finalChunk.trim()) {
        speechBufferRef.current = `${speechBufferRef.current} ${finalChunk}`.trim();
      }
      setAnswerDraft(`${speechBufferRef.current} ${interimChunk}`.trim());
      scheduleSpeechFinalize();
    };

    rec.onerror = (event) => {
      clearSpeechSilenceTimer();
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

    rec.onend = () => {
      setListening(false);
      if (!speechSubmittedRef.current && speechBufferRef.current.trim()) {
        void finalizeSpeechAnswer();
      }
    };
    rec.start();
  }

  function stopListening() {
    clearSpeechSilenceTimer();
    recognitionRef.current?.stop();
    setListening(false);
    if (!speechSubmittedRef.current && speechBufferRef.current.trim()) {
      void finalizeSpeechAnswer();
    }
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
      const displaySurface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface;
      if (displaySurface && displaySurface !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        setSharingScreen(false);
        setMessage("Security policy: share the entire screen only.");
        logSecurityEvent(
          "Candidate attempted non-fullscreen screen sharing during interview.",
          "screen_share_not_fullscreen",
          "critical",
          { displaySurface }
        );
        if (statusRef.current === "in_progress") {
          terminateInterviewForSecurity(
            "Non-fullscreen screen sharing detected.",
            "screen_share_not_fullscreen_timeout",
            { displaySurface }
          );
        }
        return;
      }
      screenStreamRef.current = stream;
      attachScreenStreamToVideo(stream);
      setSharingScreen(true);
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setSharingScreen(false);
          screenStreamRef.current = null;
          if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
          recentScreenSnapshotRef.current = "";
          prevScreenSnapshotRef.current = "";
          logSecurityEvent("Screen sharing ended while interview is active.", "screen_share_stopped", "critical");
          if (statusRef.current === "in_progress") {
            terminateInterviewForSecurity(
              "Screen sharing stopped during the interview.",
              "screen_share_stopped_timeout"
            );
          }
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
      if (wsFallbackTimerRef.current) {
        window.clearTimeout(wsFallbackTimerRef.current);
        wsFallbackTimerRef.current = null;
      }
      wsAwaitingNextQuestionRef.current = false;
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      stopListening();
      window.speechSynthesis.cancel();
      userStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      userStreamRef.current = null;
      screenStreamRef.current = null;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
      recentScreenSnapshotRef.current = "";
      prevScreenSnapshotRef.current = "";
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
                  (item.step === "camera" && cameraOn && cameraIdentityVerified) || 
                  (item.step === "microphone" && micOn && micIdentityVerified) || 
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
                {cameraCaptureFlash && <div className="absolute inset-0 bg-white/60 animate-pulse pointer-events-none" />}

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
                    status: cameraOn && cameraIdentityVerified ? "Passed" : setupStep === "camera" ? "Verifying" : "Pending",
                    icon: Camera
                  },
                  {
                    step: "microphone",
                    title: "Step 2: Microphone Calibration",
                    desc: "Calibrate voice parameters for conversational analysis.",
                    status: micOn && micIdentityVerified ? "Passed" : setupStep === "microphone" ? "Verifying" : "Pending",
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
                            ? (!cameraOn ? "Allow Camera Access" : !cameraIdentityVerified ? `Capture Photo (${cameraSnapshots.length}/${CAMERA_VERIFICATION_PHOTO_COUNT})` : "Camera Verified")
                            : setupStep === "microphone" 
                              ? (!micOn ? "Allow Microphone Feed" : !micIdentityVerified ? (micVerificationInProgress ? "Listening..." : "Verify Voice Phrase") : "Microphone Verified")
                              : setupStep === "screen" 
                                ? "Initiate Screen Share" 
                                : "System Hardware Verified"}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={startInterview}
                    disabled={!canStart || startingInterview}
                    className="flex-1 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-sm font-bold text-white px-4 py-4 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center gap-2 shadow-[0_4px_20px_rgba(99,102,241,0.25)] hover:shadow-[0_4px_30px_rgba(99,102,241,0.4)] select-none animate-pulse"
                    style={{ animationDuration: "2s" }}
                  >
                    <span>{startingInterview ? "Launching..." : "Launch AI Interview"}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                {setupStep === "camera" && cameraOn && (
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-3 text-xs text-slate-300">
                    <p className="font-semibold text-indigo-300">Camera Identity Check</p>
                    <p className="mt-1 text-slate-400">Capture {CAMERA_VERIFICATION_PHOTO_COUNT} photos to confirm a live candidate.</p>
                    <p className="mt-1 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-amber-300">
                      Guidance: {CAMERA_POSE_GUIDES[cameraPoseGuideIdx]}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {Array.from({ length: CAMERA_VERIFICATION_PHOTO_COUNT }).map((_, idx) => (
                        <div key={idx} className="h-16 w-24 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                          {cameraSnapshots[idx] ? (
                            <img src={cameraSnapshots[idx]} alt={`Verification ${idx + 1}`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">Photo {idx + 1}</div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void captureCameraVerificationPhoto()}
                        disabled={cameraSnapshots.length >= CAMERA_VERIFICATION_PHOTO_COUNT}
                        className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-300 disabled:opacity-40"
                      >
                        Capture Photo
                      </button>
                      <button
                        type="button"
                        onClick={retakeCameraVerification}
                        className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                      >
                        Retake
                      </button>
                      {cameraIdentityVerified && <span className="text-emerald-400 text-[11px] font-semibold">Verified</span>}
                    </div>
                    {cameraVerificationHint && <p className="mt-1 text-[11px] text-rose-400">{cameraVerificationHint}</p>}
                  </div>
                )}

                {setupStep === "microphone" && micOn && (
                  <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.03] p-3 text-xs text-slate-300">
                    <p className="font-semibold text-indigo-300">Microphone Voice Verification</p>
                    <p className="mt-1 text-slate-400">Read this phrase exactly:</p>
                    <p className="mt-1 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 text-[12px] text-slate-200">
                      "{micVerificationPhrase}"
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={startMicVerification}
                        disabled={micVerificationInProgress}
                        className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-300 disabled:opacity-40"
                      >
                        {micVerificationInProgress ? "Listening..." : "Start Voice Check"}
                      </button>
                      <button
                        type="button"
                        onClick={nextMicPhrase}
                        className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300"
                      >
                        New Phrase
                      </button>
                      {micIdentityVerified && <span className="text-emerald-400 text-[11px] font-semibold">Verified</span>}
                    </div>
                    <div className="mt-2">
                      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
                        <span>Mic Input Level</span>
                        <span>{Math.round(micLevel)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10">
                        <div className="h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-all" style={{ width: `${Math.max(2, micLevel)}%` }} />
                      </div>
                    </div>
                    {micVerificationTranscript && (
                      <p className="mt-2 text-[11px] text-slate-400">You said: "{micVerificationTranscript}"</p>
                    )}
                    {micVerificationScore > 0 && (
                      <p className={`mt-1 text-[11px] ${micVerificationScore >= 0.65 ? "text-emerald-400" : "text-amber-400"}`}>
                        Phrase match score: {Math.round(micVerificationScore * 100)}%
                      </p>
                    )}
                    {micVerificationError && (
                      <p className="mt-1 text-[11px] text-rose-400">{micVerificationError}</p>
                    )}
                  </div>
                )}

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
              <video ref={screenVideoRef} autoPlay muted playsInline className="hidden" />

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
                {(faceViolationCountdown !== null || securityCountdown !== null || tabCountdown !== null || screenViolationCountdown !== null || lipSyncViolationCountdown !== null || cameraFreezeCountdown !== null) && (
                  <div className="absolute inset-x-0 top-0 z-50">
                    {faceViolationCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-orange-600/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">⚠️</span>
                        <span>FACE VISIBILITY WARNING — Keep your face clearly visible in {faceViolationCountdown}s.</span>
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
                        <span>TAB SWITCH DETECTED — Return to interview in {tabCountdown}s.</span>
                      </div>
                    )}
                    {screenViolationCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-rose-700/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">🚨</span>
                        <span>SCREEN SWITCHING DETECTED — Return to a stable screen in {screenViolationCountdown}s.</span>
                      </div>
                    )}
                    {lipSyncViolationCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-rose-700/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">🚨</span>
                        <span>SPEECH/LIP MISMATCH DETECTED — Speak clearly while face is visible in {lipSyncViolationCountdown}s.</span>
                      </div>
                    )}
                    {cameraFreezeCountdown !== null && (
                      <div className="flex items-center justify-center gap-3 bg-rose-700/95 px-6 py-3 text-sm font-bold text-white backdrop-blur-md shadow-2xl">
                        <span className="animate-pulse text-lg">🚨</span>
                        <span>STATIC CAMERA FEED DETECTED — Move naturally while speaking in {cameraFreezeCountdown}s.</span>
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
                    { label: "Camera Motion", ok: !cameraFreezeSuspicious, icon: "🎥" },
                    { label: "Microphone Active", ok: micOn, icon: "🎤" },
                    { label: "Voice Match", ok: !voiceMismatchSuspicious, icon: "🧬" },
                    { label: "Speech-Lip Sync", ok: !lipSyncSuspicious, icon: "🗣" },
                    { label: "Screen Sharing", ok: sharingScreen, icon: "🖥" },
                    { label: "Screen Stability", ok: screenViolationCountdown === null, icon: "🧭" },
                    { label: "Internet Stable", ok: internetQuality === "good", icon: "🌐" },
                    { label: "Tab Focus", ok: tabCountdown === null, icon: "🖱" },
                    { label: "Realtime Link", ok: wsConnected, icon: "⚡" },
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
                {listening && (
                  <div className="mt-2 rounded-lg bg-sky-900/20 border border-sky-500/20 px-3 py-2 text-xs text-sky-300">
                    Lip motion signal: {mouthMotionLevel.toFixed(2)}
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

              {securityChallenge && (
                <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Random Security Challenge</p>
                  <p className="mt-2 text-sm text-amber-100">{securityChallenge.prompt}</p>
                  <p className="mt-1 text-xs text-amber-300">
                    Complete within {Math.max(0, Math.floor((securityChallenge.expiresAt - Date.now()) / 1000))}s
                  </p>
                  <button
                    type="button"
                    onClick={() => void completeSecurityChallenge()}
                    className="mt-3 w-full rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/30"
                  >
                    Challenge Completed
                  </button>
                </div>
              )}

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
