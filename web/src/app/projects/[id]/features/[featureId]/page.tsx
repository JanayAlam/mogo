import { Suspense } from "react";

import { FeatureView } from "@/components/feature-view";

export default function FeaturePage() {
  return (
    <Suspense>
      <FeatureView />
    </Suspense>
  );
}
