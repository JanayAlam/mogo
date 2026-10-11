import { Suspense } from "react";

import { RepoSettings } from "@/components/repo-settings";

export default function RepoPage() {
  return (
    <Suspense>
      <RepoSettings />
    </Suspense>
  );
}
