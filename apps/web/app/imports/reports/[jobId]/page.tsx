import React from "react";
import { ImportReport } from "./import-report";

export default async function ImportReportPage({ params }: Readonly<{ params: Promise<{ jobId: string }> }>): Promise<React.JSX.Element> {
  const { jobId } = await params;
  return <ImportReport jobId={jobId} />;
}
