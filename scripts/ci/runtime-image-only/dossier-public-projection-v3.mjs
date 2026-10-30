// Validation-only view of a complete, source-rebuilt read-only job dossier.
// No input object, persisted field, payload byte or digest is rewritten.
import assert from 'node:assert/strict';
import {types} from 'node:util';
import {validateLocalReadOnlyDossier,READONLY_RUNTIME_FILES,POOL_RUNTIME_FILES} from '../pool-reconciliation/pool-job-dossier-v1.mjs';
import {validateImageInventoryPublicProjection} from './operational-cli-v2.mjs';

const SOURCE_FILES=new Set([...Object.values(READONLY_RUNTIME_FILES),...Object.values(POOL_RUNTIME_FILES)]);
const DOSSIER_FIELDS=['bundle','job','objective','schemaVersion'];
const ordering=(left,right)=>left.localeCompare(right,'en');
const MAX_BYTES=20971520;
function descriptorsOf(value,array){
  assert(!types.isProxy(value),'TYPED_PUBLIC_PROXY_REFUSED');
  assert(array||Object.getPrototypeOf(value)===Object.prototype);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  assert(Reflect.ownKeys(descriptors).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')));
  return descriptors;
}
function copyArray(value,depth,state){
  const descriptors=descriptorsOf(value,true),result=[];
  assert(Object.keys(descriptors).every(key=>key==='length'||/^(?:0|[1-9]\d*)$/u.test(key)));
  const length=descriptors.length.value;assert(Number.isSafeInteger(length)&&length<=200000);
  for(let index=0;index<length;index++){
    const descriptor=descriptors[String(index)];assert(descriptor,'TYPED_PUBLIC_SPARSE_ARRAY_REFUSED');
    result.push(copyValue(descriptor.value,depth+1,state));
  }
  return result;
}
function copyObject(value,depth,state){
  const descriptors=descriptorsOf(value,false),result={};
  for(const [key,descriptor] of Object.entries(descriptors)){
    assert(!['__proto__','constructor','prototype'].includes(key));
    Object.defineProperty(result,key,{value:copyValue(descriptor.value,depth+1,state),enumerable:descriptor.enumerable,writable:true,configurable:true});
  }
  return result;
}
function copyValue(value,depth,state){
  assert(++state.nodes<=200000&&depth<=64);
  if(value===null||typeof value==='boolean'||typeof value==='string'){return value;}
  if(typeof value==='number'){assert(Number.isFinite(value));return value;}
  assert(value&&typeof value==='object'&&!types.isProxy(value)&&!state.active.has(value));
  state.active.add(value);
  try{return Array.isArray(value)?copyArray(value,depth,state):copyObject(value,depth,state);}
  finally{state.active.delete(value);}
}
function fixedReader(readSource){
  assert.equal(typeof readSource,'function');
  return file=>{
    assert(SOURCE_FILES.has(file),'TYPED_PUBLIC_SOURCE_OUTSIDE_COLLECTOR_CLOSURE');
    const bytes=readSource(file);assert(!types.isProxy(bytes)&&(typeof bytes==='string'||Buffer.isBuffer(bytes)));
    return Buffer.from(bytes);
  };
}
function isCompleteDossier(value){
  return !Array.isArray(value)&&Object.keys(value).sort(ordering).join(',')===DOSSIER_FIELDS.join(',')&&value.schemaVersion===1;
}
function dossierView(value,readSource){
  // The rebuild validates phase, source, payload, task/env, reference and pins
  // together before this one qualified reference receives a typed public view.
  validateLocalReadOnlyDossier(value,readSource);
  const reference=value.objective.databaseSecretRef;
  validateImageInventoryPublicProjection({secretKeyRef:reference});
  Object.defineProperty(value.objective,'databaseSecretRef',{...Object.getOwnPropertyDescriptor(value.objective,'databaseSecretRef'),value:{secretKeyRef:reference}});
  return value;
}
function projectView(value,readSource){
  if(value===null||typeof value!=='object'){return value;}
  if(isCompleteDossier(value)){return dossierView(value,readSource);}
  for(const [key,descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))){
    if(key==='length'&&Array.isArray(value)){continue;}
    Object.defineProperty(value,key,{...descriptor,value:projectView(descriptor.value,readSource)});
  }
  return value;
}
export function validateImageDossierPublicProjectionV3(value,readSource){
  try{
    const snapshot=copyValue(value,0,{nodes:0,active:new Set()});
    assert(Buffer.byteLength(JSON.stringify(snapshot))<=MAX_BYTES);
    const view=projectView(snapshot,fixedReader(readSource));
    validateImageInventoryPublicProjection(view);
    return value;
  }catch{throw new Error('IMAGE_TYPED_DOSSIER_PUBLIC_V3_REFUSED');}
}
