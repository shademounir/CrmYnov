// The root test and instrumented coverage workflows select this directory.
// Keep the versioned renewal refusal tests in the same measured execution.
import '../pool-reconciliation/general-operational-pre-v4.test.mjs';
import '../runtime-image-only/cutover-renewal-catalogue-v1.test.mjs';
import '../runtime-image-only/cutover-jira-readiness-v1.test.mjs';
import '../runtime-image-only/post-preservation-v3.test.mjs';
