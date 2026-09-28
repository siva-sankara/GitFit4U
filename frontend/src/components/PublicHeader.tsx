import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Brand } from "./Brand";
import { ThemePicker } from "./ThemePicker";
import { useSession } from "../services/session";
import { canRegisterGym } from "../services/authRedirect";
import { getAccessToken } from "../services/apiClient";

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const me = useSession({ publicPage: true });
  const showOwnerLink = !getAccessToken() || Boolean(me.data && canRegisterGym(me.data.data));
  return (
    <header className="public-header">
      <div className="container header-inner">
        <Brand />
        <nav
          className={open ? "public-nav is-open" : "public-nav"}
          aria-label="Main navigation"
        >
          <NavLink to="/explore" onClick={() => setOpen(false)}>
            Explore gyms
          </NavLink>
          <a href="/#how-it-works" onClick={() => setOpen(false)}>
            How it works
          </a>
          {showOwnerLink && <Link to="/register-gym" onClick={() => setOpen(false)}>
            For gym owners
          </Link>}
          <Link to="/help" onClick={() => setOpen(false)}>
            Help
          </Link>
          <Link
            className="mobile-auth-link"
            to="/auth/login"
            onClick={() => setOpen(false)}
          >
            Sign in
          </Link>
        </nav>
        <div className="header-actions">
          <ThemePicker />
          <Link className="btn btn-secondary desktop-only" to="/auth/login">
            Sign in
          </Link>
          <Link className="btn btn-primary desktop-only" to="/explore">
            Find a gym
          </Link>
          <button
            className="icon-btn mobile-menu"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Toggle menu"
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
      </div>
    </header>
  );
}
