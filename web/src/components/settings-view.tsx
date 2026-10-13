"use client";

import { ExternalLink } from "lucide-react";

import { LlmConnections } from "@/components/llm-connections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eyebrow, Shell, useSession } from "@/components/ui-kit";

export function SettingsView() {
  const session = useSession();
  return (
    <Shell>
      <div className="mb-8">
        <Eyebrow className="tracking-widest text-primary">Account</Eyebrow>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h1>
      </div>
      <div className="grid gap-10">
        <LlmConnections />
        <Card>
          <CardHeader>
            <CardTitle>GitHub</CardTitle>
            <CardDescription>
              Mogo reads pull requests and posts its reviews as <span className="font-mono">mogo[bot]</span> on the
              repos where you install its GitHub App. Signed in as{" "}
              <span className="font-mono">{session?.user.login ?? "…"}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/api/auth/github/install?next=/settings">Choose repos for Mogo</a>
            </Button>
            {session && (
              <Button asChild variant="ghost">
                <a href={session.app_url} target="_blank" rel="noreferrer">
                  The App on GitHub <ExternalLink />
                </a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
