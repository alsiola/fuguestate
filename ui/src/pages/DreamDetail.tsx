import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Markdown } from "@/components/Markdown";
import { Loading } from "@/components/Loading";
import { apiFetch, formatDate } from "@/lib/utils";
import type { Dream } from "@/lib/types";

export function DreamDetailPage() {
  const { id } = useParams();
  const { data: dream, isLoading } = useQuery({
    queryKey: ["dream", id],
    queryFn: () => apiFetch<Dream>(`/api/dreams/${id}`),
  });

  if (isLoading) return <Loading />;
  if (!dream) return <p>Not found</p>;

  const actions = JSON.parse(dream.actions_taken_json);
  const linkedBeliefs = JSON.parse(dream.linked_belief_ids_json);
  const linkedLoops = JSON.parse(dream.linked_loop_ids_json);

  return (
    <div className="space-y-6 animate-fade-in">
      <Link to="/dreams" className="text-sm text-muted-foreground hover:text-primary transition-colors">
        &larr; Back to Dreams
      </Link>

      <div>
        <div className="flex items-center gap-3 mb-2">
          <Badge variant="dream">{dream.dream_type.replace("_", " ")}</Badge>
          <span className="text-sm text-muted-foreground">{formatDate(dream.created_at)}</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight">{dream.title}</h2>
      </div>

      {/* Narrative */}
      <Card className="quest-glow border-purple-500/20">
        <CardContent className="p-6">
          <div className="dream-narrative pl-5">
            <Markdown content={dream.narrative_markdown} />
          </div>
        </CardContent>
      </Card>

      {/* Actions taken */}
      {actions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Actions Taken</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {actions.map((action: string, i: number) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-primary mt-0.5">&#x2022;</span>
                  <p className="text-sm">{typeof action === "string" ? action : JSON.stringify(action)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked items */}
      {(linkedBeliefs.length > 0 || linkedLoops.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Linked Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {linkedBeliefs.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Beliefs</p>
                <div className="flex flex-wrap gap-1">
                  {linkedBeliefs.map((bid: string) => (
                    <Badge key={bid} variant="belief" className="text-xs font-mono">
                      {bid.slice(0, 8)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {linkedLoops.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Open Loops</p>
                  <div className="flex flex-wrap gap-1">
                    {linkedLoops.map((lid: string) => (
                      <Badge key={lid} variant="loop" className="text-xs font-mono">
                        {lid.slice(0, 8)}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
