import { Suspense } from "react";

import { FormSkeleton } from "@/components/skeletons";
import { Shell } from "@/components/ui-kit";
import { FeatureFormPage } from "@/components/feature-form";

export default function Page() {
  return (
    <Suspense
      fallback={
        <Shell>
          <FormSkeleton />
        </Shell>
      }>
      <FeatureFormPage />
    </Suspense>
  );
}
