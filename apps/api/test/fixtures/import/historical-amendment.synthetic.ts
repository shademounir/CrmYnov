import {APPEND_MODE,APPEND_POLICY,appendPositions,appendHash,type SheetAppendBoundary,type SheetAppendContract} from "../../../src/sheet-import/sheet-append-contract.js";
import {artifactSha256} from "../../../src/sheet-import/sheet-private-artifact.js";
import {HISTORICAL_POLICY,readHistoricalCapability,type HistoricalFiles,type HistoricalCapability} from "../../../src/sheet-import/sheet-historical-contract.js";
export function historicalFixture(campusId="33333333-3333-4333-8333-333333333333",workbookId="synthetic_historical_application"):{boundary:SheetAppendBoundary;bytes:Buffer;contract:SheetAppendContract;capability:HistoricalCapability;capabilityBytes:Buffer;files:HistoricalFiles;values:string[][]}{
 const values:string[][]=[Array.from({length:11},(_,i)=>`column-${i+1}`),...Array.from({length:2585},()=>[] as string[])];
 values[2584]=["synthetic","","","","Synthetic A","a@example.invalid","raw-A","old-A"];
 values[2585]=["synthetic","","","","Synthetic B","b@example.invalid","raw-B","old-B"];
 const boundary:SheetAppendBoundary={schemaVersion:1,mode:APPEND_MODE,workbookId,sheetId:0,tab:"SYNTHETIC",generation:"615e16cf-5029-4b48-90e8-76900990d63f",range:"A1:CV10001",capturedAt:"2026-01-01T00:00:00.000Z",boundaryRow:2586,values};
 const bytes=Buffer.from(JSON.stringify(boundary)),{values:originalValues,...fields}=boundary,original=appendPositions(boundary.range,originalValues);
 const contract:SheetAppendContract={...fields,artifactSha256:artifactSha256(bytes),headerFingerprint:appendHash(original.header),historicalFingerprints:original.positions.map(({row,fingerprint})=>({row,fingerprint})),bindingSha256:"b".repeat(64),policy:APPEND_POLICY,producerAttested:false};
 const raw={schemaVersion:1,policy:HISTORICAL_POLICY,...Object.fromEntries(["workbookId","sheetId","tab","range","generation","boundaryRow","headerFingerprint"].map(k=>[k,contract[k as keyof SheetAppendContract]])),boundaryArtifactSha256:contract.artifactSha256,bindingSha256:contract.bindingSha256,campusId,sourceObservationSha256:"c".repeat(64),transitions:([2585,2586] as const).map(row=>{const p=original.positions.find(p=>p.row===row)!,cells=[...p.cells];cells[7]=`reviewed-${row}`;return{row,column:8,originalFingerprint:p.fingerprint,acceptedFingerprint:appendHash(cells),acceptedCells:cells};})};
 const capability=readHistoricalCapability(raw,boundary,contract.artifactSha256),capabilityBytes=Buffer.from(JSON.stringify(raw)),files:HistoricalFiles={boundary,boundarySha256:contract.artifactSha256,capability,capabilitySha256:artifactSha256(capabilityBytes)};
 const observed=structuredClone(values);for(const t of capability.transitions)observed[t.row-1]=[...t.acceptedCells];for(let i=0;i<49;i++)observed.push([`synthetic-arrival-${i}`]);
 return{boundary,bytes,contract,capability,capabilityBytes,files,values:observed};
}
