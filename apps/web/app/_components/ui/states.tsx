import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }): React.JSX.Element {
  return <section className="ui-state" aria-labelledby="empty-state-title"><h2 id="empty-state-title">{title}</h2><p>{description}</p>{action}</section>;
}

export function ErrorState({ title = "Une erreur est survenue", description, action }: { title?: string; description: string; action?: ReactNode }): React.JSX.Element {
  return <section className="ui-state ui-state--error" role="alert"><h2>{title}</h2><p>{description}</p>{action}</section>;
}

export function Skeleton({ label = "Chargement en cours", height = "1rem" }: { label?: string; height?: string }): React.JSX.Element {
  return <div className="ui-skeleton" style={{ height }} role="status" aria-label={label}><span className="sr-only">{label}</span></div>;
}
