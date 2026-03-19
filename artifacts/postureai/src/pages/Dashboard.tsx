import { useEffect, useRef, useState, useCallback } from "react";
import ScoreRing from "@/components/ScoreRing";
import HistoryChart, { SessionRecord } from "@/components/HistoryChart";

declare global {
  interface Window {
    initPostureCV?: (video: HTMLVideoElement, canvas: HTMLCanvasElement) => void;
  }
}

function getFixTip(statusText: string): string {
  const s = statusText.toLowerCase();
  if (s.includes("forward") || s.includes("chin"))
    return "Pull your head back gently — ears should be directly above your shoulders";
  if (s.includes("neck") || s.includes("tilt"))
    return "Level your head — imagine balancing a book on top of it";
  if (s.includes("shoulder"))
    return "Relax both shoulders down and back equally";
  if (s.includes("spine") || s.includes("back") || s.includes("slouch"))
    return "Sit tall from your hips, not your shoulders. Light core engagement helps.";
  if (s.includes("good") || s.includes("excellent"))
    return "Great posture! Keep your screen at eye level and stay relaxed.";
  return "Adjust your position and take a slow breath.";
}

const SESSIONS_KEY = "postureai_sessions";

function loadSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionRecord[];
  } catch {
    return [];
  }
}

function saveSession(session: SessionRecord) {
  const sessions = loadSessions();
  sessions.unshift(session);
  const trimmed = sessions.slice(0, 30);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
}

