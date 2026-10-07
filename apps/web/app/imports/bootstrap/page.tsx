import React from "react";
import { BootstrapWizard } from "./bootstrap-wizard";
import { packageKey } from "./bootstrap-client";

export default async function BootstrapPage({ searchParams }: Readonly<{ searchParams: Promise<{ package?: string | string[] }> }>): Promise<React.JSX.Element> {
  const query = await searchParams;
  const initialPackageId = typeof query.package === "string" ? packageKey(query.package) : undefined;
  return <BootstrapWizard {...(initialPackageId ? { initialPackageId } : {})} />;
}
