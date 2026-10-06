import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, logoutSession } from "../services/apiClient";

function EndUnavailableSession() {
  const client = useQueryClient(),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    client.clear();
    navigate("/login", { replace: true });
    try {
      await logoutSession();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to sign out. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={() => void signOut()}
      >
        {busy ? "Signing out..." : "Sign out and return to login"}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function SessionFailure({
  error,
  retry,
}: {
  error: Error;
  retry: () => unknown;
}) {
  const unavailable = error instanceof ApiError && error.status === 403;
  return (
    <main className="state-card">
      <h1>
        {unavailable
          ? "Account access unavailable"
          : "Unable to check your session"}
      </h1>
      <p role="alert">{error.message}</p>
      {unavailable ? (
        <EndUnavailableSession />
      ) : (
        <button className="btn btn-secondary" onClick={() => retry()}>
          Retry
        </button>
      )}
    </main>
  );
}
