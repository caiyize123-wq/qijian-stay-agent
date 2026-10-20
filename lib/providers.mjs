import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
const project=fileURLToPath(new URL('../',import.meta.url));
const allowed=['DASHSCOPE_API_KEY','BAILIAN_API_KEY','FLYAI_API_KEY','TRAVEL_API_KEY','BAILIAN_BASE_URL','BAILIAN_MODEL','FLYAI_CLI'];
export class ServiceError extends Error { constructor(code,message,status=503){super(message);this.code=code;this.status=status;} }
export function config(){
  const result={};
  for(const file of [project+'../.env.local',project+'.env.local']){
    if(!fs.existsSync(file))continue;
    for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
      const m=line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);if(!m||!allowed.includes(m[1]))continue;
      let v=m[2];if((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'")))v=v.slice(1,-1);
      if(v)result[m[1]]=v;
    }
  }
  for(const key of allowed)if(process.env[key])result[key]=process.env[key];
  return {bailianKey:result.DASHSCOPE_API_KEY||result.BAILIAN_API_KEY||'',flyaiKey:result.FLYAI_API_KEY||result.TRAVEL_API_KEY||'',
    base:result.BAILIAN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',model:result.BAILIAN_MODEL||'qwen-plus',
    cli:result.FLYAI_CLI||'flyai'};
}
export const connectionState={bailian:{status:'untested'},flyai:{status:'untested'}};
export function status(){const c=config();return {bailian:{configured:!!c.bailianKey,model:c.model,...connectionState.bailian},flyai:{configured:!!c.flyaiKey,...connectionState.flyai}};}
export async function bailian(messages,options={},signal){
  const {timeoutMs=45000,...modelOptions}=options;
  const c=config();if(!c.bailianKey)throw new ServiceError('MISSING_BAILIAN_KEY','百炼尚未配置，暂不能生成智能建议。');
  let base;try{base=new URL(c.base);}catch{throw new ServiceError('INVALID_ENDPOINT','百炼服务地址配置无效');}
  if(base.protocol!=='https:'||!/(^|\.)(aliyuncs\.com|alibabacloud\.com)$/.test(base.hostname))throw new ServiceError('INVALID_ENDPOINT','请使用百炼官方 HTTPS 服务地址');
  const began=Date.now();
  try{
    const response=await fetch(c.base.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${c.bailianKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:c.model,messages,temperature:0.35,max_tokens:1400,...modelOptions}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
    if(!response.ok){const map={401:'百炼凭据未通过认证，请检查密钥及地域。',403:'百炼调用权限不足，请检查模型授权。',429:'百炼调用限流或额度不足，请稍后重试。'};throw new ServiceError('BAILIAN_HTTP_'+response.status,map[response.status]||`百炼暂时未成功返回（${response.status}）。`);}
    const body=await response.json();const msg=body.choices?.[0]?.message;
    if(!msg)throw new ServiceError('BAILIAN_EMPTY','百炼未返回有效内容，请重试。');
    connectionState.bailian={status:'connected',checkedAt:new Date().toISOString(),ms:Date.now()-began};
    return {message:msg,usage:body.usage||null,model:body.model||c.model,ms:Date.now()-began};
  }catch(error){if(signal?.aborted)throw new ServiceError('CANCELLED','已停止上一段后台介绍。',499);const safe=error instanceof ServiceError?error:new ServiceError(error.name==='TimeoutError'?'BAILIAN_TIMEOUT':'BAILIAN_NETWORK',error.name==='TimeoutError'?'百炼整理超时，请重试；已取得的酒店资料会保留。':'当前环境无法连接百炼，请重试。');connectionState.bailian={status:'error',checkedAt:new Date().toISOString(),error:safe.message};throw safe;}
}
export function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}}
export function normalizeFlyai(body){
  if(body?.status!==0&&body?.status!=='0'&&body?.status!==undefined)throw new ServiceError('FLYAI_BUSINESS','飞猪未成功返回查询结果，请调整条件重试。');
  if(body?.systemMessage)throw new ServiceError('FLYAI_BUSINESS','飞猪返回服务提示，本次结果未视为成功。');
  const list=body?.data?.itemList||body?.data?.items||body?.data?.list||[];
  if(!Array.isArray(list))throw new ServiceError('FLYAI_FORMAT','飞猪返回格式暂不支持。');
  return list.slice(0,12).map(p=>({id:String(p.shId||p.id||p.itemId||''),name:String(p.name||p.title||'未命名结果'),description:String(p.description||p.sellPoint||'').slice(0,1000),address:String(p.address||''),brand:String(p.brandName||''),star:String(p.star||''),rating:String(p.rate||''),landmark:String(p.interestsPoi||''),price:p.price==null?null:String(p.price),link:safeUrl(p.detailUrl||p.jumpUrl),image:safeUrl(p.mainPic||p.picUrl),latitude:p.latitude?Number(p.latitude):null,longitude:p.longitude?Number(p.longitude):null,openingHours:null,availability:null}));
}
export function normalizeFlyaiExperience(body){
  if(body?.status!==0&&body?.status!=='0'||body?.systemMessage)throw new ServiceError('FLYAI_BUSINESS','飞猪体验资料查询未成功，请重试。');
  if(typeof body.data!=='string'||!body.data.trim())throw new ServiceError('FLYAI_FORMAT','飞猪未返回可用的酒店介绍。');
  if(body.data.length>40000)throw new ServiceError('FLYAI_FORMAT','酒店资料过长，请缩小查询范围。');
  return body.data.trim();
}
export async function flyaiExperience(hotel,signal){
  const c=config();if(!c.flyaiKey)throw new ServiceError('MISSING_FLYAI_KEY','飞猪尚未配置。');
  const query=`只查询${hotel.city}的${hotel.name}，地址${hotel.address}，平台酒店ID ${hotel.providerId}。只读取这家酒店详情已有的酒店内休闲设施、餐饮与娱乐项目原始清单，保留所有可查的不同项目：如亲子、演艺、运动、水上、海洋互动、手作、水疗、特色空间等。无具体名称时保留设施原词。只需清单和酒店详情链接，尽量不超过600字。不查询周边景点，不展开附近或度假区POI，不继续检索各项目详情，不介绍房型。未取得的名称、时间、费用、楼层、权益、排期不要推测。`;
  const env={...process.env,FLYAI_API_KEY:c.flyaiKey,FLYAI_JSON:'1'};
  for(const key of Object.keys(env))if(key.startsWith('DEBUG_FLYAI')||['FLYAI_BASE_URL','FLYAI_MCP_URL','FLYAI_API_URL'].includes(key))delete env[key];
  const began=Date.now();
  try{
    const {stdout}=await run(c.cli,['ai-search','--query',query],{env,timeout:45000,maxBuffer:3*1024*1024,signal});
    let body;try{body=JSON.parse(stdout.trim());}catch{throw new ServiceError('FLYAI_FORMAT','飞猪未返回可读取的酒店介绍。');}
    const text=normalizeFlyaiExperience(body);connectionState.flyai={status:'connected',checkedAt:new Date().toISOString(),ms:Date.now()-began};
    return {provider:'flyai',kind:'hotel-experience',hotelId:hotel.id,providerId:hotel.providerId,query,text,source:hotel.link,queriedAt:new Date().toISOString(),ms:Date.now()-began};
  }catch(error){if(signal?.aborted)throw new ServiceError('CANCELLED','本次资料查询已停止。',499);const safe=error instanceof ServiceError?error:new ServiceError(error.code==='ENOENT'?'FLYAI_CLI_MISSING':'FLYAI_NETWORK',error.code==='ENOENT'?'未找到 FlyAI CLI，请安装官方 CLI 或设置 FLYAI_CLI 路径。':'飞猪酒店介绍查询未完成或超时，请重试。');connectionState.flyai={status:'error',checkedAt:new Date().toISOString(),error:safe.message};throw safe;}
}
export async function flyai(kind='hotel',keyword='七尚',signal,options={}){
  const c=config();if(!c.flyaiKey)throw new ServiceError('MISSING_FLYAI_KEY','飞猪尚未配置，暂不能查询实时旅行信息。');
  const text=String(keyword).slice(0,80),city=String(options.city||'厦门市').slice(0,40);
  const args=kind==='nearby'?['search-poi','--city-name',city,'--keyword',text||'五缘湾']:['search-hotel','--dest-name',city,'--key-words',text||'七尚'];
  const env={...process.env,FLYAI_API_KEY:c.flyaiKey,FLYAI_JSON:'1'};
  for(const key of Object.keys(env))if(key.startsWith('DEBUG_FLYAI')||['FLYAI_BASE_URL','FLYAI_MCP_URL','FLYAI_API_URL'].includes(key))delete env[key];
  const began=Date.now();
  try{
    const {stdout}=await run(c.cli,args,{env,timeout:25000,maxBuffer:3*1024*1024,signal});
    let body;try{body=JSON.parse(stdout.trim());}catch{throw new ServiceError('FLYAI_FORMAT','飞猪未返回可读取的结构化结果。');}
    const items=normalizeFlyai(body);connectionState.flyai={status:'connected',checkedAt:new Date().toISOString(),ms:Date.now()-began,count:items.length};
    const classified=kind==='hotel'?items.map(item=>({...item,hotelMatch:(options.matchName?item.name.replace(/\s/g,'').includes(options.matchName.replace(/\s/g,'')):/七尚/.test(item.name)&&!/榕舍|鼓浪屿|礁石|七栩/.test(item.name))?'candidate':'other-property'})):items;
    return {provider:'flyai',kind,city,items:classified,queriedAt:new Date().toISOString(),ms:Date.now()-began,notice:'查询结果不代表实时库存、已预约或已核对步行路线；酒店匹配需核对名称与地址，价格以详情确认为准。'};
  }catch(error){if(signal?.aborted)throw new ServiceError('CANCELLED','已停止上一段后台查询。',499);const safe=error instanceof ServiceError?error:new ServiceError(error.code==='ENOENT'?'FLYAI_CLI_MISSING':'FLYAI_NETWORK',error.code==='ENOENT'?'未找到 FlyAI CLI，请安装官方 CLI 或设置 FLYAI_CLI 路径。':'当前环境无法完成飞猪查询，或请求超时。');connectionState.flyai={status:'error',checkedAt:new Date().toISOString(),error:safe.message};throw safe;}
}
