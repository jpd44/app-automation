import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { confirmSignUp, resendConfirmationCode } from "@/lib/auth";

export function ConfirmSignUpForm({
  email,
  onDone,
}: {
  email: string;
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await confirmSignUp(email, code);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    setError(null);
    setInfo(null);
    try {
      await resendConfirmationCode(email);
      setInfo("Code resent. Check your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resend failed");
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Confirm your email</CardTitle>
        <CardDescription>
          We sent a 6-digit code to <span className="font-medium">{email}</span>.
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Confirmation code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-muted-foreground">{info}</p>}
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Confirming…" : "Confirm"}
          </Button>
          <Button type="button" variant="link" className="w-full" onClick={onResend}>
            Resend code
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
