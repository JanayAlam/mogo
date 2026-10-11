import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholders shaped like each page, shown until its data arrives. */

function TitleBlock({ actions = 0 }: { actions?: number }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24" />
        ))}
      </div>
    </div>
  );
}

function ItemCard({ lines = 2 }: { lines?: number }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-14" />
        </div>
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={i === lines - 1 ? "h-4 w-2/3" : "h-4 w-full"} />
        ))}
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ItemCardsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <ItemCard key={i} />
      ))}
    </div>
  );
}

export function ProjectCardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ItemCard lines={1} />
      <ItemCard lines={1} />
    </div>
  );
}

export function ProjectSkeleton() {
  return (
    <>
      <Skeleton className="mb-4 h-8 w-24" />
      <TitleBlock actions={3} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Card className="h-fit">
          <CardContent className="space-y-4 p-4">
            <Skeleton className="h-3 w-24" />
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Skeleton className="h-9 w-72" />
          <ItemCard />
          <ItemCard />
        </div>
      </div>
    </>
  );
}

export function FeatureSkeleton() {
  return (
    <>
      <Skeleton className="mb-4 h-8 w-24" />
      <TitleBlock actions={2} />
      <Card className="mb-6">
        <CardContent className="flex items-end gap-6 p-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-9 w-80" />
          </div>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="ml-auto h-9 w-36" />
        </CardContent>
      </Card>
      <div className="space-y-4">
        <ItemCard />
        <ItemCard />
      </div>
    </>
  );
}

/** Repo settings and the feature form: title, then form sections. */
export function FormSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <>
      <Skeleton className="mb-4 h-8 w-24" />
      <TitleBlock actions={2} />
      <div className="space-y-6">
        {Array.from({ length: sections }, (_, i) => (
          <Card key={i}>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-72" />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 2 }, (_, j) => (
                <div key={j} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-8 w-32" />
        </div>
      ))}
    </div>
  );
}
