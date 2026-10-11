import { Suspense } from "react";

import { FeatureSkeleton } from "@/components/skeletons";
import { Shell } from "@/components/ui-kit";
import { FeatureView } from "@/components/feature-view";

export default function FeaturePage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <FeatureSkeleton />
        </Shell>
      }>
      <FeatureView />
    </Suspense>
  );
}
