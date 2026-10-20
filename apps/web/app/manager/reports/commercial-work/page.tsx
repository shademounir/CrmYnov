import React from "react";
import CommercialWork from "./work";

export default async function CommercialWorkPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<React.JSX.Element> {
  const values = await searchParams;
  const query = new URLSearchParams(Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string")));
  return <CommercialWork query={query.toString()} />;
}
