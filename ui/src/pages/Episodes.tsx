import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { apiFetch, timeAgo } from "@/lib/utils";
import type { Episode, Paginated } from "@/lib/types";

const statusColors: Record<string, "active" | "disputed" | "stale"> = {
  open: "active",
  closed: "stale",
  abandoned: "disputed",
};

export function EpisodesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["episodes"],
    queryFn: () => apiFetch<Paginated<Episode>>("/api/episodes"),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">📖 Episodes</h2>
        <p className="text-muted-foreground mt-1">Structured summaries of agent work sessions</p>
      </div>

      {!data?.data.length ? (
        <Empty icon="📖" title="No episodes" description="No work sessions have been recorded yet." />
      ) : (
        <div className="space-y-3">
          {data.data.map((ep) => {
            const lessons = JSON.parse(ep.lesson_candidates_json);
            return (
              <Card key={ep.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={statusColors[ep.status] ?? "secondary"}>{ep.status}</Badge>
                      {ep.salience_score > 0.7 && <Badge variant="quest">high salience</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">{timeAgo(ep.started_at)}</span>
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{ep.title}</h3>
                  {ep.goal && <p className="text-xs text-muted-foreground mb-2">Goal: {ep.goal}</p>}
                  {ep.outcome_summary && (
                    <p className="text-sm text-muted-foreground mt-1">{ep.outcome_summary}</p>
                  )}
                  {lessons.length > 0 && (
                    <div className="mt-2">
                      <Badge variant="outline" className="text-xs">{lessons.length} lesson{lessons.length > 1 ? "s" : ""}</Badge>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <p className="text-xs text-muted-foreground text-center pt-2">{data.total} total episodes</p>
        </div>
      )}
    </div>
  );
}
