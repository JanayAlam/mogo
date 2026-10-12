import { LogIn } from "lucide-react";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorText } from "@/components/ui-kit";

const START = "/api/auth/github/login";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto mt-32 max-w-sm px-6">
      <Card>
        <CardHeader>
          <span className="w-fit rounded bg-primary px-1.5 py-0.5 font-mono text-sm font-semibold text-primary-foreground">
            mogo
          </span>
          <CardTitle className="pt-3 text-xl">Sign in</CardTitle>
          <CardDescription>
            New here? Signing in creates your account. Mogo reviews pull requests on the repos where you install
            its GitHub App.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Suspense fallback={<SignInButton href={START} />}>
            <SignIn searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}

/** The query (?error from a failed sign-in, ?next to return to) is request data, so it renders inside Suspense. */
async function SignIn({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error, next } = await searchParams;
  return (
    <>
      <ErrorText error={typeof error === "string" ? error : ""} />
      <SignInButton href={typeof next === "string" ? `${START}?next=${encodeURIComponent(next)}` : START} />
    </>
  );
}

function SignInButton({ href }: { href: string }) {
  return (
    <Button asChild className="w-full">
      {/* a plain link: the sign-in is a full-page round trip through GitHub */}
      <a href={href}>
        <LogIn /> Continue with GitHub
      </a>
    </Button>
  );
}
