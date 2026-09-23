"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Per-tab React error boundary — a rendering crash inside one chart or
 * heavy tab degrades to an inline retry card instead of a white screen.
 * Client-only (uses lifecycle APIs); safe under dynamic ssr:false shell.
 */
export class TabErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Frontend telemetry hook — replace with Sentry/OTel sink in fleet deploys.
    console.error("[tab-error-boundary]", error.message, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-6"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" aria-hidden="true" />
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
              This panel hit a rendering error
            </p>
          </div>
          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
            {this.state.error.message || "Unknown client-side error."} The rest of the dashboard
            keeps running — reload this panel to retry. If it persists, check the API health tab.
          </p>
          <Button size="sm" variant="outline" onClick={this.reset}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reload panel
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
