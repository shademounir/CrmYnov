// Persisted manifests, audit arrays and journal names use UTF-16 code-unit order.
// Locale collation would change their historical hashes across machines/locales.
export function compareCanonicalStrings(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
