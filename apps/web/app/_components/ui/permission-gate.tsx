import type { ReactNode } from "react";

export function PermissionGate({ allowed, children, fallback = null }: { allowed: boolean; children: ReactNode; fallback?: ReactNode }): React.JSX.Element {
  return <>{allowed ? children : fallback}</>;
}
