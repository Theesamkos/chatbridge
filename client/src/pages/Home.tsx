import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";

export default function Home() {
  const { isAuthenticated, loading } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">ChatBridge / TutorMeAI</h1>
      <p className="text-muted-foreground text-center max-w-sm">
        An AI tutor that works alongside interactive learning activities.
      </p>

      {loading ? null : isAuthenticated ? (
        <Link href="/chat">
          <Button className="min-h-[44px] px-6">
            <MessageSquare className="size-4 mr-2" />
            Open Chat
          </Button>
        </Link>
      ) : (
        <a href={getLoginUrl()}>
          <Button className="min-h-[44px] px-6">Sign in to start</Button>
        </a>
      )}
    </div>
  );
}
