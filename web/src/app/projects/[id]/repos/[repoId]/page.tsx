import { Suspense } from "react";

import { FormSkeleton } from "@/components/skeletons";
import { Shell } from "@/components/ui-kit";
import { RepoSettings } from "@/components/repo-settings";

export default function RepoPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <FormSkeleton />
        </Shell>
      }>
      <RepoSettings />
    </Suspense>
  );
}
