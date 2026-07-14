import React, { type ReactNode } from "react";
import { AuthScreen } from "./AuthScreen";
import { useAuth, type AuthState } from "./AuthProvider";

export function AuthBoundary({
  state,
  children,
  anonymous,
}: {
  state: AuthState;
  children: ReactNode;
  anonymous?: ReactNode;
}) {
  if (state.status === "checking") {
    return (
      <main className="min-h-screen bg-background text-foreground grid place-items-center">
        <div role="status" className="font-mono text-xs uppercase tracking-wider">
          Verifying Desk session…
        </div>
      </main>
    );
  }
  if (state.status === "anonymous") return <>{anonymous ?? <AuthScreen />}</>;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  return <AuthBoundary state={state}>{children}</AuthBoundary>;
}
