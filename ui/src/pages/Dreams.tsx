import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { apiFetch, timeAgo } from "@/lib/utils";
import type { Dream, Paginated } from "@/lib/types";

const dreamTypeLabels: Record<string, string> = {
  conflict_resolution: "Conflict Resolution",
  insight: "Insight",
  consolidation: "Consolidation",
};

const dreamMoodStyles: Record<string, { border: string; bg: string; icon: string }> = {
  conflict_resolution: {
    border: "border-l-4 border-l-rose-500/60",
    bg: "bg-gradient-to-r from-rose-500/5 to-transparent",
    icon: "⚡",
  },
  insight: {
    border: "border-l-4 border-l-cyan-400/60",
    bg: "bg-gradient-to-r from-cyan-400/5 to-transparent",
    icon: "✨",
  },
  consolidation: {
    border: "border-l-4 border-l-amber-500/60",
    bg: "bg-gradient-to-r from-amber-500/5 to-transparent",
    icon: "🔥",
  },
};

export function DreamsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dreams"],
    queryFn: () => apiFetch<Paginated<Dream>>("/api/dreams"),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">🌙 Dreams</h2>
        <p className="text-muted-foreground mt-1">
          Conflict resolutions and insights from the agent's subconscious
        </p>
      </div>

      {!data?.data.length ? (
        <Empty icon="🌙" title="No dreams yet" description="The agent hasn't entered REM sleep with any conflicts to resolve." />
      ) : (
        <div className="space-y-4">
          {data.data.map((dream) => {
            const actions = JSON.parse(dream.actions_taken_json);
            const mood = dreamMoodStyles[dream.dream_type] ?? dreamMoodStyles.consolidation;
            return (
              <Link key={dream.id} to={dream.id}>
                <Card className={`${mood.border} ${mood.bg} hover:border-purple-500/30 transition-all hover:quest-glow cursor-pointer group ${!dream.delivered_at ? "border-purple-500/20 quest-glow" : ""}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="dream">{dreamTypeLabels[dream.dream_type] ?? dream.dream_type}</Badge>
                        {!dream.delivered_at && <Badge variant="default" className="animate-pulse bg-purple-500/80">new</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(dream.created_at)}</span>
                    </div>
                    <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors">
                      <span className="mr-2">{mood.icon}</span>{dream.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {dream.narrative_markdown.slice(0, 200)}...
                    </p>
                    {actions.length > 0 && (
                      <div className="mt-3 flex gap-2">
                        <Badge variant="outline">{actions.length} action{actions.length > 1 ? "s" : ""} taken</Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          <p className="text-xs text-muted-foreground text-center pt-2">
            {data.total} total dream{data.total !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
