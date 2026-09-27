// Gilbeot server: serves the web app and proxies real-time transit APIs.
// No external packages. Node 18+ (uses global fetch).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ENV = {
  ODSAY: process.env.ODSAY_API_KEY || "",          // ODsay LAB (web platform key)
  SEOUL: process.env.SEOUL_OPENAPI_KEY || "",      // 서울 열린데이터광장 - 실시간 지하철 도착정보
  BUS: process.env.DATA_GO_KR_KEY || "",           // 공공데이터포털 - 서울특별시 버스도착정보 (Decoding 키)
  KAKAO: process.env.KAKAO_REST_KEY || "",         // Kakao Developers REST API 키 (장소 검색)
  MM_EMAIL: process.env.MYMEMORY_EMAIL || ""       // 선택: 번역 무료 한도 확대용 이메일
};
const PUB = path.join(__dirname, "public");
const TYPES = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json",".webmanifest":"application/manifest+json",".png":"image/png",".svg":"image/svg+xml",".ico":"image/x-icon"};

// ---- tiny cache ----
const cache = new Map();
function cget(k){const v=cache.get(k);if(!v)return null;if(v.exp<Date.now()){cache.delete(k);return null}return v.val}
function cset(k,val,ms){if(cache.size>5000)cache.delete(cache.keys().next().value);cache.set(k,{val,exp:Date.now()+ms})}

function send(res,code,obj){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(obj))}
async function getJSON(url,opts={}){
  const ctl=new AbortController();const tm=setTimeout(()=>ctl.abort(),9000);
  try{const r=await fetch(url,{...opts,signal:ctl.signal});const txt=await r.text();
    try{return {status:r.status,data:JSON.parse(txt)}}catch(e){return {status:r.status,data:null,raw:txt.slice(0,300)}}}
  finally{clearTimeout(tm)}
}
const hasHangul = s => /[가-힣]/.test(s);

