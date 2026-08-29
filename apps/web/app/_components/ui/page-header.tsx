import type { ReactNode } from "react";

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: string; description?: string; actions?: ReactNode }): React.JSX.Element {
  return <header className="ui-page-header"><div>{eyebrow ? <p className="ui-page-header__eyebrow">{eyebrow}</p> : null}<h1>{title}</h1>{description ? <p className="ui-page-header__description">{description}</p> : null}</div>{actions ? <div className="ui-page-header__actions">{actions}</div> : null}</header>;
}
