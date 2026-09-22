import { Outlet } from "react-router-dom";
import { PublicHeader } from "../components/PublicHeader";
import { Brand } from "../components/Brand";

export function PublicLayout() {
  return (
    <>
      <a href="#main-content" className="skip-link">Skip to content</a>
      <PublicHeader />
      <main id="main-content"><Outlet /></main>
      <footer className="public-footer">
        <div className="container footer-grid">
          <div><Brand /><p>One trusted place to discover gyms, manage memberships and build stronger habits.</p></div>
          <div><strong>Explore</strong><a href="/explore">Nearby gyms</a><a href="/register-gym">Register your gym</a></div>
          <div><strong>Support</strong><a href="/help">Help center</a><a href="/contact">Contact</a></div>
          <div><strong>Legal</strong><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a></div>
        </div>
        <div className="container footer-bottom"><span>© 2026 GETFIT4U</span><span>Made for healthier communities across India</span></div>
      </footer>
    </>
  );
}
