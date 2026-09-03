// Tests for the cookie fan-out (this extension) and the Apps Script ingest
// receiver it can now push to. Both are plain functions read out of their
// source files, so nothing here needs Chrome or Apps Script.
//
//   node extensions/behaviours-edsby-cookie-sync/test-ingest.cjs

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const REPO = path.resolve(__dirname, '../..');
const bg = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const DEFAULT_INGEST_URL = "https://api.curriculate.net/api/behavior/edsby/ingest";
const parseIngestUrls = eval('(' + bg.match(/function parseIngestUrls[\s\S]*?\n}/)[0] + ')');
const shortenUrl      = eval('(' + bg.match(/function shortenUrl[\s\S]*?\n}/)[0] + ')');
let pass=0,fail=0;
const eq=(n,a,b)=>{const A=JSON.stringify(a),B=JSON.stringify(b);
  if(A===B){pass++;console.log('  ok   '+n);}else{fail++;console.log(`  FAIL ${n}\n    got ${A}\n    exp ${B}`);}};

console.log('\nparseIngestUrls');
eq('blank -> default', parseIngestUrls(''), [DEFAULT_INGEST_URL]);
eq('undefined -> default', parseIngestUrls(undefined), [DEFAULT_INGEST_URL]);
eq('single', parseIngestUrls('https://a.test/x'), ['https://a.test/x']);
eq('two lines', parseIngestUrls('https://a.test/x\nhttps://b.test/y'), ['https://a.test/x','https://b.test/y']);
eq('comma separated', parseIngestUrls('https://a.test/x, https://b.test/y'), ['https://a.test/x','https://b.test/y']);
eq('blank lines dropped', parseIngestUrls('\n\nhttps://a.test/x\n\n'), ['https://a.test/x']);
eq('http rejected -> default', parseIngestUrls('http://insecure.test/x'), [DEFAULT_INGEST_URL]);
eq('junk rejected, good kept', parseIngestUrls('not-a-url\nhttps://a.test/x'), ['https://a.test/x']);
eq('apps script + backend', parseIngestUrls(
  DEFAULT_INGEST_URL+'\nhttps://script.google.com/macros/s/ABC/exec?token=T'),
  [DEFAULT_INGEST_URL,'https://script.google.com/macros/s/ABC/exec?token=T']);

console.log('\nshortenUrl (the token must never reach the log)');
eq('masks the token', shortenUrl('https://script.google.com/macros/s/ABC/exec?token=SECRET'),
   'script.google.com/macros/s/ABC/exec?token=***');
eq('no token, no marker', shortenUrl(DEFAULT_INGEST_URL), 'api.curriculate.net/api/behavior/edsby/ingest');
eq('unparseable', shortenUrl('!!!'), '(unparseable URL)');

// --- Apps Script receiver: applyIngest_ + constantTimeEquals_ ---
const gs = fs.readFileSync(path.join(REPO, 'extensions/edsby-bdays-apps-script/Code.gs'), 'utf8');
const shim = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-')), 'code.cjs');
fs.writeFileSync(shim, gs + '\nmodule.exports={applyIngest_,constantTimeEquals_};');
const M = require(shim);
const mkStore = () => { const o={}; return { data:o, setProperty:(k,v)=>{o[k]=v;} }; };

console.log('\napplyIngest_');
let st = mkStore();
let r = M.applyIngest_({ cookie:'session_id_edsby=abc; _ga=1', baseUrl:'https://bcs.edsby.com',
                         jver:'J1', cver:'C1', userNid:'25582870' }, st);
eq('writes the cookie', st.data.EDSBY_SESSION_COOKIE, 'session_id_edsby=abc; _ga=1');
eq('writes the base url', st.data.EDSBY_BASE_URL, 'https://bcs.edsby.com');
eq('writes jver/cver', [st.data.EDSBY_JVER, st.data.EDSBY_CVER], ['J1','C1']);
eq('writes a plausible user nid', st.data.EDSBY_USER_NID, '25582870');
eq('reports the cookie count', r.cookieCount, 2);
eq('stamps the update time', typeof st.data.EDSBY_COOKIE_UPDATED_AT, 'string');
eq('never writes the zoom node', st.data.EDSBY_ZOOM_NODE_ID, undefined);

st = mkStore();
eq('rejects an empty payload', M.applyIngest_(null, st).error, 'empty payload');
eq('rejects a missing cookie', M.applyIngest_({ baseUrl:'https://x.test' }, st).error, 'no cookie in payload');
eq('rejects a cookie with no session id',
   M.applyIngest_({ cookie:'foo=bar' }, st).error, 'cookie has no session_id_edsby');
eq('nothing written on rejection', Object.keys(st.data).length, 0);

st = mkStore();
M.applyIngest_({ cookie:'session_id_edsby=abc', userNid:'054748', baseUrl:'http://insecure.test' }, st);
eq('rejects the 054748-style nid', st.data.EDSBY_USER_NID, undefined);
eq('rejects a non-https base url', st.data.EDSBY_BASE_URL, undefined);
eq('but still takes the cookie', st.data.EDSBY_SESSION_COOKIE, 'session_id_edsby=abc');

console.log('\nconstantTimeEquals_');
eq('equal', M.constantTimeEquals_('abc123','abc123'), true);
eq('differing', M.constantTimeEquals_('abc123','abc124'), false);
eq('prefix is not a match', M.constantTimeEquals_('abc','abc123'), false);
eq('empty supplied', M.constantTimeEquals_('','abc'), false);
eq('empty expected', M.constantTimeEquals_('abc',''), false);
eq('both empty', M.constantTimeEquals_('',''), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
