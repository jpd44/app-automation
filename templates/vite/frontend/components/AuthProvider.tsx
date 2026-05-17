import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  getCurrentUser,
  getSession,
  signIn as cognitoSignIn,
  signOut as cognitoSignOut,
} from "@/lib/auth";

type AuthState = {
  email: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const user = getCurrentUser();
      const session = await getSession();
      if (user && session?.isValid()) {
        setEmail(user.getUsername());
      }
      setLoading(false);
    })();
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        email,
        loading,
        signIn: async (e, p) => {
          await cognitoSignIn(e, p);
          setEmail(e);
        },
        signOut: () => {
          cognitoSignOut();
          setEmail(null);
        },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
