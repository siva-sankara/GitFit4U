import { AlertTriangle, RefreshCw } from "lucide-react";
import { isRouteErrorResponse, useLocation, useRouteError } from "react-router-dom";
import { isDynamicImportError } from "../services/lazyWithRetry";

function dashboardFor(pathname: string) {
  if (pathname.startsWith("/owner")) return "/owner/dashboard";
  if (pathname.startsWith("/trainer")) return "/trainer/dashboard";
  if (pathname.startsWith("/admin")) return "/admin/dashboard";
  if (pathname.startsWith("/app")) return "/app/home";
  return "/";
}

export function RouteErrorPage() {
  const error = useRouteError();
  const location = useLocation();
  const moduleUnavailable = isDynamicImportError(error);
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="route-error-shell">
      <section className="route-error-card" role="alert" aria-live="assertive">
        <span className="route-error-icon" aria-hidden="true">
          <AlertTriangle size={28} />
        </span>
        <p className="eyebrow">GETFIT4U</p>
        <h1>{notFound ? "Page not found" : "We couldn't load this screen"}</h1>
        <p>
          {moduleUnavailable
            ? "The app may have updated or the development server briefly restarted. Reload the screen to continue."
            : "Something interrupted this screen. Your account and saved data are safe."}
        </p>
        <div className="route-error-actions">
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={18} aria-hidden="true" />
            Reload screen
          </button>
          <a className="btn btn-secondary" href={dashboardFor(location.pathname)}>
            Go to dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