export default function Dashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraStatus, setCameraStatus] = useState<"loading" | "ready" | "error">("loading");
  const [cameraMessage, setCameraMessage] = useState("Getting camera ready...");
  const [isMuted, setIsMuted] = useState(false);
  const [mode, setMode] = useState<"relaxed" | "focus">(() =>
    (localStorage.getItem("postureai_mode") as any) || "relaxed"
  );

  const [displayScore, setDisplayScore] = useState(100);
  const [statusText, setStatusText] = useState("Good posture");
  const [metrics, setMetrics] = useState({ neck: 0, shoulder: 0, spine: 0 });

  const [slouchSeconds, setSlouchSeconds] = useState(0);
  const [isAway, setIsAway] = useState(false);
  const [welcomeBack, setWelcomeBack] = useState("");
  const [showBreakReminder, setShowBreakReminder] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<{
    duration: number;
    goodPercent: number;
    worstIssue: string;
    tip: string;
    bestScore: number;
  } | null>(null);

  const [sessions, setSessions] = useState<SessionRecord[]>(() => loadSessions());
  const [showHistory, setShowHistory] = useState(false);

  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem("postureai_welcomed")
  );

  const slouchRef = useRef(0);
  const lastColorRef = useRef("green");
  const rollingScoreRef = useRef<number[]>([]);
  const scoreBuffer = useRef<number[]>([]);
  const noDetectionRef = useRef(0);
  const awayRef = useRef(0);
  const isAwayRef = useRef(false);
  const statusTextRef = useRef("Good posture");
  const summaryShownRef = useRef(false);

  function generateSummary() {
    const buf = scoreBuffer.current;
    if (buf.length < 10) return;
    const goodCount = buf.filter((s) => s >= 70).length;
    const goodPercent = Math.round((goodCount / buf.length) * 100);
    const bestScore = Math.max(...buf);
    const worstIssue = statusTextRef.current;
    const tip = getFixTip(worstIssue);
    const dur = sessionElapsed;

    const record: SessionRecord = {
      id: Date.now().toString(),
      score: Math.round(buf.reduce((a, b) => a + b, 0) / buf.length),
      goodPercent,
      duration: dur,
      createdAt: new Date().toISOString(),
    };
    saveSession(record);
    setSessions(loadSessions());

    setSummary({ duration: dur, goodPercent, worstIssue, tip, bestScore });
    setShowSummary(true);
  }

  const handleTick = useCallback((e: Event) => {
    const d = (e as CustomEvent).detail;

    if (!d.detected || d.status === "NO_POSE" || d.composite === 0) {
      noDetectionRef.current += 1;
      if (noDetectionRef.current >= 30) {
        if (!isAwayRef.current) {
          isAwayRef.current = true;
          setIsAway(true);
        }
        awayRef.current += 1;
      }
      return;
    }

    if (isAwayRef.current) {
      const minsAway = Math.round(awayRef.current / 60);
      setWelcomeBack(
        `Welcome back! You were away ${minsAway > 0 ? minsAway + " min" : "a moment"}.`
      );
      setTimeout(() => setWelcomeBack(""), 5000);
      slouchRef.current = 0;
      awayRef.current = 0;
      isAwayRef.current = false;
      setIsAway(false);
    }
    noDetectionRef.current = 0;

    rollingScoreRef.current.push(d.composite);
    if (rollingScoreRef.current.length > 300) {
      rollingScoreRef.current.shift();
    }
    const avg = Math.round(
      rollingScoreRef.current.reduce((a: number, b: number) => a + b, 0) /
        rollingScoreRef.current.length
    );
    setDisplayScore(avg);

    scoreBuffer.current.push(d.composite);

    if (d.color === "red") {
      slouchRef.current += 1;
    } else {
      slouchRef.current = 0;
    }
    setSlouchSeconds(slouchRef.current);
    lastColorRef.current = d.color;

    setStatusText(d.status || "Good posture");
    statusTextRef.current = d.status || "Good posture";

    setMetrics({
      neck: d.neckTilt ?? 0,
      shoulder: d.shoulderAlign ?? 0,
      spine: d.spineTilt ?? 0,
    });
  }, []);

  useEffect(() => {
    window.addEventListener("posture-tick", handleTick);
    return () => window.removeEventListener("posture-tick", handleTick);
  }, [handleTick]);

  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            setCameraStatus("ready");
            setCameraMessage("Camera running — sit in frame");
            if (window.initPostureCV && videoRef.current && canvasRef.current) {
              window.initPostureCV(videoRef.current, canvasRef.current);
            }
          };
        }
      } catch (err: any) {
        setCameraStatus("error");
        setCameraMessage("Camera error: " + (err.message || "Permission denied"));
      }
    }

    startCamera();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setSessionElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (sessionElapsed > 0 && sessionElapsed % 2700 === 0) {
      setShowBreakReminder(true);
    }
  }, [sessionElapsed]);

  useEffect(() => {
    if (sessionElapsed >= 3600 && !summaryShownRef.current) {
      summaryShownRef.current = true;
      generateSummary();
    }
  }, [sessionElapsed]);

  useEffect(() => {
    const handler = () => generateSummary();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const threshold = mode === "relaxed" ? 480 : 120;
  const isAlerting = slouchSeconds >= threshold;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const metricConfig = [
    { label: "NECK TILT", value: metrics.neck, thresholds: [10, 20], unit: "°" },
    { label: "SHOULDER ALIGN", value: metrics.shoulder, thresholds: [5, 10], unit: "°" },
    { label: "SPINE TILT", value: metrics.spine, thresholds: [5, 10], unit: "°" },
  ];

  return (
    <div
      className="min-h-screen font-mono flex flex-col"
      style={{ background: "#0a0a1a", color: "#e2e8f0" }}
    >
      {/* Welcome banner */}
      {showWelcome && (
        <div className="w-full px-5 py-4 flex items-start justify-between gap-4"
          style={{ background: "#7c3aed15", borderBottom: "1px solid #7c3aed55" }}>
          <div>
            <p className="text-[#a855f7] font-bold text-sm mb-1">Welcome to PostureAI</p>
            <p className="text-[#a0a0c0] text-xs leading-relaxed">
              Sit so your full upper body is visible in the camera. Keep your screen at eye level.
              We track quietly — you'll only be nudged if you've been slouching for several minutes
              continuously. We never record video. Ever.
            </p>
          </div>
          <button
            onClick={() => {
              localStorage.setItem("postureai_welcomed", "true");
              setShowWelcome(false);
            }}
            className="text-xs px-3 py-1 text-[#7c3aed] hover:bg-[#7c3aed22] transition-colors whitespace-nowrap flex-shrink-0"
            style={{ border: "1px solid #7c3aed55" }}
          >
            Got it
          </button>
        </div>
      )}

      {/* Welcome back banner */}
      {welcomeBack && (
        <div className="w-full px-4 py-2 text-sm font-bold tracking-wide text-center"
          style={{ background: "#10b98115", border: "none", borderBottom: "1px solid #10b981", color: "#10b981" }}>
          {welcomeBack}
        </div>
      )}

      {/* Break reminder */}
      {showBreakReminder && (
        <div className="w-full px-5 py-3 flex items-center justify-between"
          style={{ background: "#f59e0b15", borderBottom: "1px solid #f59e0b" }}>
          <p className="text-[#f59e0b] text-sm font-bold">
            You've been sitting for 45 minutes. Stand up, stretch, and walk for 2 minutes.
          </p>
          <button
            onClick={() => setShowBreakReminder(false)}
            className="text-[#f59e0b] text-xs px-3 py-1 hover:bg-[#f59e0b22] transition-colors ml-4 flex-shrink-0"
            style={{ border: "1px solid #f59e0b55" }}
          >
            Done
          </button>
        </div>
      )}

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4"
        style={{ borderBottom: "1px solid #1e1e3a" }}>
        <div>
          <span className="text-[#a855f7] font-bold tracking-widest text-sm">POSTUREAI</span>
          <span className="text-[#3b3b5c] mx-2">—</span>
          <span className="text-[#4b5563] text-xs tracking-wide">Your personal posture coach</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#4b5563] text-xs tracking-widest font-mono">
            {formatTime(sessionElapsed)}
          </span>
          <button
            onClick={() => {
              const next = mode === "relaxed" ? "focus" : "relaxed";
              setMode(next);
              localStorage.setItem("postureai_mode", next);
            }}
            className="flex items-center gap-2 text-xs font-bold tracking-widest px-3 py-2 hover:text-[#a855f7] transition-colors"
            style={{ border: "1px solid #2a2a4a", background: "#111128", color: "#6b7280" }}
          >
            {mode === "relaxed" ? "RELAXED MODE" : "FOCUS MODE"}
          </button>
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="text-xs px-3 py-2 transition-colors"
            style={{
              border: "1px solid #2a2a4a",
              background: "#111128",
              color: isMuted ? "#ef4444" : "#6b7280",
            }}
          >
            {isMuted ? "MUTED" : "SOUND ON"}
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="text-xs px-3 py-2 transition-colors hover:text-[#a855f7]"
            style={{ border: "1px solid #2a2a4a", background: "#111128", color: "#6b7280" }}
          >
            SESSION HISTORY
          </button>
          <button
            onClick={() => setShowQR(true)}
            className="text-xs px-3 py-2 transition-colors hover:text-[#a855f7]"
            style={{ border: "1px solid #2a2a4a", background: "#111128", color: "#6b7280" }}
          >
            OPEN ON PHONE
          </button>
        </div>
      </header>

      {/* Alert Banner */}
      <div
        className="w-full px-5 py-3 text-sm font-bold tracking-wide"
        style={{
          background: isAlerting ? "#ef444415" : "#10b98115",
          borderBottom: `1px solid ${isAlerting ? "#ef4444" : "#10b981"}`,
          color: isAlerting ? "#ef4444" : "#10b981",
          display: isAway ? "none" : "block",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: isAlerting ? "#ef4444" : "#10b981" }}
          />
          {isAlerting ? statusText : "Posture looks good"}
        </div>
        {isAlerting && (
          <p className="text-xs opacity-75 mt-1 font-normal normal-case tracking-normal">
            {getFixTip(statusText)}
          </p>
        )}
      </div>

      {isAway && (
        <div
          className="w-full px-5 py-3 text-sm font-bold tracking-wide text-center"
          style={{ background: "#4b506315", borderBottom: "1px solid #4b5063", color: "#9ca3af" }}
        >
          Away from desk — tracking paused
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Camera feed */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="text-xs text-[#4b5563] tracking-widest font-bold">CAMERA FEED</div>
              <div
                className="relative overflow-hidden"
                style={{ background: "#0d0d1f", border: "1px solid #1e1e3a", borderRadius: 8 }}
              >
                {cameraStatus === "loading" && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="text-center">
                      <div
                        className="w-6 h-6 border-2 rounded-full mx-auto mb-3 animate-spin"
                        style={{ borderColor: "#2a2a4a", borderTopColor: "#a855f7" }}
                      />
                      <p className="text-xs text-[#6b7280]">Starting camera...</p>
                    </div>
                  </div>
                )}
                {cameraStatus === "error" && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <div className="text-center p-4">
                      <p className="text-[#ef4444] text-xs font-bold mb-1">Camera unavailable</p>
                      <p className="text-[#6b7280] text-xs">{cameraMessage}</p>
                    </div>
                  </div>
                )}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: "100%", display: "block", borderRadius: 8 }}
                />
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={480}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                  }}
                />
              </div>
              <p className="text-xs text-[#3b3b5c]">{cameraMessage}</p>

              {/* Live Readings */}
              <div>
                <div className="text-xs text-[#4b5563] tracking-widest font-bold mb-3">
                  LIVE READINGS
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {metricConfig.map(({ label, value, thresholds, unit }) => {
                    const dotColor =
                      value < thresholds[0]
                        ? "#10b981"
                        : value < thresholds[1]
                          ? "#f59e0b"
                          : "#ef4444";
                    const statusLabel =
                      value < thresholds[0]
                        ? "normal"
                        : value < thresholds[1]
                          ? "watch"
                          : "correct now";
                    return (
                      <div
                        key={label}
                        className="p-3 flex justify-between items-center"
                        style={{ background: "#111128", border: "1px solid #1e1e3a" }}
                      >
                        <div>
                          <span className="text-xs text-[#6b7280] tracking-widest">{label}</span>
                          <div className="text-[10px] mt-1" style={{ color: dotColor }}>
                            {statusLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: dotColor }}
                          />
                          <div className="text-lg font-bold text-[#a855f7]">
                            {value}
                            <span className="text-xs text-[#4b5563] ml-1">{unit}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-6">
              {/* Score */}
              <div
                className="p-5 flex flex-col items-center"
                style={{ background: "#111128", border: "1px solid #1e1e3a", borderRadius: 8 }}
              >
                <div className="text-xs text-[#4b5563] tracking-widest font-bold mb-4 self-start">
                  YOUR SCORE
                </div>
                <ScoreRing score={displayScore} size={160} />
                <div className="w-full mt-4 pt-4" style={{ borderTop: "1px solid #1e1e3a" }}>
                  <div className="flex justify-between text-xs text-[#4b5563]">
                    <span>Mode</span>
                    <span
                      className="font-bold"
                      style={{ color: mode === "focus" ? "#a855f7" : "#6b7280" }}
                    >
                      {mode === "focus" ? "FOCUS" : "RELAXED"}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-[#4b5563] mt-1">
                    <span>Alert after</span>
                    <span className="font-bold text-[#6b7280]">
                      {mode === "relaxed" ? "8 min" : "2 min"} slouch
                    </span>
                  </div>
                  {slouchSeconds > 0 && slouchSeconds < threshold && (
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-[#4b5563]">Slouch timer</span>
                      <span className="text-[#f59e0b] font-bold">
                        {formatTime(slouchSeconds)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* End session button */}
              <button
                onClick={() => generateSummary()}
                className="text-xs tracking-widest py-2 transition-colors hover:text-[#a855f7]"
                style={{ border: "1px solid #2a2a4a", background: "#111128", color: "#4b5563" }}
              >
                END SESSION
              </button>
            </div>
          </div>

          {/* History */}
          {showHistory && (
            <div className="mt-6">
              <div className="text-xs text-[#4b5563] tracking-widest font-bold mb-3">
                SESSION HISTORY
              </div>
              <div
                className="p-4"
                style={{ background: "#111128", border: "1px solid #1e1e3a", borderRadius: 8 }}
              >
                <HistoryChart sessions={sessions} />
                {sessions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {sessions.slice(0, 5).map((s) => (
                      <div
                        key={s.id}
                        className="flex justify-between items-center text-xs text-[#6b7280]"
                        style={{ borderBottom: "1px solid #1e1e3a", paddingBottom: 4 }}
                      >
                        <span>
                          {s.createdAt
                            ? new Date(s.createdAt).toLocaleString()
                            : "No date"}
                        </span>
                        <span className="text-[#a855f7] font-bold">Score: {s.score}</span>
                        <span className="text-[#10b981]">Good: {s.goodPercent}%</span>
                        <span>{Math.floor(s.duration / 60)} min</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* QR / Phone Modal */}
      {showQR && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#0a0a1aee" }}
          onClick={() => setShowQR(false)}
        >
          <div
            className="font-mono text-white p-8 max-w-sm w-full"
            style={{ background: "#111128", border: "1px solid #7c3aed", borderRadius: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[#a855f7] font-bold tracking-widest text-sm mb-4">
              Open on Your Phone
            </p>
            <div className="text-xs text-left space-y-3 text-[#a0a0c0] mb-5 w-full">
              <p className="text-[#10b981] font-bold">
                Make sure your phone is on the same WiFi as this laptop.
              </p>
              <p>
                <span className="text-[#7c3aed] font-bold">Step 1</span> — On Windows: open
                Command Prompt, type{" "}
                <span className="text-white font-mono">ipconfig</span>, find your IPv4 address
                (looks like 192.168.x.x)
              </p>
              <p>
                <span className="text-[#7c3aed] font-bold">Step 2</span> — On your phone browser,
                go to: <span className="text-white font-mono">YOUR_IP:5173</span>
              </p>
              <p>
                <span className="text-[#7c3aed] font-bold">Step 3</span> — Allow camera permission
                on phone
              </p>
              <p>
                <span className="text-[#7c3aed] font-bold">Step 4</span> — Place phone on table
                edge facing your side for best angle
              </p>
            </div>
            <button
              onClick={() => setShowQR(false)}
              className="w-full py-2 text-[#7c3aed] text-xs tracking-widest hover:bg-[#7c3aed22] transition-colors"
              style={{ border: "1px solid #7c3aed55" }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}

      {/* Session Summary Modal */}
      {showSummary && summary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "#0a0a1aee" }}
        >
          <div
            className="font-mono text-white p-8 max-w-sm w-full"
            style={{ background: "#111128", border: "1px solid #7c3aed", borderRadius: 12 }}
          >
            <p className="text-[#a855f7] font-bold tracking-widest text-sm mb-4">
              SESSION COMPLETE
            </p>
            <div className="space-y-3 text-sm mb-6">
              <p>
                Time tracked:{" "}
                <span className="text-[#a855f7] font-bold">
                  {Math.floor(summary.duration / 60)} min
                </span>
              </p>
              <p>
                Good posture:{" "}
                <span className="text-[#10b981] font-bold">{summary.goodPercent}% of session</span>
              </p>
              <p>
                Best score:{" "}
                <span className="text-[#a855f7] font-bold">{summary.bestScore}</span>
              </p>
              <p className="text-[#f59e0b]">Main issue: {summary.worstIssue}</p>
              <p className="text-[#6b7280] text-xs mt-2">
                Tip for next session: {summary.tip}
              </p>
            </div>
            <button
              onClick={() => setShowSummary(false)}
              className="w-full py-2 text-[#7c3aed] text-xs tracking-widest hover:bg-[#7c3aed22] transition-colors"
              style={{ border: "1px solid #7c3aed55" }}
            >
              CLOSE
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
