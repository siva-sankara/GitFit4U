import { Navigate, type RouteObject } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout";
import {
  PolicyDocumentPage,
  TermsAndPoliciesPage,
} from "../pages/public/PoliciesPage";

/** Public legal routes intentionally live outside GuestRoute and ProtectedRoute. */
export const publicPolicyRoutes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: "/terms-and-policies", element: <TermsAndPoliciesPage /> },
      {
        path: "/terms-and-conditions",
        element: <PolicyDocumentPage path="/terms-and-conditions" />,
      },
      {
        path: "/privacy-policy",
        element: <PolicyDocumentPage path="/privacy-policy" />,
      },
      {
        path: "/refund-cancellation-policy",
        element: <PolicyDocumentPage path="/refund-cancellation-policy" />,
      },
      {
        path: "/data-deletion",
        element: <PolicyDocumentPage path="/data-deletion" />,
      },
      { path: "/legal/terms", element: <Navigate to="/terms-and-conditions" replace /> },
      { path: "/legal/privacy", element: <Navigate to="/privacy-policy" replace /> },
    ],
  },
];
