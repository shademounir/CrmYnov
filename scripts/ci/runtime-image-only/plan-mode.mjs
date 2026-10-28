// Closed plan/scope dispatch shared by the existing authority, executor and CLI.
import assert from 'node:assert/strict';
import {validateRc48ServiceImagePlanDraft} from './plan.mjs';
import {validateImageOnlyServedState} from './served-state.mjs';
import {validateRc48ImageRollbackPlanDraft,validateImageRollbackServedState} from './rollback-plan.mjs';
export function isImageRollback(plan){
  if(plan.kind==='UNPROTECTED_PURE_RC48_TO_RC44_IMAGE_ROLLBACK_DRAFT'){return true;}
  assert.equal(plan.kind,'UNPROTECTED_PURE_RC48_SERVICE_IMAGE_PLAN_DRAFT','CLOSED_IMAGE_PLAN_KIND');return false;
}
export function imagePlanScope(plan){return isImageRollback(plan)?'RC48_SERVICE_IMAGE_ROLLBACK_V1':'RC48_SERVICE_IMAGE_ONLY_V1';}
export function validateImagePlan(plan,candidate,baseline,rollbackContext){
  if(isImageRollback(plan)){
    assert(rollbackContext,'ROLLBACK_CONTEXT_REQUIRED');
    return validateRc48ImageRollbackPlanDraft(plan,{...rollbackContext,candidate,currentBaseline:baseline},Date.parse(plan.baselineObservedAt));
  }
  assert.equal(rollbackContext,undefined,'FORWARD_PLAN_CANNOT_UPGRADE_TO_ROLLBACK');
  return validateRc48ServiceImagePlanDraft(plan,candidate,baseline,Date.parse(plan.baselineObservedAt));
}
export function validatePlannedImageServedState(input,now){
  if(isImageRollback(input.plan)){return validateImageRollbackServedState(input,now);}
  return validateImageOnlyServedState(input,now);
}
