import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Markdown } from "@/components/Markdown";
import { Loading } from "@/components/Loading";
import { apiFetch, formatDate } from "@/lib/utils";
import type { SpiritQuest } from "@/lib/types";

interface Insight {
  insight: string;
  applied?: boolean;
  description?: string;
}

interface BeliefSnapshot {
  id: string;
  proposition: string;
  action?: string;
}

export function SpiritQuestDetailPage() {
  const { id } = useParams();
  const { data: quest, isLoading } = useQuery({
    queryKey: ["spirit-quest", id],
    queryFn: () => apiFetch<SpiritQuest>(`/api/spirit-quests/${id}`),
  });

  if (isLoading) return <Loading />;
  if (!quest) return <p>Not found</p>;

  const principles = JSON.parse(quest.guiding_principles_json) as string[];
  const hallucinations = JSON.parse(quest.hallucinations_json) as string[];
  const insights = JSON.parse(quest.insights_json) as Insight[];
  const beliefsBefore = JSON.parse(quest.beliefs_before_json) as BeliefSnapshot[];
  const beliefsAfter = JSON.parse(quest.beliefs_after_json) as BeliefSnapshot[];

  // Build a map of after-beliefs by id for diffing
  const afterMap = new Map(beliefsAfter.map((b) => [b.id, b]));

  return (
    <div className="space-y-6 animate-fade-in">
      <Link to="/spirit-quests" className="text-sm text-muted-foreground hover:text-primary transition-colors">
        &larr; Back to Spirit Quests
      </Link>

      <div>
        <div className="flex items-center gap-3 mb-2">
          <Badge variant="quest">Spirit Quest</Badge>
          {quest.style_used && <Badge variant="secondary">{quest.style_used}</Badge>}
          <span className="text-sm text-muted-foreground">{formatDate(quest.created_at)}</span>
        </div>
        <h2 className="text-3xl font-bold tracking-tight">🍄 Spirit Quest</h2>
      </div>

      {/* Narrative - the trip report */}
      <Card className="quest-glow border-amber-500/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <span>The Vision</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="dream-narrative pl-5">
            <Markdown content={quest.narrative_markdown} />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="principles">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="principles">Principles ({principles.length})</TabsTrigger>
          <TabsTrigger value="beliefs">Core Beliefs ({beliefsBefore.length})</TabsTrigger>
          <TabsTrigger value="insights">Insights ({insights.length})</TabsTrigger>
          {hallucinations.length > 0 && (
            <TabsTrigger value="hallucinations">Drug-Induced Stupor ({hallucinations.length})</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="principles">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Guiding Principles Discovered</CardTitle>
            </CardHeader>
            <CardContent>
              {principles.length === 0 ? (
                <p className="text-muted-foreground text-sm">No principles extracted.</p>
              ) : (
                <div className="space-y-4">
                  {principles.map((p, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-primary font-bold text-lg mt-0.5">{i + 1}.</span>
                      <p className="text-sm leading-relaxed">{typeof p === "string" ? p : JSON.stringify(p)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="beliefs">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Core Beliefs at Time of Quest</CardTitle>
            </CardHeader>
            <CardContent>
              {beliefsBefore.length === 0 ? (
                <p className="text-muted-foreground text-sm">No beliefs recorded.</p>
              ) : (
                <div className="space-y-4">
                  {beliefsBefore.map((belief) => {
                    const after = afterMap.get(belief.id);
                    const wasRewritten = after && after.proposition !== belief.proposition;
                    const wasRejected = after?.action?.includes("rejected");
                    const wasKept = after?.action?.includes("kept") || (!wasRewritten && !wasRejected);

                    return (
                      <div key={belief.id} className="p-4 rounded-lg border bg-card/50">
                        <div className="flex items-start gap-3">
                          <span className="text-lg mt-0.5">💎</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">{belief.proposition}</p>
                            {wasRewritten && after && (
                              <div className="mt-3 p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                                <p className="text-xs text-green-400 font-medium mb-1">Rewritten to</p>
                                <p className="text-sm">{after.proposition}</p>
                              </div>
                            )}
                            <div className="mt-2">
                              {wasRewritten ? (
                                <Badge variant="quest">rewritten</Badge>
                              ) : wasRejected ? (
                                <Badge variant="stale">rewrite rejected</Badge>
                              ) : wasKept ? (
                                <Badge variant="active">kept</Badge>
                              ) : (
                                <Badge variant="secondary">unchanged</Badge>
                              )}
                              {after?.action && (
                                <span className="text-xs text-muted-foreground ml-2">{after.action}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="insights">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Insights Applied</CardTitle>
            </CardHeader>
            <CardContent>
              {insights.length === 0 ? (
                <p className="text-muted-foreground text-sm">No insights from this quest.</p>
              ) : (
                <div className="space-y-6">
                  {insights.map((ins, i) => {
                    const text = typeof ins === "string" ? ins : ins.insight || ins.description || JSON.stringify(ins);
                    // Parse "Rewrote: "before" → "after"" pattern
                    const rewriteMatch = text.match(/^Rewrote:\s*"(.+?)"\s*→\s*"(.+)"$/s);
                    // Parse "Split: "original" → "new1" + "new2" + ..." pattern
                    const splitMatch = !rewriteMatch && text.match(/^Split:\s*"(.+?)"\s*→\s*(.+)$/s);

                    if (rewriteMatch) {
                      return (
                        <div key={i} className="space-y-3">
                          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                            <p className="text-xs text-red-400 font-medium mb-1">Before</p>
                            <p className="text-sm">{rewriteMatch[1]}</p>
                          </div>
                          <div className="flex justify-center">
                            <span className="text-muted-foreground">↓</span>
                          </div>
                          <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                            <p className="text-xs text-green-400 font-medium mb-1">After</p>
                            <p className="text-sm">{rewriteMatch[2]}</p>
                          </div>
                        </div>
                      );
                    }

                    if (splitMatch) {
                      const parts = splitMatch[2].match(/"[^"]+"/g)?.map(s => s.slice(1, -1)) || [splitMatch[2]];
                      return (
                        <div key={i} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="quest">split</Badge>
                          </div>
                          <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                            <p className="text-xs text-red-400 font-medium mb-1">Original</p>
                            <p className="text-sm">{splitMatch[1]}</p>
                          </div>
                          <div className="flex justify-center">
                            <span className="text-muted-foreground">↓</span>
                          </div>
                          <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/10">
                            <p className="text-xs text-green-400 font-medium mb-1">Split into {parts.length} beliefs</p>
                            <div className="space-y-2 mt-1">
                              {parts.map((p, j) => (
                                <p key={j} className="text-sm pl-2 border-l-2 border-green-500/20">{p}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={i} className="p-3 rounded-lg bg-muted/50">
                        <p className="text-sm font-medium">{text}</p>
                        {typeof ins === "object" && ins.applied !== undefined && (
                          <Badge variant={ins.applied ? "active" : "stale"} className="mt-2">
                            {ins.applied ? "applied" : "not applied"}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {hallucinations.length > 0 && (
          <TabsContent value="hallucinations">
            <Card className="border-destructive/20">
              <CardHeader>
                <CardTitle className="text-lg">Drug-Induced Stupor</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  These insights were generated during the quest but failed the sobriety check.
                </p>
                <div className="space-y-6">
                  {hallucinations.map((h, i) => {
                    const text = typeof h === "string" ? h : JSON.stringify(h);
                    // Parse "Rejected rewrite: "before" → "after" (reason)" pattern
                    const rewriteMatch = text.match(/^Rejected rewrite:\s*"(.+?)"\s*→\s*"(.+?)"\s*\((.+)\)$/s);
                    // Parse "Rejected consolidation: "a" + "b" + ... → "merged" (reason)" pattern
                    const consolidationMatch = !rewriteMatch && text.match(/^Rejected consolidation:\s*(.+?)\s*→\s*"(.+?)"\s*\((.+)\)$/s);
                    // Parse "Rejected split: "original" → "new1" + "new2" + ... (reason)" pattern
                    const splitMatch = !rewriteMatch && !consolidationMatch && text.match(/^Rejected split:\s*"(.+?)"\s*→\s*(.+)\s*\((\w+)\)$/s);

                    if (rewriteMatch) {
                      return (
                        <div key={i} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="retired">rejected</Badge>
                            <span className="text-xs text-muted-foreground">{rewriteMatch[3]}</span>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 border border-muted">
                            <p className="text-xs text-muted-foreground font-medium mb-1">Before</p>
                            <p className="text-sm">{rewriteMatch[1]}</p>
                          </div>
                          <div className="flex justify-center">
                            <span className="text-muted-foreground">↓</span>
                          </div>
                          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                            <p className="text-xs text-red-400 font-medium mb-1">Proposed</p>
                            <p className="text-sm opacity-70">{rewriteMatch[2]}</p>
                          </div>
                        </div>
                      );
                    }

                    if (consolidationMatch) {
                      // Parse the source beliefs: "a" + "b" + "c"
                      const sources = consolidationMatch[1].match(/"[^"]+"/g)?.map(s => s.slice(1, -1)) || [consolidationMatch[1]];
                      return (
                        <div key={i} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="retired">rejected</Badge>
                            <span className="text-xs text-muted-foreground">{consolidationMatch[3]}</span>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 border border-muted">
                            <p className="text-xs text-muted-foreground font-medium mb-1">Sources ({sources.length} beliefs)</p>
                            <div className="space-y-2 mt-1">
                              {sources.map((s, j) => (
                                <p key={j} className="text-sm pl-2 border-l-2 border-muted-foreground/20">{s}</p>
                              ))}
                            </div>
                          </div>
                          <div className="flex justify-center">
                            <span className="text-muted-foreground">↓</span>
                          </div>
                          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                            <p className="text-xs text-red-400 font-medium mb-1">Proposed Consolidation</p>
                            <p className="text-sm opacity-70">{consolidationMatch[2]}</p>
                          </div>
                        </div>
                      );
                    }

                    if (splitMatch) {
                      const parts = splitMatch[2].match(/"[^"]+"/g)?.map(s => s.slice(1, -1)) || [splitMatch[2]];
                      return (
                        <div key={i} className="space-y-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="retired">rejected</Badge>
                            <span className="text-xs text-muted-foreground">{splitMatch[3]}</span>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/30 border border-muted">
                            <p className="text-xs text-muted-foreground font-medium mb-1">Original</p>
                            <p className="text-sm">{splitMatch[1]}</p>
                          </div>
                          <div className="flex justify-center">
                            <span className="text-muted-foreground">↓</span>
                          </div>
                          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                            <p className="text-xs text-red-400 font-medium mb-1">Proposed Split ({parts.length} beliefs)</p>
                            <div className="space-y-2 mt-1">
                              {parts.map((p, j) => (
                                <p key={j} className="text-sm opacity-70 pl-2 border-l-2 border-destructive/20">{p}</p>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={i} className="p-3 rounded-lg bg-destructive/5 border border-destructive/10">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="retired">rejected</Badge>
                        </div>
                        <p className="text-sm opacity-70">{text}</p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
