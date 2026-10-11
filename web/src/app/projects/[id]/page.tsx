import { Suspense } from "react";

import { ProjectView } from "@/components/project-view";
import { ProjectSkeleton } from "@/components/skeletons";
import { Shell } from "@/components/ui-kit";

export default function ProjectPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <ProjectSkeleton />
        </Shell>
      }>
      <ProjectView />
    </Suspense>
  );
}
