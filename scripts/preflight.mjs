import {execFileSync} from 'node:child_process';
import {config} from '../lib/providers.mjs';
const c=config();let ok=true;
const check=(label,passed)=>{console.log(`${passed?'通过':'缺少'}：${label}`);if(!passed)ok=false;};
check('Node.js 24 或以上',Number(process.versions.node.split('.')[0])>=24);
check('百炼密钥已配置（不显示内容）',Boolean(c.bailianKey));
check('飞猪密钥已配置（不显示内容）',Boolean(c.flyaiKey));
try{const text=execFileSync(c.cli,['--help'],{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']});check('FlyAI CLI 含酒店、周边与语义查询',/search-hotel/.test(text)&&/search-poi/.test(text)&&/ai-search/.test(text));}
catch{check('FlyAI CLI 可执行；请查看 REPRODUCE.md 配置',false);}
console.log('此检查只验证本机配置；外部服务需实际搜索和规划验证。');
process.exitCode=ok?0:1;
