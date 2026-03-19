import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { format } from "date-fns";
import { useMemo } from "react";
import type { Session } from "@/hooks/use-sessions";

interface Props {
  data: Session[];
}

export function HistoryChart({ data }: Props) {
  const gc = (s: number) => (s >= 80 ? "#10b981" : s >= 50 ? "#f59e0b" : "#ef4444");

  const chartData = useMemo(
    () =>
      [...data]
        .sort(
          (a, b) =>
            new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
        )
        .slice(-7)
        .map((s) => ({
          ...s,
          displayDate:
            s.createdAt && !isNaN(new Date(s.createdAt).getTime())
              ? format(new Date(s.createdAt), "MMM d")
              : s.timestamp && !isNaN(new Date(s.timestamp).getTime())
                ? format(new Date(s.timestamp), "MMM d")
                : "—",
        })),
    [data]
  );

  const hourly = useMemo(() => {
    const h: Record<number, number[]> = {};
    data.forEach((s) => {
      const d = new Date(s.createdAt ?? s.timestamp ?? 0);
      if (!isNaN(d.getTime())) {
        const hr = d.getHours();
        if (!h[hr]) h[hr] = [];
        h[hr].push(s.avg);
      }
    });
    return Object.entries(h)
      .map(([hr, sc]) => ({
        hour: parseInt(hr),
        avg: Math.round(sc.reduce((a, b) => a + b, 0) / sc.length),
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [data]);

  const worst =
    hourly.length > 0 ? hourly.reduce((w, h) => (h.avg < w.avg ? h : w), hourly[0]) : null;

  if (!data.length) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-[#9ca3af]">No sessions yet</p>
        <p className="text-[10px] text-[#9ca3af] mt-1">Auto-saves every 60 seconds</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="h-[130px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
            <XAxis
              dataKey="displayDate"
              stroke="#d1d5db"
              fontSize={9}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#d1d5db"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
            />
            <Tooltip
              cursor={{ fill: "#f3f4f6" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-white border border-[#e8eaed] rounded-lg p-2 shadow-sm text-xs">
                    <p className="text-[#6b7280] mb-1">{d.displayDate}</p>
                    <div className="flex gap-2">
                      <span>
                        Avg{" "}
                        <strong style={{ color: gc(d.avg) }}>{d.avg}</strong>
                      </span>
                      {d.min !== undefined && (
                        <span className="text-red-400">Min {d.min}</span>
                      )}
                      {d.max !== undefined && (
                        <span className="text-emerald-500">Max {d.max}</span>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="avg" radius={[3, 3, 0, 0]}>
              {chartData.map((e, i) => (
                <Cell key={i} fill={gc(e.avg)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {hourly.length >= 3 && (
        <div>
          <p className="text-[10px] text-[#9ca3af] mb-1">By hour</p>
          <div className="flex gap-1 flex-wrap">
            {hourly.map(({ hour, avg }) => (
              <div key={hour} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-4 h-4 rounded-sm"
                  style={{ backgroundColor: gc(avg) + "cc" }}
                  title={`${hour}:00`}
                />
                <span className="text-[8px] text-[#9ca3af]">{hour}</span>
              </div>
            ))}
          </div>
          {worst && (
            <p className="text-[10px] text-[#9ca3af] mt-1">
              Worst hour:{" "}
              <span className="text-red-400 font-medium">{worst.hour}:00</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
