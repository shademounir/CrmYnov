// Resolve actual protected catalogue provenance; no guessed/self-referential PR ID.
import assert from 'node:assert/strict';
export const IMAGE_CATALOGUE_PATH_V2='docs/governance/runtime-image-only-objectives-v1.json';
export const READONLY_CATALOGUE_PATH_V2='docs/governance/readonly-probe-objectives-v1.json';
const API='/repos/shademounir/CrmYnov/',S=/^[a-f0-9]{40}$/u;
export function validateImageCatalogueReviewV2(value,expectedPath=IMAGE_CATALOGUE_PATH_V2){
  assert(value&&Object.getPrototypeOf(value)===Object.prototype);
  assert.deepEqual(Object.keys(value).sort(),['kind','path']);
  assert.equal(value.kind,'PROTECTED_CATALOGUE_PATH_HISTORY');
  assert([IMAGE_CATALOGUE_PATH_V2,READONLY_CATALOGUE_PATH_V2].includes(expectedPath));assert.equal(value.path,expectedPath);return true;
}
export async function resolveImageCatalogueReviewV2(github,{descriptor,revision,expectedPath=IMAGE_CATALOGUE_PATH_V2}){
  validateImageCatalogueReviewV2(descriptor,expectedPath);assert(S.test(revision));
  // These two fixed repository paths use only URI query-safe characters. Keep
  // their slash literal: the unchanged official reader deliberately refuses %.
  const history=await github.get(API+'commits?path='+expectedPath+'&sha='+revision+'&per_page=1');
  assert(Array.isArray(history)&&history.length===1,'EXACT_LAST_CATALOGUE_COMMIT_REQUIRED');
  const commit=history[0].sha;assert(S.test(commit),'ACTUAL_CATALOGUE_COMMIT_REQUIRED');
  // A full page is ambiguous rather than silently truncated. Approved-merge,
  // exact catalogue bytes and ancestry are independently checked by the caller.
  const pulls=await github.get(API+'commits/'+commit+'/pulls?per_page=100');
  assert(Array.isArray(pulls)&&pulls.length<100,'BOUNDED_COMPLETE_CATALOGUE_PULLS_REQUIRED');
  const matches=pulls.filter(p=>p.merged_at&&p.state==='closed'&&p.base?.ref==='develop'&&p.merge_commit_sha===commit);
  assert.equal(matches.length,1,'UNIQUE_ACTUAL_MERGED_CATALOGUE_PR_REQUIRED');const pull=matches[0];
  assert(Number.isSafeInteger(pull.number)&&pull.number>0&&S.test(pull.head?.sha));
  return{pr:pull.number,head:pull.head.sha,mergeCommit:commit};
}
