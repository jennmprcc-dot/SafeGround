/**
 * Minimal local auth flag for the MVP build wave (per delegation brief:
 * "signed-in state can be a minimal local flag/demo for now").
 * Real auth (Supabase-ready schema) lands in a later wave; this keeps
 * sign-in/out flows reachable and privacy behavior (R-P7 sign-out ≤2 taps)
 * demonstrable on every main screen.
 */
import { createContext, use, useCallback, useState } from "react";
import type { ReactNode } from "react";

export interface Session {
  signedIn: boolean;
  displayName: string; // alias — no legal name requirement (PRD R-P7)
  isOutreach?: boolean;
  signIn: (name?: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<Session | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ signedIn: boolean; displayName: string }>({ signedIn: false, displayName: "" });

  const signIn = useCallback((name?: string) => {
    setState({ signedIn: true, displayName: name?.trim() || "Neighbor" });
  }, []);

  const signOut = useCallback(() => {
    setState({ signedIn: false, displayName: "" });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        signedIn: state.signedIn,
        displayName: state.displayName,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): Session {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}