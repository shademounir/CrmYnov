export const RELEASE_PROFILE = Object.freeze({
  GATE_1: "gate-1",
  APPLICATION: "application",
});

const PROFILES = Object.freeze({
  [RELEASE_PROFILE.GATE_1]: Object.freeze({
    description: "First technical Gate-1 release with controls available today.",
    requiredChecks: Object.freeze([
      "unit-tests",
      "terraform-static",
      "iac-security",
      "secret-scan",
    ]),
  }),
  [RELEASE_PROFILE.APPLICATION]: Object.freeze({
    description: "Future application release; unavailable controls remain fail-closed.",
    requiredChecks: Object.freeze([
      "unit-tests",
      "lint",
      "type-check",
      "build",
      "CodeQL",
      "dependency-review",
      "secret-scan",
      "iac-security",
      "container-scan",
      "SonarQube Quality Gate",
    ]),
  }),
});

export function releaseProfile(name) {
  const profile = PROFILES[name];
  if (!profile) throw new Error(`Unsupported release profile: ${name}.`);
  return { name, ...profile, requiredChecks: [...profile.requiredChecks] };
}
