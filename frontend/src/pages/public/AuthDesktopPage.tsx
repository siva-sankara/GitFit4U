import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Brand } from "../../components/Brand";
import { PhoneInput } from "../../components/PhoneInput";
import { BackIconButton, BackIconLink } from "../../components/BackIconControl";
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
import type { ActiveRole, OwnerOnboarding } from "../../services/session";

const phoneForm = z.object({ phone: phoneSchema });
const otpForm = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code"),
});
type Challenge = {
  challengeId: string;
  operationId?: string;
  phone: string;
  maskedPhone: string;
  purpose: "SIGNUP" | "LOGIN" | "ACCOUNT_RECOVERY";
  expiresAt: number;
  resendAt: number;
  deliveryStatus: "SUBMITTED" | "SENT" | "DELIVERED" | "READ" | "FAILED";
};
type AuthResponse = ApiEnvelope<{
  accessToken: string;
  user: { activeRole: ActiveRole; roles?: ActiveRole[]; onboarding?: OwnerOnboarding };
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
    signupOtp = path === "/auth/signup-otp",
    recovery = path === "/auth/recovery-otp";
  const otpView = path === "/auth/otp" || signupOtp || recovery,
    forgot = path === "/auth/forgot-password";
  const phoneView = path === "/auth/phone" || forgot,
    resetView = path === "/auth/reset-password",
    success = path === "/auth/reset-success";
  const [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [signupRequired, setSignupRequired] = useState(false);
  const running = useRef(false);
  const invalidPhoneInput = useRef(false);
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
    invalidPhoneInput.current = false;
    setSignupRequired(false);
    setShow(false);
    login.clearErrors();
    registration.clearErrors();
    phone.clearErrors();
    otp.clearErrors();
    reset.clearErrors();
  }, [path, login.clearErrors, registration.clearErrors, phone.clearErrors, otp.clearErrors, reset.clearErrors]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!otpView || !challenge?.challengeId) return;
    let active = true;
    const checkDelivery = async () => {
      try {
        const result = await apiRequest<
          ApiEnvelope<{
            deliveryStatus: Challenge["deliveryStatus"] | "EXPIRED";
            expired: boolean;
          }>
        >(`/api/v1/auth/otp/${challenge.challengeId}/status`);
        if (!active) return;
        if (result.data.deliveryStatus === "FAILED") {
          setChallenge((current) =>
            current ? { ...current, deliveryStatus: "FAILED" } : current,
          );
          setError(
            "WhatsApp could not deliver this verification message. Request a new code or use another login method.",
          );
        }
      } catch {
        // Status polling is advisory; verification and timers remain
        // authoritative and transient polling failures must not block input.
      }
    };
    void checkDelivery();
    const timer = window.setInterval(checkDelivery, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [otpView, challenge?.challengeId]);
  function clearChallenge(resetState = true) {
    sessionStorage.removeItem("gfu_auth_challenge");
    sessionStorage.removeItem("gfu_challenge");
    if (resetState) setChallenge(null);
  }
  function finish(response: AuthResponse, fromSignup = false) {
    setAccessToken(response.data.accessToken);
    setRole(
      response.data.user.activeRole === "GYM_STAFF"
        ? "GYM_OWNER"
        : response.data.user.activeRole,
    );
    clearChallenge(false);
    sessionStorage.removeItem("gfu_reset");
    const next = fromSignup && response.data.user.activeRole === "GYM_OWNER" ? undefined : returnTo;
    navigate(loginDestination(response.data.user, next), {
      replace: true,
    });
  }
  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setError("");
    setSignupRequired(false);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setSignupRequired(e instanceof ApiError && e.code === "SIGNUP_REQUIRED");
      setError(
        e instanceof ApiError
          ? e.message
          : "Unable to connect. Please try again.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function requestCode(number: string, purpose: Challenge["purpose"]) {
    await run(async () => {
      const r = await apiRequest<
        ApiEnvelope<{
          challengeId: string;
          maskedPhone: string;
          expiresInSeconds: number;
          resendInSeconds: number;
          deliveryStatus: "SUBMITTED";
        }>
      >(
        purpose === "LOGIN"
          ? "/api/v1/auth/otp/request"
          : "/api/v1/auth/forgot-password",
        {
          method: "POST",
          body: JSON.stringify({
            phone: number,
          }),
        },
      );
      const next: Challenge = {
        challengeId: r.data.challengeId,
        phone: number,
        maskedPhone: r.data.maskedPhone,
        purpose,
        expiresAt: Date.now() + r.data.expiresInSeconds * 1000,
        resendAt: Date.now() + r.data.resendInSeconds * 1000,
        deliveryStatus: r.data.deliveryStatus,
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
  async function resendSignupCode() {
    await run(async () => {
      const r = await apiRequest<
        ApiEnvelope<{
          challengeId: string;
          operationId: string;
          maskedPhone: string;
          expiresInSeconds: number;
          resendInSeconds: number;
          deliveryStatus: "SUBMITTED";
        }>
      >("/api/v1/auth/signup/resend", {
        method: "POST",
        body: JSON.stringify({ operationId: challenge!.operationId }),
      });
      const next: Challenge = {
        challengeId: r.data.challengeId,
        operationId: r.data.operationId,
        phone: challenge!.phone,
        maskedPhone: r.data.maskedPhone,
        purpose: "SIGNUP",
        expiresAt: Date.now() + r.data.expiresInSeconds * 1000,
        resendAt: Date.now() + r.data.resendInSeconds * 1000,
        deliveryStatus: r.data.deliveryStatus,
      };
      setChallenge(next);
      sessionStorage.setItem("gfu_auth_challenge", JSON.stringify(next));
      otp.reset();
    });
  }
  async function changeSignupNumber() {
    await run(async () => {
      await apiRequest("/api/v1/auth/signup/cancel", {
        method: "POST",
        body: JSON.stringify({ operationId: challenge!.operationId }),
      });
      clearChallenge();
      navigate(authLink("/auth/signup"), { replace: true, state: location.state });
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
      challenge.purpose !==
        (signupOtp ? "SIGNUP" : recovery ? "ACCOUNT_RECOVERY" : "LOGIN"))
  )
    return (
      <Navigate
        to={authLink(
          signupOtp
            ? "/auth/signup"
            : recovery
              ? "/auth/forgot-password"
              : "/auth/phone",
        )}
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
      <BackIconLink className="auth-back" to="/" label="Back to home" />
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
        {location.state?.sessionExpired === true && !signup && <p className="auth-hint" role="status">Your session expired or was signed out. Please sign in again.</p>}
        {returnTo?.startsWith("/gyms/") && (
          <p className="auth-hint" role="status">
            Sign in to view your selected gym and choose a membership. We will
            take you straight back after sign in.
          </p>
        )}
        {error && (
          <div className="form-alert" role="alert">
            {error}
            {signupRequired && <p><Link to={authLink("/auth/signup")}>Create an account</Link></p>}
          </div>
        )}
        {signup ? (
          <form
            noValidate
            onSubmit={registration.handleSubmit((values) => {
              if (invalidPhoneInput.current) {
                registration.setError("phone", { message: "Enter a 10-digit mobile number." }, { shouldFocus: true });
                return;
              }
              return run(async () => {
                const { confirm: _confirm, ...details } = values;
                const r = await apiRequest<
                  ApiEnvelope<{
                    challengeId: string;
                    operationId: string;
                    maskedPhone: string;
                    expiresInSeconds: number;
                    resendInSeconds: number;
                    deliveryStatus: "SUBMITTED";
                  }>
                >("/api/v1/auth/register", {
                    method: "POST",
                    body: JSON.stringify(details),
                  });
                const next: Challenge = {
                  challengeId: r.data.challengeId,
                  operationId: r.data.operationId,
                  phone: values.phone,
                  maskedPhone: r.data.maskedPhone,
                  purpose: "SIGNUP",
                  expiresAt: Date.now() + r.data.expiresInSeconds * 1000,
                  resendAt: Date.now() + r.data.resendInSeconds * 1000,
                  deliveryStatus: r.data.deliveryStatus,
                };
                setChallenge(next);
                sessionStorage.setItem("gfu_auth_challenge", JSON.stringify(next));
                otp.reset();
                navigate(authLink("/auth/signup-otp"), { state: location.state });
              });
            })}
          >
            <h1>Create your account</h1>
            <p>Choose your account type to get started.</p>
            <fieldset className="auth-role-options" aria-describedby="signup-role-error" disabled={busy}>
              <legend>Account type</legend>
              {([
                ["USER", "User", "Find gyms, book classes and manage your fitness."],
                ["GYM_OWNER", "Gym Owner", "Register your gym and manage members and operations."],
              ] as const).map(([value, title, description]) => (
                <label className="auth-role-option" key={value}>
                  <input type="radio" value={value} required aria-invalid={Boolean(registration.formState.errors.role)} {...registration.register("role")} />
                  <div><strong>{title}</strong></div>
                </label>
              ))}
              <small id="signup-role-error" role={registration.formState.errors.role ? "alert" : undefined}>{registration.formState.errors.role?.message}</small>
            </fieldset>
            <label className="field">
              <span>Full name</span>
              <input autoComplete="name" required aria-invalid={Boolean(registration.formState.errors.name)} aria-describedby="signup-name-error" {...registration.register("name")} />
              <small id="signup-name-error">{registration.formState.errors.name?.message}</small>
            </label>
            <label className="field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="email"
                required
                aria-invalid={Boolean(registration.formState.errors.email)}
                aria-describedby="signup-email-error"
                {...registration.register("email")}
              />
              <small id="signup-email-error">{registration.formState.errors.email?.message}</small>
            </label>
            <label className="field">
              <span>Mobile number</span>
              <Controller name="phone" control={registration.control} render={({ field }) =>
                <PhoneInput name={field.name} ref={field.ref} value={field.value} onBlur={field.onBlur}
                  required
                  aria-label="WhatsApp mobile number" aria-invalid={Boolean(registration.formState.errors.phone)} aria-describedby="signup-phone-error"
                  onValidityChange={invalid => { invalidPhoneInput.current = invalid; }}
                  onValueChange={value => { registration.clearErrors("phone"); field.onChange(value); }} />
              } />
              <small id="signup-phone-error" role={registration.formState.errors.phone ? "alert" : undefined}>{registration.formState.errors.phone?.message}</small>
            </label>
            <p className="auth-hint">
              India (+91) is selected by default. Choose another country format when needed. We will send a six-digit verification code to this WhatsApp number.
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
              {busy ? "Submitting to WhatsApp…" : "Send WhatsApp OTP"}
            </button>
            <p className="auth-switch">
              Already have an account?{" "}
              <Link to={authLink("/auth/login")} state={location.state}>
                Log in
              </Link>
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
                if (signupOtp) {
                  finish(
                    await apiRequest<AuthResponse>("/api/v1/auth/signup/verify", {
                      method: "POST",
                      body: JSON.stringify({
                        operationId: challenge!.operationId,
                        challengeId: challenge!.challengeId,
                        code: values.code,
                      }),
                    }),
                    true,
                  );
                } else if (recovery) {
                  const r = await apiRequest<
                    ApiEnvelope<{ resetToken: string }>
                  >("/api/v1/auth/recovery/verify", { method: "POST", body });
                  setResetToken(r.data.resetToken);
                  sessionStorage.setItem("gfu_reset", r.data.resetToken);
                  clearChallenge(false);
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
            {signupOtp ? (
              <BackIconButton
                className="auth-step-back"
                onClick={changeSignupNumber}
                disabled={busy}
                label="Change phone number"
              />
            ) : (
              <BackIconLink
                className="auth-step-back"
                to={authLink(recovery ? "/auth/forgot-password" : "/auth/phone")}
                label="Back to change phone number"
              />
            )}
            <h1>Check WhatsApp</h1>
            <p>
              Enter the six-digit verification code sent to{" "}
              <strong>{challenge!.maskedPhone}</strong>. Meta accepted the message for delivery; delivery may still fail and will be tracked by webhook.
            </p>
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
                onClick={() => signupOtp
                  ? resendSignupCode()
                  : requestCode(challenge!.phone, challenge!.purpose)}
              >
                {resend ? `Resend OTP in ${resend}s` : "Resend OTP"}
              </button>
            </div>
            <button
              className="btn btn-primary auth-submit"
              disabled={busy || !remaining || challenge!.deliveryStatus === "FAILED"}
            >
              {busy ? "Verifying…" : signupOtp ? "Verify and create account" : "Verify"}
            </button>
          </form>
        ) : phoneView ? (
          <form
            noValidate
            onSubmit={phone.handleSubmit((values) => {
              if (invalidPhoneInput.current) {
                phone.setError("phone", { message: "Enter a valid mobile number." }, { shouldFocus: true });
                return;
              }
              return requestCode(values.phone, forgot ? "ACCOUNT_RECOVERY" : "LOGIN");
            })}
          >
            <BackIconLink
              className="auth-step-back"
              to={authLink("/auth/login")}
              label="Back to login"
            />
            <h1>{forgot ? "Recover your account" : "Continue with phone"}</h1>
            <p>
              {forgot
                ? "Use the phone number saved on your account. Accounts without a phone number need support assistance."
                : "Enter the WhatsApp number on your existing active account. GETFIT4U will send a six-digit code from its platform sender."}
            </p>
            <label className="field">
              <span>Phone number</span>
              <Controller name="phone" control={phone.control} render={({ field }) =>
                <PhoneInput name={field.name} ref={field.ref} value={field.value} onBlur={field.onBlur} required
                  onValidityChange={invalid => { invalidPhoneInput.current = invalid; }}
                  onValueChange={value => { phone.clearErrors("phone"); field.onChange(value); }} />
              } />
              <small>{phone.formState.errors.phone?.message}</small>
            </label>
            <button className="btn btn-primary auth-submit" disabled={busy}>
              {busy ? "Submitting to WhatsApp…" : "Send WhatsApp OTP"}
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
              Login with WhatsApp OTP
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
