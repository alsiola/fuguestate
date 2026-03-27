import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { apiFetch, apiPost, timeAgo } from "@/lib/utils";
import type { OpenLoop, Paginated } from "@/lib/types";

const loopTypeColors: Record<string, "loop" | "dream" | "quest" | "belief"> = {
  contradiction: "loop",
  followup: "dream",
  risk: "quest",
  todo: "belief",
};

const loopTypeIcons: Record<string, string> = {
  contradiction: "⚡",
  followup: "👉",
  risk: "⚠️",
  todo: "📌",
};

export function OpenLoopsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["open-loops"],
    queryFn: () => apiFetch<Paginated<OpenLoop>>("/api/open-loops"),
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/open-loops/${id}/resolve`, { resolution: "Resolved via UI" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["open-loops"] }),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/open-loops/${id}/dismiss`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["open-loops"] }),
  });

  const resolveNowMutation = useMutation({
    mutationFn: () => apiPost("/api/open-loops/resolve-now"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["open-loops"] }),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">🔄 Open Loops</h2>
          <p className="text-muted-foreground mt-1">Unresolved contradictions, followups, risks, and todos</p>
        </div>
        {(data?.data.length ?? 0) > 0 && (
          <button
            onClick={() => resolveNowMutation.mutate()}
            disabled={resolveNowMutation.isPending}
            className="text-xs px-3 py-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {resolveNowMutation.isPending ? "resolving..." : "auto-resolve"}
          </button>
        )}
      </div>

      {!data?.data.length ? (
        <Empty icon="🔄" title="No open loops" description="Everything is resolved. The agent's mind is at peace." />
      ) : (
        <div className="space-y-3">
          {data.data.map((loop) => (
            <Card key={loop.id} className="group">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl mt-0.5">{loopTypeIcons[loop.loop_type] ?? "❓"}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={loopTypeColors[loop.loop_type] ?? "secondary"}>
                        {loop.loop_type}
                      </Badge>
                      <div className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          priority: {Math.round(loop.priority * 100)}%
                        </span>
                        <span className="text-xs text-muted-foreground">{timeAgo(loop.created_at)}</span>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => resolveMutation.mutate(loop.id)}
                            className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                          >resolve</button>
                          <button
                            onClick={() => dismissMutation.mutate(loop.id)}
                            className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
                          >dismiss</button>
                        </div>
                      </div>
                    </div>
                    <h3 className="font-semibold text-sm">{loop.title}</h3>
                    {loop.description && (
                      <p className="text-sm text-muted-foreground mt-1">{loop.description}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground text-center pt-2">{data.total} open loops</p>
        </div>
      )}
    </div>
  );
}
