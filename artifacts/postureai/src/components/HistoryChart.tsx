import { format } from "date-fns";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface SessionRecord {
  id: string;
  score: number;
  goodPercent: number;
  duration: number;
  createdAt?: string | number;
  timestamp?: string | number;
}

interface HistoryChartProps {
  sessions: SessionRecord[];
  loading?: boolean;
}

export default function HistoryChart({ sessions, loading }: HistoryChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[#6b7280] text-xs tracking-widest">
        Loading history...
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[#6b7280] text-xs tracking-widest">
        No sessions recorded yet
      </div>
    );
  }

  const data = sessions.map((session) => {
    const displayDate: string = session.createdAt
      ? format(new Date(session.createdAt), "MMM dd HH:mm")
      : (session as any).timestamp
        ? format(new Date((session as any).timestamp), "MMM dd HH:mm")
        : "No date";

    return {
      date: displayDate,
      score: session.score,
      goodPercent: session.goodPercent,
      duration: Math.floor(session.duration / 60),
    };
  });

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e3a" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#4b5563", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: "#4b5563", fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: "#111128",
            border: "1px solid #2a2a4a",
            borderRadius: 4,
            fontSize: 11,
            color: "#e2e8f0",
          }}
          labelStyle={{ color: "#a855f7", fontWeight: "bold" }}
        />
        <Area
          type="monotone"
          dataKey="score"
          stroke="#a855f7"
          strokeWidth={2}
          fill="url(#scoreGrad)"
          dot={{ fill: "#a855f7", r: 3 }}
          activeDot={{ r: 5, fill: "#c084fc" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
