import { Menu, Moon, Sun, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Brand } from "./Brand";
import { useApp } from "../context/AppContext";

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useApp();
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
          <Link to="/register-gym" onClick={() => setOpen(false)}>
            For gym owners
          </Link>
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
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
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
