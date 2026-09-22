import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError, setAccessToken } from "../services/apiClient";

function EndUnavailableSession() {
  const client = useQueryClient(),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function signOut() {
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/v1/auth/logout", { method: "POST" });
      setAccessToken(null);
      client.clear();
      navigate("/login", { replace: true });
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
