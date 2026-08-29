export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

export function StatusBadge({ children, tone = "neutral" }: { children: string; tone?: StatusTone }): React.JSX.Element {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}
