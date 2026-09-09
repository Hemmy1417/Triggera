import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
const RPC='https://studio-next.genlayer.com/api';
const ADDR='0xe3d35e24E2aa9A58f451Ce0468cFA3cB3B1E1309';
const chain={...studioDevnet,id:61997,name:'Studio Next',rpcUrls:{default:{http:[RPC]}}};
const reader=createClient({chain});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rd(fn,args=[],t=8){let last;for(let i=0;i<t;i++){try{return await reader.readContract({address:ADDR,functionName:fn,args});}catch(e){last=e?.message||String(e);await sleep(800*(i+1));}}throw new Error(fn+': '+last);}
const p=JSON.parse(await rd('get_policy',['trg-000001']));
const keep=['policy_id','status','outcome','evidence_flag','evidence_version','judged_version','min_independent','operator','threshold','unit','metric','coverage_atto','premium_atto','appeal_bond_atto','publishers','qualifying','contradicting','coverage_start_epoch','coverage_end_epoch','claim_grace','finality_window','appeal_window','insurer','policyholder'];
for(const k of keep) if(k in p) console.log(k.padEnd(22), JSON.stringify(p[k]));
console.log('--- basis ---');
for(const b of (p.basis||[])) console.log(' ', JSON.stringify(b));
console.log('--- stats ---'); console.log(await rd('get_stats',[]));
console.log('--- now ---', Math.floor(Date.now()/1000));
