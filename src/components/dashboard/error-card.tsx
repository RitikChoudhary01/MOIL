"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ErrorCardProps {
  title: string;
  message?: string | null;
  onRetry: () => void;
}

/** Inline error state with retry — never a blank screen. */
export function ErrorCard({ title, message, onRetry }: ErrorCardProps) {
  return (
    <Card className="items-center gap-0 rounded-xl p-8 text-center" role="alert">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 font-semibold">Couldn&apos;t load {title}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {message ?? "Something went wrong while fetching data."} The demo backend is running —
        one retry usually fixes it.
      </p>
      <Button onClick={onRetry} variant="outline" className="mt-5 gap-2">
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        Retry
      </Button>
    </Card>
  );
}
