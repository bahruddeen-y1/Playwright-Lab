const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const PORT = 3000;
const BASE = 'http://localhost:' + PORT;
const MODE = (process.env.TURNSTILE_MODE || 'pass').toLowerCase();
const TS_CONF = {
  pass: { site: '1x00000000000000000000AA', secret: '1x0000000000000000000000000000000AA' },
  block: { site: '2x00000000000000000000AB', secret: '2x0000000000000000000000000000000AA' },
  interactive: { site: '3x00000000000000000000FF', secret: '1x0000000000000000000000000000000AA' }
};
const TS = TS_CONF[MODE];
if (!TS) {
  console.error('TURNSTILE_MODE ต้องเป็น pass, block หรือ interactive');
  process.exit(1);
}

const PROVIDERS = {
  google: {
    name: 'Google', accounts: [
      { email: 'alice@gmail.com', label: 'Alice Google' },
      { email: 'bob@gmail.com', label: 'Bob Google' }
    ]
  },
  microsoft: {
    name: 'Microsoft', accounts: [
      { email: 'carol@outlook.com', label: 'Carol Microsoft' },
      { email: 'dave@outlook.com', label: 'Dave Microsoft' }
    ]
  }
};
function getProv(k) {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, k) ? PROVIDERS[k] : null;
}

const db = new Database('app.db');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, pw TEXT, provider TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, a INTEGER NOT NULL, b INTEGER NOT NULL, op TEXT NOT NULL, result REAL NOT NULL, created_at TEXT NOT NULL);
`);

const fails = new Map();
const codes = new Map();

function hashPw(p) {
  const s = crypto.randomBytes(16).toString('hex');
  return s + ':' + crypto.scryptSync(p, s, 64).toString('hex');
}
function checkPw(p, stored) {
  const parts = stored.split(':');
  const x = crypto.scryptSync(p, parts[0], 64);
  return crypto.timingSafeEqual(x, Buffer.from(parts[1], 'hex'));
}
function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(function (p) {
    const i = p.indexOf('=');
    if (i > 0) {
      try { o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { }
    }
  });
  return o;
}
function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').get(sid) || null;
}
function auth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  req.user = u;
  next();
}
function createSession(res, userId) {
  const id = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (id, user_id, created_at) VALUES (?, ?, ?)').run(id, userId, new Date().toISOString());
  res.append('Set-Cookie', 'sid=' + id + '; Path=/; SameSite=Lax');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
async function verifyTs(token) {
  if (!token) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TS.secret, response: String(token) })
    });
    const d = await r.json();
    return d.success === true;
  } catch (e) {
    return null;
  }
}
function calc(a, b, op) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') {
    if (!a || !b) return null;
    return Math.trunc(a * 100 / b) / 100;
  }
  return null;
}
function validNum(v) {
  return Number.isInteger(v) && v >= 0 && v < 99;
}

const LOGO = `<svg class="app-icon" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c2c2e"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#lg)"/><rect x="10" y="9" width="44" height="14" rx="4" fill="#3a3a3c"/><g fill="#a5a5a5"><circle cx="16" cy="33" r="4.5"/><circle cx="28" cy="33" r="4.5"/><circle cx="40" cy="33" r="4.5"/></g><g fill="#505050"><circle cx="16" cy="43" r="4.5"/><circle cx="28" cy="43" r="4.5"/><circle cx="40" cy="43" r="4.5"/><circle cx="16" cy="53" r="4.5"/><circle cx="28" cy="53" r="4.5"/><circle cx="40" cy="53" r="4.5"/></g><g fill="#ff9f0a"><circle cx="52" cy="33" r="4.5"/><circle cx="52" cy="43" r="4.5"/><circle cx="52" cy="53" r="4.5"/></g></svg>`;
const GOOGLE_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.27-2.09 3.57-5.17 3.57-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.94H1.29v3.09A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.29 14.3A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.3V6.61H1.29A12 12 0 0 0 0 12c0 1.94.46 3.77 1.29 5.39l4-3.09z"/><path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.61l4 3.09C6.23 6.86 8.88 4.75 12 4.75z"/></svg>`;
const MS_SVG = `<svg viewBox="0 0 23 23" width="20" height="20" aria-hidden="true"><path fill="#f25022" d="M1 1h10v10H1z"/><path fill="#7fba00" d="M12 1h10v10H12z"/><path fill="#00a4ef" d="M1 12h10v10H1z"/><path fill="#ffb900" d="M12 12h10v10H12z"/></svg>`;
const USER_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`;
const CHEV_SVG = `<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`;
const BACK_SVG = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4H8l-7 8 7 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/><path d="M18 9l-6 6M12 9l6 6"/></svg>`;

