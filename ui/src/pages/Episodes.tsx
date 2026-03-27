import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { apiFetch, apiPost, timeAgo } from "@/lib/utils";
import type { Episode, Paginated } from "@/lib/types";

const statusColors: Record<string, "active" | "disputed" | "stale"> = {
  open: "active",
  closed: "stale",
  abandoned: "disputed",
};

export function EpisodesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["episodes"],
    queryFn: () => apiFetch<Paginated<Episode>>("/api/episodes"),
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/episodes/${id}/close`, { outcome: "Closed via UI" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["episodes"] }),
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
              <Card key={ep.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={statusColors[ep.status] ?? "secondary"}>{ep.status}</Badge>
                      {ep.salience_score > 0.7 && <Badge variant="quest">high salience</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      {ep.status === "open" && (
                        <button
                          onClick={() => closeMutation.mutate(ep.id)}
                          className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors opacity-0 group-hover:opacity-100"
                        >close</button>
                      )}
                      <span className="text-xs text-muted-foreground">{timeAgo(ep.started_at)}</span>
                    </div>
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
