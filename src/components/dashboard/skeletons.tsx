import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function KpiRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="gap-0 rounded-xl p-5 py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-4 h-7 w-32" />
          <Skeleton className="mt-2.5 h-3 w-40" />
        </Card>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("gap-0 rounded-xl p-5", className)}>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-1.5 h-3 w-72" />
      <div className="mt-5 flex h-64 items-end gap-1.5 sm:gap-2">
        {Array.from({ length: 14 }).map((_, i) => (
          <Skeleton
            key={i}
            className="w-full flex-1 rounded-t"
            style={{ height: `${34 + ((i * 37) % 60)}%` }}
          />
        ))}
      </div>
    </Card>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card className="gap-0 rounded-xl p-5">
      <Skeleton className="h-4 w-56" />
      <div className="mt-4 space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-3/4" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card className="gap-0 rounded-xl p-5">
      <Skeleton className="h-4 w-64" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="ml-auto h-4 w-12" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <KpiRowSkeleton />
      <ChartSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListSkeleton rows={4} />
        <Card className="gap-0 rounded-xl p-5">
          <Skeleton className="h-4 w-56" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="mt-5 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-full" style={{ width: `${88 - i * 9}%` }} />
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="gap-0 rounded-xl p-4">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-5/6" />
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ReserveMapSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="gap-0 rounded-xl p-5 lg:col-span-2">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-1.5 h-3 w-64" />
        <div className="mt-4 aspect-square w-full">
          <Skeleton className="h-full w-full rounded-lg" />
        </div>
      </Card>
      <div className="space-y-4 lg:col-span-3">
        <Card className="gap-0 rounded-xl p-5">
          <Skeleton className="h-5 w-52" />
          <div className="mt-4 grid grid-cols-12 gap-1">
            {Array.from({ length: 108 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-[3px]" />
            ))}
          </div>
        </Card>
        <TableSkeleton rows={5} />
      </div>
    </div>
  );
}

export function ProductionSkeleton() {
  return (
    <div className="space-y-4">
      <ChartSkeleton className="pb-6" />
      <TableSkeleton rows={6} />
      <ListSkeleton rows={3} />
    </div>
  );
}

export function RisksSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <ListSkeleton key={i} rows={2} />
        ))}
      </div>
      <Card className="gap-0 h-fit rounded-xl p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-2 h-3 w-56" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
