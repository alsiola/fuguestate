import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/utils";

interface HistoryPoint {
  confidence: number;
  recorded_at: string;
}

export function Sparkline({ beliefId }: { beliefId: string }) {
  const { data } = useQuery({
    queryKey: ["belief-history", beliefId],
    queryFn: () => apiFetch<HistoryPoint[]>(`/api/beliefs/${beliefId}/history`),
    staleTime: 60_000,
  });

  if (!data || data.length < 2) return null;

  const width = 60;
  const height = 20;
  const values = data.map((d) => d.confidence);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  // Color based on trend
  const trend = values[values.length - 1] - values[0];
  const color = trend > 0.05 ? "#4ade80" : trend < -0.05 ? "#f87171" : "#a78bfa";

  return (
    <svg width={width} height={height} className="inline-block ml-2 opacity-70">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
