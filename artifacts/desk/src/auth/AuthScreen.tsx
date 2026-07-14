import React, { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

export function AuthScreen() {
  const { state, openSession } = useAuth();
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submittedCredential = credential;
    setCredential("");
    setSubmitting(true);
    try {
      await openSession(submittedCredential);
    } catch {
      // AuthProvider owns the user-visible, audited failure state.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground grid place-items-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl"
      >
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
          Protected Desk
        </div>
        <h1 className="mt-2 text-xl font-semibold">Authentication required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Open a secure browser session with your permanent human credential.
          The credential is cleared immediately after submission.
        </p>

        <label className="mt-6 block font-mono text-xs uppercase text-muted-foreground">
          Permanent human credential
          <input
            type="password"
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={submitting}
            className="mt-2 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        </label>

        {state.status === "anonymous" && state.error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || credential.trim().length === 0}
          className="mt-5 w-full rounded bg-primary px-3 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary-foreground disabled:opacity-40"
        >
          {submitting ? "Opening session…" : "Open Desk session"}
        </button>
      </form>
    </main>
  );
}
