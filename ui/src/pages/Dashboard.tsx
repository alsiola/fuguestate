import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Markdown } from "@/components/Markdown";
import { apiFetch, timeAgo } from "@/lib/utils";
import type { Stats, TimelineItem } from "@/lib/types";

const statCards = [
  { key: "beliefs" as const, label: "Active Beliefs", icon: "💎", link: "/beliefs" },
  { key: "dreams" as const, label: "Dreams", icon: "🌙", link: "/dreams" },
  { key: "quests" as const, label: "Spirit Quests", icon: "🍄", link: "/spirit-quests" },
  { key: "episodes" as const, label: "Episodes", icon: "📖", link: "/episodes" },
  { key: "openLoops" as const, label: "Open Loops", icon: "🔄", link: "/open-loops" },
  { key: "events" as const, label: "Raw Events", icon: "📡", link: "" },
];

const typeConfig: Record<string, { badge: "dream" | "quest" | "episode"; icon: string; linkPrefix: string }> = {
  dream: { badge: "dream", icon: "🌙", linkPrefix: "/dreams/" },
  spirit_quest: { badge: "quest", icon: "🍄", linkPrefix: "/spirit-quests/" },
  episode: { badge: "episode", icon: "📖", linkPrefix: "/episodes/" },
};

export function DashboardPage() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: () => apiFetch<Stats>("/api/stats") });
  const briefing = useQuery({ queryKey: ["briefing"], queryFn: () => apiFetch<{ markdown: string }>("/api/briefing") });
  const timeline = useQuery({ queryKey: ["timeline"], queryFn: () => apiFetch<TimelineItem[]>("/api/timeline") });

  if (stats.isLoading) return <Loading />;

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground mt-1">Agent memory at a glance</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {statCards.map((s) => (
          <Link key={s.key} to={s.link}>
            <Card className="hover:border-primary/30 transition-colors cursor-pointer">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <div className="flex items-baseline gap-2">
                      <p className="text-3xl font-bold mt-1">{stats.data?.[s.key] ?? 0}</p>
                      {s.key === "dreams" && (stats.data?.undeliveredDreams ?? 0) > 0 && (
                        <span className="text-xs text-purple-400 animate-pulse">{stats.data?.undeliveredDreams} new</span>
                      )}
                      {s.key === "quests" && (stats.data?.undeliveredQuests ?? 0) > 0 && (
                        <span className="text-xs text-amber-400 animate-pulse">{stats.data?.undeliveredQuests} new</span>
                      )}
                    </div>
                  </div>
                  <span className="text-3xl opacity-60">{s.icon}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Agent Briefing */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Agent Briefing</h3>
        {briefing.isLoading ? (
          <Loading />
        ) : briefing.data ? (
          <Card className="border-primary/20">
            <CardContent className="p-6">
              <Markdown content={briefing.data.markdown} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Uptime */}
      {stats.data && (
        <p className="text-xs text-muted-foreground">
          Server uptime: {Math.floor(stats.data.uptime / 3600)}h {Math.floor((stats.data.uptime % 3600) / 60)}m
        </p>
      )}

      {/* Timeline */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Recent Activity</h3>
        {timeline.isLoading ? (
          <Loading />
        ) : !timeline.data?.length ? (
          <p className="text-muted-foreground text-sm">No activity yet. The agent hasn't dreamed.</p>
        ) : (
          <div className="space-y-3">
            {timeline.data.map((item) => {
              const config = typeConfig[item.type] ?? typeConfig.episode;
              return (
                <Link key={`${item.type}-${item.id}`} to={config.linkPrefix + item.id}>
                  <Card className="hover:border-primary/20 transition-colors cursor-pointer">
                    <CardContent className="p-4 flex items-start gap-3">
                      <span className="text-xl mt-0.5">{config.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={config.badge}>{item.type.replace("_", " ")}</Badge>
                          <span className="text-xs text-muted-foreground">{timeAgo(item.ts)}</span>
                        </div>
                        <p className="font-medium text-sm truncate">{item.label}</p>
                        {item.detail && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.detail}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
