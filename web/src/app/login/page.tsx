"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ErrorText, errorMessage } from "@/components/ui-kit";
import { api } from "@/lib/client";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.login(password);
      router.replace("/");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <main className="mx-auto mt-32 max-w-sm px-6">
      <div className="mb-6 flex items-center gap-2 font-mono text-sm font-semibold">
        <span className="rounded bg-primary px-1.5 py-0.5 text-primary-foreground">PR</span>
        mogo<span className="text-muted-foreground">/agent</span>
      </div>
      <form onSubmit={submit} className="panel space-y-4 p-6">
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" autoFocus required className="field" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorText error={error} />
        <button type="submit" className="btn-primary w-full">Sign in</button>
      </form>
    </main>
  );
}
