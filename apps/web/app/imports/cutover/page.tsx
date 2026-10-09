import React from "react";
import { CutoverWorkspace } from "./cutover-workspace";
import { cutoverId } from "./cutover-client";

export default async function CutoverPage({ searchParams }: Readonly<{ searchParams: Promise<{ manifest?: string | string[]; package?: string | string[] }> }>): Promise<React.JSX.Element> {
  const query = await searchParams;
  const manifestId = typeof query.manifest === "string" ? cutoverId(query.manifest) : undefined;
  const packageId = typeof query.package === "string" ? cutoverId(query.package) : undefined;
  return <CutoverWorkspace {...(manifestId ? { initialManifestId: manifestId } : {})} {...(packageId ? { initialPackageId: packageId } : {})} />;
}
