const fs=require('fs'),path=require('path');
const P=(f)=>path.join(__dirname,'..','public',f);
function keysOf(name){/* 2026-10-21：繁/英字典已拆到 i18n-hant.js / i18n-en.js，需合并读取 */
 const file = name==='HANT' ? 'i18n-hant.js' : name==='EN' ? 'i18n-en.js' : 'i18n.js';
 const t=fs.readFileSync(P(file),'utf8');const vn = name==='HANT' ? 'H' : name==='EN' ? 'E' : name;
 const i=t.indexOf('var '+vn+' = {');
 const j=t.indexOf('\n};',i);const seg=t.slice(i,j);const ks=new Set();
 seg.replace(/(?:^|\n)\s*'((?:[^'\\]|\\.)*)'\s*:/g,(m,k)=>{ks.add(k.replace(/\\'/g,"'"));return m;});return ks;}
const have=new Set([...keysOf('HANT'),...keysOf('EN')]);
const cand=new Set();
const rj=fs.readFileSync(P('rank.js'),'utf8');
{const i=rj.indexOf('const BOARDS = [');const j=rj.indexOf('];',i);
 rj.slice(i,j).replace(/\{ g: '([^']+)', id: '[^']+', name: '([^']+)',[^}]*desc: '([^']+)'/g,(mm,g,n,d)=>{cand.add(g);cand.add(n);cand.add(d);return mm;});}
['common.js','rank.js','home.js','app.js'].forEach((f)=>{const t=fs.readFileSync(P(f),'utf8');
 t.replace(/(?:TT|TQ|t)\(\s*'((?:[^'\\]|\\.)*)'/g,(m,k)=>{const key=k.replace(/\\'/g,"'");if(/[\u4e00-\u9fff]/.test(key))cand.add(key);return m;});});
['home.html','index.html','ranking.html'].forEach((f)=>{const t=fs.readFileSync(P(f),'utf8');
 t.replace(/data-i18n(?:-ph|-title|-parts)?="([^"]+)"/g,(m,k)=>{cand.add(k);return m;});});
const miss=[...cand].filter(k=>!have.has(k));
console.log(miss.length); miss.forEach(m=>console.log(' -',m));
