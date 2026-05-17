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
type Turn = { role: "assistant" | "candidate"; content: string; analysis?: string; score?: number; confidence_score?: number; communication_score?: number; technical_depth_score?: number; authenticity_score?: number };
type SetupStep = "camera" | "microphone" | "screen" | "ready";

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
  const [securityEvents, setSecurityEvents] = useState<{time: string; event: string}[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const noSpeechRetryRef = useRef(0);
  const listeningRef = useRef(false);
  const tabTimerRef = useRef<number | null>(null);
  const faceTimerRef = useRef<number | null>(null);
  const faceCheckRef = useRef<number | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const prevScreenShotRef = useRef<string | null>(null);
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
    if (status !== "in_progress" || cheatingTagged) return;
    const nonCompliant = !cameraOn || !micOn || !sharingScreen || internetQuality !== "good";
    if (!nonCompliant) {
      setSecurityCountdown(null);
      return;
    }

    stopListening();
    setMessage("Security alert: restore camera, microphone, screen share, and stable internet within 10 seconds.");
    setSecurityCountdown(10);
    const timer = window.setInterval(() => {
      setSecurityCountdown((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(timer);
          setCheatingTagged(true);
          void saveTurn("assistant", "Cheating detected: required device/internet compliance broken for more than 10 seconds.");
          setMessage("Interview ended: Cheating detected due to compliance break >10 seconds.");
          void endInterview();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
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
      tabTimerRef.current = window.setInterval(() => {
        setTabCountdown((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            if (tabTimerRef.current) {
              window.clearInterval(tabTimerRef.current);
              tabTimerRef.current = null;
            }
            setCheatingTagged(true);
            void saveTurn("assistant", "Cheating detected: candidate moved away from interview tab for more than 10 seconds.");
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

    function addSecurityEvent(evt: string) {
      const now = new Date().toLocaleTimeString();
      setSecurityEvents(prev => [{time: now, event: evt}, ...prev].slice(0, 20));
    }

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
      for (let by = 0; by < 4; by++) {
        for (let bx = 0; bx < 4; bx++) {
          let sum = 0, count = 0;
          for (let y = by * 15; y < (by + 1) * 15; y++) {
            for (let x = bx * 20; x < (bx + 1) * 20; x++) {
              const i = (y * 80 + x) * 4;
              sum += data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
              count++;
            }
          }
          blockBrightness.push(sum / count);
        }
      }

      const mean = blockBrightness.reduce((a, b) => a + b, 0) / blockBrightness.length;
      const variance = blockBrightness.reduce((a, b) => a + (b - mean) ** 2, 0) / blockBrightness.length;

      // A face requires:
      //  1. Sufficient scene brightness (mean > 20) — catches covered/dark camera
      //  2. Brightness variation (variance > 150) — catches blank walls / solid backgrounds
      //  3. Some pixels brighter than 60 (catches pure black frames)
      const brightPixels = blockBrightness.filter(b => b > 60).length;
      const hasFace = mean > 20 && variance > 150 && brightPixels >= 4;

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
          addSecurityEvent("Face not visible in camera");
          lastLoggedNoFace = true;
        }
      }
    }

    faceCheckRef.current = requestAnimationFrame(checkFrame);
    return () => { if (faceCheckRef.current) cancelAnimationFrame(faceCheckRef.current); };
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
          void saveTurn("assistant", "Cheating detected: face violation — no face or multiple faces for >10 seconds.");
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
      const shot = canvas.toDataURL("image/jpeg", 0.1);
      if (prevScreenShotRef.current && prevScreenShotRef.current !== shot) {
        setScreenChanged(true);
        const now = new Date().toLocaleTimeString();
        setSecurityEvents(prev => [{time: now, event: "Screen content changed"}, ...prev].slice(0, 20));
      }
      prevScreenShotRef.current = shot;
    }, 3000);

    screenVideo.play().catch(() => {});
    return () => { if (screenCheckIntervalRef.current) window.clearInterval(screenCheckIntervalRef.current); };
  }, [status, cheatingTagged, sharingScreen]);

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
      const res = await fetchWithFallback(`/interviews/${interviewId}/turns`);
      if (!res.ok) return [];
      const parsed = await readJsonSafe(res);
      if (!parsed.ok) return [];
      const payload = parsed.data;
      const turns: Turn[] = (payload || []).map((t: { role: "assistant" | "candidate"; content: string; analysis: string; score: number; confidence_score?: number; communication_score?: number; technical_depth_score?: number; authenticity_score?: number }) => ({
        role: t.role,
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

  async function saveTurn(role: "assistant" | "candidate", content: string): Promise<Turn | null> {
    try {
      const res = await fetchWithFallback(`/interviews/${interviewId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content }),
      });
      if (!res.ok) return null;
      const parsed = await readJsonSafe(res);
      if (!parsed.ok) return null;
      const payload = parsed.data;
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

  async function verifyCameraStep() {
    setMessage("");
    setCheckState("checking");
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      userStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      userStreamRef.current = camStream;
      attachUserStreamToVideo(camStream);
      camStream.getVideoTracks().forEach((track) => {
        track.onended = () => setCameraOn(false);
      });
      setCameraOn(true);
      setCheckState("passed");
      setSetupStep("microphone");
      setMessage("Camera access granted. Next: allow microphone.");
    } catch {
      setCheckState("failed");
      setMessage("Camera permission denied.");
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
        track.onended = () => setMicOn(false);
      });
      userStreamRef.current = combined;
      attachUserStreamToVideo(combined);
      setMicOn(true);
      setCheckState("passed");
      setSetupStep("screen");
      setMessage("Microphone access granted. Next: allow screen share.");
    } catch {
      setCheckState("failed");
      setMessage("Microphone permission denied.");
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
        };
      });
      setSharingScreen(true);
      setCheckState("passed");
      setSetupStep("ready");
      setMessage("Screen share granted. You can now start the interview.");
    } catch {
      setCheckState("failed");
      setMessage("Screen share permission denied.");
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
      <main className="mx-auto min-h-screen max-w-[1750px] bg-[#f3f8fa] p-5 md:p-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">Loading interview session...</section>
      </main>
    );
  }

  if (status !== "in_progress") {
    return (
      <main className="mx-auto min-h-screen max-w-[900px] bg-[#f3f8fa] p-5 md:p-10">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Kovidam AI Interview</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Before Interview Starts</h1>
          <p className="mt-2 text-sm text-slate-500">Session ID: {sessionId}</p>
          <p className="mt-1 text-sm text-slate-500">Candidate: {candidateName} • {candidateEmail}</p>
          <p className="mt-1 text-sm text-slate-500">Role: {jobTitle}</p>

          <div className="mt-6 grid grid-cols-1 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-slate-800">Live Camera Preview</p>
              <div className="relative aspect-video overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
                <video ref={userVideoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
                {!cameraOn ? (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-200">
                    Camera preview appears here after permission
                  </div>
                ) : null}
              </div>
            </div>
            <div className={`rounded-xl border p-4 ${setupStep === "camera" ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
              <p className="font-semibold text-slate-800">Step 1: Camera Access</p>
              <p className="mt-1 text-sm text-slate-500">{cameraOn ? "Granted" : "Required before interview can start."}</p>
            </div>
            <div className={`rounded-xl border p-4 ${setupStep === "microphone" ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
              <p className="font-semibold text-slate-800">Step 2: Microphone Access</p>
              <p className="mt-1 text-sm text-slate-500">{micOn ? "Granted" : "Required after camera step."}</p>
            </div>
            <div className={`rounded-xl border p-4 ${setupStep === "screen" ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-slate-50"}`}>
              <p className="font-semibold text-slate-800">Step 3: Screen Share</p>
              <p className="mt-1 text-sm text-slate-500">{sharingScreen ? "Granted" : "Required after microphone step."}</p>
            </div>
            <div className={`rounded-xl border p-4 ${setupStep === "ready" ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
              <p className="font-semibold text-slate-800">Step 4: Start Interview</p>
              <p className="mt-1 text-sm text-slate-500">
                Internet: {internetQuality === "good" ? "Stable" : internetQuality === "unstable" ? "Unstable" : "Offline"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <button onClick={runDeviceCheck} className="rounded-lg bg-slate-100 px-3 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
              {checkState === "checking"
                ? "Checking..."
                : setupStep === "camera"
                  ? "Allow Camera"
                  : setupStep === "microphone"
                    ? "Allow Microphone"
                    : setupStep === "screen"
                      ? "Allow Screen Share"
                      : "Checks Complete"}
            </button>
            <button
              onClick={startInterview}
              disabled={!canStart}
              className="rounded-lg bg-teal-500 px-3 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start Interview
            </button>
          </div>

          {startBlockReason ? <p className="mt-3 text-sm text-amber-600">{startBlockReason}</p> : null}
          {message ? <p className="mt-2 text-sm text-slate-600">{message}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-[1750px] bg-[#f3f8fa] p-5 md:p-6">
      <div className="grid grid-cols-[56px_1fr] gap-4 md:gap-6">
        <aside className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white py-4 shadow-sm">
          <div className="mb-5 h-9 w-9 rounded-xl bg-gradient-to-br from-accent to-accent2" />
          {NAV_ITEMS.map((item, idx) => (
            <button
              key={item}
              onClick={() => goToSection(item)}
              className={`mb-3 h-10 w-10 rounded-xl text-xs ring-1 transition ${navActive === item ? "bg-gradient-to-br from-teal-600 to-cyan-500 text-white ring-teal-400/60" : "bg-slate-100 text-slate-500 ring-slate-200 hover:ring-teal-300"}`}
              title={item}
            >
              {idx + 1}
            </button>
          ))}
          <div className="mt-auto h-9 w-9 rounded-full bg-panel/70 ring-1 ring-muted/30" />
        </aside>

        <section className="space-y-4 md:space-y-6">
          <header id="topbar" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
            <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Kovidam AI Interview</p>
                <div className="mt-2 flex items-center gap-3">
                  <h1 className="text-3xl font-semibold text-slate-900">AI Interview Session</h1>
                  <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-sm text-emerald-700">
                    Live
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">Session ID: {sessionId}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="text-xs uppercase tracking-[0.15em] text-slate-400">Environment</p>
                <p className="mt-1 font-medium">
                  {cameraOn ? "Webcam" : "Webcam Off"} + {micOn ? "Mic" : "Mic Off"} +{" "}
                  {internetQuality === "good" ? "Stable Internet" : internetQuality === "unstable" ? "Internet Unstable" : "Internet Offline"}
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

          {/* PREMIUM STUDIO LAYOUT */}
          <div className="flex flex-1 gap-5 overflow-hidden">

            {/* LEFT PANEL */}
            <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto">

              {/* Interview Progress */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Progress</h3>
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">{progress}%</span>
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
                        <p className="font-medium text-slate-600">{step.label}</p>
                        <p className="text-slate-400">{step.pct}%</p>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-gradient-to-r from-teal-400 to-cyan-500 transition-all duration-500" style={{ width: `${step.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Live Transcript */}
              <div className="flex flex-1 flex-col rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Transcript</h3>
                  <span className="h-2 w-2 animate-pulse rounded-full bg-teal-400"></span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[340px]">
                  {history.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center mt-8">Conversation will appear here...</p>
                  ) : history.map((turn, idx) => (
                    <div key={`${turn.role}-${idx}`} className={`rounded-xl p-3 text-xs ${turn.role === "assistant" ? "bg-slate-50 border border-slate-100" : "bg-teal-50 border border-teal-100 ml-4"}`}>
                      <p className={`mb-1 font-bold uppercase tracking-wider text-[10px] ${turn.role === "assistant" ? "text-slate-400" : "text-teal-600"}`}>
                        {turn.role === "assistant" ? "🤖 AI" : "👤 You"}
                      </p>
                      <p className="leading-relaxed text-slate-700">{turn.content}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Security Event Log */}
              <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Security Log</h3>
                  <span className={`h-2 w-2 rounded-full ${securityEvents.length > 0 ? "bg-rose-400 animate-pulse" : "bg-emerald-400"}`}></span>
                </div>
                <div className="max-h-36 overflow-y-auto p-3 space-y-1">
                  {securityEvents.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2 text-center">No violations detected</p>
                  ) : securityEvents.map((evt, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 text-rose-400">⚠</span>
                      <span className="text-slate-500">[{evt.time}] {evt.event}</span>
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
              <div className="relative flex-1 overflow-hidden rounded-3xl bg-slate-950 shadow-2xl min-h-[520px]">
                {/* AI Avatar Background */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(20,184,166,0.08),transparent_60%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_80%,rgba(59,130,246,0.06),transparent_60%)]" />

                  {/* Avatar orb */}
                  <div className="relative flex h-52 w-52 items-center justify-center">
                    <div className={`absolute inset-0 rounded-full transition-all duration-500 ${loadingQuestion ? "animate-spin" : ""}`}
                      style={{ background: "conic-gradient(from 0deg, rgba(20,184,166,0.3), rgba(59,130,246,0.1), rgba(20,184,166,0.3))" }} />
                    <div className="absolute inset-3 animate-pulse rounded-full bg-teal-500/10 blur-xl" />
                    <div className="absolute inset-6 rounded-full bg-gradient-to-br from-teal-400/20 to-blue-500/20 backdrop-blur-sm ring-1 ring-teal-400/30" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex items-end gap-1.5">
                        {Array.from({ length: 7 }).map((_, i) => (
                          <div key={i} className="w-1.5 rounded-full bg-gradient-to-t from-teal-400 to-cyan-300 shadow-lg shadow-teal-400/30"
                            style={{ height: listening ? `${8 + Math.random() * 20}px` : `${10 + (i % 4) * 10}px`, animation: `pulse ${0.5 + i * 0.1}s ease-in-out infinite alternate`, transition: "height 0.15s" }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-8 text-center">
                    <p className="text-lg font-light tracking-wide text-white/90">
                      {listening ? "Listening..." : loadingQuestion ? "Generating next question..." : message || "AI Interviewer"}
                    </p>
                    <p className="mt-1 text-sm text-white/40">Kovidam AI • {jobTitle}</p>
                  </div>
                </div>

                {/* Top bar */}
                <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur-xl ring-1 ring-white/10">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400"></span>
                      AI Interviewer • Live
                    </div>
                    <div className="rounded-full bg-black/40 px-3 py-2 text-xs font-mono text-white/70 backdrop-blur-xl ring-1 ring-white/10">
                      {formatClock(elapsedSec)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl ring-1 ${faceVisible ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30" : "bg-rose-500/30 text-rose-300 ring-rose-500/30 animate-pulse"}`}>
                      {faceVisible ? "✓ Face OK" : "⚠ No Face"}
                    </div>
                    <div className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl ring-1 ${sharingScreen ? "bg-teal-500/20 text-teal-300 ring-teal-500/30" : "bg-rose-500/30 text-rose-300 ring-rose-500/30"}`}>
                      {sharingScreen ? "✓ Screen" : "⚠ No Screen"}
                    </div>
                    <div className={`rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur-xl ring-1 ${internetQuality === "good" ? "bg-emerald-500/20 text-emerald-300 ring-emerald-500/30" : "bg-rose-500/30 text-rose-300 ring-rose-500/30 animate-pulse"}`}>
                      {internetQuality === "good" ? "✓ Stable" : "⚠ " + internetQuality}
                    </div>
                  </div>
                </div>

                {/* PiP candidate video */}
                <div className="absolute bottom-24 right-5 w-56 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl ring-1 ring-white/5">
                  <video ref={userVideoRef} autoPlay muted playsInline className="h-full w-full object-cover aspect-video" />
                  {!cameraOn && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/95 text-xs text-white/50">Camera off</div>
                  )}
                  {/* Face detection indicator on PiP */}
                  <div className={`absolute inset-0 rounded-2xl ring-2 transition-all ${!faceVisible ? "ring-rose-500 animate-pulse" : "ring-transparent"}`} />
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                    <p className="text-xs font-medium text-white">{candidateName}</p>
                  </div>
                </div>

                {/* Bottom controls */}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 p-6">
                  <div className="flex items-center gap-3 rounded-2xl bg-black/60 px-6 py-3 backdrop-blur-xl ring-1 ring-white/10 shadow-2xl">
                    <button onClick={toggleMic} title="Microphone" className={`group relative flex h-12 w-12 items-center justify-center rounded-xl transition-all ${micOn ? "bg-white/10 text-white hover:bg-white/20" : "bg-rose-500 text-white"}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{micOn ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /> : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></>}</svg>
                    </button>
                    <button onClick={toggleCamera} title="Camera" className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all ${cameraOn ? "bg-white/10 text-white hover:bg-white/20" : "bg-rose-500 text-white"}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </button>
                    <button onClick={toggleScreenShare} title="Screen Share" className={`flex h-12 w-12 items-center justify-center rounded-xl transition-all ${sharingScreen ? "bg-teal-500/30 text-teal-300 ring-1 ring-teal-400/40" : "bg-white/10 text-white/60 hover:bg-white/20"}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    </button>
                    <div className="h-8 w-px bg-white/10" />
                    <button onClick={startListening} disabled={listening || loadingQuestion || !micOn} className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/20 text-teal-300 ring-1 ring-teal-400/30 transition hover:bg-teal-500/30 disabled:opacity-40">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
                    </button>
                    <div className="h-8 w-px bg-white/10" />
                    <button onClick={endInterview} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-rose-900/30 transition hover:bg-rose-700">
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
                <input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} className="rounded" />
                Auto-listen after AI speaks
                {listening && <span className="ml-2 inline-flex items-center gap-1 text-teal-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />Listening...</span>}
                {loadingQuestion && <span className="ml-2 text-slate-400">Generating question...</span>}
              </label>
            </div>

            {/* RIGHT PANEL */}
            <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto">

              {/* Live Security Status */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
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
                    <div key={label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
                        <span>{icon}</span>{label}
                      </div>
                      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-rose-400 animate-pulse"}`} />
                    </div>
                  ))}
                </div>
                {screenChanged && (
                  <div className="mt-3 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2 text-xs text-orange-700">
                    ⚠ Screen content change detected
                  </div>
                )}
              </div>

              {/* Current Question */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <span className="h-2 w-2 rounded-full bg-teal-400"></span>
                  <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Current Question</h3>
                </div>
                <p className="rounded-xl bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-100 p-4 text-sm leading-relaxed text-slate-800">{currentQuestion}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">⏱ {formatClock(elapsedSec)}</span>
                  <button onClick={() => setShowQuestionDetails(v => !v)} className="text-xs text-teal-600 hover:underline">{showQuestionDetails ? "Hide" : "Details"}</button>
                </div>
                {showQuestionDetails && (
                  <p className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-3">AI-generated from your resume context. Expects depth, trade-offs, and real examples.</p>
                )}
              </div>

              {/* AI Scoring */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-4">Live Scoring</h3>
                <div className="space-y-3">
                  {[
                    { label: "Communication", score: liveScores.communication, color: "from-blue-400 to-cyan-500" },
                    { label: "Confidence", score: liveScores.confidence, color: "from-violet-400 to-purple-500" },
                    { label: "Technical Depth", score: liveScores.technical, color: "from-teal-400 to-emerald-500" },
                    { label: "Authenticity", score: liveScores.authenticity, color: "from-amber-400 to-orange-500" },
                  ].map(({ label, score, color }) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-500">{label}</span>
                        <span className={`font-semibold ${score >= 7 ? "text-emerald-600" : score >= 5 ? "text-amber-600" : score > 0 ? "text-rose-500" : "text-slate-300"}`}>
                          {score > 0 ? `${score.toFixed(1)}/10` : "–"}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100">
                        <div className={`h-2 rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: score > 0 ? `${score * 10}%` : "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
                {lastAnalysis && <p className="mt-3 text-xs text-emerald-700 bg-emerald-50 rounded-lg p-3 border border-emerald-100 leading-relaxed">{lastAnalysis}</p>}
                {liveScores.communication === 0 && <p className="mt-2 text-xs text-slate-400 text-center">Scores update after each answer</p>}
              </div>

              {/* Voice Control */}
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 mb-3">Voice</h3>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={startListening} disabled={listening || loadingQuestion || !micOn} className="rounded-xl bg-teal-500 px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-teal-600 disabled:opacity-40">
                    {listening ? "Listening..." : "Answer"}
                  </button>
                  <button onClick={stopListening} disabled={!listening} className="rounded-xl bg-slate-100 px-3 py-2.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-200 disabled:opacity-40">
                    Stop
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-400">{candidateName} • {jobTitle}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

