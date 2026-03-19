import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import {
  useSessions,
  useCreateSession,
  getStreak,
  getTodaySummary,
  getMetricTrend,
  needsPhysioWarning,
} from "@/hooks/use-sessions";
import { ScoreRing } from "@/components/ScoreRing";
import { HistoryChart } from "@/components/HistoryChart";
import {
  Activity,
  Volume2,
  VolumeX,
  Smartphone,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Target,
  PauseCircle,
  ChevronRight,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";

declare global {
  interface Window {
    initCV?: () => void;
    initScore?: () => void;
    setPostureAIMuted?: (muted: boolean) => void;
    setViewMode?: (mode: string) => void;
    postureCV?: {
      neckAngle: number;
      shoulderAngle: number;
      spineAngle: number;
      headRoll: number;
      status?: string;
    };
  }
}

function getFeedback(
  neck: number,
  shoulder: number,
  spine: number,
  headRoll: number,
): string {
  if (headRoll > 25) return "Head tilted severely — level it out now";
  if (headRoll > 15) return "Level your head — it's tilted sideways";
  if (headRoll > 10) return "Slight head tilt — straighten up";
  if (neck > 30) return "Bring your chin back";
  if (neck > 15) return "Ease your head back slightly";
  if (shoulder > 20) return "Level your shoulders";
  if (shoulder > 10) return "One shoulder is a little high";
  if (spine > 20) return "Sit up straighter";
  if (spine > 10) return "Slight lean detected";
  return "Posture looks good";
}

function getFixTip(s: string): string {
  const t = s.toLowerCase();
  if (t.includes("tilt") || t.includes("roll"))
    return "Level your head — ear over shoulder";
  if (t.includes("forward") || t.includes("chin"))
    return "Pull head back — ears above shoulders";
  if (t.includes("neck")) return "Level head — imagine a book on top";
  if (t.includes("shoulder")) return "Relax both shoulders down and back";
  if (t.includes("spine") || t.includes("slouch"))
    return "Sit tall from hips, light core engagement";
  return "Adjust position and take a slow breath";
}

function getBreakTip(m: {
  neck: number;
  shoulder: number;
  spine: number;
  headRoll: number;
}): string {
  if (m.headRoll > 10) return "Tilt head to opposite side, hold 15s each side";
  if (m.neck > 15) return "Tuck chin, look 6m away for 20 seconds";
  if (m.shoulder > 10) return "Roll shoulders back 5 times slowly";
  if (m.spine > 10) return "Stand up, hands on hips, arch back 10 seconds";
  return "Stand up and walk for 2 minutes";
}

function fmt(s: number) {
  return `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function ms(v: number, w: number, b: number) {
  if (v < w) return { c: "#10b981", l: "Good" };
  if (v < b) return { c: "#f59e0b", l: "Watch" };
  return { c: "#ef4444", l: "Fix now" };
}

function getTrendInsight(trend: ReturnType<typeof getMetricTrend>): string {
  const last3 = (arr: number[]) => arr.slice(-3).filter((v) => v > 0);
  const worsening = (arr: number[]) => {
    const r = last3(arr);
    return r.length >= 2 && r[r.length - 1] > r[0] + 3;
  };
  if (worsening(trend.headRoll)) return "Head roll getting worse this week";
  if (worsening(trend.neck)) return "Neck tilt worsening over last 3 days";
  if (worsening(trend.spine))
    return "Spine slouch increasing — watch your back";
  if (worsening(trend.shoulder)) return "Shoulder imbalance trending up";
  return "";
}

// ── Posture heatmap bar ───────────────────────────────────────────────────────
function PostureHeatmap({
  goodSecs,
  fairSecs,
  badSecs,
}: {
  goodSecs: number;
  fairSecs: number;
  badSecs: number;
}) {
  const total = goodSecs + fairSecs + badSecs;
  if (total < 5) return null;
  const gp = Math.round((goodSecs / total) * 100);
  const fp = Math.round((fairSecs / total) * 100);
  const bp = 100 - gp - fp;
  const totalMin = Math.floor(total / 60);
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-white/40">Session breakdown</span>
        <span className="text-[10px] text-white/40">{totalMin}m tracked</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
        {gp > 0 && <div style={{ width: `${gp}%`, background: "#10b981" }} />}
        {fp > 0 && <div style={{ width: `${fp}%`, background: "#f59e0b" }} />}
        {bp > 0 && <div style={{ width: `${bp}%`, background: "#ef4444" }} />}
      </div>
      <div className="flex items-center gap-3 mt-1">
        <span className="text-[10px] text-emerald-400">{gp}% good</span>
        <span className="text-[10px] text-amber-400">{fp}% fair</span>
        <span className="text-[10px] text-red-400">{bp}% bad</span>
      </div>
    </div>
  );
}

// ── Daily goal progress ───────────────────────────────────────────────────────
const DAILY_GOAL_PCT = 80; // 80% good posture

function DailyGoal({
  goodSecs,
  fairSecs,
  badSecs,
}: {
  goodSecs: number;
  fairSecs: number;
  badSecs: number;
}) {
  const total = goodSecs + fairSecs + badSecs;
  if (total < 5) return null;
  const currentPct = Math.round((goodSecs / total) * 100);
  const achieved = currentPct >= DAILY_GOAL_PCT;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-white/40">
          Daily goal: {DAILY_GOAL_PCT}% good posture
        </span>
        <span
          className={cn(
            "text-[10px] font-medium",
            achieved ? "text-emerald-400" : "text-white/50",
          )}
        >
          {currentPct}% {achieved ? "✓ achieved" : ""}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(100, currentPct)}%`,
            background: achieved
              ? "#10b981"
              : currentPct > 50
                ? "#f59e0b"
                : "#ef4444",
          }}
        />
      </div>
      {!achieved && total > 60 && (
        <p className="text-[10px] text-white/30 mt-0.5">
          {DAILY_GOAL_PCT - currentPct}% more good posture needed
        </p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: sessions = [], isLoading } = useSessions();
  const { mutate: saveSession } = useCreateSession();

  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem("postureai_onboarded"),
  );
  const [displayScore, setDisplayScore] = useState(100);
  const [color, setColor] = useState<"green" | "yellow" | "red">("green");
  const [statusText, setStatusText] = useState("Waiting...");
  const [camStatus, setCamStatus] = useState("INITIALIZING");
  const [elapsed, setElapsed] = useState(0);
  const [scoreHistory, setScoreHistory] = useState<number[]>([]);
  const [metrics, setMetrics] = useState({
    neck: 0,
    shoulder: 0,
    spine: 0,
    headRoll: 0,
  });
  const [muscleRisk, setMuscleRisk] = useState("");
  const [exerciseTip, setExerciseTip] = useState("");
  const [earlyWarning, setEarlyWarning] = useState(false);
  const [badStreak, setBadStreak] = useState(0);
  const [hasDetected, setHasDetected] = useState(false);
  const [slouchSecs, setSlouchSecs] = useState(0);
  const [goodSecs, setGoodSecs] = useState(0);
  const [fairSecs, setFairSecs] = useState(0);
  const [badSecs, setBadSecs] = useState(0);
  const [justFixed, setJustFixed] = useState(false);
  const [mode, setMode] = useState<"relaxed" | "focus">(
    () => (localStorage.getItem("postureai_mode") as any) || "relaxed",
  );
  const [isMuted, setIsMuted] = useState(
    () => localStorage.getItem("postureai_sfx_muted") === "true",
  );
  const [showWelcome, setShowWelcome] = useState(
    () => !localStorage.getItem("postureai_welcomed"),
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
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  const [bannerOverride, setBannerOverride] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const isPaused = pausedUntil !== null && Date.now() < pausedUntil;
  const pauseMinsLeft = isPaused
    ? Math.ceil((pausedUntil! - Date.now()) / 60000)
    : 0;
  function pauseFor(m: number) {
    setPausedUntil(Date.now() + m * 60 * 1000);
    setShowPauseMenu(false);
  }

  // Streak
  const streak = useMemo(() => getStreak(), [sessions]);

  const rollingRef = useRef<number[]>([]);
  const slouchRef = useRef(0);
  const noDetRef = useRef(0);
  const awayRef = useRef(0);
  const isAwayRef = useRef(false);
  const bufRef = useRef<number[]>([]);
  const neckBuf = useRef<number[]>([]);
  const shoulderBuf = useRef<number[]>([]);
  const spineBuf = useRef<number[]>([]);
  const headRollBuf = useRef<number[]>([]);
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const lastBreakRef = useRef(0);
  const sumDoneRef = useRef(false);
  const statusTextRef = useRef("Waiting...");
  const fixedTimerRef = useRef<any>(null);

  const trend = useMemo(() => getMetricTrend(), [sessions]);
  const trendInsight = useMemo(() => getTrendInsight(trend), [trend]);
  const physioWarn = useMemo(() => needsPhysioWarning(), [sessions]);

  useEffect(() => {
    const canvas = sparkRef.current;
    if (!canvas || scoreHistory.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width,
      H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const gap = 3;
    const bw = Math.max(
      4,
      Math.floor((W - gap * (scoreHistory.length - 1)) / scoreHistory.length),
    );
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

  useEffect(() => {
    if (hasDetected) {
      const e = displayScore >= 80 ? "🟢" : displayScore >= 60 ? "🟡" : "🔴";
      document.title = `${e} ${displayScore} — PostureAI`;
    } else document.title = "PostureAI — Your posture coach";
  }, [displayScore, hasDetected]);

  useEffect(() => {
    if (
      elapsed > 0 &&
      elapsed % 2700 === 0 &&
      elapsed !== lastBreakRef.current
    ) {
      lastBreakRef.current = elapsed;
      setShowBreak(true);
    }
  }, [elapsed]);

  useEffect(() => {
    if (elapsed >= 3600 && !sumDoneRef.current) {
      sumDoneRef.current = true;
      genSummary();
    }
  }, [elapsed]);

  function genSummary() {
    const buf = bufRef.current;
    if (buf.length < 10) return;
    const gp = Math.round(
      (buf.filter((s) => s >= 70).length / buf.length) * 100,
    );
    const avg = Math.round(buf.reduce((a, b) => a + b, 0) / buf.length);
    const best = Math.max(...buf);
    const today = getTodaySummary();
    setSummary({
      duration: elapsed,
      gp,
      avg,
      best,
      streak,
      todayMin: today.totalMin,
      todayGoodMin: today.goodMin,
      tip: getFixTip(statusTextRef.current),
      trendInsight,
      physioWarn,
      goodSecs,
      fairSecs,
      badSecs,
    });
    setShowSummary(true);
  }

  const yAvg = useMemo(() => {
    if (!sessions.length) return null;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const ys = sessions.filter(
      (s) =>
        new Date(s.createdAt ?? (s as any).timestamp ?? 0).toDateString() ===
        y.toDateString(),
    );
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
    if (showOnboarding) return;
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
    window.initCV?.();
    window.initScore?.();
    window.setPostureAIMuted?.(
      localStorage.getItem("postureai_sfx_muted") === "true",
    );

    const onCam = (e: Event) => setCamStatus((e as CustomEvent).detail);
    const onLost = () =>
      setBannerOverride("Can't see you — sit back and face the camera");
    const onFound = () => setBannerOverride(null);

    const onTick = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setColor(d.color);
      setStatusText(d.status);
      statusTextRef.current = d.status;
      setElapsed(d.elapsed ?? 0);
      if (Array.isArray(d.scoreHistory) && d.scoreHistory.length > 0)
        setScoreHistory([...d.scoreHistory]);

      if (d.detected !== false && d.composite > 0) {
        setHasDetected(true);
        rollingRef.current.push(d.composite);
        if (rollingRef.current.length > 300) rollingRef.current.shift();
        setDisplayScore(
          Math.round(
            rollingRef.current.reduce((a: number, b: number) => a + b, 0) /
              rollingRef.current.length,
          ),
        );
      }

      const neck = d.neckTilt || window.postureCV?.neckAngle || 0;
      const shoulder = d.shoulderAlign || window.postureCV?.shoulderAngle || 0;
      const spine = d.spineTilt || window.postureCV?.spineAngle || 0;
      const headRoll = d.headRollVal || window.postureCV?.headRoll || 0;
      setMetrics({ neck, shoulder, spine, headRoll });
      if (d.muscleRisk !== undefined) setMuscleRisk(d.muscleRisk);
      if (d.exerciseTip !== undefined) setExerciseTip(d.exerciseTip);
      if (d.earlyWarning !== undefined) setEarlyWarning(d.earlyWarning);
      if (d.badStreak !== undefined) setBadStreak(d.badStreak);
      if (d.forwardHeadDepth !== undefined) setFwdHead(d.forwardHeadDepth);
      if (d.lumbarScore !== undefined) setLumbar(d.lumbarScore);
      if (d.goodSecs !== undefined) setGoodSecs(d.goodSecs);
      if (d.fairSecs !== undefined) setFairSecs(d.fairSecs);
      if (d.badSecs !== undefined) setBadSecs(d.badSecs);

      // "Fixed it" flash
      if (d.justFixed) {
        setJustFixed(true);
        if (fixedTimerRef.current) clearTimeout(fixedTimerRef.current);
        fixedTimerRef.current = setTimeout(() => setJustFixed(false), 2500);
      }

      if (d.color === "red") slouchRef.current += 1;
      else slouchRef.current = 0;
      setSlouchSecs(slouchRef.current);

      const noData = !d.detected || d.composite === 0 || d.status === "NO_POSE";
      if (noData) {
        noDetRef.current++;
        if (noDetRef.current >= 30) {
          isAwayRef.current = true;
          awayRef.current++;
        }
      } else {
        if (isAwayRef.current) {
          const m = Math.round(awayRef.current / 60);
          setWelcomeBack(
            `Welcome back! Away ${m > 0 ? m + " min" : "briefly"}.`,
          );
          setTimeout(() => setWelcomeBack(""), 4000);
          slouchRef.current = 0;
        }
        isAwayRef.current = false;
        noDetRef.current = 0;
        awayRef.current = 0;
      }

      neckBuf.current.push(neck);
      shoulderBuf.current.push(shoulder);
      spineBuf.current.push(spine);
      headRollBuf.current.push(headRoll);
      bufRef.current.push(d.composite);

      if (bufRef.current.length >= 60) {
        const arr = bufRef.current;
        const avg = (a: number[]) =>
          a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
        saveSession({
          avg: Math.round(
            arr.reduce((a: number, b: number) => a + b, 0) / arr.length,
          ),
          min: Math.min(...arr),
          max: Math.max(...arr),
          duration: 60,
          timestamp: Date.now(),
          avgNeck: avg(neckBuf.current),
          avgShoulder: avg(shoulderBuf.current),
          avgSpine: avg(spineBuf.current),
          avgHeadRoll: avg(headRollBuf.current),
        } as any);
        bufRef.current = [];
        neckBuf.current = [];
        shoulderBuf.current = [];
        spineBuf.current = [];
        headRollBuf.current = [];
      }
    };

    const onSide = () => setSideCon(true);
    window.addEventListener("posture-camera-status", onCam);
    window.addEventListener("posture-tick", onTick);
    window.addEventListener("posture-side-connected", onSide);
    window.addEventListener("posture-lost", onLost);
    window.addEventListener("posture-found", onFound);
    window.addEventListener("beforeunload", genSummary);
    return () => {
      window.removeEventListener("posture-camera-status", onCam);
      window.removeEventListener("posture-tick", onTick);
      window.removeEventListener("posture-side-connected", onSide);
      window.removeEventListener("posture-lost", onLost);
      window.removeEventListener("posture-found", onFound);
      window.removeEventListener("beforeunload", genSummary);
    };
  }, [saveSession, showOnboarding]);

  const isTracking = camStatus === "ACTIVE" || camStatus === "TRACKING";
  const threshold = mode === "relaxed" ? 480 : 120;
  const shouldAlert = slouchSecs >= threshold && hasDetected && !isPaused;
  const showEarlyWarning =
    earlyWarning && hasDetected && !isPaused && !shouldAlert;
  const cvStatus = window.postureCV?.status ?? "good";
  const isGood =
    !shouldAlert &&
    !showEarlyWarning &&
    cvStatus !== "no_detection" &&
    hasDetected &&
    !bannerOverride;

  const primaryFeedback = bannerOverride
    ? bannerOverride
    : !isTracking || !hasDetected
      ? "Starting camera..."
      : cvStatus === "no_detection"
        ? "Sit back — can't see your shoulders"
        : getFeedback(
            metrics.neck,
            metrics.shoulder,
            metrics.spine,
            metrics.headRoll,
          );

  const phoneUrl = `${window.location.protocol}//${window.location.hostname}${window.location.port ? ":" + window.location.port : ""}/mobile`;

  return (
    <div className="min-h-screen bg-[#0d0d0d]">
      {/* Onboarding */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full flex flex-col items-center gap-5">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <Activity size={24} className="text-white" />
            </div>
            <div className="text-center">
              <h2 className="font-semibold text-[#1a1d23] text-lg mb-1">
                Set yourself up right
              </h2>
              <p className="text-xs text-[#9ca3af]">
                30 seconds now saves hours of pain later
              </p>
            </div>
            <div className="bg-[#f8f9fb] rounded-xl p-4 w-full flex flex-col items-center gap-3">
              <svg viewBox="0 0 160 200" width="120" height="150">
                <rect
                  x="10"
                  y="10"
                  width="140"
                  height="180"
                  rx="8"
                  fill="none"
                  stroke="#e8eaed"
                  strokeWidth="2"
                />
                <ellipse
                  cx="80"
                  cy="65"
                  rx="22"
                  ry="26"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  opacity="0.8"
                />
                <rect
                  x="45"
                  y="95"
                  width="70"
                  height="80"
                  rx="8"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="2"
                  strokeDasharray="5 3"
                  opacity="0.8"
                />
                <line
                  x1="30"
                  y1="108"
                  x2="130"
                  y2="108"
                  stroke="#3b82f6"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  opacity="0.5"
                />
                <text
                  x="80"
                  y="200"
                  textAnchor="middle"
                  fontSize="9"
                  fill="#9ca3af"
                >
                  arm's length away
                </text>
              </svg>
              <p className="text-[11px] text-[#6b7280] text-center">
                Head, shoulders and chest all visible
              </p>
            </div>
            <div className="w-full space-y-2">
              {[
                "Sit an arm's length from screen",
                "Camera at eye level if possible",
                "Shoulders visible on both sides",
                "We never store or upload video",
              ].map((tip) => (
                <div key={tip} className="flex items-center gap-2.5">
                  <CheckCircle
                    size={14}
                    className="text-emerald-500 flex-shrink-0"
                  />
                  <p className="text-xs text-[#374151]">{tip}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                localStorage.setItem("postureai_onboarded", "1");
                setShowOnboarding(false);
              }}
              className="w-full bg-blue-600 text-white text-sm font-medium py-3 rounded-xl hover:bg-blue-700 transition-colors"
            >
              I'm set up — start tracking
            </button>
          </div>
        </div>
      )}

      {/* Full screen camera */}
      <div className="relative w-full" style={{ height: "100vh" }}>
        <video
          id="webcam"
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: "contain", background: "#0d0d0d" }}
        />
        <canvas
          id="overlay"
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 10, pointerEvents: "none" }}
        />

        {/* ── "Fixed it" green flash overlay ───────────────────────────── */}
        {justFixed && (
          <div
            className="absolute inset-0 z-30 pointer-events-none flex items-center justify-center"
            style={{ background: "rgba(16,185,129,0.12)" }}
          >
            <div className="bg-emerald-500/90 backdrop-blur-sm rounded-2xl px-6 py-3 flex items-center gap-2">
              <CheckCircle size={18} className="text-white" />
              <span className="text-white text-sm font-semibold">
                Posture fixed!
              </span>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div
          className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-5 py-3"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.65), transparent)",
          }}
        >
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <Activity size={14} className="text-white" />
            </div>
            <span className="text-white text-sm font-semibold">PostureAI</span>
            {elapsed > 0 && (
              <div className="flex items-center gap-1 text-white/50 text-xs ml-1">
                <Clock size={11} />
                {fmt(elapsed)}
              </div>
            )}
            {/* ── Streak badge ─────────────────────────────────────────── */}
            {streak > 1 && (
              <div className="flex items-center gap-1 bg-amber-500/20 border border-amber-500/30 rounded-full px-2 py-0.5 ml-1">
                <Flame size={11} className="text-amber-400" />
                <span className="text-[11px] text-amber-400 font-medium">
                  {streak}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const n = mode === "relaxed" ? "focus" : "relaxed";
                setMode(n);
                localStorage.setItem("postureai_mode", n);
                slouchRef.current = 0;
              }}
              className={cn(
                "text-xs font-medium px-3 py-1.5 rounded-full transition-all",
                mode === "focus"
                  ? "bg-amber-500/90 text-white"
                  : "bg-white/15 text-white/80 hover:bg-white/25",
              )}
            >
              {mode === "focus" ? "Focus" : "Relaxed"}
            </button>
            <button
              onClick={toggleMute}
              className="p-1.5 rounded-full bg-white/15 text-white/80 hover:bg-white/25"
            >
              {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowPauseMenu((p) => !p)}
                className={cn(
                  "flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full transition-all",
                  isPaused
                    ? "bg-amber-500/90 text-white"
                    : "bg-white/15 text-white/80 hover:bg-white/25",
                )}
              >
                <PauseCircle size={13} />
                <span>{isPaused ? `${pauseMinsLeft}m` : "Pause"}</span>
              </button>
              {showPauseMenu && (
                <div className="absolute right-0 top-9 bg-white border border-[#e8eaed] rounded-xl shadow-lg z-50 py-1 min-w-[130px]">
                  {[15, 30, 60].map((m) => (
                    <button
                      key={m}
                      onClick={() => pauseFor(m)}
                      className="w-full text-left px-4 py-2 text-xs text-[#374151] hover:bg-[#f3f4f6]"
                    >
                      {m} minutes
                    </button>
                  ))}
                  {isPaused && (
                    <button
                      onClick={() => {
                        setPausedUntil(null);
                        setShowPauseMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-xs text-emerald-600 hover:bg-[#f3f4f6] border-t border-[#e8eaed]"
                    >
                      Resume now
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowPhone(true)}
              className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-600/90 text-white hover:bg-blue-700"
            >
              <Smartphone size={13} />
              <span className="hidden sm:inline">Side cam</span>
            </button>
            <div className="flex items-center gap-1.5 text-white/60 text-xs">
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isTracking && "dot-pulse",
                )}
                style={{ backgroundColor: isTracking ? "#10b981" : "#6b7280" }}
              />
              <span className="hidden sm:inline text-[11px]">
                {isTracking ? "Tracking" : "Starting..."}
              </span>
            </div>
          </div>
        </div>

        {/* Front/Side toggle */}
        <div className="absolute top-16 left-4 z-20 flex gap-2">
          {(["front", "side"] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setViewModeState(m);
                window.setViewMode?.(m);
              }}
              className="text-xs font-medium px-3 py-1.5 rounded-full border backdrop-blur-sm transition-all"
              style={{
                background:
                  viewMode === m
                    ? "rgba(59,130,246,0.9)"
                    : "rgba(255,255,255,0.12)",
                borderColor:
                  viewMode === m ? "transparent" : "rgba(255,255,255,0.2)",
                color: "#fff",
              }}
            >
              {m === "front" ? "Front" : "Side"}
            </button>
          ))}
        </div>

        {/* Camera loading */}
        {!isTracking && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80">
            <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-4 animate-pulse">
              <Activity size={28} className="text-white" />
            </div>
            <p className="text-white text-sm font-medium">
              Getting camera ready...
            </p>
            <p className="text-white/40 text-xs mt-1">
              Allow camera access if prompted
            </p>
          </div>
        )}

        {/* Toasts */}
        {welcomeBack && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-emerald-500 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            {welcomeBack}
          </div>
        )}
        {showBreak && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-white rounded-2xl shadow-xl px-5 py-4 max-w-xs w-full">
            <p className="text-sm font-semibold text-[#1a1d23] mb-1">
              45-min break time
            </p>
            <p className="text-xs text-[#6b7280] mb-3">
              {getBreakTip(metrics)}
            </p>
            <button
              onClick={() => setShowBreak(false)}
              className="w-full bg-blue-600 text-white text-xs font-medium py-2 rounded-lg"
            >
              Done
            </button>
          </div>
        )}

        {/* Overlay banners */}
        {showWelcome && (
          <div className="absolute bottom-56 left-4 right-4 z-20 bg-blue-600/90 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-white">
              Sit back so your shoulders are visible. We never store video.
            </p>
            <button
              onClick={() => {
                localStorage.setItem("postureai_welcomed", "true");
                setShowWelcome(false);
              }}
              className="text-xs text-blue-200 font-medium ml-3 whitespace-nowrap"
            >
              Got it
            </button>
          </div>
        )}
        {physioWarn && (
          <div className="absolute bottom-56 left-4 right-4 z-20 bg-red-600/90 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-2">
            <AlertCircle size={14} className="text-white flex-shrink-0" />
            <p className="text-xs text-white">
              3+ days of poor posture — consider seeing a physiotherapist.
            </p>
          </div>
        )}
        {trendInsight && !physioWarn && (
          <div className="absolute bottom-56 left-4 right-4 z-20 bg-amber-500/90 backdrop-blur-sm rounded-xl px-4 py-2.5 flex items-center gap-2">
            <AlertCircle size={13} className="text-white flex-shrink-0" />
            <p className="text-xs text-white">{trendInsight}</p>
          </div>
        )}

        {/* ── MAIN STATUS CARD ──────────────────────────────────────────── */}
        <div
          className="absolute bottom-0 left-0 right-0 z-20"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.9) 70%, transparent)",
          }}
        >
          <div className="px-5 pb-2 pt-10">
            {/* Score + status */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div
                  className={cn(
                    "text-4xl font-bold leading-none",
                    !hasDetected
                      ? "text-white/30"
                      : isGood
                        ? "text-emerald-400"
                        : shouldAlert
                          ? "text-red-400"
                          : "text-amber-400",
                  )}
                >
                  {hasDetected ? displayScore : "—"}
                </div>
                <div
                  className={cn(
                    "text-sm font-medium mt-1",
                    !hasDetected
                      ? "text-white/30"
                      : isGood
                        ? "text-emerald-300"
                        : shouldAlert
                          ? "text-red-300"
                          : "text-amber-300",
                  )}
                >
                  {!hasDetected
                    ? "Waiting for camera..."
                    : isGood
                      ? "Posture looks good"
                      : primaryFeedback}
                </div>
                {(shouldAlert || showEarlyWarning) && (
                  <div className="text-xs text-white/40 mt-0.5">
                    {getFixTip(statusText)}
                  </div>
                )}
              </div>

              {/* Status circle */}
              <div className="flex flex-col items-center gap-1.5 ml-4">
                <div
                  className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0",
                    shouldAlert || showEarlyWarning ? "dot-pulse" : "",
                  )}
                  style={{
                    backgroundColor: !hasDetected
                      ? "rgba(255,255,255,0.05)"
                      : isGood
                        ? "rgba(16,185,129,0.15)"
                        : shouldAlert
                          ? "rgba(239,68,68,0.15)"
                          : "rgba(245,158,11,0.15)",
                    border: `2px solid ${!hasDetected ? "rgba(255,255,255,0.1)" : isGood ? "#10b981" : shouldAlert ? "#ef4444" : "#f59e0b"}`,
                  }}
                >
                  {!hasDetected ? (
                    <div className="w-3 h-3 rounded-full bg-white/10" />
                  ) : isGood ? (
                    <CheckCircle size={24} className="text-emerald-400" />
                  ) : (
                    <AlertCircle
                      size={24}
                      className={
                        shouldAlert ? "text-red-400" : "text-amber-400"
                      }
                    />
                  )}
                </div>
                {isPaused && (
                  <span className="text-[10px] text-amber-400 font-medium">
                    Paused
                  </span>
                )}
                {yAvg !== null && hasDetected && (
                  <span
                    className="text-[10px]"
                    style={{
                      color: displayScore > yAvg ? "#10b981" : "#ef4444",
                    }}
                  >
                    {displayScore > yAvg ? "↑" : "↓"}
                    {Math.abs(displayScore - yAvg)} vs yday
                  </span>
                )}
              </div>
            </div>

            {/* Muscle risk */}
            {muscleRisk && hasDetected && cvStatus !== "no_detection" && (
              <div className="bg-amber-500/15 border border-amber-500/25 rounded-lg px-3 py-2 mb-1.5 flex items-start gap-2">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mt-0.5 flex-shrink-0">
                  At risk
                </span>
                <p className="text-xs text-amber-200">{muscleRisk}</p>
              </div>
            )}

            {/* Exercise tip */}
            {exerciseTip && hasDetected && cvStatus !== "no_detection" && (
              <div className="bg-blue-500/15 border border-blue-500/25 rounded-lg px-3 py-2 mb-1.5 flex items-start gap-2">
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mt-0.5 flex-shrink-0">
                  Fix
                </span>
                <p className="text-xs text-blue-200">{exerciseTip}</p>
              </div>
            )}

            {/* Heatmap + daily goal */}
            <PostureHeatmap
              goodSecs={goodSecs}
              fairSecs={fairSecs}
              badSecs={badSecs}
            />
            <DailyGoal
              goodSecs={goodSecs}
              fairSecs={fairSecs}
              badSecs={badSecs}
            />

            {/* Details toggle */}
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="w-full flex items-center justify-between py-2 text-white/35 hover:text-white/60 transition-colors mt-1"
            >
              <span className="text-xs">
                {showDetails
                  ? "Hide details"
                  : `Details — Neck ${metrics.neck || "--"}° · Shoulder ${metrics.shoulder || "--"}° · Spine ${metrics.spine || "--"}°`}
              </span>
              {showDetails ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </button>

            {/* Expanded details */}
            {showDetails && (
              <div className="bg-white/5 backdrop-blur-sm rounded-xl p-4 mb-2 space-y-1">
                {[
                  { label: "Neck tilt", val: metrics.neck, w: 15, b: 30 },
                  { label: "Head roll", val: metrics.headRoll, w: 10, b: 20 },
                  {
                    label: "Shoulder align",
                    val: metrics.shoulder,
                    w: 10,
                    b: 20,
                  },
                  { label: "Spine tilt", val: metrics.spine, w: 10, b: 20 },
                ].map(({ label, val, w, b }) => {
                  const { c, l } = ms(val, w, b);
                  return (
                    <div
                      key={label}
                      className="flex items-center justify-between py-1.5 border-b border-white/8 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: c }}
                        />
                        <span className="text-xs text-white/60">{label}</span>
                        <span
                          className="text-[10px] font-medium"
                          style={{ color: c }}
                        >
                          {l}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-white tabular-nums">
                        {val > 0 ? `${val}°` : "--"}
                      </span>
                    </div>
                  );
                })}
                <div className="pt-2">
                  <p className="text-[10px] text-white/35 mb-1.5">
                    Score trend
                  </p>
                  <canvas
                    ref={sparkRef}
                    width={224}
                    height={36}
                    className="w-full rounded"
                    style={{ background: "rgba(255,255,255,0.04)" }}
                  />
                </div>
                {badStreak > 0 && badStreak < threshold && !isPaused && (
                  <p className="text-[10px] text-amber-400 text-center">
                    {Math.round((threshold - badStreak) / 60)}m until nudge
                  </p>
                )}
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="w-full flex items-center justify-between text-white/35 hover:text-white/60 transition-colors pt-1"
                >
                  <span className="text-xs">Session history</span>
                  {showHistory ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
                {showHistory && (
                  <div className="pt-2">
                    {isLoading ? (
                      <p className="text-[10px] text-white/35 text-center">
                        Loading...
                      </p>
                    ) : (
                      <HistoryChart data={sessions} />
                    )}
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setShowCal(true)}
                    className="flex-1 text-xs text-blue-400 border border-blue-400/30 py-1.5 rounded-lg hover:bg-blue-400/10 flex items-center justify-center gap-1"
                  >
                    <Target size={11} />
                    Calibrate
                  </button>
                  <button
                    onClick={genSummary}
                    className="flex-1 text-xs text-white/40 border border-white/15 py-1.5 rounded-lg hover:bg-white/8"
                  >
                    End session
                  </button>
                </div>
              </div>
            )}

            <div className="h-4" />
          </div>
        </div>

        {sideCon && (
          <div className="absolute bottom-52 left-4 z-20 bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-white dot-pulse" />
            3D mode active
          </div>
        )}

        {/* Floating badge */}
        <div
          onClick={() => setShowDetails((v) => !v)}
          style={{
            position: "fixed",
            bottom: 24,
            right: 20,
            zIndex: 9999,
            background: "rgba(0,0,0,0.7)",
            backdropFilter: "blur(8px)",
            borderRadius: 50,
            padding: "7px 14px",
            border: "1px solid rgba(255,255,255,0.12)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div
            className={shouldAlert || showEarlyWarning ? "dot-pulse" : ""}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: !hasDetected
                ? "#4b5563"
                : isGood
                  ? "#10b981"
                  : shouldAlert
                    ? "#ef4444"
                    : "#f59e0b",
            }}
          />
          <span style={{ color: "white" }}>
            {hasDetected ? displayScore : "—"}
          </span>
          <span
            style={{
              color: "rgba(255,255,255,0.35)",
              fontWeight: 400,
              fontSize: 11,
            }}
          >
            PostureAI
          </span>
        </div>
      </div>

      {/* Phone modal */}
      {showPhone && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowPhone(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-[#1a1d23] mb-1">
              Add side camera
            </h3>
            <p className="text-xs text-[#6b7280] mb-4">
              Use your phone for full 3D posture analysis.
            </p>
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
              <p className="flex gap-2">
                <span className="text-blue-600 font-bold">1</span>Same WiFi as
                laptop
              </p>
              <p className="flex gap-2">
                <span className="text-blue-600 font-bold">2</span>Phone on desk,
                camera facing your left side
              </p>
              <p className="flex gap-2">
                <span className="text-blue-600 font-bold">3</span>Ear, shoulder,
                hip all visible
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(phoneUrl)}
                className="flex-1 text-xs border border-[#e8eaed] py-2 rounded-lg hover:bg-[#f3f4f6]"
              >
                Copy URL
              </button>
              <button
                onClick={() => setShowPhone(false)}
                className="flex-1 text-xs bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calibration modal */}
      {showCal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xs w-full text-center">
            <h3 className="font-semibold text-[#1a1d23] mb-2">
              Calibrate baseline
            </h3>
            <p className="text-sm text-[#6b7280] mb-5">
              Sit straight, look at camera, press Start and hold 5 seconds.
            </p>
            {!caling ? (
              <>
                <button
                  onClick={() => {
                    setCaling(true);
                    setTimeout(() => {
                      const cv = window.postureCV;
                      localStorage.setItem(
                        "postureai_baseline",
                        JSON.stringify({
                          neck: cv?.neckAngle || 0,
                          shoulder: cv?.shoulderAngle || 0,
                          spine: cv?.spineAngle || 0,
                        }),
                      );
                      setCaling(false);
                      setShowCal(false);
                    }, 5000);
                  }}
                  className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium text-sm hover:bg-blue-700"
                >
                  Start calibration
                </button>
                <button
                  onClick={() => setShowCal(false)}
                  className="mt-3 text-xs text-[#9ca3af] w-full"
                >
                  Cancel
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                <p className="text-sm text-[#374151] font-medium">
                  Hold still...
                </p>
                <div className="w-full bg-[#e8eaed] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-blue-600 h-1.5 rounded-full"
                    style={{ animation: "grow 5s linear forwards" }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Summary modal */}
      {showSummary && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-[#1a1d23] mb-4">
              Session summary
            </h3>
            <div className="space-y-3 mb-5">
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7280]">Duration</span>
                <span className="font-medium">
                  {Math.floor(summary.duration / 60)} min
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7280]">Good posture</span>
                <span className="font-medium text-emerald-600">
                  {summary.gp}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7280]">Average score</span>
                <span className="font-medium">{summary.avg}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7280]">Best score</span>
                <span className="font-medium text-blue-600">
                  {summary.best}
                </span>
              </div>
              {streak > 1 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#6b7280]">Streak</span>
                  <span className="font-medium text-amber-500">
                    🔥 {streak} days
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-[#6b7280]">Good posture today</span>
                <span className="font-medium text-emerald-600">
                  {summary.todayGoodMin} of {summary.todayMin} min
                </span>
              </div>
              {/* Session heatmap in summary */}
              {summary.goodSecs + summary.fairSecs + summary.badSecs > 60 && (
                <div className="pt-2 border-t border-[#e8eaed]">
                  <p className="text-xs text-[#6b7280] mb-2">
                    Session breakdown
                  </p>
                  <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
                    {Math.round(
                      (summary.goodSecs /
                        (summary.goodSecs +
                          summary.fairSecs +
                          summary.badSecs)) *
                        100,
                    ) > 0 && (
                      <div
                        style={{
                          width: `${Math.round((summary.goodSecs / (summary.goodSecs + summary.fairSecs + summary.badSecs)) * 100)}%`,
                          background: "#10b981",
                        }}
                        className="rounded-l-full"
                      />
                    )}
                    {Math.round(
                      (summary.fairSecs /
                        (summary.goodSecs +
                          summary.fairSecs +
                          summary.badSecs)) *
                        100,
                    ) > 0 && (
                      <div
                        style={{
                          width: `${Math.round((summary.fairSecs / (summary.goodSecs + summary.fairSecs + summary.badSecs)) * 100)}%`,
                          background: "#f59e0b",
                        }}
                      />
                    )}
                    {Math.round(
                      (summary.badSecs /
                        (summary.goodSecs +
                          summary.fairSecs +
                          summary.badSecs)) *
                        100,
                    ) > 0 && (
                      <div
                        style={{
                          width: `${Math.round((summary.badSecs / (summary.goodSecs + summary.fairSecs + summary.badSecs)) * 100)}%`,
                          background: "#ef4444",
                        }}
                        className="rounded-r-full"
                      />
                    )}
                  </div>
                  <div className="flex gap-3 mt-1">
                    <span className="text-[10px] text-emerald-600">
                      {Math.round(
                        (summary.goodSecs /
                          (summary.goodSecs +
                            summary.fairSecs +
                            summary.badSecs)) *
                          100,
                      )}
                      % good
                    </span>
                    <span className="text-[10px] text-amber-600">
                      {Math.round(
                        (summary.fairSecs /
                          (summary.goodSecs +
                            summary.fairSecs +
                            summary.badSecs)) *
                          100,
                      )}
                      % fair
                    </span>
                    <span className="text-[10px] text-red-600">
                      {Math.round(
                        (summary.badSecs /
                          (summary.goodSecs +
                            summary.fairSecs +
                            summary.badSecs)) *
                          100,
                      )}
                      % bad
                    </span>
                  </div>
                </div>
              )}
              {summary.trendInsight && (
                <div className="pt-2 border-t border-[#e8eaed]">
                  <p className="text-xs text-amber-700 flex items-center gap-1.5">
                    <AlertCircle size={11} />
                    {summary.trendInsight}
                  </p>
                </div>
              )}
              {summary.physioWarn && (
                <div className="px-3 py-2 bg-red-50 rounded-lg border border-red-100">
                  <p className="text-xs text-red-700 font-medium">
                    Consider seeing a physiotherapist — 3+ days of poor posture
                    detected.
                  </p>
                </div>
              )}
              <div className="pt-3 border-t border-[#e8eaed]">
                <p className="text-xs text-[#6b7280] mb-1">
                  Tip for next session:
                </p>
                <p className="text-sm text-[#374151]">{summary.tip}</p>
              </div>
            </div>
            <button
              onClick={() => setShowSummary(false)}
              className="w-full bg-blue-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-blue-700"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
