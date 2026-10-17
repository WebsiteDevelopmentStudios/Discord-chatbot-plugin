import { parentPort, workerData } from "node:worker_threads";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = workerData.root;
const dataDir = resolve(root, "api/models");
const artifactDir = resolve(root, "data/trained-models");
const STOP = new Set(["a","an","the","is","are","was","were","to","of","and","or","in","on","for","it","this","that","i","you","me","my","your","we","do","does","what","how","why","when","where","who","can","could","would","should","please","tell","about"]);
const tokenize = text => String(text).toLowerCase().match(/[a-z0-9']+|[.!?,]/g) || [];
function report(progress, stage, message, extra={}) {
  parentPort.postMessage({type:"progress", progress, stage, message, ...extra});
}
function seededRandom(seed=42) {
  let n=seed>>>0;
  return () => { n=(1664525*n+1013904223)>>>0; return n/4294967296; };
}
function softmax(logits) {
  const max=Math.max(...logits), ex=logits.map(v=>Math.exp(Math.max(-30,v-max))), sum=ex.reduce((a,b)=>a+b,0);
  return ex.map(v=>v/sum);
}
function trainMlp({name, examples, textField="text", labelField="label", epochs=70, hiddenUnits=48, seed=42, progressStart=0, progressEnd=0}) {
  const clean=examples.filter(r=>typeof r[textField]==="string" && r[textField].trim() && typeof r[labelField]==="string");
  const vocab=[...new Set(clean.flatMap(r=>tokenize(r[textField]).filter(t=>!STOP.has(t))))].sort();
  const labels=[...new Set(clean.map(r=>r[labelField]))].sort();
  if(clean.length<4||vocab.length<2||labels.length<2) throw new Error(name+" training data is too small");
  const vi=new Map(vocab.map((t,i)=>[t,i])), li=new Map(labels.map((t,i)=>[t,i]));
  const vectors=clean.map(r=>{const x=new Float32Array(vocab.length);for(const t of tokenize(r[textField])){const i=vi.get(t);if(i!==undefined)x[i]+=1;}let norm=Math.sqrt(x.reduce((s,v)=>s+v*v,0));if(norm)for(let i=0;i<x.length;i++)x[i]/=norm;return x;});
  const ys=clean.map(r=>li.get(r[labelField]));
  const rand=seededRandom(seed), hidden=Math.max(8,Math.min(96,Math.floor(hiddenUnits)));
  const w1=Array.from({length:vocab.length},()=>Array.from({length:hidden},()=>((rand()-.5)*.18)));
  const b1=Array(hidden).fill(0), w2=Array.from({length:hidden},()=>Array.from({length:labels.length},()=>((rand()-.5)*.18))), b2=Array(labels.length).fill(0);
  const lr=.045; let finalLoss=0;
  for(let epoch=0;epoch<epochs;epoch++){
    let loss=0;
    for(let k=0;k<clean.length;k++){
      const x=vectors[k], target=ys[k], pre=Array(hidden).fill(0);
      for(let j=0;j<hidden;j++){let v=b1[j];for(let i=0;i<vocab.length;i++)v+=x[i]*w1[i][j];pre[j]=v;}
      const h=pre.map(v=>Math.max(0,v)), logits=labels.map((_,c)=>{let v=b2[c];for(let j=0;j<hidden;j++)v+=h[j]*w2[j][c];return v;});
      const probs=softmax(logits); loss-=Math.log(Math.max(1e-9,probs[target]));
      const dz=probs.slice();dz[target]-=1;
      const dh=Array(hidden).fill(0);
      for(let j=0;j<hidden;j++){for(let c=0;c<labels.length;c++)dh[j]+=dz[c]*w2[j][c];for(let c=0;c<labels.length;c++)w2[j][c]-=lr*h[j]*dz[c];}
      for(let c=0;c<labels.length;c++)b2[c]-=lr*dz[c];
      for(let j=0;j<hidden;j++){if(pre[j]<=0)continue;for(let i=0;i<vocab.length;i++)w1[i][j]-=lr*x[i]*dh[j];b1[j]-=lr*dh[j];}
    }
    finalLoss=loss/clean.length;
    if(epoch%Math.max(1,Math.floor(epochs/8))===0||epoch===epochs-1){
      const fraction=(epoch+1)/epochs;
      report(Math.round(progressStart+(progressEnd-progressStart)*fraction),name, name+" model training · epoch "+(epoch+1)+"/"+epochs,{loss:Number(finalLoss.toFixed(4))});
    }
  }
  function predict(text){
    const x=new Float32Array(vocab.length);for(const t of tokenize(text)){const i=vi.get(t);if(i!==undefined)x[i]+=1;}let norm=Math.sqrt(x.reduce((s,v)=>s+v*v,0));if(norm)for(let i=0;i<x.length;i++)x[i]/=norm;
    const h=Array(hidden).fill(0).map((_,j)=>Math.max(0,b1[j]+x.reduce((s,v,i)=>s+v*w1[i][j],0)));
    const p=softmax(labels.map((_,c)=>b2[c]+h.reduce((s,v,j)=>s+v*w2[j][c],0)));
    const order=p.map((score,i)=>({label:labels[i],score})).sort((a,b)=>b.score-a.score);
    return {prediction:order[0].label,confidence:Number(order[0].score.toFixed(3)),alternatives:order.slice(0,3).map(x=>({label:x.label,score:Number(x.score.toFixed(3))}))};
  }
  const artifact={format:"zoi-render-mlp-v1",name,vocabulary:vocab,labels,weights:{w1,b1,w2,b2},trainingExamples:clean.length,epochs,finalLoss:Number(finalLoss.toFixed(4))};
  return {artifact,summary:{name,trainingExamples:clean.length,vocabularySize:vocab.length,labels,epochs,finalLoss:Number(finalLoss.toFixed(4)),samplePredictions:clean.slice(0,5).map(r=>({input:r[textField],expected:r[labelField],...predict(r[textField])}))}};
}
function loadJsonl(text) {
 return text.split(/\r?\n/).filter(Boolean).map((line,i)=>{try{return JSON.parse(line)}catch{throw new Error("Invalid JSONL row "+(i+1))}});
}
async function main(){
 report(2,"starting","Loading the committed training data…");
 const intentRows=loadJsonl(await readFile(resolve(dataDir,"intent/data/training.jsonl"),"utf8"));
 const topicRows=loadJsonl(await readFile(resolve(dataDir,"knowledge/data/training.jsonl"),"utf8"));
 const corpus=(await readFile(resolve(dataDir,"language/data/corpus.txt"),"utf8")).split(/\r?\n/).filter(s=>s.trim());
 report(5,"intent","Training the intent neural network…");
 const intent=trainMlp({name:"Intent model",examples:intentRows,epochs:220,hiddenUnits:48,seed:11,progressStart:5,progressEnd:32});
 report(35,"knowledge","Training the knowledge-topic neural network…");
 const knowledge=trainMlp({name:"Knowledge model",examples:topicRows,epochs:260,hiddenUnits:64,seed:23,progressStart:35,progressEnd:63});
 report(66,"language","Preparing next-token training examples…");
 const sentences=corpus.map(tokenize).filter(t=>t.length>2);
 const counts=new Map();for(const s of sentences)for(const t of s)counts.set(t,(counts.get(t)||0)+1);
 const vocab=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,150).map(x=>x[0]);
 const allowed=new Set(vocab), pairs=[];
 for(const s of sentences){const seq=s.filter(t=>allowed.has(t));for(let i=1;i<seq.length;i++)pairs.push({text:seq[i-1],label:seq[i]});}
 const language=trainMlp({name:"Language next-token model",examples:pairs,textField:"text",labelField:"label",epochs:140,hiddenUnits:48,seed:37,progressStart:68,progressEnd:96});
 await mkdir(artifactDir,{recursive:true});
 for(const [file,result] of [["intent",intent],["knowledge",knowledge],["language",language]]) {
   await writeFile(resolve(artifactDir,file+".json"),JSON.stringify(result.artifact),{encoding:"utf8",mode:0o600});
 }
 const summaries=[intent.summary,knowledge.summary,language.summary];
 report(100,"complete","Training completed. Review the learned labels, sample predictions, vocabulary sizes, and training loss below.",{summaries,artifactLocation:"data/trained-models/",note:"Artifacts are written to this Render instance's filesystem. On the free instance, files may be lost after a restart or redeploy; download the result before then. These small models are experiments, not a general-purpose GPT model."});
}
main().catch(error=>parentPort.postMessage({type:"failed",message:error.message||"Training failed"}));
