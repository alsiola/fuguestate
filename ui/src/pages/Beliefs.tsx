import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loading } from "@/components/Loading";
import { Empty } from "@/components/Empty";
import { Sparkline } from "@/components/Sparkline";
import { apiFetch, timeAgo } from "@/lib/utils";
import type { Belief, Paginated } from "@/lib/types";

const statusVariants: Record<string, "active" | "disputed" | "stale" | "retired"> = {
  active: "active",
  disputed: "disputed",
  stale: "stale",
  retired: "retired",
};

export function BeliefsPage() {
  const [statusFilter, setStatusFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["beliefs", statusFilter],
    queryFn: () => apiFetch<Paginated<Belief>>(`/api/beliefs${statusFilter ? `?status=${statusFilter}` : ""}`),
  });

  if (isLoading) return <Loading />;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">💎 Beliefs</h2>
        <p className="text-muted-foreground mt-1">What the agent believes to be true, with confidence scores</p>
      </div>

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="">All ({data?.total ?? 0})</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="disputed">Disputed</TabsTrigger>
          <TabsTrigger value="stale">Stale</TabsTrigger>
          <TabsTrigger value="retired">Retired</TabsTrigger>
        </TabsList>
      </Tabs>

      {!data?.data.length ? (
        <Empty icon="💎" title="No beliefs" description="The agent hasn't formed any beliefs yet." />
      ) : (
        <div className="space-y-3">
          {data.data.map((belief) => {
            const evidenceFor = JSON.parse(belief.evidence_for_json);
            const evidenceAgainst = JSON.parse(belief.evidence_against_json);
            const confidencePct = Math.round(belief.confidence * 100);

            return (
              <Card key={belief.id} className="group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Confidence meter */}
                    <div className="flex flex-col items-center gap-1 pt-1">
                      <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold"
                        style={{
                          borderColor: `hsl(${confidencePct * 1.2}, 70%, 50%)`,
                          color: `hsl(${confidencePct * 1.2}, 70%, 60%)`,
                        }}
                      >
                        {confidencePct}
                      </div>
                      <Sparkline beliefId={belief.id} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={statusVariants[belief.status] ?? "secondary"}>
                          {belief.status}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {belief.scope_type}{belief.scope_key ? `:${belief.scope_key}` : ""}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {timeAgo(belief.first_derived_at)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{belief.proposition}</p>

                      {/* Evidence summary */}
                      <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
                        {evidenceFor.length > 0 && (
                          <span className="text-green-400">{evidenceFor.length} supporting</span>
                        )}
                        {evidenceAgainst.length > 0 && (
                          <span className="text-red-400">{evidenceAgainst.length} against</span>
                        )}
                        <span>decay: {belief.decay_rate}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
