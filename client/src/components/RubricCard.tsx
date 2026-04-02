/**
 * RubricCard — displays structured LLM scoring for artifact investigations.
 * Animated progress bars (Rule 42: CSS-only), respects prefers-reduced-motion (Rule 41).
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ExternalLink, Lightbulb, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RubricScore = {
  overall: number; // 0–1
  observation?: number;
  evidence?: number;
  reasoning?: number;
  depth?: number;
  strengths?: string[];
  growth?: string[];
  feedback?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(val: number) {
  return Math.round(val * 100);
}

function scoreLabel(val: number): { label: string; className: string } {
  const p = pct(val);
  if (p >= 85) return { label: "Excellent", className: "text-green-600 dark:text-green-400" };
  if (p >= 70) return { label: "Proficient", className: "text-primary" };
  if (p >= 55) return { label: "Developing", className: "text-amber-600 dark:text-amber-400" };
  return { label: "Beginning", className: "text-destructive" };
}

// ─── Score row ────────────────────────────────────────────────────────────────

function ScoreRow({ label, value }: { label: string; value: number }) {
  const p = pct(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums">{p}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary progress-bar-animated"
          style={{ "--progress-width": `${p}%` } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

// ─── RubricCard ───────────────────────────────────────────────────────────────

const DIMENSIONS: Array<{ label: string; key: keyof RubricScore }> = [
  { label: "Observation Quality", key: "observation" },
  { label: "Evidence Use", key: "evidence" },
  { label: "Historical Reasoning", key: "reasoning" },
  { label: "Inquiry Depth", key: "depth" },
];

export function RubricCard({ score }: { score: RubricScore }) {
  const [, setLocation] = useLocation();
  const overall = score.overall;
  const { label, className } = scoreLabel(overall);
  const hasDimensions = DIMENSIONS.some(d => typeof score[d.key] === "number");

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col gap-4 shadow-sm">
      {/* Overall score */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
            Investigation Score
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono tabular-nums">{pct(overall)}%</span>
            <span className={`text-sm font-medium ${className}`}>{label}</span>
          </div>
        </div>
        <Badge
          variant={pct(overall) >= 70 ? "default" : "secondary"}
          className="text-xs shrink-0"
        >
          {label}
        </Badge>
      </div>

      {/* Dimension bars */}
      {hasDimensions && (
        <div className="flex flex-col gap-2.5">
          {DIMENSIONS.map(({ label: dimLabel, key }) => {
            const val = score[key];
            if (typeof val !== "number") return null;
            return <ScoreRow key={key} label={dimLabel} value={val} />;
          })}
        </div>
      )}

      {/* Strengths */}
      {score.strengths && score.strengths.length > 0 && (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
            <span className="text-xs font-semibold text-green-700 dark:text-green-300">
              Strengths
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {score.strengths.map((s, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                <span className="text-green-600 dark:text-green-400 shrink-0">·</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Growth areas */}
      {score.growth && score.growth.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
              Areas for Growth
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            {score.growth.map((g, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                <span className="text-amber-600 dark:text-amber-400 shrink-0">·</span>
                {g}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Narrative feedback */}
      {score.feedback && (
        <div className="flex gap-2.5 pt-1">
          <Lightbulb className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground leading-relaxed">{score.feedback}</p>
        </div>
      )}

      {/* Portfolio link */}
      <Button
        variant="outline"
        size="sm"
        className="min-h-[44px] gap-1.5 self-start"
        onClick={() => setLocation("/portfolio")}
      >
        <ExternalLink className="h-3.5 w-3.5" />
        View in Portfolio
      </Button>
    </div>
  );
}
