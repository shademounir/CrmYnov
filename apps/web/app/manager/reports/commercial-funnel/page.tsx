import React from "react";
import Pipeline from "./pipeline";
import { pipelineFilterKeys } from "./funnel-contract";

export default async function CommercialFunnelPage({ searchParams = Promise.resolve({}) }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const raw = await searchParams;
  const allowed = new Set<string>(pipelineFilterKeys);
  const filters = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => allowed.has(key) && typeof value === "string" ? [[key, value]] : []));
  return <Pipeline initialFilters={filters} />;
}
