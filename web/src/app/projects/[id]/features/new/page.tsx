import { Suspense } from "react";

import { FeatureFormPage } from "@/components/feature-form";

export default function Page() {
  return (
    <Suspense>
      <FeatureFormPage />
    </Suspense>
  );
}
