import type { ReactNode } from "react";
import { useAuth } from "./AuthProvider";
import { SignInForm } from "./SignInForm";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { email, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!email) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <SignInForm />
      </div>
    );
  }

  return <>{children}</>;
}
