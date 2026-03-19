import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useSessions, useCreateSession } from "@/hooks/use-sessions";
import { ScoreRing } from "@/components/ScoreRing";
import { HistoryChart } from "@/components/HistoryChart";
import {
  Activity, Volume2, VolumeX, Smartphone,
  ChevronDown, ChevronUp, AlertCircle, CheckCircle, Clock, Target,
} from "lucide-react";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    initCV?: () => void;
    initScore?: () => void;
    setPostureAIMuted?: (muted: boolean) => void;
    setViewMode?: (mode: string) => void;
    postureCV?: { neckAngle: number; shoulderAngle: number; spineAngle: number };
  }
}

function getFixTip(s: string): string {
  const t = s.toLowerCase();
  if (t.includes("forward") || t.includes("chin")) return "Pull head back — ears above shoulders";
  if (t.includes("neck") || t.includes("tilt")) return "Level head — imagine a book on top";
  if (t.includes("shoulder")) return "Relax both shoulders down and back";
  if (t.includes("spine") || t.includes("torso") || t.includes("slouch")) return "Sit tall from hips, light core engagement";
  return "Adjust position and take a slow breath";
}

function getBreakTip(m: { neck: number; shoulder: number; spine: number }): string {
  if (m.neck > 20) return "Neck break — tuck chin, look 6m away 20 seconds";
  if (m.shoulder > 10) return "Roll shoulders back 5 times slowly";
  if (m.spine > 10) return "Stand up, hands on hips, arch back 10 seconds";
  return "Stand up and walk for 2 minutes";
}

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function ms(v: number, w: number, b: number) {
  if (v < w) return { c: "#10b981", l: "Good" };
  if (v < b) return { c: "#f59e0b", l: "Watch" };
  return { c: "#ef4444", l: "Fix now" };
}

