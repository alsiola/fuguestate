import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { apiFetch, timeAgo } from "@/lib/utils";
import type { SpiritQuest, Paginated } from "@/lib/types";

export function SpiritQuestsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["spirit-quests"],
    queryFn: () => apiFetch<Paginated<SpiritQuest>>("/api/spirit-quests"),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">🍄 Spirit Quests</h2>
        <p className="text-muted-foreground mt-1">
          Deep belief reviews that extract guiding principles and rewrite understanding
        </p>
      </div>

      {!data?.data.length ? (
        <Empty
          icon="🍄"
          title="No spirit quests yet"
          description="Spirit quests happen every 12 sleep cycles. The agent needs more time to dream."
        />
      ) : (
        <div className="space-y-4">
          {data.data.map((quest) => {
            const principles = JSON.parse(quest.guiding_principles_json);
            const insights = JSON.parse(quest.insights_json);
            const hallucinations = JSON.parse(quest.hallucinations_json);

            return (
              <Link key={quest.id} to={quest.id}>
                <Card className={`hover:border-amber-500/30 transition-all hover:quest-glow cursor-pointer group ${!quest.delivered_at ? "border-amber-500/20 quest-glow" : ""}`}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="quest">Spirit Quest</Badge>
                        {quest.drug_used && <Badge variant="dream">{quest.drug_used}</Badge>}
                        {quest.style_used && <Badge variant="secondary">{quest.style_used}</Badge>}
                        {!quest.delivered_at && <Badge variant="default" className="animate-pulse bg-amber-500/80">new</Badge>}
                      </div>
                      <span className="text-xs text-muted-foreground">{timeAgo(quest.created_at)}</span>
                    </div>

                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                      {quest.narrative_markdown.slice(0, 250)}...
                    </p>

                    <div className="flex flex-wrap gap-2">
                      {principles.length > 0 && (
                        <Badge variant="outline">{principles.length} principle{principles.length > 1 ? "s" : ""}</Badge>
                      )}
                      {insights.length > 0 && (
                        <Badge variant="outline">{insights.length} insight{insights.length > 1 ? "s" : ""}</Badge>
                      )}
                      {hallucinations.length > 0 && (
                        <Badge variant="destructive">{hallucinations.length} drug-induced stupor{hallucinations.length > 1 ? "s" : ""}</Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          <p className="text-xs text-muted-foreground text-center pt-2">
            {data.total} total quest{data.total !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  );
}
