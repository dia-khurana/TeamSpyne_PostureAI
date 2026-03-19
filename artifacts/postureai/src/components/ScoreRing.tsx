import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  score: number;
  color: "green" | "yellow" | "red";
  hasDetected?: boolean;
}

function getColors(c: "green" | "yellow" | "red") {
  if (c === "red") return { hex: "#ef4444", tc: "text-red-500" };
  if (c === "yellow") return { hex: "#f59e0b", tc: "text-amber-500" };
  return { hex: "#3b82f6", tc: "text-blue-600" };
}

function getLabel(s: number) {
  if (s >= 80) return { text: "Excellent", sub: "Keep it up!", c: "text-emerald-600" };
  if (s >= 60) return { text: "Good", sub: "Minor corrections", c: "text-blue-600" };
  if (s >= 40) return { text: "Fair", sub: "Time to readjust", c: "text-amber-500" };
  return { text: "Poor", sub: "Take a break", c: "text-red-500" };
}

export function ScoreRing({ score, color, hasDetected = false }: Props) {
  const [d, setD] = useState(score);
  useEffect(() => { setD(score); }, [score]);
  const { hex, tc } = getColors(color);
  const label = getLabel(d);
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="score-ring-container"
        style={{
          ["--ring-gradient" as any]: hasDetected
            ? `conic-gradient(${hex} ${pct}%, #e8eaed 0%)`
            : `conic-gradient(#e8eaed 100%, #e8eaed 0%)`,
        }}
      >
        <div className="score-ring-inner">
          <div className="text-[10px] text-[#9ca3af] uppercase tracking-wider mb-0.5">Score</div>
          {hasDetected ? (
            <div className={cn("text-3xl font-semibold", tc)}>{d}</div>
          ) : (
            <div className="text-2xl font-light text-[#d1d5db]">—</div>
          )}
        </div>
      </div>
      <div className="text-center">
        {hasDetected ? (
          <>
            <div className={cn("text-sm font-semibold", label.c)}>{label.text}</div>
            <div className="text-[11px] text-[#9ca3af] mt-0.5">{label.sub}</div>
          </>
        ) : (
          <div className="text-xs text-[#9ca3af]">Waiting for detection...</div>
        )}
      </div>
    </div>
  );
}
