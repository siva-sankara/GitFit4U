import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../../components/Brand";
import { useApp } from "../../context/AppContext";
import {
  apiRequest,
  ApiError,
  setAccessToken,
  type ApiEnvelope,
} from "../../services/apiClient";
import {
  loginSchema,
  signupSchema,
  resetSchema,
  phoneSchema,
} from "../../services/authValidation";
import {
  authPath,
  safeReturnTo,
  loginDestination,
} from "../../services/authRedirect";
import type { ActiveRole } from "../../services/session";

const phoneForm = z.object({ phone: phoneSchema });
const otpForm = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code"),
});
type Challenge = {
  challengeId: string;
  phone: string;
  purpose: "LOGIN" | "ACCOUNT_RECOVERY";
  expiresAt: number;
  resendAt: number;
  devOtp?: string;
};
type AuthResponse = ApiEnvelope<{
  accessToken: string;
  user: { activeRole: ActiveRole };
}>;
function readChallenge(): Challenge | null {
  try {
    return JSON.parse(sessionStorage.getItem("gfu_auth_challenge") || "null");
  } catch {
    return null;
  }
}

export function AuthDesktopPage() {
  const location = useLocation(),
    path = location.pathname,
    navigate = useNavigate(),
    { setRole } = useApp();
  const returnTo =
    safeReturnTo(new URLSearchParams(location.search).get("returnTo")) ||
    safeReturnTo(location.state?.from);
  const authLink = (path: string) =>
    authPath(
      path === "/auth/login"
        ? "/login"
        : ["/auth/signup", "/auth/register"].includes(path)
          ? "/register"
          : path,
      returnTo,
    );
  const signup = ["/register", "/auth/signup", "/auth/register"].includes(path),
    recovery = path === "/auth/recovery-otp";
  const otpView = path === "/auth/otp" || recovery,
    forgot = path === "/auth/forgot-password";
  const phoneView = path === "/auth/phone" || forgot,
    resetView = path === "/auth/reset-password",
    success = path === "/auth/reset-success";
  const [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(readChallenge);
  const [resetToken, setResetToken] = useState(
      sessionStorage.getItem("gfu_reset") || "",
    ),
    [now, setNow] = useState(Date.now());
  const login = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
  });
  const registration = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { phone: "" },
  });
  const phone = useForm<z.infer<typeof phoneForm>>({
    resolver: zodResolver(phoneForm),
    defaultValues: { phone: challenge?.phone || "" },
  });
  const otp = useForm<z.infer<typeof otpForm>>({
    resolver: zodResolver(otpForm),
  });
  const reset = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
  });
  useEffect(() => {
    setError("");
    setShow(false);
  }, [path]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  function clearChallenge() {
    sessionStorage.removeItem("gfu_auth_challenge");
    sessionStorage.removeItem("gfu_challenge");
  }
  function finish(response: AuthResponse) {
    setAccessToken(null);
    setAccessToken(response.data.accessToken);
    setRole(
      response.data.user.activeRole === "GYM_STAFF"
        ? "GYM_OWNER"
        : response.data.user.activeRole,
    );
    clearChallenge();
    sessionStorage.removeItem("gfu_reset");
    navigate(loginDestination(response.data.user.activeRole, returnTo), {
      replace: true,
    });
  }
  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Unable to connect. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function requestCode(number: string, purpose: Challenge["purpose"]) {
    await run(async () => {
      const r = await apiRequest<
        ApiEnvelope<{
          challengeId: string;
          expiresInSeconds: number;
          devOtp?: string;
        }>
      >(
        purpose === "LOGIN"
          ? "/api/v1/auth/otp/request"
          : "/api/v1/auth/forgot-password",
        {
          method: "POST",
          body: JSON.stringify({
            phone: number,
            ...(purpose === "LOGIN" ? { purpose } : {}),
          }),
        },
      );
      const next: Challenge = {
        challengeId: r.data.challengeId,
        phone: number,
        purpose,
        expiresAt: Date.now() + r.data.expiresInSeconds * 1000,
        resendAt: Date.now() + 60_000,
        ...(import.meta.env.DEV ? { devOtp: r.data.devOtp } : {}),
      };
      setChallenge(next);
      sessionStorage.setItem("gfu_auth_challenge", JSON.stringify(next));
      otp.reset();
      navigate(
        authLink(purpose === "LOGIN" ? "/auth/otp" : "/auth/recovery-otp"),
        { state: location.state },
      );
    });
  }
  const remaining = Math.max(
      0,
      Math.ceil(((challenge?.expiresAt || 0) - now) / 1000),
    ),
    resend = Math.max(0, Math.ceil(((challenge?.resendAt || 0) - now) / 1000));
  if (
    otpView &&
    (!challenge ||
      challenge.purpose !== (recovery ? "ACCOUNT_RECOVERY" : "LOGIN"))
  )
    return (
      <Navigate
        to={authLink(recovery ? "/auth/forgot-password" : "/auth/phone")}
        replace
      />
    );
  if (resetView && !resetToken)
    return <Navigate to={authLink("/auth/forgot-password")} replace />;
  const toggle = (
    <button
      type="button"
      onClick={() => setShow(!show)}
      aria-label={show ? "Hide password" : "Show password"}
    >
      {show ? <EyeOff size={19} /> : <Eye size={19} />}
    </button>
  );
  return (
    <div className="auth-page auth-desktop">
      <Link className="auth-back" to="/">
        <ArrowLeft size={18} /> Back home
      </Link>
      <aside className="auth-story">
        <Brand />
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
          <h1>
            One platform.
            <br />
            Every fitness journey.
          </h1>
          <p>
            Find your gym, build your routine and keep your progress in one
            place.
          </p>
        </div>
        <small>Secure sessions · Connected gyms · Your progress</small>
      </aside>
      <section className="auth-card panel" aria-busy={busy}>
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        {!phoneView && !otpView && !resetView && !success && (
          <nav className="auth-tabs" aria-label="Account access">
            <Link
              to={authLink("/auth/login")}
              state={location.state}
              aria-current={!signup ? "page" : undefined}
            >
              Log in
            </Link>
            <Link
              to={authLink("/auth/signup")}
              state={location.state}
              aria-current={signup ? "page" : undefined}
            >
              Sign up
            </Link>
          </nav>
        )}
        {returnTo?.startsWith("/gyms/") && (
          <p className="auth-hint" role="status">
            Sign in to view your selected gym and choose a membership. We will
            take you straight back after sign in.
          </p>
        )}
        {error && (
          <div className="form-alert" role="alert">
            {error}
          </div>
        )}
        {signup ? (
          <form
            noValidate
            onSubmit={registration.handleSubmit((values) =>
              run(async () => {
                const { confirm: _confirm, phone: mobile, ...details } = values;
                finish(
                  await apiRequest<AuthResponse>("/api/v1/auth/register", {
                    method: "POST",
                    body: JSON.stringify({
                      ...details,
                      ...(mobile ? { phone: mobile } : {}),
                    }),
                  }),
                );
              }),
            )}
          >
            <h1>Create your account</h1>
            <p>Start your fitness journey with a free member account.</p>
            <label className="field">
              <span>Full name</span>
              <input autoComplete="name" {...registration.register("name")} />
              <small>{registration.formState.errors.name?.message}</small>
            </label>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                {...registration.register("email")}
              />
              <small>{registration.formState.errors.email?.message}</small>
            </label>
            <label className="field">
              <span>Phone number (optional)</span>
              <input
                type="tel"
                autoComplete="tel"
                placeholder="+919876543210"
                {...registration.register("phone")}
              />
              <small>{registration.formState.errors.phone?.message}</small>
            </label>
            <p className="auth-hint">
              Add a phone number to use phone sign in and password recovery.
            </p>
            <label className="field">
              <span>Password</span>
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  {...registration.register("password")}
                />
                {toggle}
              </div>
              <small>{registration.formState.errors.password?.message}</small>
            </label>
            <p className="auth-hint">
              10–128 characters, including uppercase, lowercase and a number.
            </p>
            <label className="field">
              <span>Confirm password</span>
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                {...registration.register("confirm")}
              />
              <small>{registration.formState.errors.confirm?.message}</small>
            </label>
            <button className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
            <p className="auth-switch">
              Already a member?{" "}
              <Link to={authLink("/auth/login")} state={location.state}>
                Log in
              </Link>
            </p>
            <p className="auth-switch">
              Own a gym? <Link to="/register-gym">Register your gym</Link>
            </p>
          </form>
        ) : success ? (
          <>
            <h1>Password reset</h1>
            <p>Your password has changed. Sign in with your new password.</p>
            <Link
              className="btn btn-primary auth-submit"
              to={authLink("/auth/login")}
            >
              Return to login
            </Link>
          </>
        ) : resetView ? (
          <form
            noValidate
            onSubmit={reset.handleSubmit((values) =>
              run(async () => {
                await apiRequest("/api/v1/auth/reset-password", {
                  method: "POST",
                  body: JSON.stringify({
                    resetToken,
                    password: values.password,
                  }),
                });
                sessionStorage.removeItem("gfu_reset");
                setAccessToken(null);
                clearChallenge();
                navigate(authLink("/auth/reset-success"), { replace: true });
              }),
            )}
          >
            <h1>Create new password</h1>
            <p>Use 10–128 characters with uppercase, lowercase and a number.</p>
            <label className="field">
              <span>New password</span>
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  {...reset.register("password")}
                />
                {toggle}
              </div>
              <small>{reset.formState.errors.password?.message}</small>
            </label>
            <label className="field">
              <span>Confirm password</span>
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                {...reset.register("confirm")}
              />
              <small>{reset.formState.errors.confirm?.message}</small>
            </label>
            <button className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? "Saving…" : "Reset password"}
            </button>
          </form>
        ) : otpView ? (
          <form
            noValidate
            onSubmit={otp.handleSubmit((values) =>
              run(async () => {
                const body = JSON.stringify({
                  challengeId: challenge!.challengeId,
                  code: values.code,
                });
                if (recovery) {
                  const r = await apiRequest<
                    ApiEnvelope<{ resetToken: string }>
                  >("/api/v1/auth/recovery/verify", { method: "POST", body });
                  setResetToken(r.data.resetToken);
                  sessionStorage.setItem("gfu_reset", r.data.resetToken);
                  clearChallenge();
                  navigate(authLink("/auth/reset-password"), { replace: true });
                } else
                  finish(
                    await apiRequest<AuthResponse>("/api/v1/auth/otp/verify", {
                      method: "POST",
                      body,
                    }),
                  );
              }),
            )}
          >
            <Link
              className="auth-step-back"
              to={authLink(recovery ? "/auth/forgot-password" : "/auth/phone")}
            >
              Change number
            </Link>
            <h1>Check your phone</h1>
            <p>
              Enter the six-digit code for the number ending in{" "}
              {challenge!.phone.slice(-4)}.
            </p>
            {import.meta.env.DEV && challenge?.devOtp && (
              <p>
                Development code: <strong>{challenge.devOtp}</strong>
              </p>
            )}
            <label className="field">
              <span>Verification code</span>
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                {...otp.register("code")}
              />
              <small>{otp.formState.errors.code?.message}</small>
            </label>
            <div className="otp-resend">
              <span>
                {remaining
                  ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                  : "Code expired. Request a new code."}
              </span>
              <button
                type="button"
                disabled={busy || resend > 0}
                onClick={() =>
                  requestCode(challenge!.phone, challenge!.purpose)
                }
              >
                {resend ? `Resend in ${resend}s` : "Resend code"}
              </button>
            </div>
            <button
              className="btn btn-primary auth-submit"
              disabled={busy || !remaining}
            >
              {busy ? "Verifying…" : "Verify code"}
            </button>
          </form>
        ) : phoneView ? (
          <form
            noValidate
            onSubmit={phone.handleSubmit((values) =>
              requestCode(values.phone, forgot ? "ACCOUNT_RECOVERY" : "LOGIN"),
            )}
          >
            <Link className="auth-step-back" to={authLink("/auth/login")}>
              Back to login
            </Link>
            <h1>{forgot ? "Recover your account" : "Continue with phone"}</h1>
            <p>
              {forgot
                ? "Use the phone number saved on your account. Accounts without a phone number need support assistance."
                : "Verify your number to sign in. New numbers create a member account."}
            </p>
            <label className="field">
              <span>Phone number</span>
              <input
                type="tel"
                autoComplete="tel"
                placeholder="+919876543210"
                {...phone.register("phone")}
              />
              <small>{phone.formState.errors.phone?.message}</small>
            </label>
            <button className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? "Requesting code…" : "Send verification code"}
            </button>
            {forgot && (
              <Link className="auth-switch" to="/contact">
                Need help recovering your account?
              </Link>
            )}
          </form>
        ) : (
          <form
            noValidate
            onSubmit={login.handleSubmit((values) =>
              run(async () =>
                finish(
                  await apiRequest<AuthResponse>("/api/v1/auth/login", {
                    method: "POST",
                    body: JSON.stringify(values),
                  }),
                ),
              ),
            )}
          >
            <div className="auth-icon">
              <LockKeyhole />
            </div>
            <h1>Welcome back</h1>
            <p>Log in to your GETFIT4U account.</p>
            <label className="field">
              <span>Email or phone</span>
              <input
                autoComplete="username"
                {...login.register("identifier")}
              />
              <small>{login.formState.errors.identifier?.message}</small>
            </label>
            <label className="field">
              <span>Password</span>
              <div className="password-field">
                <input
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  {...login.register("password")}
                />
                {toggle}
              </div>
              <small>{login.formState.errors.password?.message}</small>
            </label>
            <div className="auth-links">
              <Link to={authLink("/auth/forgot-password")}>
                Forgot password?
              </Link>
            </div>
            <button className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? (
                "Logging in…"
              ) : (
                <>
                  Log in <ArrowRight size={17} />
                </>
              )}
            </button>
            <Link
              className="btn btn-secondary auth-submit"
              to={authLink("/auth/phone")}
              state={location.state}
            >
              Continue with phone OTP
            </Link>
            <p className="auth-switch">
              New to GETFIT4U?{" "}
              <Link to={authLink("/auth/signup")} state={location.state}>
                Create an account
              </Link>
            </p>
          </form>
        )}
        <footer className="auth-footer">
          <LockKeyhole size={14} /> Secure account access
        </footer>
      </section>
    </div>
  );
}
