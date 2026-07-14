import {
  ApiError,
  createSession,
  deleteSession,
  getCurrentPrincipal,
  setCsrfTokenGetter,
  setUnauthorizedHandler,
  type GetCurrentPrincipal200,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

type SessionState =
  | { status: "checking" }
  | { status: "anonymous"; error?: string }
  | { status: "authenticated"; principal: GetCurrentPrincipal200 };

function csrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  for (const entry of document.cookie.split(";")) {
    const value = entry.trim();
    if (!value.startsWith("mie_csrf=")) continue;
    try {
      return decodeURIComponent(value.slice("mie_csrf=".length));
    } catch {
      return null;
    }
  }
  return null;
}

function authError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Credential rejected or session expired";
    if (error.status === 403) return "This principal cannot open FinDesk";
    if (error.status === 503) return "Authentication audit service is unavailable";
  }
  return error instanceof Error ? error.message : "Authentication failed";
}

export function SessionGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: "checking" });
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const becomeAnonymous = useCallback(
    (error?: string) => {
      queryClient.clear();
      setState(error ? { status: "anonymous", error } : { status: "anonymous" });
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    try {
      const principal = await getCurrentPrincipal();
      setState({ status: "authenticated", principal });
    } catch (error) {
      becomeAnonymous(authError(error));
    }
  }, [becomeAnonymous]);

  useEffect(() => {
    setCsrfTokenGetter(csrfCookie);
    setUnauthorizedHandler(() => becomeAnonymous("Session expired"));
    void refresh();
    return () => {
      setCsrfTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, [becomeAnonymous, refresh]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedCredential = credential.trim();
    setCredential("");
    if (!submittedCredential) return;
    setSubmitting(true);
    setState({ status: "checking" });
    try {
      await createSession({
        headers: { authorization: `Bearer ${submittedCredential}` },
      });
      if (!csrfCookie()) {
        throw new Error("Secure session exchange did not provide a CSRF cookie");
      }
      setCsrfTokenGetter(csrfCookie);
      await refresh();
    } catch (error) {
      becomeAnonymous(authError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    try {
      await deleteSession();
      becomeAnonymous();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) becomeAnonymous();
    }
  };

  if (state.status === "checking") {
    return (
      <main className="min-h-screen bg-background text-foreground grid place-items-center">
        <div role="status" className="font-mono text-xs uppercase tracking-wider">
          Verifying FinDesk session…
        </div>
      </main>
    );
  }

  if (state.status === "anonymous") {
    return (
      <main className="min-h-screen bg-background text-foreground grid place-items-center p-6">
        <form
          onSubmit={submit}
          className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-xl"
        >
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Protected FinDesk
          </div>
          <h1 className="mt-2 text-xl font-semibold">Authentication required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Open the same secure human session used by the Trading Desk.
          </p>
          <input
            type="password"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            aria-label="Permanent human credential"
            className="mt-5 w-full rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          {state.error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || credential.trim().length === 0}
            className="mt-5 w-full rounded bg-primary px-3 py-2 font-mono text-xs font-semibold uppercase text-primary-foreground disabled:opacity-40"
          >
            {submitting ? "Opening session…" : "Open FinDesk session"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      {children}
      <button
        type="button"
        onClick={() => void logout()}
        className="fixed right-3 top-3 z-50 rounded border border-border bg-card/95 px-2 py-1 font-mono text-[10px] text-muted-foreground shadow hover:text-foreground"
        title={`Verified principal: ${state.principal.principal.subject}`}
      >
        LOG OUT
      </button>
    </>
  );
}