export default function Dashboard() {
  const { data: sessions = [], isLoading } = useSessions();
  const { mutate: saveSession } = useCreateSession();

  const [displayScore, setDisplayScore] = useState(100);
  const [color, setColor] = useState<"green" | "yellow" | "red">("green");
  const [statusText, setStatusText] = useState("Waiting...");
  const [camStatus, setCamStatus] = useState("INITIALIZING");
  const [elapsed, setElapsed] = useState(0);
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);
  const [metrics, setMetrics] = useState({ neck: 0, shoulder: 0, spine: 0 });
  const [hasDetected, setHasDetected] = useState(false);
  const [slouchSecs, setSlouchSecs] = useState(0);
  const [mode, setMode] = useState<"relaxed" | "focus">(
    () => (localStorage.getItem("postureai_mode") as any) || "relaxed"
  );
  const [isMuted, setIsMuted] = useState(
    () => localStorage.getItem("postureai_sfx_muted") === "true"
  );
  const [showHistory, setShowHistory] = useState(false);
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem("postureai_welcomed")
  );
  const [welcomeBack, setWelcomeBack] = useState("");
  const [showBreak, setShowBreak] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [showPhone, setShowPhone] = useState(false);
  const [showCal, setShowCal] = useState(false);
  const [caling, setCaling] = useState(false);
  const [sideCon, setSideCon] = useState(false);
  const [fwdHead, setFwdHead] = useState(0);
  const [lumbar, setLumbar] = useState(100);
  const [viewMode, setViewModeState] = useState<"front" | "side">("front");

  const rollingRef = useRef<number[]>([]);
  const slouchRef = useRef(0);
  const noDetRef = useRef(0);
  const awayRef = useRef(0);
  const isAwayRef = useRef(false);
  const bufRef = useRef<number[]>([]);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const lastBreakRef = useRef(0);
  const sumDoneRef = useRef(false);
  const statusTextRef = useRef("Waiting...");

  // Spark line canvas
  useEffect(() => {
    const canvas = sparkRef.current;
    if (!canvas || scoreHistory.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const gap = 3;
    const bw = Math.max(4, Math.floor((W - gap * (scoreHistory.length - 1)) / scoreHistory.length));
    scoreHistory.forEach((s, i) => {
      const bh = Math.max(3, Math.round((s / 100) * (H - 4)));
      ctx.fillStyle = s >= 80 ? "#10b981" : s >= 50 ? "#f59e0b" : "#ef4444";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.rect(i * (bw + gap), H - bh, bw, bh);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [scoreHistory]);

  // Page title
  useEffect(() => {
    if (hasDetected) {
      const e = displayScore >= 80 ? "🟢" : displayScore >= 60 ? "🟡" : "🔴";
      document.title = `${e} ${displayScore} — PostureAI`;
    } else {
      document.title = "PostureAI — Your posture coach";
    }
  }, [displayScore, hasDetected]);

  // Break reminder every 45 min
  useEffect(() => {
    if (elapsed > 0 && elapsed % 2700 === 0 && elapsed !== lastBreakRef.current) {
      lastBreakRef.current = elapsed;
      setShowBreak(true);
    }
  }, [elapsed]);

  // Auto session summary after 60 min
  useEffect(() => {
    if (elapsed >= 3600 && !sumDoneRef.current) {
      sumDoneRef.current = true;
      genSummary();
    }
  }, [elapsed]);

  function genSummary() {
    const buf = bufRef.current;
    if (buf.length < 10) return;
    const gp = Math.round((buf.filter((s) => s >= 70).length / buf.length) * 100);
    const avg = Math.round(buf.reduce((a, b) => a + b, 0) / buf.length);
    const best = Math.max(...buf);
    setSummary({ duration: elapsed, gp, avg, best, tip: getFixTip(statusTextRef.current) });
    setShowSummary(true);
  }

  const yAvg = useMemo(() => {
    if (!sessions.length) return null;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const ys = sessions.filter((s) => {
      const d = new Date(s.createdAt ?? (s as any).timestamp ?? 0);
      return d.toDateString() === y.toDateString();
    });
    if (!ys.length) return null;
    return Math.round(ys.reduce((a, b) => a + b.avg, 0) / ys.length);
  }, [sessions]);

  const toggleMute = useCallback(() => {
    setIsMuted((p) => {
      const n = !p;
      window.setPostureAIMuted?.(n);
      localStorage.setItem("postureai_sfx_muted", String(n));
      return n;
    });
  }, []);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    window.initCV?.();
    window.initScore?.();
    window.setPostureAIMuted?.(localStorage.getItem("postureai_sfx_muted") === "true");

    const onCam = (e: Event) => setCamStatus((e as CustomEvent).detail);
    const onTick = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setColor(d.color);
      setStatusText(d.status);
      statusTextRef.current = d.status;
      setElapsed(d.elapsed ?? 0);

      if (Array.isArray(d.scoreHistory) && d.scoreHistory.length > 0) {
        setScoreHistory([...d.scoreHistory]);
      }

      if (d.detected !== false && d.composite > 0) {
        setHasDetected(true);
        rollingRef.current.push(d.composite);
        if (rollingRef.current.length > 300) rollingRef.current.shift();
        setDisplayScore(
          Math.round(
            rollingRef.current.reduce((a: number, b: number) => a + b, 0) /
              rollingRef.current.length
          )
        );
      }

      setMetrics({
        neck: d.neckTilt || window.postureCV?.neckAngle || 0,
        shoulder: d.shoulderAlign || window.postureCV?.shoulderAngle || 0,
        spine: d.spineTilt || window.postureCV?.spineAngle || 0,
      });

      if (d.forwardHeadDepth !== undefined) setFwdHead(d.forwardHeadDepth);
      if (d.lumbarScore !== undefined) setLumbar(d.lumbarScore);

      if (d.color === "red") slouchRef.current += 1;
      else slouchRef.current = 0;
      setSlouchSecs(slouchRef.current);

      const noData = !d.detected || d.composite === 0 || d.status === "NO_POSE";
      if (noData) {
        noDetRef.current++;
        if (noDetRef.current >= 30) { isAwayRef.current = true; awayRef.current++; }
      } else {
        if (isAwayRef.current) {
          const m = Math.round(awayRef.current / 60);
          setWelcomeBack(`Welcome back! Away ${m > 0 ? m + " min" : "briefly"}.`);
          setTimeout(() => setWelcomeBack(""), 5000);
          slouchRef.current = 0;
        }
        isAwayRef.current = false;
        noDetRef.current = 0;
        awayRef.current = 0;
      }

      bufRef.current.push(d.composite);
      if (bufRef.current.length >= 60) {
        const arr = bufRef.current;
        saveSession({
          avg: Math.round(arr.reduce((a: number, b: number) => a + b, 0) / arr.length),
          min: Math.min(...arr),
          max: Math.max(...arr),
          duration: 60,
          timestamp: Date.now(),
        } as any);
        bufRef.current = [];
      }
    };
    const onSide = () => setSideCon(true);

    window.addEventListener("posture-camera-status", onCam);
    window.addEventListener("posture-tick", onTick);
    window.addEventListener("posture-side-connected", onSide);
    window.addEventListener("beforeunload", genSummary);

    return () => {
      window.removeEventListener("posture-camera-status", onCam);
      window.removeEventListener("posture-tick", onTick);
      window.removeEventListener("posture-side-connected", onSide);
      window.removeEventListener("beforeunload", genSummary);
    };
  }, [saveSession]);

  const isTracking = camStatus === "ACTIVE" || camStatus === "TRACKING";
  const threshold = mode === "relaxed" ? 480 : 120;
  const shouldAlert = slouchSecs >= threshold && hasDetected;
  const phoneUrl = `${window.location.protocol}//${window.location.hostname}${window.location.port ? ":" + window.location.port : ""}/mobile`;

  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      {/* Nav */}
      <nav className="bg-white border-b border-[#e8eaed] px-6 py-3 flex items-center justify-between sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Activity size={16} className="text-white" />
          </div>
          <span className="font-semibold text-[#1a1d23] text-sm">PostureAI</span>
          <span className="text-[#9ca3af] text-xs hidden md:inline">Your personal posture coach</span>
          <div className="hidden lg:flex items-center gap-1 text-[10px] text-[#9ca3af] bg-[#f3f4f6] px-2 py-1 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            No video stored
          </div>
        </div>
        <div className="flex items-center gap-2">
          {elapsed > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[#6b7280] bg-[#f3f4f6] px-3 py-1.5 rounded-full">
              <Clock size={12} />
              {fmt(elapsed)}
            </div>
          )}
          <button
            onClick={() => {
              const n = mode === "relaxed" ? "focus" : "relaxed";
              setMode(n);
              localStorage.setItem("postureai_mode", n);
              slouchRef.current = 0;
            }}
            className={cn(
              "text-xs font-medium px-3 py-1.5 rounded-full border transition-all",
              mode === "focus"
                ? "bg-amber-50 border-amber-200 text-amber-700"
                : "bg-[#f3f4f6] border-[#e8eaed] text-[#6b7280] hover:border-blue-200 hover:text-blue-600"
            )}
          >
            {mode === "focus" ? "Focus mode" : "Relaxed mode"}
          </button>
          <button onClick={toggleMute} className="p-2 rounded-full hover:bg-[#f3f4f6] text-[#6b7280]">
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={() => setShowPhone(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Smartphone size={13} />
            <span className="hidden sm:inline">Side camera</span>
          </button>
          <div className="flex items-center gap-1.5 text-xs text-[#6b7280]">
            <div
              className={cn("w-2 h-2 rounded-full", isTracking && "dot-pulse")}
              style={{ backgroundColor: isTracking ? "#10b981" : "#d1d5db" }}
            />
            <span className="hidden sm:inline">{isTracking ? "Tracking" : "Starting..."}</span>
          </div>
        </div>
      </nav>

      {/* Banners */}
      {showWelcome && (
        <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 flex items-center justify-between">
          <p className="text-sm text-blue-800">
            Sit so your full upper body is visible. You will only be nudged after several minutes of continuous bad posture. We never store video — ever.
          </p>
          <button
            onClick={() => { localStorage.setItem("postureai_welcomed", "true"); setShowWelcome(false); }}
            className="text-xs text-blue-600 font-medium ml-4 whitespace-nowrap"
          >
            Got it
          </button>
        </div>
      )}
      {welcomeBack && (
        <div className="bg-emerald-50 border-b border-emerald-100 px-6 py-2 text-sm text-emerald-700 text-center font-medium">
          {welcomeBack}
        </div>
      )}
      {showBreak && (
        <div className="bg-amber-50 border-b border-amber-100 px-6 py-2 flex items-center justify-between">
          <p className="text-sm text-amber-800 font-medium">
            45 min sitting — {getBreakTip(metrics)}
          </p>
          <button onClick={() => setShowBreak(false)} className="text-xs text-amber-600 ml-4 font-medium whitespace-nowrap">
            Done
          </button>
        </div>
      )}

      {/* Status bar */}
      <div
        className={cn(
          "px-6 py-2.5 flex items-center gap-2 border-b text-sm font-medium transition-colors duration-500",
          shouldAlert
            ? color === "red"
              ? "bg-red-50 border-red-100 text-red-700"
              : "bg-amber-50 border-amber-100 text-amber-700"
            : "bg-emerald-50 border-emerald-100 text-emerald-700"
        )}
      >
        {shouldAlert
          ? <AlertCircle size={15} className="flex-shrink-0" />
          : <CheckCircle size={15} className="flex-shrink-0" />
        }
        <span>
          {shouldAlert
            ? statusText
            : isTracking && hasDetected
              ? "Posture looks good"
              : "Starting camera..."}
        </span>
        {shouldAlert && (
          <span className="text-xs font-normal opacity-75 ml-1 hidden md:inline">
            — {getFixTip(statusText)}
          </span>
        )}
        {!shouldAlert && color !== "green" && hasDetected && (
          <span className="w-2 h-2 rounded-full bg-amber-400 dot-pulse ml-auto flex-shrink-0" />
        )}
      </div>

      {/* Main layout */}
      <div className="flex" style={{ height: "calc(100vh - 112px)" }}>
        {/* Camera panel */}
        <div className="flex-1 relative bg-[#0d0d0d]">
          <video id="webcam" autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
          <canvas id="overlay" className="absolute inset-0 w-full h-full object-cover" style={{ zIndex: 10, pointerEvents: "none" }} />
          <div className="absolute top-4 left-4 z-20 flex gap-2">
            {(["front", "side"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setViewModeState(m); window.setViewMode?.(m); }}
                className="text-xs font-medium px-3 py-1.5 rounded-full border backdrop-blur-sm transition-all"
                style={{
                  background: viewMode === m ? "rgba(59,130,246,0.9)" : "rgba(255,255,255,0.15)",
                  borderColor: viewMode === m ? "transparent" : "rgba(255,255,255,0.3)",
                  color: "#fff",
                }}
              >
                {m === "front" ? "Front" : "Side"}
              </button>
            ))}
          </div>
          {!isTracking && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-4 animate-pulse">
                <Activity size={28} className="text-white" />
              </div>
              <p className="text-white text-sm font-medium">Getting camera ready...</p>
              <p className="text-white/50 text-xs mt-1">Allow camera access if prompted</p>
            </div>
          )}
          {sideCon && (
            <div className="absolute bottom-4 left-4 z-20 bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-white dot-pulse" />
              3D mode active
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="w-72 bg-white border-l border-[#e8eaed] flex flex-col overflow-y-auto flex-shrink-0">
          {/* Score */}
          <div className="p-5 border-b border-[#e8eaed] flex flex-col items-center">
            <p className="text-[10px] font-medium text-[#9ca3af] uppercase tracking-wider mb-4">Your score</p>
            <ScoreRing score={displayScore} color={color} hasDetected={hasDetected} />
            {yAvg !== null && hasDetected && (
              <div className="text-xs text-center mt-2" style={{ color: displayScore > yAvg ? "#10b981" : "#ef4444" }}>
                {displayScore > yAvg ? "↑" : "↓"} {Math.abs(displayScore - yAvg)} pts vs yesterday
              </div>
            )}
          </div>

          {/* Live readings */}
          <div className="p-4 border-b border-[#e8eaed]">
            <p className="text-[10px] font-medium text-[#9ca3af] uppercase tracking-wider mb-3">Live readings</p>
            <div className="space-y-1">
              {[
                { label: "Neck tilt", val: metrics.neck, w: 10, b: 20 },
                { label: "Shoulder align", val: metrics.shoulder, w: 5, b: 10 },
                { label: "Spine tilt", val: metrics.spine, w: 5, b: 10 },
              ].map(({ label, val, w, b }) => {
                const { c, l } = ms(val, w, b);
                return (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-[#f9fafb] last:border-0">
                    <div>
                      <p className="text-xs font-medium text-[#374151]">{label}</p>
                      <p className="text-[10px] font-medium" style={{ color: c }}>{l}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
                      <span className="text-sm font-semibold text-[#1a1d23] tabular-nums">
                        {val > 0 ? `${val}°` : "--"}
                      </span>
                    </div>
                  </div>
                );
              })}
              {sideCon && (
                <>
                  <div className="flex items-center justify-between py-2 border-b border-[#f9fafb]">
                    <div>
                      <p className="text-xs font-medium text-[#374151]">Forward head</p>
                      <p className="text-[10px] font-medium" style={{ color: fwdHead < 10 ? "#10b981" : fwdHead < 25 ? "#f59e0b" : "#ef4444" }}>
                        {fwdHead < 10 ? "Good" : fwdHead < 25 ? "Watch" : "Fix now"}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#1a1d23]">{fwdHead}mm</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-xs font-medium text-[#374151]">Lumbar curve</p>
                      <p className="text-[10px] font-medium" style={{ color: lumbar >= 80 ? "#10b981" : lumbar >= 50 ? "#f59e0b" : "#ef4444" }}>
                        {lumbar >= 80 ? "Good" : lumbar >= 50 ? "Watch" : "Fix now"}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#1a1d23]">{lumbar}/100</span>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={() => setShowCal(true)}
              className="w-full text-xs font-medium text-blue-600 border border-blue-100 bg-blue-50 py-2 rounded-lg hover:bg-blue-100 transition-colors mt-3 flex items-center justify-center gap-1.5"
            >
              <Target size={12} />
              Calibrate my baseline
            </button>
          </div>

          {/* Mode info */}
          <div className="px-4 py-3 border-b border-[#e8eaed] flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[#9ca3af]">Alert after</p>
              <p className="text-xs font-medium text-[#374151]">
                {mode === "relaxed" ? "8 min" : "2 min"} continuous slouch
              </p>
            </div>
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: shouldAlert ? "#ef4444" : slouchSecs > 0 ? "#f59e0b" : "#10b981" }}
            />
          </div>

          {/* Sparkline */}
          <div className="p-4 border-b border-[#e8eaed]">
            <p className="text-[10px] font-medium text-[#9ca3af] uppercase tracking-wider mb-2">Score trend</p>
            <canvas ref={sparkRef} width={224} height={44} className="w-full rounded" style={{ background: "#f8f9fb" }} />
            {scoreHistory.length === 0 && (
              <p className="text-[10px] text-[#9ca3af] text-center mt-2">Waiting for detection...</p>
            )}
          </div>

          {/* History */}
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="px-4 py-3 flex items-center justify-between hover:bg-[#f8f9fb] transition-colors border-b border-[#e8eaed]"
          >
            <span className="text-xs font-medium text-[#374151]">Session history</span>
            {showHistory ? <ChevronUp size={14} className="text-[#9ca3af]" /> : <ChevronDown size={14} className="text-[#9ca3af]" />}
          </button>
          {showHistory && (
            <div className="p-4 border-b border-[#e8eaed]">
              {isLoading
                ? <p className="text-xs text-[#9ca3af] text-center animate-pulse">Loading...</p>
                : <HistoryChart data={sessions} />
              }
            </div>
          )}

          {/* End session */}
          <div className="p-4 mt-auto">
            <button
              onClick={genSummary}
              className="w-full text-xs font-medium text-[#6b7280] border border-[#e8eaed] py-2.5 rounded-lg hover:bg-[#f3f4f6] hover:border-[#d1d5db] transition-all"
            >
              End session
            </button>
          </div>
        </div>
      </div>

      {/* Floating score badge */}
      <div
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        style={{
          position: "fixed", bottom: 20, right: 20, zIndex: 9999,
          background: "white", borderRadius: 50, padding: "8px 14px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.12)", border: "1px solid #e8eaed",
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 13, fontWeight: 600, cursor: "pointer", userSelect: "none",
        }}
      >
        <div
          className={shouldAlert ? "dot-pulse" : ""}
          style={{
            width: 8, height: 8, borderRadius: "50%",
            backgroundColor: !hasDetected ? "#d1d5db" : displayScore >= 80 ? "#10b981" : displayScore >= 60 ? "#f59e0b" : "#ef4444",
          }}
        />
        <span style={{ color: "#1a1d23" }}>{hasDetected ? displayScore : "—"}</span>
        <span style={{ color: "#9ca3af", fontWeight: 400, fontSize: 11 }}>PostureAI</span>
      </div>

      {/* Phone modal */}
      {showPhone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPhone(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-[#1a1d23] mb-1">Add side camera</h3>
            <p className="text-xs text-[#6b7280] mb-4">Use your phone for 3D posture analysis.</p>
            <div className="bg-[#f8f9fb] rounded-xl p-4 mb-4 flex flex-col items-center gap-2">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(phoneUrl)}&color=1a1d23&bgcolor=f8f9fb`}
                alt="QR"
                width={160}
                height={160}
                className="rounded-lg"
              />
              <p className="text-xs text-[#6b7280]">Scan with phone camera</p>
            </div>
            <div className="space-y-2 text-xs text-[#374151] mb-4">
              <p className="flex gap-2"><span className="text-blue-600 font-bold">1</span>Same WiFi as laptop</p>
              <p className="flex gap-2"><span className="text-blue-600 font-bold">2</span>Phone on table edge, rear camera facing your left side</p>
              <p className="flex gap-2"><span className="text-blue-600 font-bold">3</span>Ear, shoulder, hip all visible</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard.writeText(phoneUrl)} className="flex-1 text-xs border border-[#e8eaed] py-2 rounded-lg hover:bg-[#f3f4f6]">Copy URL</button>
              <button onClick={() => setShowPhone(false)} className="flex-1 text-xs bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Calibration modal */}
      {showCal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xs w-full text-center">
            <h3 className="font-semibold text-[#1a1d23] mb-2">Calibrate your baseline</h3>
            <p className="text-sm text-[#6b7280] mb-5">Sit straight, look at camera, press Start and hold 5 seconds.</p>
            {!caling ? (
              <>
                <button
                  onClick={() => {
                    setCaling(true);
                    setTimeout(() => {
                      const cv = window.postureCV;
                      localStorage.setItem("postureai_baseline", JSON.stringify({
                        neck: cv?.neckAngle || 0,
                        shoulder: cv?.shoulderAngle || 0,
                        spine: cv?.spineAngle || 0,
                      }));
                      setCaling(false);
                      setShowCal(false);
                    }, 5000);
                  }}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-blue-700"
                >
                  Start calibration
                </button>
                <button onClick={() => setShowCal(false)} className="mt-3 text-xs text-[#9ca3af] w-full">Cancel</button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                <p className="text-sm text-[#374151] font-medium">Hold still...</p>
                <div className="w-full bg-[#e8eaed] rounded-full h-1.5 overflow-hidden">
                  <div className="bg-blue-600 h-1.5 rounded-full" style={{ animation: "grow 5s linear forwards" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary modal */}
      {showSummary && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-[#1a1d23] mb-4">Session summary</h3>
            <div className="space-y-3 mb-5">
              <div className="flex justify-between text-sm"><span className="text-[#6b7280]">Duration</span><span className="font-medium">{Math.floor(summary.duration / 60)} min</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#6b7280]">Good posture</span><span className="font-medium text-emerald-600">{summary.gp}%</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#6b7280]">Average score</span><span className="font-medium">{summary.avg}</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#6b7280]">Best score</span><span className="font-medium text-blue-600">{summary.best}</span></div>
              <div className="pt-3 border-t border-[#e8eaed]">
                <p className="text-xs text-[#6b7280] mb-1">Tip for next session:</p>
                <p className="text-sm text-[#374151]">{summary.tip}</p>
              </div>
            </div>
            <button onClick={() => setShowSummary(false)} className="w-full bg-blue-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-blue-700">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
