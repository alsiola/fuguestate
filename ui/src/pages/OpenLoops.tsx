import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { apiFetch, timeAgo } from "@/lib/utils";
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
  const { data, isLoading } = useQuery({
    queryKey: ["open-loops"],
    queryFn: () => apiFetch<Paginated<OpenLoop>>("/api/open-loops"),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">🔄 Open Loops</h2>
        <p className="text-muted-foreground mt-1">Unresolved contradictions, followups, risks, and todos</p>
      </div>

      {!data?.data.length ? (
        <Empty icon="🔄" title="No open loops" description="Everything is resolved. The agent's mind is at peace." />
      ) : (
        <div className="space-y-3">
          {data.data.map((loop) => (
            <Card key={loop.id}>
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
