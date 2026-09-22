import { ArrowLeft, Dumbbell } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return <main className="not-found-page"><span><Dumbbell size={32} /></span><strong>404</strong><h1>This route needs a spotter.</h1><p>The page may have moved, or your active role may not have access.</p><Link className="btn btn-primary" to="/"><ArrowLeft size={17} /> Back to GETFIT4U</Link></main>;
}
