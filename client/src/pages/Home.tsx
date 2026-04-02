/**
 * Landing page and first-login onboarding for ChatBridge / TutorMeAI.
 * Premium redesign: Linear × Stripe aesthetic, dark-first, depth layers.
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getLoginUrl } from "@/const";
import {
  BookOpen,
  Brain,
  ChevronRight,
  Cpu,
  MessageSquare,
  Puzzle,
  Shield,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const ONBOARDED_KEY = "chatbridge_onboarded";

// ─── Onboarding steps ─────────────────────────────────────────────────────────

const STUDENT_STEPS = [
  {
    icon: <Sparkles className="h-10 w-10 text-primary" />,
    title: "Welcome to ChatBridge",
    body: "Your AI tutor is here to help you learn. Ask questions, explore topics, and work through problems together.",
  },
  {
    icon: <BookOpen className="h-10 w-10 text-primary" />,
    title: "Try a Learning Activity",
    body: "Ask the AI to start a chess game — then ask it to explain every move. It can see the board and think alongside you.",
  },
  {
    icon: <Brain className="h-10 w-10 text-primary" />,
    title: "Investigate Historical Artifacts",
    body: "Explore the Artifact Investigation Studio. Search real Smithsonian collections, annotate findings, and submit your inquiry for AI feedback.",
  },
];

const TEACHER_STEPS = [
  {
    icon: <Shield className="h-10 w-10 text-primary" />,
    title: "Welcome, Teacher",
    body: "The Teacher Dashboard gives you full visibility into every student session — messages, plugin usage, and safety events.",
  },
  {
    icon: <Cpu className="h-10 w-10 text-primary" />,
    title: "Monitor Sessions in Real Time",
    body: "Review active and historical conversations, unfreeze flagged sessions, and see exactly what each student is working on.",
  },
  {
    icon: <MessageSquare className="h-10 w-10 text-primary" />,
    title: "Safety Events & Plugin Usage",
    body: "All safety events are logged and reviewable. Plugin analytics show you which tools students use most and where they struggle.",
  },
];

// ─── Onboarding modal ─────────────────────────────────────────────────────────

function OnboardingModal({
  steps,
  onDone,
}: {
  steps: typeof STUDENT_STEPS;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md p-0 overflow-hidden gap-0"
        onInteractOutside={e => e.preventDefault()}
        showCloseButton={false}
      >
        {/* Progress dots */}
        <div className="flex gap-1.5 justify-center pt-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="flex flex-col items-center text-center px-8 py-8 gap-5">
          <div className="p-4 rounded-2xl bg-primary/10 border border-primary/15 shadow-sm">
            {current.icon}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{current.title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed mt-2">{current.body}</p>
          </div>
        </div>

        <div className="px-8 pb-8 flex gap-3">
          {step > 0 && (
            <Button
              variant="outline"
              className="flex-1 min-h-[44px]"
              onClick={() => setStep(s => s - 1)}
            >
              Back
            </Button>
          )}
          <Button
            className="flex-1 min-h-[44px]"
            onClick={() => {
              if (isLast) {
                onDone();
              } else {
                setStep(s => s + 1);
              }
            }}
          >
            {isLast ? "Get Started" : "Next"}
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Landing page ─────────────────────────────────────────────────────────────

export default function Home() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, setLocation] = useLocation();
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Show onboarding after first login (not for admins)
  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      if (user.role !== "admin") {
        const done = localStorage.getItem(ONBOARDED_KEY);
        if (!done) {
          setShowOnboarding(true);
        }
      }
    }
  }, [loading, isAuthenticated, user]);

  const handleOnboardingDone = () => {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setShowOnboarding(false);
    if (user?.role === "student") {
      setLocation("/chat");
    } else {
      setLocation("/teacher");
    }
  };

  const onboardingSteps =
    user?.role === "teacher" ? TEACHER_STEPS : STUDENT_STEPS;

  return (
    <>
      {showOnboarding && (
        <OnboardingModal steps={onboardingSteps} onDone={handleOnboardingDone} />
      )}

      <div className="min-h-screen bg-background flex flex-col">

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 border-b border-border/50 bg-background/85 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold tracking-tight text-foreground">ChatBridge</span>
              <span className="hidden sm:inline text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/15 ml-1">
                K-12
              </span>
            </div>
            {!loading && (
              isAuthenticated ? (
                <div className="flex items-center gap-2">
                  {(user?.role === "teacher" || user?.role === "admin") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-[40px] text-muted-foreground hover:text-foreground"
                      onClick={() => setLocation("/teacher")}
                    >
                      Dashboard
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="min-h-[40px] gap-1.5"
                    onClick={() => setLocation("/chat")}
                  >
                    Open Chat
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="sm" className="min-h-[40px] gap-1.5">
                    Sign in
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )
            )}
          </div>
        </header>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative flex-1 flex items-center overflow-hidden">
          {/* Background depth layers */}
          <div className="absolute inset-0 bg-dot-grid opacity-40 pointer-events-none" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/6 rounded-full blur-3xl pointer-events-none" />

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left: copy */}
              <div className="flex flex-col gap-7 animate-fade-in">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-medium w-fit">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI-powered K-12 education
                </div>

                {/* Headline */}
                <div>
                  <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-[1.15]">
                    The AI that learns{" "}
                    <span className="text-gradient">alongside</span>{" "}
                    your students
                  </h1>
                  <p className="text-lg text-muted-foreground leading-relaxed mt-4">
                    ChatBridge connects conversational AI with interactive educational
                    apps — chess, timelines, artifact studios — all in one place,
                    all under your control.
                  </p>
                </div>

                {/* Trust signals */}
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {["Sandboxed apps", "Full audit trail", "K-12 safety filters"].map(t => (
                    <div key={t} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      {t}
                    </div>
                  ))}
                </div>

                {/* CTAs */}
                {loading ? null : isAuthenticated ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      size="lg"
                      className="min-h-[48px] px-8 gap-2 glow-primary"
                      onClick={() => setLocation("/chat")}
                    >
                      <MessageSquare className="h-4 w-4" />
                      Open Chat
                    </Button>
                    {(user?.role === "teacher" || user?.role === "admin") && (
                      <Button
                        size="lg"
                        variant="outline"
                        className="min-h-[48px] px-8 bg-transparent"
                        onClick={() => setLocation("/teacher")}
                      >
                        Teacher Dashboard
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <a href={`${getLoginUrl()}&returnPath=/chat`} className="contents">
                      <Button size="lg" className="min-h-[48px] px-8 gap-2 w-full sm:w-auto glow-primary">
                        <MessageSquare className="h-4 w-4" />
                        Get Started as a Student
                      </Button>
                    </a>
                    <a href={`${getLoginUrl()}&returnPath=/teacher`} className="contents">
                      <Button
                        size="lg"
                        variant="outline"
                        className="min-h-[48px] px-8 w-full sm:w-auto bg-transparent"
                      >
                        I'm a Teacher
                      </Button>
                    </a>
                  </div>
                )}
              </div>

              {/* Right: illustration */}
              <div className="hidden lg:flex items-center justify-center">
                <HeroIllustration />
              </div>
            </div>
          </div>
        </section>

        {/* ── Stats bar ────────────────────────────────────────────────────── */}
        <section className="border-y border-border/50 bg-muted/20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
              {[
                { value: "3", label: "Learning Plugins" },
                { value: "48+", label: "Timeline Events" },
                { value: "K-12", label: "Safety Certified" },
                { value: "100%", label: "Sandboxed" },
              ].map(stat => (
                <div key={stat.label} className="flex flex-col gap-0.5">
                  <span className="text-2xl font-bold tracking-tight text-foreground">{stat.value}</span>
                  <span className="text-xs text-muted-foreground">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────────── */}
        <section className="py-24">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-medium mb-4">
                <Zap className="h-3 w-3" />
                Platform Features
              </div>
              <h2 className="text-3xl font-bold tracking-tight">
                Designed for real classrooms
              </h2>
              <p className="text-muted-foreground mt-3 max-w-xl mx-auto leading-relaxed">
                Every feature was built with teachers, safety, and genuine learning in mind.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <FeatureCard
                icon={<Puzzle className="h-5 w-5 text-primary" />}
                title="Sandboxed App Integration"
                body="Third-party apps run in complete isolation. Students interact with chess, timelines, and artifact studios — all inside the chat, all under platform control."
                accent="primary"
              />
              <FeatureCard
                icon={<Brain className="h-5 w-5 text-secondary" />}
                title="Context-Aware AI"
                body="The AI remembers what happened inside every app. Ask about your chess game, your timeline arrangement, or your artifact investigation — the AI always knows."
                accent="secondary"
              />
              <FeatureCard
                icon={<Shield className="h-5 w-5 text-emerald-500" />}
                title="Built for K-12 Safety"
                body="Every message is inspected before it reaches the AI. Every response is moderated before it reaches your students. Safety is architecture, not an afterthought."
                accent="emerald"
              />
            </div>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <footer className="border-t border-border/50 py-8 mt-auto">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <div className="h-5 w-5 rounded-md bg-primary/20 flex items-center justify-center">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              <span className="font-medium text-foreground/70">ChatBridge</span>
              <span className="text-border">·</span>
              TutorMeAI
            </div>
            <p className="text-xs text-muted-foreground">
              AI in K-12 education, responsibly built.
            </p>
          </div>
        </footer>
      </div>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  body,
  accent = "primary",
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  accent?: "primary" | "secondary" | "emerald";
}) {
  const accentMap = {
    primary: "bg-primary/8 border-primary/15 group-hover:border-primary/30",
    secondary: "bg-secondary/8 border-secondary/15 group-hover:border-secondary/30",
    emerald: "bg-emerald-500/8 border-emerald-500/15 group-hover:border-emerald-500/30",
  };

  return (
    <div className="group rounded-xl border border-border/60 bg-card/60 p-6 flex flex-col gap-4 hover:bg-card hover:border-border hover:shadow-md transition-all duration-200 cursor-default">
      <div className={`h-10 w-10 rounded-lg border flex items-center justify-center transition-colors duration-200 ${accentMap[accent]}`}>
        {icon}
      </div>
      <div>
        <h3 className="font-semibold tracking-tight mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function HeroIllustration() {
  return (
    <div className="relative w-full max-w-md">
      {/* Outer glow */}
      <div className="absolute inset-0 bg-primary/8 rounded-3xl blur-3xl" />
      <div className="absolute -inset-4 bg-primary/4 rounded-3xl blur-2xl" />

      {/* Mock interface card */}
      <div className="relative rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden">
        {/* Window chrome */}
        <div className="bg-sidebar px-4 py-3 flex items-center gap-2 border-b border-sidebar-border">
          <div className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-accent/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-secondary/60" />
          <span className="ml-2 text-[10px] text-sidebar-foreground/50 font-mono tracking-wide">
            chatbridge — chess session
          </span>
        </div>

        <div className="flex h-72">
          {/* Chat side */}
          <div className="flex-1 p-3.5 flex flex-col gap-2.5 border-r border-border/40">
            <MockMessage role="assistant" text="Let's play chess! What opening do you know?" />
            <MockMessage role="user" text="I know the King's Pawn opening." />
            <MockMessage role="assistant" text="Perfect. e4 controls the center — watch how this opens lines for your bishop..." streaming />
          </div>
          {/* Board side */}
          <div className="w-36 bg-muted/20 flex flex-col items-center justify-center gap-2 p-2">
            <MiniChessBoard />
            <span className="text-[9px] text-muted-foreground font-mono">e2→e4</span>
          </div>
        </div>
      </div>

      {/* Floating badge */}
      <div className="absolute -bottom-3 -right-3 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1.5">
        <Sparkles className="h-3 w-3" />
        AI sees the board
      </div>
    </div>
  );
}

function MockMessage({
  role,
  text,
  streaming,
}: {
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
}) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-xl px-3 py-2 text-[11px] max-w-[88%] leading-relaxed ${
          role === "user"
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted/60 text-foreground border border-border/40 rounded-tl-sm"
        } ${streaming ? "streaming-cursor" : ""}`}
      >
        {text}
      </div>
    </div>
  );
}

function MiniChessBoard() {
  const ranks = [
    ["♜","♞","♝","♛","♚","♝","♞","♜"],
    ["♟","♟","♟","♟","♟","♟","♟","♟"],
    [" "," "," "," "," "," "," "," "],
    [" "," "," "," "," "," "," "," "],
    [" "," "," "," ","♙"," "," "," "],
    [" "," "," "," "," "," "," "," "],
    ["♙","♙","♙","♙"," ","♙","♙","♙"],
    ["♖","♘","♗","♕","♔","♗","♘","♖"],
  ];
  return (
    <div className="grid grid-cols-8 gap-px">
      {ranks.flat().map((piece, i) => (
        <div
          key={i}
          className={`h-4 w-4 flex items-center justify-center text-[7px] ${
            (Math.floor(i / 8) + (i % 8)) % 2 === 0
              ? "bg-primary/25"
              : "bg-primary/8"
          }`}
        >
          {piece !== " " ? piece : null}
        </div>
      ))}
    </div>
  );
}
