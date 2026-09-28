import { Dumbbell } from "lucide-react";
import { BackIconLink } from "../../components/BackIconControl";

export function NotFoundPage() {
  return <main className="not-found-page"><span><Dumbbell size={32} /></span><strong>404</strong><h1>This route needs a spotter.</h1><p>The page may have moved, or your active role may not have access.</p><BackIconLink className="btn btn-primary" to="/" label="Back to GETFIT4U" /></main>;
}
