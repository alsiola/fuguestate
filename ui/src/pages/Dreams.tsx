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
            return (
              <Link key={dream.id} to={dream.id}>
                <Card className="hover:border-purple-500/30 transition-all hover:quest-glow cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="dream">{dreamTypeLabels[dream.dream_type] ?? dream.dream_type}</Badge>
                        {dream.delivered_at && <Badge variant="secondary">delivered</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(dream.created_at)}</span>
                    </div>
                    <h3 className="font-semibold text-lg mb-2 group-hover:text-primary transition-colors">
                      {dream.title}
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