// ---- translation (MyMemory, free, cached 7 days) ----
const MM_LANG = {en:"en",ja:"ja",zh:"zh-CN",vi:"vi",ru:"ru",ko:"ko"};
async function translate(q,from,to){
  if(!q||from===to) return q;
  const k=`tr:${from}:${to}:${q}`; const c=cget(k); if(c) return c;
  let url=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${MM_LANG[from]}|${MM_LANG[to]}`;
  if(ENV.MM_EMAIL) url+=`&de=${encodeURIComponent(ENV.MM_EMAIL)}`;
  try{const {data}=await getJSON(url);const out=data&&data.responseStatus==200&&data.responseData&&data.responseData.translatedText;
    if(out&&!/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(out)){cset(k,out,7*864e5);return out}}catch(e){}
  return null;
}

// ---- API handlers ----
const api = {
  async config(q,res){
    send(res,200,{odsayKey:ENV.ODSAY,subway:!!ENV.SEOUL,bus:!!ENV.BUS,places:!!ENV.KAKAO,translate:true});
  },
  async tr(q,res){
    const text=(q.get("q")||"").slice(0,200), to=q.get("to")||"en", from=q.get("from")||"ko";
    if(!MM_LANG[to]||!MM_LANG[from]) return send(res,400,{error:"bad lang"});
    send(res,200,{text:await translate(text,from,to)});
  },
  async places(q,res){
    if(!ENV.KAKAO) return send(res,503,{error:"KAKAO_REST_KEY missing"});
    let query=(q.get("q")||"").trim().slice(0,80); const lang=q.get("lang")||"en";
    if(!query) return send(res,200,{items:[]});
    const queries=[query];
    if(!hasHangul(query)){const ko=await translate(query,lang,"ko");if(ko&&ko!==query)queries.unshift(ko)}
    const seen=new Set(), items=[];
    for(const qq of queries){
      const k="pl:"+qq; let docs=cget(k);
      if(!docs){const r=await getJSON(`https://dapi.kakao.com/v2/local/search/keyword.json?size=10&query=${encodeURIComponent(qq)}`,{headers:{Authorization:`KakaoAK ${ENV.KAKAO}`}});
        if(r.status!==200) return send(res,502,{error:"kakao",status:r.status,detail:r.data||r.raw});
        docs=r.data.documents||[]; cset(k,docs,864e5);}
      for(const d of docs){if(seen.has(d.id))continue;seen.add(d.id);
        items.push({id:d.id,ko:d.place_name,addr:d.road_address_name||d.address_name,cat:d.category_group_name||"",lat:+d.y,lng:+d.x,url:d.place_url});}
    }
    send(res,200,{items:items.slice(0,15),usedQuery:queries[0]});
  },
  async subway(q,res){
    if(!ENV.SEOUL) return send(res,503,{error:"SEOUL_OPENAPI_KEY missing"});
    let st=(q.get("st")||"").trim().replace(/\(.*?\)/g,"");
    if(st.length>2&&st.endsWith("역")) st=st.slice(0,-1);
    if(!st) return send(res,400,{error:"st required"});
    const k="sw:"+st; const c=cget(k); if(c) return send(res,200,c);
    const r=await getJSON(`http://swopenapi.seoul.go.kr/api/subway/${ENV.SEOUL}/json/realtimeStationArrival/0/20/${encodeURIComponent(st)}`);
    const list=(r.data&&r.data.realtimeArrivalList)||[];
    const out={station:st,items:list.map(a=>({subwayId:a.subwayId,dir:a.trainLineNm,updn:a.updnLine,msg:a.arvlMsg2,msg3:a.arvlMsg3,code:a.arvlCd,sec:+a.barvlDt||0,last:a.lstcarAt==="1",express:a.btrainSttus,dest:a.bstatnNm,next:a.statnTnm||""})),
      error:list.length?null:(r.data&&(r.data.errorMessage||r.data.RESULT)?(r.data.errorMessage||r.data.RESULT).message:"no data")};
    cset(k,out,20000); send(res,200,out);
  },
  async bus(q,res){
    if(!ENV.BUS) return send(res,503,{error:"DATA_GO_KR_KEY missing"});
    const ars=(q.get("ars")||"").replace(/\D/g,""); const no=(q.get("no")||"").trim();
    if(!ars) return send(res,400,{error:"ars required"});
    const k="bus:"+ars; let items=cget(k);
    if(!items){
      const key=ENV.BUS.includes("%")?ENV.BUS:encodeURIComponent(ENV.BUS);
      const r=await getJSON(`http://ws.bus.go.kr/api/rest/stationinfo/getStationByUid?serviceKey=${key}&arsId=${ars}&resultType=json`);
      const body=r.data&&r.data.msgBody; const hdr=r.data&&r.data.msgHeader;
      if(!body) return send(res,502,{error:"bus api",detail:hdr||r.raw});
      items=(body.itemList||[]).map(i=>({no:i.rtNm,m1:i.arrmsg1,m2:i.arrmsg2,dir:i.adirection,next:i.nxtStn,st:i.stNm}));
      cset(k,items,20000);
    }
    const f=no?items.filter(i=>i.no===no||i.no.replace(/\s/g,"")===no.replace(/\s/g,"")):items;
    send(res,200,{ars,items:f.length?f:items,matched:f.length>0});
  }
};

// ---- server ----
http.createServer(async (req,res)=>{
  try{
    const u=new URL(req.url,"http://x");
    if(u.pathname.startsWith("/api/")){
      const fn=api[u.pathname.slice(5)];
      if(!fn) return send(res,404,{error:"not found"});
      return await fn(u.searchParams,res);
    }
    let p=decodeURIComponent(u.pathname); if(p.endsWith("/")) p+="index.html";
    const fp=path.normalize(path.join(PUB,p));
    if(!fp.startsWith(PUB)) {res.writeHead(403);return res.end()}
    fs.readFile(fp,(err,buf)=>{
      if(err){fs.readFile(path.join(PUB,"index.html"),(e2,b2)=>{res.writeHead(e2?404:200,{"Content-Type":TYPES[".html"]});res.end(e2?"not found":b2)});return}
      res.writeHead(200,{"Content-Type":TYPES[path.extname(fp)]||"application/octet-stream","Cache-Control":p.endsWith(".html")?"no-cache":"public, max-age=3600"});res.end(buf);
    });
  }catch(e){send(res,500,{error:String(e&&e.message||e)})}
}).listen(PORT,"0.0.0.0",()=>console.log(`Gilbeot on :${PORT} | keys: odsay=${!!ENV.ODSAY} seoul=${!!ENV.SEOUL} bus=${!!ENV.BUS} kakao=${!!ENV.KAKAO}`));
