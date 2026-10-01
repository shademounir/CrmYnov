export function Pagination({ page, pageCount, hrefForPage, label = "Pagination" }: { page: number; pageCount: number; hrefForPage: (page: number) => string; label?: string }): React.JSX.Element {
  const safeCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), safeCount);
  const pages = Array.from({ length: safeCount }, (_, index) => index + 1);
  return <nav className="ui-pagination" aria-label={label}><span>Page {current} sur {safeCount}</span><ol className="ui-pagination__pages">{pages.map((item) => <li key={item}><a href={hrefForPage(item)} aria-current={item === current ? "page" : undefined} aria-label={`Page ${item}`}>{item}</a></li>)}</ol></nav>;
}
