const styles = Object.fromEntries([
  "page", "steps", "notice", "feedback", "error", "card", "form", "fields", "actions", "check", "metadata", "hash", "progress", "stats", "mapping", "columns", "checkboxes", "alias", "rows", "row", "rowHeader", "badge", "review", "reason", "sourceText", "valueGrid", "candidate", "table", "notes",
].map((name) => [name, `bootstrap-${name}`])) as Readonly<Record<string, string>>;
export default styles;
