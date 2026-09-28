import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
export function ProfileContactEditor({
  phone,
  email,
}: {
  phone?: string;
  email?: string;
}) {
  const client = useQueryClient();
  const [nextPhone, setPhone] = useState(phone || ""),
    [code, setCode] = useState(""),
    [challengeId, setChallenge] = useState(""),
    [message, setMessage] = useState(""),
    [googleError, setGoogleError] = useState("");
  const googleTarget = useRef<HTMLDivElement>(null);
  async function updated() {
    setMessage("Verified contact saved. Other sessions have been signed out.");
    setChallenge("");
    await client.invalidateQueries({ queryKey: ["api"] });
    await client.invalidateQueries({ queryKey: ["me"] });
  }
  const request = useMutation({
    mutationFn: () =>
      apiRequest<ApiEnvelope<{ challengeId: string; devOtp?: string }>>(
        "/api/v1/users/me/contact/phone/request",
        { method: "POST", body: JSON.stringify({ phone: nextPhone }) },
      ),
    onSuccess: (result) => {
      setChallenge(result.data.challengeId);
      setMessage(
        result.data.devOtp
          ? `Development verification code: ${result.data.devOtp}`
          : "Verification code sent to the new phone.",
      );
    },
  });
  const confirm = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/users/me/contact/phone/confirm", {
        method: "POST",
        body: JSON.stringify({ challengeId, code }),
      }),
    onSuccess: updated,
  });
  const changeEmail = useMutation({
    mutationFn: (credential: string) =>
      apiRequest("/api/v1/users/me/contact/email", {
        method: "POST",
        body: JSON.stringify({ credential }),
      }),
    onSuccess: updated,
  });
  const submitGoogle = useRef(changeEmail.mutate);
  submitGoogle.current = changeEmail.mutate;
  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) return;
    let active = true;
    const render = () => {
      const google = (window as any).google;
      if (!active || !googleTarget.current || !google?.accounts?.id) return;
      google.accounts.id.initialize({
        client_id: clientId,
        callback: (result: { credential?: string }) => {
          if (active && result.credential)
            submitGoogle.current(result.credential);
        },
      });
      google.accounts.id.renderButton(googleTarget.current, {
        type: "standard",
        theme: "outline",
        text: "continue_with",
        size: "medium",
      });
    };
    if ((window as any).google?.accounts?.id) render();
    else {
      let script = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]',
      );
      if (!script) {
        script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        document.head.append(script);
      }
      script.addEventListener("load", render, { once: true });
      script.addEventListener(
        "error",
        () =>
          active &&
          setGoogleError(
            "Google verification could not load. Check your connection and reopen this dialog.",
          ),
        { once: true },
      );
    }
    return () => {
      active = false;
    };
  }, []);
  return (
    <section className="profile-contact-editor">
      <h3>Verified contact details</h3>
      <p>
        Phone: {phone || "Not added"} · Email: {email || "Not added"}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          challengeId ? confirm.mutate() : request.mutate();
        }}
      >
        <label>
          New phone number
          <input
            type="tel"
            autoComplete="tel"
            value={nextPhone}
            onChange={(event) => {
              setPhone(event.target.value);
              setChallenge("");
            }}
            required
          />
        </label>
        {challengeId && (
          <label>
            Verification code
            <input
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
        )}
        <button
          className="btn btn-secondary"
          disabled={request.isPending || confirm.isPending}
        >
          {challengeId ? "Verify and save phone" : "Send verification code"}
        </button>
      </form>
      <p>
        To change your email, verify the new address with Google. Ordinary
        profile updates cannot change contact details.
      </p>
      {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
        <div ref={googleTarget} aria-label="Verify new email with Google" />
      ) : (
        <p>
          Email verification is not configured. Contact support to enable
          verified Google email changes.
        </p>
      )}
      {changeEmail.isPending && <p role="status">Verifying email…</p>}
      {[request.error, confirm.error, changeEmail.error]
        .filter(Boolean)
        .map((error, i) => (
          <p role="alert" key={i}>
            {(error as Error).message}
          </p>
        ))}
      {googleError && <p role="alert">{googleError}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
