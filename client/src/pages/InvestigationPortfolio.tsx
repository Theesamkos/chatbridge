/**
 * Investigation Portfolio — student view of completed artifact investigations.
 * Shows a grid of investigation cards; clicking one opens a detail modal.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Calendar, ChevronLeft, FlaskConical, Sparkles, Star } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type Investigation = {
  id: string;
  conversationId: string;
  artifactTitle: string;
  artifactThumbnail: string | null;
  submittedAt: Date;
  inquiryQuestion: string;
  conclusion: string;
  annotations: unknown[];
  llmFeedback: string | null;
  score: Record<string, unknown> | null;
};

// ─── Score badge ──────────────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: Record<string, unknown> | null }) {
  if (!score) return null;
  const overall = typeof score.overall === "number" ? score.overall : null;
  if (overall === null) return null;

  const pct = Math.round(overall * 100);
  const variant =
    pct >= 80 ? "default" : pct >= 60 ? "secondary" : "outline";

  return (
    <Badge variant={variant} className="gap-1 font-mono text-xs">
      <Star className="h-3 w-3" />
      {pct}%
    </Badge>
  );
}

// ─── Investigation card ───────────────────────────────────────────────────────

function InvestigationCard({
  inv,
  onClick,
}: {
  inv: Investigation;
  onClick: () => void;
}) {
  const date = new Date(inv.submittedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <button
      onClick={onClick}
      className="group rounded-xl border bg-card text-left p-0 overflow-hidden hover:shadow-md transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]"
    >
      {/* Thumbnail */}
      <div className="h-32 bg-muted/40 flex items-center justify-center relative overflow-hidden">
        {inv.artifactThumbnail ? (
          <img
            src={inv.artifactThumbnail}
            alt={inv.artifactTitle}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 motion-reduce:transition-none"
          />
        ) : (
          <FlaskConical className="h-10 w-10 text-muted-foreground/40" />
        )}
        {inv.score && (
          <div className="absolute top-2 right-2">
            <ScoreBadge score={inv.score} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col gap-2">
        <p className="font-semibold text-sm leading-tight line-clamp-2">{inv.artifactTitle}</p>
        {inv.inquiryQuestion && (
          <p className="text-xs text-muted-foreground line-clamp-2 italic">
            "{inv.inquiryQuestion}"
          </p>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
          <Calendar className="h-3 w-3 shrink-0" />
          <span>{date}</span>
          {inv.annotations.length > 0 && (
            <>
              <span className="text-border">·</span>
              <span>{inv.annotations.length} annotation{inv.annotations.length !== 1 ? "s" : ""}</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function InvestigationModal({
  inv,
  onClose,
}: {
  inv: Investigation;
  onClose: () => void;
}) {
  const score = inv.score;
  const dimensions: Array<{ label: string; key: string }> = [
    { label: "Observation Quality", key: "observation" },
    { label: "Evidence Use", key: "evidence" },
    { label: "Historical Reasoning", key: "reasoning" },
    { label: "Inquiry Depth", key: "depth" },
  ];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto gap-0 p-0">
        {/* Header thumbnail */}
        <div className="h-40 bg-muted/40 flex items-center justify-center overflow-hidden rounded-t-lg">
          {inv.artifactThumbnail ? (
            <img
              src={inv.artifactThumbnail}
              alt={inv.artifactTitle}
              className="w-full h-full object-cover"
            />
          ) : (
            <FlaskConical className="h-16 w-16 text-muted-foreground/30" />
          )}
        </div>

        <div className="p-6 flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="text-lg leading-snug">{inv.artifactTitle}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              Submitted {new Date(inv.submittedAt).toLocaleDateString(undefined, {
                year: "numeric", month: "long", day: "numeric",
              })}
            </p>
          </DialogHeader>

          {/* Inquiry question */}
          {inv.inquiryQuestion && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
              <p className="text-xs font-medium text-primary mb-1">Inquiry Question</p>
              <p className="text-sm italic">"{inv.inquiryQuestion}"</p>
            </div>
          )}

          {/* Conclusion */}
          {inv.conclusion && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Conclusion
              </p>
              <p className="text-sm leading-relaxed">{inv.conclusion}</p>
            </div>
          )}

          {/* Score dimensions */}
          {score && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Assessment
              </p>
              <div className="flex flex-col gap-2.5">
                {dimensions.map(({ label, key }) => {
                  const val = typeof score[key] === "number" ? (score[key] as number) : null;
                  if (val === null) return null;
                  const pct = Math.round(val * 100);
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium">{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary progress-bar-animated"
                          style={{ "--progress-width": `${pct}%` } as React.CSSProperties}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LLM feedback */}
          {inv.llmFeedback && (
            <div className="rounded-lg border bg-muted/30 px-4 py-4 flex gap-3">
              <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium mb-1">AI Tutor Feedback</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{inv.llmFeedback}</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Skeleton cards ───────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <Skeleton className="h-32 rounded-none" />
      <div className="p-4 flex flex-col gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InvestigationPortfolio() {
  const { user, loading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [selected, setSelected] = useState<Investigation | null>(null);

  const { data, isLoading } = trpc.investigations.list.useQuery(undefined, {
    enabled: !authLoading && !!user,
  });

  const investigations = (data?.investigations ?? []) as Investigation[];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-[44px] gap-1.5"
            onClick={() => setLocation("/chat")}
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Chat
          </Button>
          <div className="flex items-center gap-2 ml-2">
            <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-primary" />
            </div>
            <span className="font-semibold">My Investigation Portfolio</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : investigations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
              <FlaskConical className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-semibold mb-1">No investigations yet</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Complete an artifact investigation in the chat to see it here.
              </p>
            </div>
            <Button onClick={() => setLocation("/chat")} className="min-h-[44px] mt-2">
              Start an Investigation
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-6">
              {investigations.length} completed investigation{investigations.length !== 1 ? "s" : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {investigations.map(inv => (
                <InvestigationCard
                  key={inv.id}
                  inv={inv}
                  onClick={() => setSelected(inv)}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {/* Detail modal */}
      {selected && (
        <InvestigationModal inv={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
