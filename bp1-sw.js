/* BP1 Hosted Runtime Service Worker
 * Release build 1.0.0. Supports current and legacy BP1 package profiles.
 */
const CACHE_PREFIX = "bp1-package-";
const LEGACY_CACHE_PREFIX = "bp1-package-v1-";
const BP1_PREFIX = "/__bp1__/";
const PACKAGE_ID_RE = /^[a-f0-9]{32}$/i;

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => { if (event.data?.type === "BP1_SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(BP1_PREFIX)) return;
  event.respondWith(handleBP1Request(event.request));
});

function errorResponse(message, status, extraHeaders = {}) {
  return new Response(message, { status, headers: { "Content-Type":"text/plain; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", ...extraHeaders } });
}
function parseSingleByteRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const spec = rangeHeader.slice(6).trim();
  if (!spec || spec.includes(",")) return { invalid:true };
  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match || (!match[1] && !match[2])) return { invalid:true };
  let start,end;
  if (!match[1]) {
    const n=Number(match[2]); if (!Number.isSafeInteger(n)||n<=0) return {invalid:true}; if(size===0)return{unsatisfiable:true};
    start=Math.max(0,size-n); end=size-1;
  } else {
    start=Number(match[1]); if(!Number.isSafeInteger(start)||start<0||start>=size)return{unsatisfiable:true};
    if(!match[2]) end=size-1; else { end=Number(match[2]); if(!Number.isSafeInteger(end)||end<start)return{unsatisfiable:true}; end=Math.min(end,size-1); }
  }
  return {start,end};
}
function copyResponseHeaders(response){const h=new Headers(response.headers);h.set("Accept-Ranges","bytes");h.set("Cache-Control","no-store");h.set("X-Content-Type-Options","nosniff");return h;}
function decodeVirtualPath(encodedPath){
  if(typeof encodedPath!=="string"||!encodedPath)throw new Error("Invalid BP1 path.");
  const trailing=encodedPath.endsWith("/"); const raw=encodedPath.split("/"); if(trailing)raw.pop(); const out=[];
  for(const r of raw){ if(!r)throw new Error("Invalid BP1 path."); let p; try{p=decodeURIComponent(r)}catch{throw new Error("Invalid BP1 path encoding.")}
    if(!p||p==="."||p===".."||p.includes("/")||p.includes("\\")||/[\u0000-\u001F\u007F]/.test(p))throw new Error("Invalid BP1 path."); out.push(p); }
  if(!out.length)throw new Error("Invalid BP1 path."); return out.join("/")+(trailing?"/":"");
}
function encodeVirtualPath(path){const trailing=path.endsWith("/");const p=path.split("/");if(trailing)p.pop();return p.map(encodeURIComponent).join("/")+(trailing?"/":"");}
async function serveCachedResponse(request,cached){
  const method=request.method.toUpperCase(); if(method!=="GET"&&method!=="HEAD")return errorResponse("Method not allowed for BP1 resource.",405,{Allow:"GET, HEAD"});
  const body=await cached.arrayBuffer(),size=body.byteLength,headers=copyResponseHeaders(cached); headers.delete("Content-Range"); headers.set("Content-Length",String(size));
  const rh=request.headers.get("Range"); if(rh){const range=parseSingleByteRange(rh,size); if(!range||range.invalid||range.unsatisfiable){headers.set("Content-Range",`bytes */${size}`);headers.set("Content-Length","0");return new Response(null,{status:416,statusText:"Range Not Satisfiable",headers});}
    const {start,end}=range,length=end-start+1;headers.set("Content-Range",`bytes ${start}-${end}/${size}`);headers.set("Content-Length",String(length));
    if(method==="HEAD")return new Response(null,{status:206,statusText:"Partial Content",headers}); return new Response(body.slice(start,end+1),{status:206,statusText:"Partial Content",headers}); }
  if(method==="HEAD")return new Response(null,{status:cached.status||200,statusText:cached.statusText,headers}); return new Response(body,{status:cached.status||200,statusText:cached.statusText,headers});
}
async function findBP1Resource(cache,origin,id,path){const ep=encodeVirtualPath(path);let r=await cache.match(`${origin}${BP1_PREFIX}${id}/${ep}`,{ignoreSearch:true});if(r)return r;if(path.endsWith("/")){r=await cache.match(`${origin}${BP1_PREFIX}${id}/${ep}index.html`,{ignoreSearch:true});if(r)return r;}return null;}
async function openPackageCache(id){
  const generic=await caches.open(CACHE_PREFIX+id); const keys=await generic.keys(); if(keys.length)return generic;
  await caches.delete(CACHE_PREFIX+id); return caches.open(LEGACY_CACHE_PREFIX+id);
}
async function handleBP1Request(request){try{const url=new URL(request.url),rel=url.pathname.slice(BP1_PREFIX.length),slash=rel.indexOf("/");if(slash<=0)return errorResponse("Invalid BP1 path.",400);const id=rel.slice(0,slash);if(!PACKAGE_ID_RE.test(id))return errorResponse("Invalid BP1 package identifier.",400);const path=decodeVirtualPath(rel.slice(slash+1));const cache=await openPackageCache(id),cached=await findBP1Resource(cache,url.origin,id,path);if(!cached)return errorResponse("BP1 resource not found.",404);return serveCachedResponse(request,cached);}catch(e){return errorResponse(e?.message||"Invalid BP1 request.",400)}}
