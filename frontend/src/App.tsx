import { GuestRoute } from "./routes/GuestRoute";
import { LegacyAuthRedirect } from "./routes/LegacyAuthRedirect";
import { NotificationInboxRedirect } from "./pages/shared/NotificationInboxRedirect";
import { lazy, Suspense, useEffect } from "react";
import { safeReturnTo } from "./services/authRedirect";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
} from "react-router-dom";
import { PublicLayout } from "./layouts/PublicLayout";
import { WorkspaceLayout } from "./layouts/WorkspaceLayout";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { profileSections, ProfileSectionRedirect } from "./routes/ProfileSectionRedirect";
const LiveWorkspace = lazy(() =>
  import("./pages/live/LiveWorkspace").then((m) => ({
    default: m.LiveWorkspace,
  })),
);
import {
  LiveLanding,
  LiveExplore,
  LiveGymDetails,
} from "./pages/live/LivePublic";
import { InfoPage } from "./pages/public/InfoPage";
import { RegisterGymPage } from "./pages/public/RegisterGymPage";
import { ActivateAccountPage } from "./pages/public/ActivateAccountPage";
import { BackIconLink } from "./components/BackIconControl";
import { publicPolicyRoutes } from "./routes/publicPolicyRoutes";
const Auth = lazy(() =>
  import("./pages/public/AuthDesktopPage").then((m) => ({
    default: m.AuthDesktopPage,
  })),
);
const PlatformSubscription = lazy(() => import("./pages/owner/PlatformSubscriptionPage").then(module => ({ default: module.PlatformSubscriptionPage })));
const router = createBrowserRouter([
  { path: "/activate-account", element: <ActivateAccountPage /> },
  ...publicPolicyRoutes,
  {
    path: "/platform-renewal",
    element: <ProtectedRoute><WorkspaceLayout /></ProtectedRoute>,
    children: [{ index: true, element: <PlatformSubscription /> }],
  },
  {
    element: (
      <GuestRoute>
        <PublicLayout />
      </GuestRoute>
    ),
    children: [
      { path: "/", element: <LiveLanding /> },
      { path: "/explore", element: <LiveExplore /> },
      {
        path: "/gyms/:slug",
        element: (
          <ProtectedRoute>
            <LiveGymDetails />
          </ProtectedRoute>
        ),
      },
      { path: "/help", element: <InfoPage type="help" /> },
      { path: "/contact", element: <InfoPage type="contact" /> },
    ],
  },
  {
    path: "/notifications",
    element: (
      <ProtectedRoute>
        <NotificationInboxRedirect />
      </ProtectedRoute>
    ),
  },
  {
    path: "/messages",
    element: (
      <ProtectedRoute>
        <NotificationInboxRedirect destination="messages" />
      </ProtectedRoute>
    ),
  },
  {
    path: "/messages/:conversationId",
    element: (
      <ProtectedRoute>
        <NotificationInboxRedirect destination="messages" />
      </ProtectedRoute>
    ),
  },
  {
    path: "/auth/*",
    element: (
      <GuestRoute auth>
        <Auth />
      </GuestRoute>
    ),
  },
  {
    path: "/login",
    element: (
      <GuestRoute auth>
        <Auth />
      </GuestRoute>
    ),
  },
  {
    path: "/register",
    element: (
      <GuestRoute auth>
        <Auth />
      </GuestRoute>
    ),
  },
  { path: "/signup", element: <LegacyAuthRedirect to="/register" /> },
  { path: "/auth/login", element: <LegacyAuthRedirect to="/login" /> },
  { path: "/auth/signup", element: <LegacyAuthRedirect to="/register" /> },
  { path: "/auth/register", element: <LegacyAuthRedirect to="/register" /> },
  {
    path: "/profile",
    element: (
      <ProtectedRoute>
        <WorkspaceLayout />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <LiveWorkspace /> },
      { path: ":profileId", element: <LiveWorkspace /> },
    ],
  },
  {
    path: "/register-gym",
    element: (
      <ProtectedRoute>
        <RegisterGymPage />
      </ProtectedRoute>
    ),
  },
  ...(["USER", "GYM_OWNER", "TRAINER", "ADMIN"] as const).map((role) => ({
    path:
      role === "USER"
        ? "/app"
        : role === "GYM_OWNER"
          ? "/owner"
          : role === "TRAINER"
            ? "/trainer"
            : "/admin",
    element: (
      <ProtectedRoute>
        <WorkspaceLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: (
          <Navigate to={role === "USER" ? "home" : "dashboard"} replace />
        ),
      },
      { path: "explore", element: <LiveExplore /> },
      ...(role === "USER" ? profileSections.map(section => ({ path: `profile/${section}`, element: <ProfileSectionRedirect section={section} /> })) : []),
      { path: "gyms/:slug", element: <LiveGymDetails /> },
      { path: "help", element: <InfoPage type="help" /> },
      { path: "contact", element: <InfoPage type="contact" /> },
      { path: "legal/terms", element: <Navigate to="/terms-and-policies" replace /> },
      { path: "legal/privacy", element: <Navigate to="/terms-and-policies" replace /> },
      ...(["GYM_OWNER", "ADMIN"].includes(role) ? [{ path: "onboarding/*", element: <RegisterGymPage /> }] : []),
      { path: "*", element: <LiveWorkspace /> },
    ],
  })),
  {
    path: "*",
    element: (
      <main className="state-card">
        <h1>Page not found</h1>
        <BackIconLink to="/" label="Back to home" />
      </main>
    ),
  },
]);
export function App() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const openNotification = (event: MessageEvent) => {
      if (event.data?.type !== "GETFIT4U_NOTIFICATION_CLICK") return;
      const path = safeReturnTo(event.data.path);
      if (path) void router.navigate(path);
    };
    navigator.serviceWorker.addEventListener("message", openNotification);
    return () =>
      navigator.serviceWorker.removeEventListener("message", openNotification);
  }, []);
  return (
    <Suspense fallback={<main className="state-card">Loading GETFIT4U…</main>}>
      <RouterProvider router={router} />
    </Suspense>
  );
}
