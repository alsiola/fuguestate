import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/utils";

interface DreadData {
  dread: number;
  label: string;
  openContradictions: number;
  disputedBeliefs: number;
  staleBeliefs: number;
  undeliveredDreams: number;
  openLoops: number;
}

const dreadColors: Record<string, string> = {
  Serene: "text-green-400",
  Contemplative: "text-blue-400",
  Uneasy: "text-yellow-400",
  Anxious: "text-orange-400",
  Spiraling: "text-rose-400",
  "Existential Crisis": "text-red-500",
  "Complete Ego Death": "text-red-600",
};

export function DreadMeter() {
  const { data } = useQuery({
    queryKey: ["dread"],
    queryFn: () => apiFetch<DreadData>("/api/dread"),
    refetchInterval: 15_000,
  });

  if (!data) return null;

  const { dread, label } = data;
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (dread / 100) * circumference;
  const colorClass = dreadColors[label] ?? "text-purple-400";

  // Pulse animation intensity scales with dread
  const pulseClass = dread > 50 ? "animate-pulse" : "";

  return (
    <Card className="border-muted/50">
      <CardContent className="p-5">
        <div className="flex items-center gap-5">
          {/* Circular gauge */}
          <div className={`relative w-24 h-24 flex-shrink-0 ${pulseClass}`}>
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
              <circle
                cx="50" cy="50" r="45"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                className={`${colorClass} transition-all duration-1000`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${colorClass}`}>{dread}</span>
            </div>
          </div>

          <div className="flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Existential Dread</p>
            <p className={`text-lg font-semibold ${colorClass}`}>{label}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
              {data.openContradictions > 0 && <span>⚡ {data.openContradictions} contradictions</span>}
              {data.disputedBeliefs > 0 && <span>⚠️ {data.disputedBeliefs} disputed</span>}
              {data.staleBeliefs > 0 && <span>👻 {data.staleBeliefs} stale</span>}
              {data.openLoops > 0 && <span>🔄 {data.openLoops} open loops</span>}
              {data.undeliveredDreams > 0 && <span>🌙 {data.undeliveredDreams} unseen dreams</span>}
              {dread === 0 && <span>🧘 All is well</span>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
