import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useAuth } from "./_core/hooks/useAuth";
import Chat from "./pages/Chat";
import Home from "./pages/Home";
import StreamTest from "./pages/StreamTest";
import TeacherDashboard from "./pages/teacher/TeacherDashboard";
import StudentSessions from "./pages/teacher/StudentSessions";
import ConversationLog from "./pages/teacher/ConversationLog";
import SafetyEvents from "./pages/teacher/SafetyEvents";
import PluginStats from "./pages/teacher/PluginStats";
import AdminDashboard from "./pages/admin/AdminDashboard";
import PluginManagement from "./pages/admin/PluginManagement";
import AuditLogViewer from "./pages/admin/AuditLogViewer";
import UserManagement from "./pages/admin/UserManagement";
import CostDashboard from "./pages/admin/CostDashboard";
import PluginFailures from "./pages/admin/PluginFailures";
import InvestigationPortfolio from "./pages/InvestigationPortfolio";

// ─── Admin route guard ────────────────────────────────────────────────────────

/**
 * Wraps an admin-only page. Non-admins are redirected to /404.
 */
function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  if (loading) return null;

  if (!user) {
    return null;
  }

  if (user.role !== "admin") {
    setLocation("/404");
    return null;
  }

  return <Component />;
}

// ─── Teacher route guard ──────────────────────────────────────────────────────

/**
 * Wraps a teacher-only page. Redirects students to /404.
 * Admins and teachers pass through.
 */
function TeacherRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();

  if (loading) return null;

  if (!user) {
    // Let useAuth's redirectOnUnauthenticated handle the redirect
    return null;
  }

  if (user.role === "student") {
    setLocation("/404");
    return null;
  }

  return <Component />;
}

// ─── Router ───────────────────────────────────────────────────────────────────

function Router() {
  // make sure to consider if you need authentication for certain routes
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/chat"} component={Chat} />
      <Route path={"/portfolio"} component={InvestigationPortfolio} />
      <Route path={"/stream-test"} component={StreamTest} />

      {/* Teacher routes — role: teacher | admin */}
      <Route path={"/teacher"}>
        {() => <TeacherRoute component={TeacherDashboard} />}
      </Route>
      <Route path={"/teacher/sessions"}>
        {() => <TeacherRoute component={StudentSessions} />}
      </Route>
      <Route path={"/teacher/sessions/:conversationId"}>
        {() => <TeacherRoute component={ConversationLog} />}
      </Route>
      <Route path={"/teacher/safety"}>
        {() => <TeacherRoute component={SafetyEvents} />}
      </Route>
      <Route path={"/teacher/plugins"}>
        {() => <TeacherRoute component={PluginStats} />}
      </Route>

      {/* Admin routes — role: admin only */}
      <Route path={"/admin"}>
        {() => <AdminRoute component={AdminDashboard} />}
      </Route>
      <Route path={"/admin/plugins"}>
        {() => <AdminRoute component={PluginManagement} />}
      </Route>
      <Route path={"/admin/audit"}>
        {() => <AdminRoute component={AuditLogViewer} />}
      </Route>
      <Route path={"/admin/users"}>
        {() => <AdminRoute component={UserManagement} />}
      </Route>
      <Route path={"/admin/costs"}>
        {() => <AdminRoute component={CostDashboard} />}
      </Route>
      <Route path={"/admin/failures"}>
        {() => <AdminRoute component={PluginFailures} />}
      </Route>

      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
        switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
