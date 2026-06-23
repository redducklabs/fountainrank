import type { ReactNode } from "react";

import { resolveViewState, type ViewStateInput } from "../../lib/view-state";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import { OfflineState } from "./OfflineState";

export function QueryStateView({
  input,
  onRetry,
  emptyLabel,
  children,
}: {
  input: ViewStateInput;
  onRetry?: () => void;
  emptyLabel?: string;
  children: ReactNode;
}) {
  switch (resolveViewState(input)) {
    case "loading":
      return <LoadingState />;
    case "offline":
      return <OfflineState onRetry={onRetry} />;
    case "error":
      return <ErrorState onRetry={onRetry} />;
    case "empty":
      return <EmptyState label={emptyLabel} />;
    case "ready":
      return <>{children}</>;
  }
}
