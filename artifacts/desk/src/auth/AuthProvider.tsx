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
import {
  default as React,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const CSRF_COOKIE = "mie_csrf";

export type AuthState =
  | { status: "checking" }
  | { status: "anonymous"; error?: string }
  | { status: "authenticated"; principal: GetCurrentPrincipal200 };

export type AuthContextValue = Readonly<{
  state: AuthState;
  openSession(permanentCredential: string): Promise<void>;
  logout(): Promise<void>;
  refreshWhoAmI(): Promise<GetCurrentPrincipal200 | null>;
}>;

type EstablishSessionDependencies = Readonly<{
  createSession(options: RequestInit): Promise<unknown>;
  whoami(): Promise<GetCurrentPrincipal200>;
  readCsrfToken(): string | null;
  configureCsrf(getter: () => string | null): void;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function readCookieValue(
  name: string,
  cookieHeader: string,
): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const entry of cookieHeader.split(";")) {
    const candidate = entry.trim();
    if (!candidate.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(candidate.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

function browserCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  return readCookieValue(CSRF_COOKIE, document.cookie);
}

/**
 * Exchange a permanent credential without retaining it. The value exists only
 * as this call's argument and Authorization header; browser state receives only
 * the opaque secure session and readable CSRF cookie.
 */
export async function establishBrowserSession(
  permanentCredential: string,
  dependencies: EstablishSessionDependencies,
): Promise<GetCurrentPrincipal200> {
  const credential = permanentCredential.trim();
  if (!credential) throw new Error("A permanent human credential is required");

  await dependencies.createSession({
    headers: { authorization: `Bearer ${credential}` },
  });
  if (!dependencies.readCsrfToken()) {
    throw new Error("Secure session exchange did not provide a CSRF cookie");
  }
  dependencies.configureCsrf(dependencies.readCsrfToken);
  return dependencies.whoami();
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Credential rejected or session expired";
    if (error.status === 403) return "This human principal is not allowed to open the Desk";
    if (error.status === 503) return "Authentication audit service is unavailable";
  }
  return error instanceof Error ? error.message : "Authentication failed";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "checking" });

  const becomeAnonymous = useCallback(
    (error?: string) => {
      queryClient.clear();
      setState(error ? { status: "anonymous", error } : { status: "anonymous" });
    },
    [queryClient],
  );

  const refreshWhoAmI = useCallback(async () => {
    try {
      const principal = await getCurrentPrincipal();
      setState({ status: "authenticated", principal });
      return principal;
    } catch (error) {
      becomeAnonymous(errorMessage(error));
      return null;
    }
  }, [becomeAnonymous]);

  useEffect(() => {
    const csrfGetter = () => browserCsrfToken();
    setCsrfTokenGetter(csrfGetter);
    setUnauthorizedHandler(() => becomeAnonymous("Session expired"));
    void refreshWhoAmI();
    return () => {
      setCsrfTokenGetter(null);
      setUnauthorizedHandler(null);
    };
  }, [becomeAnonymous, refreshWhoAmI]);

  const openSession = useCallback(
    async (permanentCredential: string) => {
      setState({ status: "checking" });
      try {
        const principal = await establishBrowserSession(permanentCredential, {
          createSession,
          whoami: getCurrentPrincipal,
          readCsrfToken: browserCsrfToken,
          configureCsrf: setCsrfTokenGetter,
        });
        setState({ status: "authenticated", principal });
      } catch (error) {
        becomeAnonymous(errorMessage(error));
        throw error;
      }
    },
    [becomeAnonymous],
  );

  const logout = useCallback(async () => {
    try {
      await deleteSession();
      becomeAnonymous();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        becomeAnonymous();
        return;
      }
      throw error;
    }
  }, [becomeAnonymous]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, openSession, logout, refreshWhoAmI }),
    [state, openSession, logout, refreshWhoAmI],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
