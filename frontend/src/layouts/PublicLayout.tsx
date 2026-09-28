import { Link, Outlet } from "react-router-dom";
import { AppHeader } from "../components/AppInstallBanner";
import { PublicHeader } from "../components/PublicHeader";
import { Brand } from "../components/Brand";

export function PublicLayout() {
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <AppHeader><PublicHeader /></AppHeader>
      <main id="main-content"><Outlet /></main>
      <footer className="public-footer">
        <div className="container footer-grid">
          <div><Brand /><p>One trusted place to discover gyms, manage memberships and build stronger habits.</p></div>
          <div><strong>Explore</strong><Link to="/explore">Nearby gyms</Link></div>
          <div><strong>Support</strong><Link to="/help">Help center</Link><Link to="/contact">Contact</Link></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 GETFIT4U</span><span>Made for healthier communities across India</span></div>
      </footer>
    </>
  );
}
