"use client";

import { useRouter } from "nextjs-toploader/app";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ErrorText, errorMessage, Field } from "@/components/ui-kit";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.login(password);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto mt-32 max-w-sm px-6">
      <Card>
        <CardHeader>
          <span className="w-fit rounded bg-primary px-1.5 py-0.5 font-mono text-sm font-semibold text-primary-foreground">
            mogo
          </span>
          <CardTitle className="pt-3 text-xl">Sign in</CardTitle>
          <CardDescription>Enter the dashboard password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorText error={error} />
            <Button type="submit" className="w-full" loading={busy}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
