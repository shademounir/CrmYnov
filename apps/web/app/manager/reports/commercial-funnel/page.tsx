import React from "react";
import Pipeline from "./pipeline";

export default async function CommercialFunnelPage({ searchParams = Promise.resolve({}) }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const raw = await searchParams;
  const allowed = new Set(["from", "to", "campus", "campaign", "program", "source"]);
  const filters = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => allowed.has(key) && typeof value === "string" ? [[key, value]] : []));
  return <Pipeline initialFilters={filters} />;
}
