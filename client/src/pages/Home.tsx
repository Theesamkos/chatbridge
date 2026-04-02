/**
 * Landing page and first-login onboarding for ChatBridge / TutorMeAI.
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

        <div className="flex flex-col items-center text-center px-8 py-8 gap-4">
          <div className="p-4 rounded-2xl bg-primary/10">
            {current.icon}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{current.title}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{current.body}</p>
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
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-semibold tracking-tight">ChatBridge</span>
            </div>
            {!loading && (
              isAuthenticated ? (
                <div className="flex items-center gap-3">
                  {(user?.role === "teacher" || user?.role === "admin") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-[44px]"
                      onClick={() => setLocation("/teacher")}
                    >
                      Dashboard
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="min-h-[44px]"
                    onClick={() => setLocation("/chat")}
                  >
                    Open Chat
                  </Button>
                </div>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="sm" className="min-h-[44px]">Sign in</Button>
                </a>
              )
            )}
          </div>
        </header>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="flex-1 flex items-center">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left: copy */}
              <div className="flex flex-col gap-6">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium w-fit">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI-powered K-12 education
                </div>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
                  The AI that learns{" "}
                  <span className="text-primary">alongside</span> your students
                </h1>
                <p className="text-lg text-muted-foreground leading-relaxed">
                  ChatBridge connects conversational AI with interactive educational
                  apps — all in one place, all under your control.
                </p>

                {loading ? null : isAuthenticated ? (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button
                      size="lg"
                      className="min-h-[44px] px-8"
                      onClick={() => setLocation("/chat")}
                    >
                      <MessageSquare className="h-4 w-4 mr-2" />
                      Open Chat
                    </Button>
                    {(user?.role === "teacher" || user?.role === "admin") && (
                      <Button
                        size="lg"
                        variant="outline"
                        className="min-h-[44px] px-8"
                        onClick={() => setLocation("/teacher")}
                      >
                        Teacher Dashboard
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-3">
                    <a href={`${getLoginUrl()}&returnPath=/chat`} className="contents">
                      <Button size="lg" className="min-h-[44px] px-8 w-full sm:w-auto">
                        <MessageSquare className="h-4 w-4 mr-2" />
                        Get Started as a Student
                      </Button>
                    </a>
                    <a href={`${getLoginUrl()}&returnPath=/teacher`} className="contents">
                      <Button
                        size="lg"
                        variant="outline"
                        className="min-h-[44px] px-8 w-full sm:w-auto"
                      >
                        I'm a Teacher
                      </Button>
                    </a>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Built for K-12 classrooms · Sandboxed apps · Full audit trail
                </p>
              </div>

              {/* Right: illustration */}
              <div className="hidden lg:flex items-center justify-center">
                <HeroIllustration />
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────────── */}
        <section className="border-t bg-muted/30 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl font-bold tracking-tight mb-3">
                Designed for real classrooms
              </h2>
              <p className="text-muted-foreground">
                Every feature was built with teachers, safety, and genuine learning in mind.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              <FeatureCard
                icon={<Puzzle className="h-6 w-6 text-primary" />}
                title="Sandboxed App Integration"
                body="Third-party apps run in complete isolation. Students interact with chess, timelines, and artifact studios — all inside the chat, all under platform control."
              />
              <FeatureCard
                icon={<Brain className="h-6 w-6 text-primary" />}
                title="Context-Aware AI"
                body="The AI remembers what happened inside every app. Ask about your chess game, your timeline arrangement, or your artifact investigation — the AI always knows."
              />
              <FeatureCard
                icon={<Shield className="h-6 w-6 text-primary" />}
                title="Built for K-12 Safety"
                body="Every message is inspected before it reaches the AI. Every response is moderated before it reaches your students. Safety is architecture, not an afterthought."
              />
            </div>
          </div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <footer className="border-t py-8">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-5 w-5 rounded bg-primary/20 flex items-center justify-center">
                <Sparkles className="h-3 w-3 text-primary" />
              </div>
              ChatBridge / TutorMeAI
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
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-6 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold mb-1.5">{title}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function HeroIllustration() {
  return (
    <div className="relative w-full max-w-md">
      {/* Outer glow */}
      <div className="absolute inset-0 bg-primary/5 rounded-2xl blur-3xl" />

      {/* Mock interface card */}
      <div className="relative rounded-2xl border bg-card shadow-2xl overflow-hidden">
        {/* Header bar */}
        <div className="bg-sidebar px-4 py-3 flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-destructive/70" />
          <div className="h-3 w-3 rounded-full bg-accent/70" />
          <div className="h-3 w-3 rounded-full bg-secondary/70" />
          <span className="ml-2 text-xs text-sidebar-foreground/60 font-mono">
            chatbridge — chess
          </span>
        </div>

        <div className="flex h-72">
          {/* Chat side */}
          <div className="flex-1 p-3 flex flex-col gap-2 border-r">
            <MockMessage role="assistant" text="Let's play chess! What opening do you know?" />
            <MockMessage role="user" text="I know the King's Pawn opening." />
            <MockMessage role="assistant" text="Perfect. e4 to start — watch how this controls the center..." streaming />
          </div>
          {/* Board side */}
          <div className="w-32 bg-muted/30 flex items-center justify-center">
            <MiniChessBoard />
          </div>
        </div>
      </div>

      {/* Floating badge */}
      <div className="absolute -bottom-3 -right-3 bg-primary text-primary-foreground text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
        AI sees the board ✓
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
        className={`rounded-lg px-2.5 py-1.5 text-xs max-w-[85%] leading-relaxed ${
          role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
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
    <div className="grid grid-cols-4 gap-px p-2">
      {ranks.flat().slice(0, 16).map((piece, i) => (
        <div
          key={i}
          className={`h-3.5 w-3.5 flex items-center justify-center text-[8px] rounded-sm ${
            (Math.floor(i / 4) + (i % 4)) % 2 === 0
              ? "bg-primary/20"
              : "bg-primary/5"
          }`}
        >
          {piece !== " " ? piece : null}
        </div>
      ))}
    </div>
  );
}
