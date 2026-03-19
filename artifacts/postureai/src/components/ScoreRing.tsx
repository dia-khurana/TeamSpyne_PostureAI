import { cn } from "@/lib/utils";

interface ScoreRingProps {
  score: number;
  size?: number;
}

function getLabel(s: number) {
  if (s >= 80) return { text: "EXCELLENT", sub: "Keep it up!" };
  if (s >= 60) return { text: "GOOD", sub: "Minor corrections needed" };
  if (s >= 40) return { text: "FAIR", sub: "Time to readjust" };
  return { text: "POOR", sub: "Take a break and reset" };
}

export default function ScoreRing({ score, size = 160 }: ScoreRingProps) {
  const displayedScore = Math.max(0, Math.min(100, Math.round(score)));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayedScore / 100) * circumference;

  let ringColor = "#10b981";
  let textClass = "text-[#10b981]";
  if (displayedScore < 40) {
    ringColor = "#ef4444";
    textClass = "text-[#ef4444]";
  } else if (displayedScore < 70) {
    ringColor = "#f59e0b";
    textClass = "text-[#f59e0b]";
  }

  const label = getLabel(displayedScore);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#1e1e3a"
            strokeWidth="10"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={ringColor}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.5s ease, stroke 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn("text-3xl font-bold font-mono", textClass)}>
            {displayedScore}
          </span>
        </div>
      </div>
      <div className={cn("text-xs font-bold tracking-widest mt-1", textClass)}>
        {label.text}
      </div>
      <div className="text-[10px] text-[#6b7280] mt-1 text-center px-2">
        {label.sub}
      </div>
    </div>
  );
}