const CSS = `
:root{
  color-scheme:light dark;
  --bg:#f2f2f7;--card:#ffffff;--text:#000000;--muted:#6d6d72;--sep:rgba(60,60,67,.2);
  --blue:#007aff;--red:#ff3b30;--green:#248a3d;
  --fill:rgba(120,120,128,.12);--fill-solid:#e5e5ea;--nav:rgba(249,249,249,.82);--calc-border:transparent;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#000000;--card:#1c1c1e;--text:#ffffff;--muted:#98989f;--sep:rgba(84,84,88,.6);
    --blue:#0a84ff;--red:#ff453a;--green:#30d158;
    --fill:rgba(120,120,128,.24);--fill-solid:#2c2c2e;--nav:rgba(22,22,24,.78);--calc-border:rgba(255,255,255,.12);
  }
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;min-height:100vh;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Sukhumvit Set","Thonburi","Helvetica Neue",Arial,sans-serif;
  font-size:17px;line-height:1.4;-webkit-font-smoothing:antialiased;
  padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
a{color:var(--blue);text-decoration:none}
a:hover{opacity:.8}
button{font:inherit;color:inherit}
button:focus-visible,a:focus-visible{outline:3px solid rgba(10,132,255,.55);outline-offset:2px}
.large-title{font-size:34px;line-height:1.15;font-weight:700;letter-spacing:.2px;margin:0 0 6px}
.center{text-align:center}
.sub{margin:0 0 22px;color:var(--muted);font-size:15px}

.auth{width:min(430px,calc(100% - 32px));margin:0 auto;padding:7vh 0 48px}
.app-icon{display:block;margin:0 auto 18px;width:72px;height:72px;border-radius:17px;box-shadow:0 8px 24px -8px rgba(0,0,0,.45)}
.provider-icon{display:grid;place-items:center;width:72px;height:72px;margin:0 auto 18px;border-radius:17px;background:var(--card);box-shadow:0 2px 14px rgba(0,0,0,.14)}
.provider-icon svg{width:36px;height:36px}
.mock-badge{display:table;margin:0 auto 20px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600;color:var(--blue);background:var(--fill)}

.group{background:var(--card);border-radius:14px;overflow:hidden}
.field{display:flex;align-items:center;gap:12px;padding:0 16px;min-height:50px;transition:background .15s}
.field+.field{border-top:.5px solid var(--sep)}
.field:focus-within{background:var(--fill)}
.field label{flex:0 0 118px;margin:0;font-size:17px;color:var(--text)}
.field input{flex:1;min-width:0;border:0;background:transparent;color:var(--text);font:inherit;font-size:17px;padding:14px 0;outline:none}
.field input::placeholder{color:var(--muted);opacity:.55}
.footnote{margin:8px 16px 0;font-size:13px;color:var(--muted)}

.err,.ok{padding:12px 14px;border-radius:12px;font-size:15px;font-weight:500;margin:0 0 14px}
.err{color:var(--red);background:rgba(255,59,48,.12)}
.ok{color:var(--green);background:rgba(52,199,89,.15)}
.err:empty,.ok:empty,#msg:empty{display:none}
.hint{font-size:13px;color:var(--muted)}
#ts{margin-top:18px;display:flex;justify-content:center}
#ts-status{text-align:center;margin-top:8px}

.btn{
  display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:52px;margin-top:14px;
  border:0;border-radius:14px;font-size:17px;font-weight:600;cursor:pointer;text-decoration:none;
  transition:opacity .15s,transform .1s,background .15s;
}
.btn:active:not(:disabled){transform:scale(.98);opacity:.85}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:disabled{opacity:.4;cursor:not-allowed}
.btn-secondary{background:var(--card);color:var(--text)}
.btn-secondary:hover{opacity:1;background:var(--fill-solid)}
.btn-ghost{background:var(--fill);color:var(--blue)}
.divider{display:flex;align-items:center;gap:12px;margin:26px 0 4px;color:var(--muted);font-size:13px}
.divider::before,.divider::after{content:"";flex:1;height:.5px;background:var(--sep)}
.foot{text-align:center;margin:24px 0 0;font-size:15px;color:var(--muted)}
.foot a{font-weight:600}

.row-link{display:flex;align-items:center;gap:12px;padding:12px 16px;color:var(--text);transition:background .12s}
.row-link+.row-link{border-top:.5px solid var(--sep)}
.row-link:hover{background:var(--fill);opacity:1}
.row-link:active{background:var(--fill-solid)}
.row-link .row-text{flex:1;min-width:0;font-size:16px;word-break:break-word}
.row-link .muted{color:var(--muted);font-size:14px}
.row-link .chev{color:var(--muted);opacity:.7;flex:none}
.avatar{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;flex:none;color:#fff;font-weight:600;font-size:16px;background:linear-gradient(180deg,#64b5ff,#007aff)}

.navbar{
  position:sticky;top:0;z-index:10;background:var(--nav);border-bottom:.5px solid var(--sep);
  -webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
}
.nav-inner{max-width:900px;margin:0 auto;padding:6px 20px;min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:12px}
.chip{display:inline-flex;align-items:center;gap:8px;color:var(--muted);font-size:15px;min-width:0}
.chip svg{flex:none}
#user-email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw;color:var(--text)}
.link-btn{background:none;border:0;padding:8px 4px;color:var(--blue);font-size:17px;cursor:pointer;transition:opacity .15s}
.link-btn:active{opacity:.4}
.link-btn.danger{color:var(--red);font-size:15px}

.app{max-width:900px;margin:0 auto;padding:18px 20px 56px}
.layout{display:grid;grid-template-columns:minmax(0,380px) minmax(0,1fr);gap:28px;align-items:start;margin-top:14px}

.calc{background:#000;border:1px solid var(--calc-border);border-radius:38px;padding:20px;box-shadow:0 24px 48px -24px rgba(0,0,0,.6)}
.screen{display:flex;flex-direction:column;justify-content:flex-end;min-height:156px;padding:4px 8px 14px;text-align:right}
.calc-error{min-height:22px;font-size:15px;font-weight:600;color:#ff453a}
.calc-expression{min-height:28px;font-size:22px;color:#8e8e93;font-variant-numeric:tabular-nums}
#calc-result{
  color:#fff;font-size:84px;line-height:1.1;font-weight:300;letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;overflow-wrap:anywhere;
}
#calc-result.sm{font-size:64px}
#calc-result.xs{font-size:46px}

.keypad{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.key{
  appearance:none;-webkit-appearance:none;border:0;margin:0;padding:0;min-width:0;
  display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;border-radius:999px;
  font-size:clamp(26px,8vw,34px);font-weight:400;line-height:1;cursor:pointer;user-select:none;-webkit-user-select:none;
  -webkit-tap-highlight-color:transparent;transition:background .18s,color .18s;
  background:#333333;color:#fff;
}
.key:active{background:#737373;transition:none}
.key.fn{background:#a5a5a5;color:#000;font-size:clamp(24px,7vw,30px)}
.key.fn:active{background:#d9d9d9}
.key.op{background:#ff9f0a;color:#fff;font-size:clamp(32px,9vw,40px)}
.key.op:active{background:#fcc78a}
.key.op.active{background:#fff;color:#ff9f0a}
.key.span2{grid-column:span 2;aspect-ratio:auto}
.key.span3{grid-column:span 3;aspect-ratio:auto;justify-content:flex-start;padding-left:32px}

.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 4px 10px}
.section-title{margin:0;font-size:22px;font-weight:700;letter-spacing:.2px}
#history-list{list-style:none;margin:0;padding:0}
li.item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;cursor:pointer;transition:background .12s}
li.item+li.item{border-top:.5px solid var(--sep)}
li.item:hover{background:var(--fill)}
li.item:active{background:var(--fill-solid)}
li.item>div{display:flex;flex-direction:column;min-width:0}
li.item [data-testid="history-equation"]{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;word-break:break-all}
li.item .time{font-size:13px;color:var(--muted)}
.del{background:none;border:0;padding:6px 10px;border-radius:8px;color:var(--red);font-size:15px;cursor:pointer;flex:none}
.del:hover{background:rgba(255,59,48,.1)}
.empty{margin:0;padding:36px 16px;text-align:center;color:var(--muted);font-size:15px}

@media (max-width:820px){
  .layout{grid-template-columns:minmax(0,1fr)}
  .calc{width:min(380px,100%);margin:0 auto}
}
@media (max-width:480px){
  .auth{padding-top:4vh}
  .large-title{font-size:30px}
  .field label{flex-basis:104px;font-size:16px}
  .app{padding:14px 14px 48px}
  .nav-inner{padding:6px 14px}
  #calc-result{font-size:72px}
  #calc-result.sm{font-size:56px}
  #calc-result.xs{font-size:42px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

function page(title, body) {
  return '<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)"><link rel="icon" href="data:,"><title>' +
    title + '</title><style>' + CSS + '</style></head><body>' + body + '</body></html>';
}
function withTs(js) {
  return '<script>' + js.replace('__SITEKEY__', TS.site) + '</script>' +
    '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTsLoad" async defer></script>';
}

const LOGIN_JS = String.raw`
var token=null;
var $=function(i){return document.getElementById(i)};
var msg=$('msg'),st=$('ts-status'),btn=$('submit');
var q=new URLSearchParams(location.search);
if(q.get('registered')){msg.textContent='สมัครสมาชิกสำเร็จ กรุณาเข้าสู่ระบบ';msg.className='ok';}
if(q.get('error')==='oauth_denied'){msg.textContent='ยกเลิกการล็อกอินด้วยบัญชีภายนอก';msg.className='err';}
window.onTsLoad=function(){
  turnstile.render('#ts',{sitekey:'__SITEKEY__',
    callback:function(t){token=t;btn.disabled=false;st.textContent='ยืนยันตัวตนสำเร็จ';},
    'error-callback':function(){token=null;btn.disabled=true;st.textContent='การยืนยันตัวตนล้มเหลว';},
    'expired-callback':function(){token=null;btn.disabled=true;st.textContent='การยืนยันตัวตนหมดอายุ';}
  });
  st.textContent='กรุณายืนยันว่าคุณไม่ใช่บอท';
};
$('login-form').addEventListener('submit',function(e){
  e.preventDefault();
  var email=$('email').value,password=$('password').value;
  if(!email||!password){msg.textContent='กรุณากรอกอีเมลและรหัสผ่าน';msg.className='err';return;}
  fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:password,token:token})})
  .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
  .then(function(x){
    if(x.ok){var next=q.get('next')||'/app';location.href=next;}
    else{msg.textContent=x.d.error||'เกิดข้อผิดพลาด';msg.className='err';}
  });
});
`;

const REGISTER_JS = String.raw`
var token=null,wid=null;
var $=function(i){return document.getElementById(i)};
var msg=$('msg'),st=$('ts-status'),btn=$('submit');
window.onTsLoad=function(){
  wid=turnstile.render('#ts',{sitekey:'__SITEKEY__',
    callback:function(t){token=t;btn.disabled=false;st.textContent='ยืนยันตัวตนสำเร็จ';},
    'error-callback':function(){token=null;btn.disabled=true;st.textContent='การยืนยันตัวตนล้มเหลว';},
    'expired-callback':function(){token=null;btn.disabled=true;st.textContent='การยืนยันตัวตนหมดอายุ';}
  });
  st.textContent='กรุณายืนยันว่าคุณไม่ใช่บอท';
};
function fail(t){msg.textContent=t;msg.className='err';}
$('register-form').addEventListener('submit',function(e){
  e.preventDefault();
  var email=$('email').value,pw=$('password').value,cf=$('confirm').value;
  if(!/^\S+@\S+\.\S+$/.test(email)){fail('รูปแบบอีเมลไม่ถูกต้อง');return;}
  if(pw.length<8){fail('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');return;}
  if(!/[A-Z]/.test(pw)){fail('รหัสผ่านต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว');return;}
  if(!/[a-z]/.test(pw)){fail('รหัสผ่านต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว');return;}
  if(!/[0-9]/.test(pw)){fail('รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว');return;}
  if(!/[^A-Za-z0-9]/.test(pw)){fail('รหัสผ่านต้องมีอักขระพิเศษอย่างน้อย 1 ตัว');return;}
  if(pw!==cf){fail('ยืนยันรหัสผ่านไม่ตรงกัน');return;}
  btn.disabled=true;
  fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:pw,confirm:cf,token:token})})
  .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
  .then(function(x){
    if(x.ok){location.href='/login?registered=1';return;}
    fail(x.d.error||'เกิดข้อผิดพลาด');
    token=null;st.textContent='กรุณายืนยันว่าคุณไม่ใช่บอท';
    if(window.turnstile&&wid!==null){turnstile.reset(wid);}
  });
});
`;

const APP_JS = String.raw`
var $=function(i){return document.getElementById(i)};
var exprEl=$('calc-expression'),resEl=$('calc-result'),errEl=$('calc-error'),clrEl=$('key-clear');
var list=$('history-list'),empty=$('history-empty');
var S;
function reset(){S={a:null,b:null,op:null,cur:'0',typed:false,done:false};}
reset();
function sym(o){return {'+':'+','-':'−','*':'×','/':'÷'}[o];}
function api(method,url,body){
  return fetch(url,{method:method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  .then(function(r){return r.text().then(function(t){
    var d={};try{d=t?JSON.parse(t):{};}catch(e){}
    if(r.status===401){location.href='/login';}
    return {ok:r.ok,status:r.status,data:d};
  });});
}
function clearErr(){errEl.textContent='';}
function render(){
  var t=S.cur,n=t.length;
  resEl.textContent=t;
  resEl.classList.toggle('sm',n>6&&n<=8);
  resEl.classList.toggle('xs',n>8);
  if(S.done){exprEl.textContent=S.a+' '+sym(S.op)+' '+S.b+' =';}
  else if(S.op!==null){exprEl.textContent=S.a+' '+sym(S.op);}
  else{exprEl.textContent='';}
  clrEl.textContent=(S.typed&&!S.done)?'C':'AC';
  var ops=document.querySelectorAll('.key.op');
  for(var i=0;i<ops.length;i++){
    var on=S.op!==null&&!S.typed&&!S.done&&ops[i].getAttribute('data-key')===S.op;
    ops[i].classList.toggle('active',on);
    ops[i].setAttribute('aria-pressed',on?'true':'false');
  }
}
function digit(d){
  clearErr();
  if(S.done){reset();}
  if(!S.typed){S.cur=d;S.typed=true;}
  else if(S.cur==='0'){S.cur=d;}
  else if(S.cur.length<2){S.cur+=d;}
  render();
}
function pickOp(o){
  clearErr();
  if(S.done){return;}
  if(S.a===null){S.a=S.cur;S.op=o;S.typed=false;}
  else if(!S.typed){S.op=o;}
  render();
}
function backspace(){
  clearErr();
  if(S.done||!S.typed){return;}
  S.cur=S.cur.slice(0,-1)||'0';
  render();
}
function clearKey(){
  clearErr();
  if(S.typed&&!S.done){S.cur='0';S.typed=false;}
  else{reset();}
  render();
}
function equals(){
  clearErr();
  if(S.done||S.a===null||S.op===null||!S.typed){return;}
  var a=S.a,b=S.cur,op=S.op;
  api('POST','/api/calc',{a:Number(a),b:Number(b),op:op}).then(function(x){
    if(!x.ok){errEl.textContent=x.data.error||'เกิดข้อผิดพลาด';return;}
    S.a=String(x.data.a);S.b=String(x.data.b);S.op=x.data.op;
    S.cur=String(x.data.result);S.typed=false;S.done=true;
    render();
    loadHistory();
  });
}
$('keypad').addEventListener('click',function(e){
  var btn=e.target.closest('button');
  if(!btn){return;}
  var k=btn.getAttribute('data-key');
  if(/^\d$/.test(k)){digit(k);}
  else if(k==='+'||k==='-'||k==='*'||k==='/'){pickOp(k);}
  else if(k==='=')
  {equals();}
  else if(k==='clear'){clearKey();}
  else if(k==='back'){backspace();}
});
document.addEventListener('keydown',function(e){
  if(e.metaKey||e.ctrlKey||e.altKey){return;}
  var k=e.key;
  if(/^\d$/.test(k)){digit(k);}
  else if(k==='+'||k==='-'||k==='*'||k==='/'){e.preventDefault();pickOp(k);}
  else if(k==='Enter'||k==='='){e.preventDefault();equals();}
  else if(k==='Backspace'){backspace();}
  else if(k==='Escape'||k==='c'||k==='C'){clearKey();}
});
function renderHistory(items){
  list.innerHTML='';
  empty.hidden=items.length>0;
  items.forEach(function(h){
    var li=document.createElement('li');
    li.className='item';
    li.setAttribute('data-testid','history-item');
    var left=document.createElement('div');
    var eq=document.createElement('span');
    eq.setAttribute('data-testid','history-equation');
    eq.textContent=h.a+' '+sym(h.op)+' '+h.b+' = '+h.result;
    var tm=document.createElement('span');
    tm.className='time';
    tm.setAttribute('data-testid','history-time');
    tm.textContent=new Date(h.createdAt).toLocaleString('th-TH',{timeZone:'UTC'});
    left.appendChild(eq);left.appendChild(tm);
    var del=document.createElement('button');
    del.type='button';
    del.className='del';
    del.textContent='ลบ';
    del.setAttribute('data-testid','history-delete');
    del.addEventListener('click',function(ev){
      ev.stopPropagation();
      api('DELETE','/api/history/'+h.id).then(function(){li.remove();});
    });
    li.addEventListener('click',function(){
      clearErr();
      if(h.op==='/'){S.a=String(h.b);S.cur=String(h.a);}else{S.a=String(h.a);S.cur=String(h.b);}
      S.b=null;S.op=h.op;S.typed=true;S.done=false;
      render();
    });
    li.appendChild(left);li.appendChild(del);
    list.appendChild(li);
  });
}
function loadHistory(){
  return api('GET','/api/history').then(function(x){if(x.ok){renderHistory(x.data.items);}});
}
api('GET','/api/me').then(function(x){
  if(x.ok){$('user-email').innerHTML=x.data.email;}
});
loadHistory();
render();
$('logout').addEventListener('click',function(){
  api('POST','/api/logout').then(function(){location.href='/login';});
});
$('history-clear').addEventListener('click',function(){
  api('DELETE','/api/history').then(loadHistory);
});
`;

const app = express();
app.use(express.json());

app.get('/', function (req, res) { res.redirect('/app'); });

app.get('/login', function (req, res) {
  if (currentUser(req)) return res.redirect('/app');
  const body = `
<div class="auth">
  ${LOGO}
  <h1 class="large-title center">เข้าสู่ระบบ</h1>
  <p class="sub center">ยินดีต้อนรับกลับมา กรอกข้อมูลเพื่อเริ่มใช้งาน</p>
  <div id="msg" data-testid="login-message" role="alert"></div>
  <form id="login-form" data-testid="login-form" novalidate>
    <div class="group">
      <div class="field">
        <label for="email">อีเมล</label>
        <input id="email" data-testid="login-email" type="text" autocomplete="username" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="password">รหัสผ่าน</label>
        <input id="password" data-testid="login-password" type="password" autocomplete="current-password" placeholder="จำเป็น">
      </div>
    </div>
    <div id="ts" data-testid="turnstile-container"></div>
    <div id="ts-status" class="hint" data-testid="turnstile-status">กำลังโหลดระบบยืนยันตัวตน...</div>
    <button id="submit" class="btn btn-primary" data-testid="login-submit" type="submit" disabled>เข้าสู่ระบบ</button>
  </form>
  <div class="divider"><span>หรือ</span></div>
  <a class="btn btn-secondary" href="/auth/google" data-testid="oauth-google">${GOOGLE_SVG}<span>ล็อกอินด้วย Google</span></a>
  <a class="btn btn-secondary" href="/auth/microsoft" data-testid="oauth-microsoft">${MS_SVG}<span>ล็อกอินด้วย Microsoft</span></a>
  <p class="foot">ยังไม่มีบัญชี? <a href="/register" data-testid="link-register">สมัครสมาชิก</a></p>
</div>` + withTs(LOGIN_JS);
  res.send(page('เข้าสู่ระบบ', body));
});

app.get('/register', function (req, res) {
  if (currentUser(req)) return res.redirect('/app');
  const body = `
<div class="auth">
  ${LOGO}
  <h1 class="large-title center">สมัครสมาชิก</h1>
  <p class="sub center">สร้างบัญชีใหม่ใช้เวลาไม่ถึงนาที</p>
  <div id="msg" class="err" data-testid="register-error" role="alert"></div>
  <form id="register-form" data-testid="register-form" novalidate>
    <div class="group">
      <div class="field">
        <label for="email">อีเมล</label>
        <input id="email" data-testid="register-email" type="text" autocomplete="username" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="password">รหัสผ่าน</label>
        <input id="password" data-testid="register-password" type="password" autocomplete="new-password" placeholder="จำเป็น">
      </div>
      <div class="field">
        <label for="confirm">ยืนยันรหัสผ่าน</label>
        <input id="confirm" data-testid="register-confirm" type="password" autocomplete="new-password" placeholder="จำเป็น">
      </div>
    </div>
    <div class="footnote">อย่างน้อย 8 ตัว มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษอย่างละ 1 ตัว</div>
    <div id="ts" data-testid="turnstile-container"></div>
    <div id="ts-status" class="hint" data-testid="turnstile-status">กำลังโหลดระบบยืนยันตัวตน...</div>
    <button id="submit" class="btn btn-primary" data-testid="register-submit" type="submit" disabled>สมัครสมาชิก</button>
  </form>
  <p class="foot">มีบัญชีแล้ว? <a href="/login" data-testid="link-login">เข้าสู่ระบบ</a></p>
</div>` + withTs(REGISTER_JS);
  res.send(page('สมัครสมาชิก', body));
});

app.get('/app', function (req, res) {
  if (!currentUser(req)) return res.redirect('/login?next=%2Fapp');
  const body = `
<header class="navbar">
  <div class="nav-inner">
    <span class="chip">${USER_SVG}<span id="user-email" data-testid="user-email"></span></span>
    <button id="logout" type="button" class="link-btn" data-testid="logout-button">ออกจากระบบ</button>
  </div>
</header>
<main class="app">
  <h1 class="large-title">เครื่องคิดเลข</h1>
  <div class="layout">
    <section class="calc" aria-label="เครื่องคิดเลข">
      <div class="screen">
        <div id="calc-error" class="calc-error" data-testid="calc-error" role="alert"></div>
        <div id="calc-expression" class="calc-expression" data-testid="calc-expression"></div>
        <div id="calc-result" data-testid="calc-result" aria-live="polite">0</div>
      </div>
      <div id="keypad" class="keypad" data-testid="keypad">
        <button type="button" id="key-clear" class="key fn span2" data-key="clear" data-testid="key-clear" aria-label="ล้าง">AC</button>
        <button type="button" id="key-backspace" class="key fn" data-key="back" data-testid="key-backspace" aria-label="ลบหลักสุดท้าย">${BACK_SVG}</button>
        <button type="button" id="key-divide" class="key op" data-key="/" data-testid="key-divide" aria-label="หาร" aria-pressed="false">÷</button>
        <button type="button" id="key-7" class="key" data-key="7" data-testid="key-7">7</button>
        <button type="button" id="key-8" class="key" data-key="8" data-testid="key-8">8</button>
        <button type="button" id="key-9" class="key" data-key="9" data-testid="key-9">9</button>
        <button type="button" id="key-multiply" class="key op" data-key="*" data-testid="key-multiply" aria-label="คูณ" aria-pressed="false">×</button>
        <button type="button" id="key-4" class="key" data-key="4" data-testid="key-4">4</button>
        <button type="button" id="key-5" class="key" data-key="5" data-testid="key-5">5</button>
        <button type="button" id="key-6" class="key" data-key="6" data-testid="key-6">6</button>
        <button type="button" id="key-subtract" class="key op" data-key="-" data-testid="key-subtract" aria-label="เครื่องหมายลบ" aria-pressed="false">−</button>
        <button type="button" id="key-1" class="key" data-key="1" data-testid="key-1">1</button>
        <button type="button" id="key-2" class="key" data-key="2" data-testid="key-2">2</button>
        <button type="button" id="key-3" class="key" data-key="3" data-testid="key-3">3</button>
        <button type="button" id="key-add" class="key op" data-key="+" data-testid="key-add" aria-label="บวก" aria-pressed="false">+</button>
        <button type="button" id="key-0" class="key span3" data-key="0" data-testid="key-0">0</button>
        <button type="button" id="key-equals" class="key op" data-key="=" data-testid="key-equals" aria-label="เท่ากับ">=</button>
      </div>
    </section>
    <section class="history" aria-label="ประวัติการคำนวณ">
      <div class="section-head">
        <h2 class="section-title">ประวัติการคำนวณ</h2>
        <button id="history-clear" type="button" class="link-btn danger" data-testid="history-clear">ล้างประวัติทั้งหมด</button>
      </div>
      <div class="group">
        <p id="history-empty" class="empty" data-testid="history-empty" hidden>ยังไม่มีประวัติ</p>
        <ul id="history-list" data-testid="history-list"></ul>
      </div>
    </section>
  </div>
</main>
<script>` + APP_JS + '</script>';
  res.send(page('เครื่องคิดเลข', body));
});

app.post('/api/register', async function (req, res) {
  const b = req.body || {};
  const email = b.email, password = b.password;
  const ts = await verifyTs(b.token);
  if (ts === null) return res.status(503).json({ error: 'ไม่สามารถตรวจสอบระบบกันบอทได้ (ต้องเชื่อมต่ออินเทอร์เน็ต)' });
  if (!ts) return res.status(400).json({ error: 'การยืนยันว่าไม่ใช่บอทไม่ผ่าน' });
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
  }
  const okPw = typeof password === 'string' && password.length >= 8 &&
    /[A-Z]/.test(password) && /[a-z]/.test(password) &&
    /[0-9]/.test(password) && /[!@#$%^&*]/.test(password);
  if (!okPw) return res.status(400).json({ error: 'รหัสผ่านไม่ตรงตามเงื่อนไข' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
  db.prepare('INSERT INTO users (email, pw, provider, created_at) VALUES (?, ?, ?, ?)')
    .run(email, hashPw(password), 'local', new Date().toISOString());
  res.status(201).json({ ok: true });
});

app.post('/api/login', function (req, res) {
  const b = req.body || {};
  if (typeof b.email !== 'string' || typeof b.password !== 'string') {
    return res.status(400).json({ error: 'กรุณากรอกอีเมลและรหัสผ่าน' });
  }
  const key = b.email;
  const f = fails.get(key) || { count: 0, until: 0 };
  if (f.until > Date.now()) {
    return res.status(429).json({ error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 1 นาที' });
  }
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) ORDER BY id').get(key);
  const ok = user && (!user.pw || checkPw(b.password, user.pw));
  if (!ok) {
    f.count += 1;
    if (f.count >= 5) { f.until = Date.now() + 60000; f.count = 0; }
    fails.set(key, f);
    return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  }
  fails.delete(key);
  createSession(res, user.id);
  res.json({ ok: true });
});

app.post('/api/logout', function (req, res) {
  res.append('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', auth, function (req, res) {
  res.json({ id: req.user.id, email: req.user.email, provider: req.user.provider });
});

app.post('/api/calc', auth, function (req, res) {
  const b = req.body || {};
  const delay = Math.floor(Math.random() * 700);
  const send = function (code, body) {
    setTimeout(function () { res.status(code).json(body); }, delay);
  };
  if (!validNum(b.a) || !validNum(b.b) || ['+', '-', '*', '/'].indexOf(b.op) === -1) {
    return send(400, { error: 'กรุณากรอกเลขจำนวนเต็ม 0-99 เท่านั้น' });
  }
  const r = calc(b.a, b.b, b.op);
  if (r === null) return send(400, { error: 'เด็กน้อย' });
  db.prepare('INSERT INTO history (user_id, a, b, op, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.user.id, b.a, b.b, b.op, r, new Date().toISOString());
  const rows = db.prepare('SELECT id FROM history WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  if (rows.length > 11) {
    const del = db.prepare('DELETE FROM history WHERE id = ?');
    rows.slice(11).forEach(function (row) { del.run(row.id); });
  }
  send(200, { a: b.a, b: b.b, op: b.op, result: r });
});

app.get('/api/history', auth, function (req, res) {
  const items = db.prepare('SELECT id, a, b, op, result, created_at AS createdAt FROM history WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  res.json({ items: items });
});

app.delete('/api/history/:id', auth, function (req, res) {
  db.prepare('DELETE FROM history WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.delete('/api/history', auth, function (req, res) {
  db.prepare('DELETE FROM history WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.get('/auth/:provider', function (req, res) {
  const key = req.params.provider;
  if (!getProv(key)) return res.status(404).send('ไม่พบผู้ให้บริการ');
  const state = crypto.randomBytes(16).toString('hex');
  res.append('Set-Cookie', 'oauth_state=' + state + '; Path=/; HttpOnly; SameSite=Lax');
  const redirectUri = BASE + '/auth/' + key + '/callback';
  res.redirect('/mock-oauth/' + key + '/authorize?client_id=mock-client&response_type=code&scope=openid%20email&redirect_uri=' +
    encodeURIComponent(redirectUri) + '&state=' + state);
});

app.get('/mock-oauth/:provider/authorize', function (req, res) {
  const key = req.params.provider;
  const prov = getProv(key);
  if (!prov) return res.status(404).send('ไม่พบผู้ให้บริการ');
  const redirectUri = String(req.query.redirect_uri || '');
  const state = String(req.query.state || '');
  if (redirectUri !== BASE + '/auth/' + key + '/callback') {
    return res.status(400).send('redirect_uri ไม่ถูกต้อง');
  }
  const links = prov.accounts.map(function (acc) {
    const href = '/mock-oauth/' + key + '/approve?account=' + encodeURIComponent(acc.email) +
      '&redirect_uri=' + encodeURIComponent(redirectUri) + '&state=' + encodeURIComponent(state);
    return '<a class="row-link" href="' + esc(href) + '" data-testid="mock-account-' + esc(acc.email) + '">' +
      '<span class="avatar" aria-hidden="true">' + esc(acc.label.charAt(0)) + '</span>' +
      '<span class="row-text">' + esc(acc.label) + ' <span class="muted">(' + esc(acc.email) + ')</span></span>' +
      CHEV_SVG + '</a>';
  }).join('');
  const cancel = redirectUri + '?error=access_denied&state=' + encodeURIComponent(state);
  const icon = key === 'google' ? GOOGLE_SVG : MS_SVG;
  res.send(page('เลือกบัญชี ' + prov.name,
    '<div class="auth"><div class="provider-icon">' + icon + '</div>' +
    '<h1 class="large-title center">ล็อกอินด้วย ' + prov.name + '</h1><p class="sub center">เลือกบัญชีทดสอบ</p>' +
    '<span class="mock-badge">ระบบจำลอง OAuth สำหรับฝึกเทส</span>' +
    '<div class="group">' + links + '</div>' +
    '<a class="btn btn-ghost" href="' + esc(cancel) + '" data-testid="mock-cancel">ยกเลิก</a></div>'));
});

app.get('/mock-oauth/:provider/approve', function (req, res) {
  const key = req.params.provider;
  const prov = getProv(key);
  if (!prov) return res.status(404).send('ไม่พบผู้ให้บริการ');
  const redirectUri = String(req.query.redirect_uri || '');
  const state = String(req.query.state || '');
  const account = String(req.query.account || '');
  if (redirectUri !== BASE + '/auth/' + key + '/callback') {
    return res.status(400).send('redirect_uri ไม่ถูกต้อง');
  }
  if (!prov.accounts.some(function (a) { return a.email === account; })) {
    return res.status(400).send('ไม่พบบัญชีทดสอบ');
  }
  const code = crypto.randomBytes(16).toString('hex');
  codes.set(code, { email: account, provider: key });
  res.redirect(redirectUri + '?code=' + code + '&state=' + encodeURIComponent(state));
});

app.get('/auth/:provider/callback', function (req, res) {
  const key = req.params.provider;
  if (!getProv(key)) return res.status(404).send('ไม่พบผู้ให้บริการ');
  const code = String(req.query.code || '');
  const state = req.query.state;
  if (req.query.error) return res.redirect('/login?error=oauth_denied');
  const saved = parseCookies(req).oauth_state;
  if (state && state !== saved) return res.status(400).send('state ไม่ถูกต้อง');
  const info = codes.get(code);
  if (!info || info.provider !== key) return res.status(400).send('code ไม่ถูกต้อง');
  let user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) ORDER BY id').get(info.email);
  if (!user) {
    const r = db.prepare('INSERT INTO users (email, pw, provider, created_at) VALUES (?, NULL, ?, ?)')
      .run(info.email, key, new Date().toISOString());
    user = { id: r.lastInsertRowid };
  }
  createSession(res, user.id);
  res.append('Set-Cookie', 'oauth_state=; Path=/; Max-Age=0');
  res.redirect('/app');
});

app.post('/api/test/reset', function (req, res) {
  db.exec('DELETE FROM history; DELETE FROM sessions; DELETE FROM users; DELETE FROM sqlite_sequence;');
  fails.clear();
  codes.clear();
  res.json({ ok: true });
});

app.listen(PORT, function () {
  console.log('เปิดที่ ' + BASE + ' (Turnstile โหมด: ' + MODE + ')');
});