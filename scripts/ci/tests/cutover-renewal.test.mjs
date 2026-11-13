// The root test and instrumented coverage workflows select this directory.
// Keep the versioned renewal refusal tests in the same measured execution.
import '../pool-reconciliation/general-operational-pre-v4.test.mjs';
import '../runtime-image-only/cutover-renewal-catalogue-v1.test.mjs';
import '../runtime-image-only/cutover-jira-readiness-v1.test.mjs';
import '../runtime-image-only/post-preservation-v3.test.mjs';
import '../runtime-image-only/cutover-native-phase-boundary-v1.test.mjs';
import '../runtime-image-only/cutover-native-authority-v1.test.mjs';
import '../runtime-image-only/cutover-native-run-v1.test.mjs';
import '../runtime-image-only/cutover-native-cli-v1.test.mjs';
import '../runtime-image-only/cutover-protected-source-v1.test.mjs';
