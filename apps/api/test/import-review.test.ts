import assert from "node:assert/strict"; import test from "node:test";
import type { Principal } from "../src/auth/auth.types.js"; import { ImportReviewService } from "../src/import-review/import-review.service.js";
const manager: Principal = { userId: "10000000-0000-4000-8000-000000000061", roles: ["MANAGER"], scopes: [{ kind: "GLOBAL" }], sessionId: "20000000-0000-4000-8000-000000000061" };
test("queues sanitized collisions and records an idempotent controlled decision", () => {
 const service = new ImportReviewService(); const leadId="30000000-0000-4000-8000-000000000061";
 const item=service.enqueue({batchId:"batch-synthetic",lineNumber:2,reasons:["IDENTITY_COLLISION"],candidateLeadIds:[leadId]},manager);
 assert.deepEqual(Object.keys(item).sort(),["batchId","candidateLeadIds","id","lineNumber","reasons","status","version"]); assert.equal(service.list(manager).length,1);
 assert.throws(()=>service.decide(item.id,{decision:"ATTACH",expectedVersion:1,idempotencyKey:"decision-001",targetLeadId:"30000000-0000-4000-8000-000000000099"},manager));
 const resolved=service.decide(item.id,{decision:"ATTACH",expectedVersion:1,idempotencyKey:"decision-001",targetLeadId:leadId},manager);
 assert.equal(resolved.status,"RESOLVED"); assert.deepEqual(service.decide(item.id,{decision:"ATTACH",expectedVersion:1,idempotencyKey:"decision-001",targetLeadId:leadId},manager),resolved);
});
test("refuses malformed, stale and unauthorized review operations",()=>{ const service=new ImportReviewService(); const admissions={...manager,roles:["ADMISSIONS"]} as Principal;
 assert.throws(()=>service.enqueue({batchId:"x",lineNumber:0,reasons:[]},manager)); assert.throws(()=>service.list(admissions));
 const item=service.enqueue({batchId:"batch-synthetic",lineNumber:1,reasons:["SOURCE_UNKNOWN"]},manager);
 assert.throws(()=>service.decide(item.id,{decision:"CREATE",expectedVersion:0,idempotencyKey:"decision-002"},manager));
 assert.throws(()=>service.decide(item.id,{decision:"IGNORE",expectedVersion:1,idempotencyKey:"decision-003",targetLeadId:"30000000-0000-4000-8000-000000000061"},manager)); });
