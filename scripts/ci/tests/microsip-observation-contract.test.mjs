// Keep the preserved, pure MicroSIP observation regression suite in the normal
// unit/full suites and canonical c8 coverage. This imports synthetic assertions
// only: it does not launch MicroSIP, register SIP or make a real telephone call.
await import("../../telephony-agent/microsip-observation.test.mjs");
