import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest } from "../../services/apiClient";
import { authPath, loginDestination } from "../../services/authRedirect";

const storageKey = "gfu_pending_invitation";
function pendingInvitation(hash: string) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token");
  if (token && /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/.test(token)) return { token, kind: params.get("kind") === "LINK" ? "LINK" : "ACTIVATE" };
  try { return JSON.parse(sessionStorage.getItem(storageKey) || "null") as { token: string; kind: string } | null; }
  catch { return null; }
}
export function ActivateAccountPage() {
  const location = useLocation();
  const [invitation] = useState(() => pendingInvitation(location.hash));
  const [error, setError] = useState("");
  const me = useCurrentUser();
  const client = useQueryClient();
  const isLink = invitation?.kind === "LINK";
  useEffect(() => {
    if (invitation) sessionStorage.setItem(storageKey, JSON.stringify(invitation));
    // The token stays only in this tab's session state after initial navigation.
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [invitation]);
  const accept = useMutation({
    mutationFn: (password?: string) => apiRequest(`/api/v1/auth/${isLink ? "accept-invitation" : "activate-account"}`, { method: "POST", body: JSON.stringify({ token: invitation?.token, ...(password ? { password } : {}) }) }),
    onSuccess: async () => {
      sessionStorage.removeItem(storageKey);
      await client.invalidateQueries({ queryKey: ["me"] });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), password = String(form.get("password") || "");
    setError("");
    if (!isLink && password !== form.get("confirmPassword")) { setError("Passwords must match."); return; }
    if (!isLink && (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password))) { setError("Use at least 10 characters including uppercase, lowercase and a number."); return; }
    accept.mutate(isLink ? undefined : password);
  }
  return <main className="public-page" style={{ maxWidth: 560, margin: "64px auto", padding: 20 }}>
    <section className="panel" style={{ padding: 28 }}>
      <Link to="/">GETFIT4U</Link>
      <h1>{isLink ? "Accept your gym invitation" : "Activate your account"}</h1>
      {accept.isSuccess ? <><p role="status">{isLink ? "Your gym membership is linked." : "Your account is active. Sign in with your new password."} Gym access remains subject to your membership eligibility.</p><Link className="btn btn-primary" to={isLink ? loginDestination(me.data?.data || "USER", "/app/profile/membership") : authPath("/login", "/app/profile/membership")}>{isLink ? "Continue to your account" : "Sign in"}</Link></>
        : !invitation ? <p role="alert">Open the invitation from your email. If the link has expired, ask your gym to resend it.</p>
        : <>
          <p>{isLink ? "Sign in to the existing account that received the email, then accept this membership. Your password and profile stay under your control." : "Choose your own password. Your gym membership will appear after you sign in."}</p>
          {isLink && !me.data?.data?.user ? <Link className="btn btn-primary" to="/login?returnTo=%2Factivate-account">Sign in to accept</Link>
            : <form className="modal-form" onSubmit={submit}>
              {!isLink && <><label className="field"><span>Password</span><input className="input" name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label><label className="field"><span>Confirm password</span><input className="input" name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label><small>At least 10 characters with uppercase, lowercase and a number.</small></>}
              {(error || accept.isError) && <p role="alert">{error || accept.error?.message}</p>}
              <button className="btn btn-primary" disabled={accept.isPending}>{accept.isPending ? "Saving…" : isLink ? "Accept invitation" : "Activate Account"}</button>
            </form>}
        </>}
    </section>
  </main>;
}
