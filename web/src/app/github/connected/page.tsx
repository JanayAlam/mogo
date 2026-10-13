"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { GITHUB_CHANNEL } from "@/lib/github-connect";

/** Where the GitHub popup ends: tells the app that opened it, then closes itself. */
export default function GitHubConnectedPage() {
  useEffect(() => {
    try {
      const channel = new BroadcastChannel(GITHUB_CHANNEL);
      channel.postMessage("connected");
      channel.close();
    } catch {
      // no channel: the app refreshes when this window closes and it regains focus
    }
    window.close(); // only works for a window a script opened; otherwise the text below stays
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <Card className="w-full">
        <CardContent className="space-y-2 p-6 text-center">
          <p className="font-semibold">GitHub is connected</p>
          <p className="text-sm text-muted-foreground">You can close this window and go back to Mogo.</p>
          <Link href="/" className="text-sm underline underline-offset-2">
            Open Mogo
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
