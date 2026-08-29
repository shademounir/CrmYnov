export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return <article className="ui-stat-card"><p className="ui-stat-card__label">{label}</p><p className="ui-stat-card__value">{value}</p>{hint ? <p className="ui-stat-card__hint">{hint}</p> : null}</article>;
}
