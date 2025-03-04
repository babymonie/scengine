var _=require("axios"),W=require("fs"),L=require("cheerio"),{URL:j}=require("url"),F=require("crypto"),A=new Map,R=1e3*60*5;function U(e){return F.createHash("md5").update(e).digest("hex")}function E(e,n){return`${e}::${n}`}function N(e){let n=A.get(e);return n?Date.now()>n.expireAt?(A.delete(e),null):n.data:null}function q(e,n,i=R){A.set(e,{data:n,expireAt:Date.now()+i})}async function k(e,n,i={},s=R){let t=E(e,n),a=N(t);if(a)return a;let l=await _.get(e,i);return q(t,l.data,s),l.data}var w={trim:(e,n)=>typeof e=="string"?e.trim():e,toLowerCase:(e,n)=>typeof e=="string"?e.toLowerCase():e,toUpperCase:(e,n)=>typeof e=="string"?e.toUpperCase():e,default:(e,n,i)=>e==null||e===""?i:e,regex:(e,n,i,s="0")=>{if(typeof e!="string")return e;let t=new RegExp(i),a=e.match(t);if(a){let l=parseInt(s);return a[l]||e}return e},dateParse:(e,n)=>{let i=new Date(e);return isNaN(i.getTime())?e:i.toISOString()},customJS:(e,n,i)=>{try{return new Function("value",i)(e)}catch{return e}},regexReplace:(e,n,i,s)=>{if(typeof e!="string")return e;i=i.replace(/\\\\/g,"\\");let t=new RegExp(i);return e.replace(t,s)}};function C(e,n){if(Array.isArray(e))return e.map(i=>C(i,n));if(typeof e=="object"&&e!==null){if(e.type&&e.children)return n(e).text();let i={};for(let s in e)i[s]=C(e[s],n);return i}else return e}function b(e,n){let i=[],s=1,t=n;for(;t<e.length&&s>0;){let a=e[t];a.endsWith("{")?(s++,i.push(a)):a==="}"?(s--,s>0&&i.push(a)):i.push(a),t++}return{blockText:i.join(`
`),newIndex:t}}function T(e){e=e.trim();let n=e.match(/^([^\{]+)\{([\s\S]+)\}\s*$/);if(!n)throw new Error("Invalid script format. Ensure the Scengine is enclosed in { }.");let i=n[1].trim().split("|").map(f=>f.trim()),s=i[0],t={};for(let f=1;f<i.length;f++){let[r,o]=i[f].split("=");r&&o&&(t[r.trim()]=o.trim())}let a=n[2].trim(),l=y(a);return{url:s,config:t,instructions:l}}function y(e){e=e.replace(/}\s*else\s*{/g,`}
else {`);let n=e.split(`
`).map(t=>t.trim()).filter(t=>t&&!t.startsWith("//")),i=[],s=0;for(;s<n.length;){let t=n[s];if(/^if\s*\(.*\)\s*\{$/.test(t)){let a=t.match(/^if\s*\((.*)\)\s*\{$/);if(!a)throw new Error(`Invalid if condition: ${t}`);let l=a[1];s++;let{blockText:f,newIndex:r}=b(n,s),o=y(f);s=r;let c=null;if(s<n.length&&/^else\s*\{$/.test(n[s])){s++;let{blockText:u,newIndex:g}=b(n,s);c=y(u),s=g}i.push({type:"conditional",condition:l,ifInstructions:o,elseInstructions:c});continue}if(t.endsWith(":{")){let a=t.slice(0,-2).trim();s++;let{blockText:l,newIndex:f}=b(n,s),r=y(l);i.push({type:"block",assign:a,instructions:r}),s=f;continue}{let a=!1;t.startsWith("!")&&(a=!0,t=t.slice(1).trim());let l=t.split("=");if(l.length!==2)throw new Error(`Invalid instruction: ${t}`);let f=l[0].trim(),r=l[1].trim(),o,c=[];if(r.includes("|")){let h=r.split("|").map(d=>d.trim());o=h[0],c=h.slice(1).map(d=>{let m=d.match(/^(\w+)(?:\((.*)\))?$/);return m?{fn:m[1],params:m[2]?m[2].split(",").map(S=>S.trim().replace(/^["']|["']$/g,"")):[]}:{fn:d,params:[]}})}else o=r;let u=null;(f.startsWith('"')&&f.endsWith('"')||f.startsWith("'")&&f.endsWith("'"))&&(u=f.slice(1,-1));let g=null,p=null;if(!u){let h=f.split(">").map(m=>m.trim());g=h.map(m=>m.includes("..")?m.replace(/\.\./g,"."):m);let d=h[h.length-1];if(!d.startsWith(".")&&d.includes(".")){let m=d.split(".");g[g.length-1]=m[0].trim(),p=m[1].trim()}}u!==null?i.push({type:"literal",literal:u,assign:o,transforms:c,exclude:a}):i.push({type:"extract",exclude:a,chain:g,attribute:p,assign:o,transforms:c}),s++}}return i}async function x(e,n,i,s){n._excluded||(n._excluded={});for(let t of e)if(t.type==="extract"){let a=t.chain[0],l;s?l=s:n[a]?l=n[a]:l=i(a).toArray();for(let f=1;f<t.chain.length;f++){let r=t.chain[f],o=[];for(let c of l)o=o.concat(i(c).find(r).toArray());l=o}t.attribute&&(l=l.map(f=>i(f).attr(t.attribute))),t.transforms&&t.transforms.length>0&&(l=l.map(f=>{let r=f;for(let{fn:o,params:c}of t.transforms)typeof w[o]=="function"&&(r=w[o](r,i,...c));return r})),n[t.assign]=l,t.exclude&&(n._excluded[t.assign]=!0)}else if(t.type==="literal"){let a=t.literal;if(t.transforms&&t.transforms.length>0)for(let{fn:l,params:f}of t.transforms)typeof w[l]=="function"&&(a=w[l](a,i,...f));n[t.assign]=[a],t.exclude&&(n._excluded[t.assign]=!0)}else if(t.type==="block"){let a={};a._excluded={};let l=null;for(let r of t.instructions)if(r.type==="extract"||r.type==="literal"){let o;if(r.type==="extract"){let c=r.chain[0];a[c]?o=a[c]:n[c]?o=n[c]:o=i(c).toArray();for(let u=1;u<r.chain.length;u++){let g=r.chain[u],p=[];for(let h of o)p=p.concat(i(h).find(g).toArray());o=p}r.attribute&&(o=o.map(u=>i(u).attr(r.attribute))),r.transforms&&r.transforms.length>0&&(o=o.map(u=>{let g=u;for(let{fn:p,params:h}of r.transforms)typeof w[p]=="function"&&(g=w[p](g,i,...h));return g})),a[r.assign]=o}else if(r.type==="literal"){let c=r.literal;if(r.transforms&&r.transforms.length>0)for(let{fn:u,params:g}of r.transforms)typeof w[u]=="function"&&(c=w[u](c,i,...g));a[r.assign]=[c]}r.exclude&&(a._excluded[r.assign]=!0),l||(l=a[r.assign])}else if(r.type==="block"){let o=await x(r.instructions,a,i,null);a[r.assign]=o}let f=[];if(l&&Array.isArray(l))for(let r=0;r<l.length;r++){let o={};for(let c in a){if(c==="_excluded"||a._excluded&&a._excluded[c])continue;let u=a[c];o[c]=Array.isArray(u)?u[r]:u}f.push(o)}else f=a;n[t.assign]=f}else if(t.type==="conditional"){let a=!1;try{a=new Function("context","$","return ("+t.condition+");")(n,i)}catch{a=!1}a?await x(t.ifInstructions,n,i,s):t.elseInstructions&&await x(t.elseInstructions,n,i,s)}return n}function I(e){let n={};for(let i of e)for(let s in i)n[s]?n[s]=n[s].concat(i[s]):n[s]=i[s];return n}var $={};function D(e){if(e.engines)for(let n in e.engines)$[n]=e.engines[n];if(e.transformFunctions)for(let n in e.transformFunctions)w[n]=e.transformFunctions[n]}async function P(e,n={}){let i=U(e),{url:s,config:t,instructions:a}=T(e);s=s.replace(/\[(\w+)\]/g,(r,o)=>n[o]!==void 0?encodeURIComponent(n[o]):"");let l={},f=async r=>{let o=L.load(r),c={};return await x(a,c,o,null),C(c,o)};if(t.engine&&t.engine.toLowerCase()==="puppeteer"){let r;try{r=await puppeteer.launch();let o=await r.newPage();if(await o.goto(s,{waitUntil:"networkidle2"}),t.paginationType?.toLowerCase()==="scroll"){let c=[],u=t.paginationLimit?parseInt(t.paginationLimit):5;for(let g=0;g<u;g++){await o.evaluate(()=>window.scrollBy(0,window.innerHeight)),await o.waitForTimeout(1e3);let p=await o.content();c.push(await f(p))}l=I(c)}else if(l=await f(await o.content()),t.paginationNext){let c=1,u=t.paginationLimit?parseInt(t.paginationLimit):5,g=t.paginationNext;for(;c<u;){let p=await o.$(g);if(!p)break;let h=await o.evaluate(m=>m.href,p);await o.goto(h,{waitUntil:"networkidle2"});let d=await f(await o.content());l=I([l,d]),c++}}}finally{r&&await r.close()}return{result:l,config:t}}else{let r=await k(s,i);l=await f(r);let o=L.load(r);if(t.paginationAjax){let c=t.paginationLimit?parseInt(t.paginationLimit):5,u=[];if((t.concurrency?parseInt(t.concurrency):1)>1){let p=Array.from({length:c},(d,m)=>k(t.paginationAjax.replace("{page}",m+1),i)),h=await Promise.all(p);u=await Promise.all(h.map(f))}else for(let p=1;p<=c;p++){let h=await k(t.paginationAjax.replace("{page}",p),i);u.push(await f(h))}l=I(u)}else if(t.paginationNext){let c=1,u=t.paginationLimit?parseInt(t.paginationLimit):5,g=t.paginationNext;for(;c<u;){let p=o(g).first();if(!p||!p.attr("href"))break;let h=new j(p.attr("href"),s).toString(),d=await k(h,i),m=await f(d);l=I([l,m]),c++}}return{result:l,config:t}}}module.exports={scrape:P,parseScript:T,parseInstructions:y,executeInstructions:x,transformFunctions:w,registerPlugin:D};if(require.main===module){let e=W.readFileSync(process.argv[2],"utf8"),n={};if(process.argv.length>3)for(let i=3;i<process.argv.length;i++){let[s,t]=process.argv[i].split("=");n[s]=t}P(e,n).then(i=>{console.log(JSON.stringify(i,null,2))}).catch(i=>{console.error(i)})}
//# sourceMappingURL=index.cjs.map
