// Synthetic parser regressions only. No CRM API, credentials, providers or external network.
import assert from 'node:assert/strict';
import http from 'node:http';
import {deflateSync} from 'node:zlib';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),mode=process.argv[2];
assert(['compressed-tail','late-filter'].includes(mode));
const deadline=setTimeout(()=>{process.exitCode=1;throw Error('synthetic_parser_deadline');},8000);
try {
  if(mode==='compressed-tail') {
    const parser=require('body-parser').json();let server;
    try {
      server=http.createServer((req,res)=>{
        if(req.url==='/health'){res.end('alive');return;}
        let ended=false,parsed=false,error;
        const finish=()=>{if(ended&&parsed){res.statusCode=error?400:200;res.end(error?'rejected':JSON.stringify(req.body));}};
        req.once('end',()=>{ended=true;finish();});
        parser(req,res,err=>{error=err;parsed=true;finish();});
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const port=server.address().port,first=Buffer.concat([deflateSync(Buffer.from('{"synthetic":true}')),Buffer.from([0])]),tail=Buffer.alloc(1024,255);
      const send=(method,url,headers={},write)=>new Promise((resolve,reject)=>{
        const req=http.request({host:'127.0.0.1',port,path:url,method,agent:false,headers},res=>{let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.once('end',()=>resolve({status:res.statusCode,text}));});
        req.once('error',reject);req.setTimeout(4000,()=>req.destroy(Error('fixture_request_timeout')));
        if(write)write(req);else req.end();
      });
      const result=await send('POST','/',{'content-type':'application/json','content-encoding':'deflate','content-length':first.length+tail.length},req=>{req.write(first);setTimeout(()=>req.end(tail),50);});
      assert([200,400].includes(result.status));if(result.status===200)assert.deepEqual(JSON.parse(result.text),{synthetic:true});
      assert.deepEqual(await send('GET','/health'),{status:200,text:'alive'});
    }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
  }else {
    // Exercise a delayed filter resuming after teardown without a process-level error handler.
    const req=new PassThrough(),boundary='CrmySyntheticBoundary';let resume,parser,nextCalls=0;
    const rejected=Error('synthetic_rejection');
    const multipart=['waiting','reject'].map(name=>`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.txt"\r\nContent-Type: text/plain\r\n\r\nx\r\n`).join('');
    req.headers={'content-type':'multipart/form-data; boundary='+boundary,'content-length':Buffer.byteLength(multipart)};
    await new Promise((resolve,reject)=>{
      const middleware=require('multer')({fileHwm:1,streamHandler:(incoming,p)=>{parser=p;incoming.pipe(p);},fileFilter:(incoming,file,done)=>{
        if(file.fieldname==='waiting')resume=done;
        else incoming.once('end',()=>setImmediate(()=>done(rejected)));
      }}).any();
      middleware(req,null,error=>{
        nextCalls++;try{assert.equal(error,rejected);assert.equal(typeof resume,'function');}catch(e){reject(e);return;}
        setImmediate(()=>{parser.once('close',()=>{try{assert.equal(nextCalls,1);assert.deepEqual(req.files,[]);resolve();}catch(e){reject(e);}});resume(null,true);});
      });
      req.end(multipart);
    });
  }
  console.log(JSON.stringify({mode,completed:true,synthetic:true,productionMutation:false}));
}finally{clearTimeout(deadline);}
