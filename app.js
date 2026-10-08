/* ================= 공통 ================= */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CUR_YEAR = new Date().getFullYear();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const ymd = () => today().replace(/-/g,'');
const ko = (a,b) => String(a||'').localeCompare(String(b||''),'ko');

let S = { active:{}, withdrawn:{}, external:{cols:[], rows:[]}, logs:[], settings:{extPromote:true}, lastBackup:null, lastRoster:null };
let ME = null;   // 로그인한 사용자 이메일

/* ---------- 저장소 연동 ---------- */
function setStatus(t){ $('#saveState').textContent = t; }
function busy(msg){ $('#busyMsg').textContent = msg || ''; $('#busy').classList.toggle('on', !!msg); }
// 저장 작업 공통 처리: 진행 표시 + 오류 안내
async function run(msg, fn){
  busy(msg);
  try { const r = await fn(); setStatus('저장됨 ' + new Date().toLocaleTimeString('ko-KR')); return r; }
  catch(e){ console.error(e); alert('저장 중 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.\n\n' + (e.code || '') + ' ' + e.message); throw e; }
  finally { busy(''); }
}
function setStudents(list){
  S.active = {}; S.withdrawn = {};
  list.forEach(r => { (r.status === 'withdrawn' ? S.withdrawn : S.active)[r.id] = r; });
}
async function loadAll(){
  busy('데이터 불러오는 중…');
  try {
    const d = await Store.loadAll();
    setStudents(d.students);
    S.external = d.external; S.logs = d.logs;
    S.settings = Object.assign({extPromote:true}, d.meta.settings);
    S.lastRoster = d.meta.lastRoster || null; S.lastBackup = d.meta.lastBackup || null;
    renderAll(); setStatus('최신 데이터 ' + new Date().toLocaleTimeString('ko-KR'));
  } catch(e){ console.error(e); alert('데이터를 불러오지 못했습니다.\n' + e.message); }
  finally { busy(''); }
}
async function refreshStudents(){ setStudents(await Store.loadStudents()); }
function log(type, file, summary){
  const e = {ts:Date.now(), at:new Date().toLocaleString('ko-KR'), by:ME||'', type, file, summary};
  S.logs.unshift(e);
  Store.addLog(e).catch(err => console.error('log', err));
}

/* ---------- 학년 ---------- */
// 레벨: 초1=1 … 초6=6, 중1=7 … 중3=9, 고1=10 … 고3=12, 13 이상 = 나이(레벨+7)세
function parseGrade(v){
  let s = String(v ?? '').replace(/\s/g,'');
  if (!s) return null;
  let m = s.match(/^(\d{1,2})(세|살)/);
  if (m) return +m[1] - 7;
  let pre = 0;
  if (s.startsWith('예비')) { pre = 1; s = s.slice(2); }
  m = s.match(/^(초등학교|초등|초)(\d)/);       if (m && +m[2]>=1 && +m[2]<=6) return +m[2] - pre;
  m = s.match(/^(중학교|중학|중등|중)(\d)/);     if (m && +m[2]>=1 && +m[2]<=3) return 6 + +m[2] - pre;
  m = s.match(/^(고등학교|고등|고교|고)(\d)/);   if (m && +m[2]>=1 && +m[2]<=3) return 9 + +m[2] - pre;
  m = s.match(/^(대학교|대학|대)(\d)/);          if (m && +m[2]>=1 && +m[2]<=6) return 12 + +m[2] - pre;
  m = s.match(/^(\d)수/);                        if (m) return 11 + +m[1];   // N수생: 재수(2수)=20세
  m = s.match(/^grade(\d{1,2})$/i);              if (m) return +m[1];
  return null;
}
function gradeLabel(lv){
  if (lv == null) return '';
  if (lv >= 1 && lv <= 6) return '초' + lv;
  if (lv >= 7 && lv <= 9) return '중' + (lv - 6);
  if (lv >= 10 && lv <= 12) return '고' + (lv - 9);
  return (lv + 7) + '세';
}
const nowLevel = (lv, yr, promote=true) => lv == null ? null : lv + (promote ? (CUR_YEAR - (yr || CUR_YEAR)) : 0);
const shortGrade = g => { const lv = parseGrade(g); return lv==null ? String(g||'') : gradeLabel(lv); };   // "초5 (grade 5)" → "초5"

/* ---------- 연락처 ---------- */
function fmtPhone(v){
  const s = String(v ?? '').trim(); if (!s) return '';
  let d = s.replace(/\D/g,'');
  if ((d.length === 10 || d.length === 9) && /^1[016789]/.test(d)) d = '0' + d;    // 엑셀에서 앞자리 0 빠진 경우
  if (/^01\d{9}$/.test(d)) return d.replace(/(\d{3})(\d{4})(\d{4})/,'$1-$2-$3');
  if (/^01\d{8}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{4})/,'$1-$2-$3');
  if (/^02\d{8}$/.test(d)) return d.replace(/(\d{2})(\d{4})(\d{4})/,'$1-$2-$3');
  if (/^02\d{7}$/.test(d)) return d.replace(/(\d{2})(\d{3})(\d{4})/,'$1-$2-$3');
  if (/^0\d{10}$/.test(d)) return d.replace(/(\d{3})(\d{4})(\d{4})/,'$1-$2-$3');
  if (/^0\d{9}$/.test(d)) return d.replace(/(\d{3})(\d{3})(\d{4})/,'$1-$2-$3');
  return s;
}
const missingContact = r => !r.parentPhone || !r.studentPhone;
const teacherName = t => String(t||'').trim().replace(/^([^,\s]+)\s*,\s*([^,\s]+)$/, '$1$2');   // "최,준석" → "최준석"

/* ---------- 엑셀 읽기 ---------- */
const ALIAS = {
  id:['id','아이디','학생id','원생id','회원id','학번','학생번호','원생번호','고유번호'],
  name:['이름','학생명','성명','학생이름','원생명'],
  grade:['학년','현재학년'],
  school:['학교','학교명','재학학교'],
  cls:['클래스','반','class','클래스명','반명','배치반'],
  clsStatus:['클래스상태'],
  teacher:['교사','담임','선생님','담당교사','담임교사','강사','담당강사'],
  parentPhone:['학부모연락처','부모연락처','보호자연락처','학부모전화','학부모번호','학부모휴대폰','학부모핸드폰','부모님연락처'],
  studentPhone:['학생연락처','학생전화','학생휴대폰','학생핸드폰','학생전화번호'],
  phone:['연락처','전화번호','휴대폰','핸드폰','전화','휴대전화','핸드폰번호','휴대폰번호','연락처1'],
  region:['지역','지역명','주소','거주지','거주지역','시군구','소재지','주소지'],
  memo:['메모','비고'],
};
const norm = s => String(s ?? '').replace(/[\s_\-()\[\]·.]/g,'').toLowerCase();
function mapCols(header, fields){
  const H = header.map(norm), map = {}, used = new Set();
  for (const f of fields) { const i = H.findIndex((h,k)=>!used.has(k) && ALIAS[f].includes(h)); if (i>=0){ map[f]=i; used.add(i);} }
  for (const f of fields) { if (map[f]!=null || f==='clsStatus') continue;
    const i = H.findIndex((h,k)=>!used.has(k) && h && ALIAS[f].some(a=>a.length>=2 && h.includes(a)));
    if (i>=0){ map[f]=i; used.add(i);} }
  return map;
}
async function readWorkbook(file){
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, {type:'array'});
  return wb.SheetNames.map(n => ({ name:n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1, defval:'', raw:false, blankrows:false}) }));
}
// 지정한 필드가 가장 많이 맞는 시트/헤더 행 찾기
function locateTable(sheets, fields, must){
  let best = null;
  for (const sh of sheets) for (let i=0; i<Math.min(20, sh.rows.length); i++) {
    const map = mapCols(sh.rows[i], fields), score = Object.keys(map).length;
    if (must.some(f => map[f]==null)) continue;
    if (!best || score > best.score) best = {sheet:sh, hi:i, map, score};
  }
  return best;
}
const cell = (row, i) => i==null ? '' : String(row[i] ?? '').trim();

/* ================= 파일 선택 ================= */
let pickMode = null;
function pick(mode){ pickMode = mode; const f = $('#filePick'); f.accept = mode==='restore' ? '.json' : '.xlsx,.xls,.csv'; f.value=''; f.click(); }
$('#filePick').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (pickMode==='restore') return await restore(file);
    if (typeof XLSX === 'undefined') return alert('엑셀 처리 모듈을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.');
    const sheets = await readWorkbook(file);
    if (pickMode==='roster') await rosterUpload(file.name, sheets);
    else if (pickMode==='contacts') await contactsUpload(file.name, sheets);
    else if (pickMode==='external') await externalUpload(file.name, sheets);
  } catch(err){ console.error(err); if (!err.code) alert('파일을 처리하는 중 오류가 발생했습니다.\n' + err.message); }
});

/* ================= 모달 ================= */
function modal(html){ $('#modal').innerHTML = html; $('#modalBg').classList.add('on'); }
function closeModal(){ $('#modalBg').classList.remove('on'); }
const nameList = (arr, f) => arr.length ? `<div class="namelist">${arr.map(f).join(', ')}</div>` : '';

/* ================= 재원생: 배치생 리스트 업로드 ================= */
let pending = null;
async function rosterUpload(fname, sheets){
  const t = locateTable(sheets, ['id','name','grade','school','cls','clsStatus','teacher','parentPhone','studentPhone','phone','memo'], ['id','name']);
  if (!t) return alert('ID 열과 이름 열을 찾을 수 없습니다.\n엑셀 첫 부분에 "ID", "이름" 제목 행이 있는지 확인해 주세요.');
  const {sheet, hi, map} = t, file = {};
  let nRows = 0;
  for (const row of sheet.rows.slice(hi+1)) {
    const id = cell(row, map.id), name = cell(row, map.name);
    if (!id || !name) continue;
    nRows++;
    const f = file[id] ||= { id, name, grade: cell(row,map.grade), school: cell(row,map.school), classes:[], teachers:[],
                             parentPhone: fmtPhone(cell(row,map.parentPhone) || cell(row,map.phone)), studentPhone: fmtPhone(cell(row,map.studentPhone)), memo: cell(row,map.memo) };
    // 한 학생이 여러 클래스 → 여러 행: 클래스·교사를 모음
    const c = cell(row,map.cls), st = cell(row,map.clsStatus), tc = teacherName(cell(row,map.teacher));
    if (c && !f.classes.some(x=>x.name===c)) f.classes.push({name:c, status: st && !/^active$/i.test(st) ? st : ''});
    if (tc && !f.teachers.includes(tc)) f.teachers.push(tc);
  }
  const ids = Object.keys(file);
  if (!ids.length) return alert('학생 데이터가 없습니다.');
  // 다른 사람이 그 사이 바꾼 내용이 있을 수 있으므로 최신 명단 기준으로 비교
  busy('최신 명단 확인 중…');
  try { await refreshStudents(); } finally { busy(''); }
  const isNew = ids.filter(id => !S.active[id] && !S.withdrawn[id]);
  const returned = ids.filter(id => !S.active[id] && S.withdrawn[id]);
  const kept = ids.filter(id => S.active[id]);
  const leaving = Object.keys(S.active).filter(id => !file[id]);
  const actCnt = Object.keys(S.active).length;
  const missingCols = ['grade','school','cls','teacher'].filter(f=>map[f]==null).map(f=>({grade:'학년',school:'학교',cls:'클래스',teacher:'교사'}[f]));
  pending = {fname, file};
  const s = r => esc(r.name) + `<span style="opacity:.6">(${esc(r.id)})</span>`;
  modal(`<h3>배치생 리스트 반영 확인</h3>
    <p class="muted">파일: ${esc(fname)} · 시트: ${esc(sheet.name)} · ${nRows}행 → 학생 <b>${ids.length}명</b> (여러 클래스 수강생은 한 명으로 합침)</p>
    ${missingCols.length ? `<div class="alert">인식하지 못한 열: ${missingCols.join(', ')} (해당 정보는 비어있게 됩니다)</div>` : ''}
    ${actCnt && leaving.length > actCnt*0.4 ? `<div class="alert">⚠ 기존 재원생의 ${Math.round(leaving.length/actCnt*100)}%가 퇴원 처리됩니다. 올바른 파일인지 확인해 주세요.</div>` : ''}
    <details><summary>기존 재원생 정보 갱신: <b>${kept.length}명</b> (연락처·메모 유지)</summary></details>
    <details ${isNew.length && isNew.length<=80?'open':''}><summary>신규 등록: <b>${isNew.length}명</b></summary>${nameList(isNew.map(id=>file[id]), s)}</details>
    <details ${returned.length?'open':''}><summary>퇴원생 → 재원 복귀: <b>${returned.length}명</b> (기존 연락처 복원)</summary>${nameList(returned.map(id=>file[id]), s)}</details>
    <details ${leaving.length?'open':''}><summary>명단에 없어 퇴원생으로 이동: <b style="color:var(--warn)">${leaving.length}명</b></summary>${nameList(leaving.map(id=>S.active[id]), s)}</details>
    <div class="row" style="justify-content:flex-end;margin-top:16px">
      <button class="btn" onclick="closeModal()">취소</button>
      <button class="btn primary" onclick="applyRoster()">반영하기</button>
    </div>`);
}
async function applyRoster(){
  const {fname, file} = pending; const d = today();
  let nNew=0, nRet=0, nKept=0, nOut=0;
  const writes = [];
  for (const id in file) {
    const f = file[id], base = S.active[id] || S.withdrawn[id];
    if (S.active[id]) nKept++; else if (S.withdrawn[id]) nRet++; else nNew++;
    const data = { id, name:f.name, grade:shortGrade(f.grade), gLevel:parseGrade(f.grade), gYear:CUR_YEAR,
                   school:f.school, classes:f.classes, teachers:f.teachers, lastFile:fname, updatedAt:d, status:'active' };
    // 연락처·메모는 절대 덮어쓰지 않음 (merge 저장). 기존 값이 없을 때만 파일 값으로 채움
    if (!base) Object.assign(data, {firstSeen:d, parentPhone:f.parentPhone, studentPhone:f.studentPhone, memo:f.memo});
    else {
      if (!base.parentPhone && f.parentPhone) data.parentPhone = f.parentPhone;
      if (!base.studentPhone && f.studentPhone) data.studentPhone = f.studentPhone;
      if (!base.memo && f.memo) data.memo = f.memo;
    }
    const w = {id, data};
    if (S.withdrawn[id]) { w.del = ['withdrawnAt','withdrawGrade']; w.hist = `${d} 재원 복귀`; }
    writes.push(w);
  }
  for (const id of Object.keys(S.active)) {
    if (file[id]) continue;
    writes.push({ id, data:{status:'withdrawn', withdrawnAt:d, withdrawGrade:S.active[id].grade, updatedAt:d}, hist:`${d} 퇴원 (${fname})` });
    nOut++;
  }
  closeModal();
  await run(`저장 중… (${writes.length}명)`, async () => {
    await Store.writeStudents(writes);
    S.lastRoster = {fname, at:d};
    await Store.saveMeta({lastRoster:S.lastRoster});
    log('배치생 리스트', fname, `갱신 ${nKept} · 신규 ${nNew} · 복귀 ${nRet} · 퇴원 ${nOut}`);
    await refreshStudents();
  });
  pending = null; renderAll();
  alert(`반영 완료\n갱신 ${nKept}명 · 신규 ${nNew}명 · 복귀 ${nRet}명 · 퇴원 이동 ${nOut}명`);
}

/* ================= 연락처 일괄 업로드 ================= */
async function contactsUpload(fname, sheets){
  const t = locateTable(sheets, ['id','name','parentPhone','studentPhone','phone','memo'], ['id']);
  if (!t) return alert('ID 열을 찾을 수 없습니다. "연락처 미입력 명단 내보내기"로 받은 파일 양식을 사용해 주세요.');
  const {sheet, hi, map} = t;
  if (map.parentPhone==null && map.studentPhone==null && map.phone==null) return alert('연락처 열(학부모 연락처 / 학생 연락처)을 찾을 수 없습니다.');
  let cnt=0; const notFound=[], writes=[];
  for (const row of sheet.rows.slice(hi+1)) {
    const id = cell(row,map.id); if (!id) continue;
    const rec = S.active[id] || S.withdrawn[id];
    if (!rec) { notFound.push(id); continue; }
    const vals = { parentPhone: fmtPhone(cell(row,map.parentPhone) || cell(row,map.phone)), studentPhone: fmtPhone(cell(row,map.studentPhone)), memo: cell(row,map.memo) };
    const data = {};
    for (const k in vals) if (vals[k] && vals[k] !== rec[k]) { data[k] = vals[k]; cnt++; }   // 빈 칸은 기존 값을 지우지 않음
    if (Object.keys(data).length) writes.push({id, data, rec});
  }
  if (writes.length) await run(`연락처 저장 중… (${writes.length}명)`, async () => {
    await Store.writeStudents(writes.map(w => ({id:w.id, data:{...w.data, updatedAt:today()}})));
    writes.forEach(w => Object.assign(w.rec, w.data));
    log('연락처 업로드', fname, `${writes.length}명 / ${cnt}건 반영` + (notFound.length?` · 미등록 ID ${notFound.length}건`:''));
  });
  renderAll();
  alert(`연락처 반영 완료: ${writes.length}명 (${cnt}건)` + (notFound.length ? `\n\n등록되지 않은 ID ${notFound.length}건은 건너뛰었습니다:\n${notFound.slice(0,30).join(', ')}${notFound.length>30?' …':''}` : ''));
}

/* ================= 엑셀 내보내기 ================= */
const clsText = r => (r.classes||[]).map(c=>c.name + (c.status?` (${c.status})`:'')).join('\n');
const tchText = r => (r.teachers||[]).join(', ');
function writeXlsx(aoa, sheetName, fname, widths){
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = (widths || aoa[0].map(()=>12)).map(w=>({wch:w}));
  ws['!autofilter'] = {ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:Math.max(aoa.length-1,0), c:aoa[0].length-1}})};
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fname);
}
function exportMissing(kind){
  const W = kind==='withdrawn';
  const list = Object.values(W ? S.withdrawn : S.active).filter(missingContact).sort(byClass);
  if (!list.length) return alert('연락처가 비어 있는 학생이 없습니다.');
  const aoa = [['ID','이름','학년','학교','클래스','교사','학부모 연락처','학생 연락처']];
  list.forEach(r => aoa.push([r.id, r.name, W?curGradeOf(r):r.grade, r.school, clsText(r), tchText(r), r.parentPhone||'', r.studentPhone||'']));
  writeXlsx(aoa, '연락처입력', `${W?'퇴원생_':''}연락처입력_${ymd()}_${list.length}명.xlsx`, [11,9,7,16,34,14,16,16]);
}
function exportStudents(kind){
  const W = kind==='withdrawn';
  const list = W ? filteredWithdrawn() : filteredActive();
  if (!list.length) return alert('내보낼 학생이 없습니다.');
  const head = W ? ['ID','이름','현재 학년(자동)','퇴원 당시 학년','학교','클래스','교사','학부모 연락처','학생 연락처','메모','퇴원일']
                 : ['ID','이름','학년','학교','클래스','교사','학부모 연락처','학생 연락처','메모'];
  const aoa = [head];
  list.forEach(r => aoa.push(W
    ? [r.id, r.name, curGradeOf(r), r.withdrawGrade||r.grade, r.school, clsText(r), tchText(r), r.parentPhone||'', r.studentPhone||'', r.memo||'', r.withdrawnAt||'']
    : [r.id, r.name, r.grade, r.school, clsText(r), tchText(r), r.parentPhone||'', r.studentPhone||'', r.memo||'']));
  writeXlsx(aoa, W?'퇴원생':'재원생', `${W?'퇴원생':'재원생'}_${ymd()}_${list.length}명.xlsx`,
    W ? [11,9,10,10,16,34,14,16,16,20,12] : [11,9,7,16,34,14,16,16,20]);
}

/* ================= 재원생 / 퇴원생 화면 ================= */
const firstCls = r => (r.classes && r.classes[0] && r.classes[0].name) || '';
const byClass = (a,b) => ko(firstCls(a), firstCls(b)) || ko(a.name, b.name);
const curGradeOf = r => { const lv = nowLevel(r.gLevel, r.gYear); return lv==null ? (r.grade||'') : gradeLabel(lv); };
const textHit = (r, q) => !q || [r.id,r.name,r.school,clsText(r),tchText(r),r.parentPhone,r.studentPhone,r.memo].some(v => String(v||'').toLowerCase().includes(q));
function fillSelect(el, label, values){
  const cur = el.value;
  el.innerHTML = `<option value="">${label} 전체</option>` + values.map(v=>`<option>${esc(v)}</option>`).join('');
  el.value = values.includes(cur) ? cur : '';
}
const uniq = arr => [...new Set(arr.filter(Boolean))];
const sortGrades = arr => arr.sort((a,b)=>(parseGrade(a)??99)-(parseGrade(b)??99) || ko(a,b));
const clsCell = r => `<td class="cls">${(r.classes||[]).map(c=>`<div class="${c.status?'hold':''}">${esc(c.name)}${c.status?` <span class="tag">${esc(c.status)}</span>`:''}</div>`).join('')}</td>`;
const contactCells = (r, kind) => ['parentPhone','studentPhone'].map(f =>
  `<td class="${r[f]?'':'empty'}"><input data-k="${kind}" data-id="${esc(r.id)}" data-f="${f}" value="${esc(r[f]||'')}" placeholder="입력"></td>`).join('')
  + `<td><input class="memo" data-k="${kind}" data-id="${esc(r.id)}" data-f="memo" value="${esc(r.memo||'')}"></td>`;

function filteredActive(){
  const q=$('#aSearch').value.trim().toLowerCase(), c=$('#aClass').value, t=$('#aTeacher').value, g=$('#aGrade').value, m=$('#aMissing').checked;
  return Object.values(S.active).filter(r => textHit(r,q) && (!c||(r.classes||[]).some(x=>x.name===c)) && (!t||(r.teachers||[]).includes(t)) && (!g||r.grade===g) && (!m||missingContact(r))).sort(byClass);
}
function renderActive(){
  const all = Object.values(S.active);
  const mp = all.filter(r=>!r.parentPhone).length, ms = all.filter(r=>!r.studentPhone).length;
  $('#activeStats').innerHTML = `<div class="stat"><b>${all.length}</b>명 재원</div>
    <div class="stat ${mp?'warn':''}"><b>${mp}</b>명 학부모 연락처 미입력</div>
    <div class="stat ${ms?'warn':''}"><b>${ms}</b>명 학생 연락처 미입력</div>
    <div class="stat">최근 업로드: ${S.lastRoster ? esc(S.lastRoster.fname)+' ('+S.lastRoster.at+')' : '없음'}</div>`;
  fillSelect($('#aClass'),'클래스', uniq(all.flatMap(r=>(r.classes||[]).map(c=>c.name))).sort(ko));
  fillSelect($('#aTeacher'),'교사', uniq(all.flatMap(r=>r.teachers||[])).sort(ko));
  fillSelect($('#aGrade'),'학년', sortGrades(uniq(all.map(r=>r.grade))));
  const list = filteredActive();
  $('#aCount').textContent = `${list.length}명 표시`;
  $('#aTable').innerHTML = `<thead><tr><th>ID</th><th>이름</th><th>학년</th><th>학교</th><th>클래스</th><th>교사</th><th>학부모 연락처</th><th>학생 연락처</th><th>메모</th></tr></thead><tbody>`
    + (list.length ? list.map(r=>`<tr><td>${esc(r.id)}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.grade)}</td><td>${esc(r.school)}</td>${clsCell(r)}<td>${esc(tchText(r))}</td>${contactCells(r,'active')}</tr>`).join('')
       : `<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">${all.length?'조건에 맞는 학생이 없습니다.':'"배치생 리스트 업로드" 버튼으로 엑셀 파일을 올려주세요.'}</td></tr>`) + '</tbody>';
}
function filteredWithdrawn(){
  const q=$('#wSearch').value.trim().toLowerCase(), g=$('#wGrade').value, y=$('#wYear').value, m=$('#wMissing').checked;
  return Object.values(S.withdrawn).filter(r => textHit(r,q) && (!g||curGradeOf(r)===g) && (!y||(r.withdrawnAt||'').startsWith(y)) && (!m||missingContact(r)))
    .sort((a,b)=>ko(b.withdrawnAt, a.withdrawnAt) || ko(a.name, b.name));
}
function renderWithdrawn(){
  const all = Object.values(S.withdrawn);
  const mp = all.filter(r=>!r.parentPhone).length;
  $('#wInfo').innerHTML = `현재 기준 연도 <b>${CUR_YEAR}년</b> · '현재 학년'은 마지막으로 확인된 학년에서 해가 바뀔 때마다 자동으로 올라갑니다. 고3 다음부터는 나이(20세, 21세 …)로 표시됩니다.`;
  $('#wStats').innerHTML = `<div class="stat"><b>${all.length}</b>명 누적 퇴원생</div><div class="stat ${mp?'warn':''}"><b>${mp}</b>명 학부모 연락처 미입력</div>`;
  fillSelect($('#wGrade'),'현재 학년', sortGrades(uniq(all.map(curGradeOf))));
  fillSelect($('#wYear'),'퇴원 연도', uniq(all.map(r=>(r.withdrawnAt||'').slice(0,4))).sort().reverse());
  const list = filteredWithdrawn();
  $('#wCount').textContent = `${list.length}명 표시`;
  $('#wTable').innerHTML = `<thead><tr><th>ID</th><th>이름</th><th>현재 학년</th><th>퇴원 당시</th><th>학교</th><th>클래스</th><th>교사</th><th>학부모 연락처</th><th>학생 연락처</th><th>메모</th><th>퇴원일</th><th></th></tr></thead><tbody>`
    + (list.length ? list.map(r=>{ const cg = curGradeOf(r), auto = r.gLevel!=null && cg !== (r.withdrawGrade||r.grade);
      return `<tr><td>${esc(r.id)}</td><td><b>${esc(r.name)}</b></td><td><span class="tag ${auto?'auto':''}" title="${r.gLevel==null?'학년 표기를 인식하지 못해 자동 진급되지 않습니다':''}">${esc(cg)}</span></td><td class="muted">${esc(r.withdrawGrade||r.grade)}</td><td>${esc(r.school)}</td>${clsCell(r)}<td>${esc(tchText(r))}</td>${contactCells(r,'withdrawn')}<td>${esc(r.withdrawnAt||'')}</td><td><button class="btn sm danger" data-del="${esc(r.id)}">삭제</button></td></tr>`; }).join('')
       : `<tr><td colspan="12" class="muted" style="text-align:center;padding:30px">퇴원생이 없습니다. 새 배치생 리스트를 올렸을 때 명단에서 빠진 학생이 이곳으로 이동합니다.</td></tr>`) + '</tbody>';
}
$('#wTable').addEventListener('click', async e => {
  const id = e.target.dataset && e.target.dataset.del; if (!id) return;
  const r = S.withdrawn[id]; if (!r) return;
  if (!confirm(`퇴원생 '${r.name}(${id})'을(를) DB에서 완전히 삭제할까요?\n연락처 정보도 함께 삭제되며 되돌릴 수 없습니다.`)) return;
  await run('삭제 중…', () => Store.deleteStudent(id));
  delete S.withdrawn[id]; log('퇴원생 삭제', '', `${r.name}(${id})`); renderWithdrawn();
});
// 표 안에서 직접 입력 → 해당 학생 문서의 그 칸만 저장
document.addEventListener('change', async e => {
  const el = e.target; if (!el.dataset || !el.dataset.f || !el.dataset.k) return;
  const rec = S[el.dataset.k][el.dataset.id]; if (!rec) return;
  const f = el.dataset.f, v = f==='memo' ? el.value.trim() : fmtPhone(el.value), old = rec[f] || '';
  if (v === old) { el.value = old; return; }
  if (!v && old && !confirm(`${rec.name} 학생의 ${f==='memo'?'메모':'연락처'}를 지울까요?`)) { el.value = old; return; }
  el.value = v; setStatus('저장 중…');
  try {
    await Store.updateStudent(rec.id, {[f]: v, updatedAt: today()});
    rec[f] = v; el.parentElement.classList.toggle('empty', f!=='memo' && !v);
    setStatus('저장됨 ' + new Date().toLocaleTimeString('ko-KR'));
    (el.dataset.k==='active' ? renderActiveStatsOnly : renderWithdrawnStatsOnly)();
  } catch(err){ el.value = old; setStatus('⚠ 저장 실패'); alert('저장하지 못했습니다: ' + err.message); }
});
function renderActiveStatsOnly(){ const all=Object.values(S.active), st=$('#activeStats').children, a=all.filter(r=>!r.parentPhone).length, b=all.filter(r=>!r.studentPhone).length;
  st[1].innerHTML=`<b>${a}</b>명 학부모 연락처 미입력`; st[1].classList.toggle('warn',!!a); st[2].innerHTML=`<b>${b}</b>명 학생 연락처 미입력`; st[2].classList.toggle('warn',!!b); }
function renderWithdrawnStatsOnly(){ const all=Object.values(S.withdrawn), a=all.filter(r=>!r.parentPhone).length, el=$('#wStats').children[1]; el.innerHTML=`<b>${a}</b>명 학부모 연락처 미입력`; el.classList.toggle('warn',!!a); }
['#aSearch','#aClass','#aTeacher','#aGrade','#aMissing'].forEach(s=>$(s).addEventListener(s==='#aSearch'?'input':'change', e=>{ e.stopPropagation(); renderActive(); }));
['#wSearch','#wGrade','#wYear','#wMissing'].forEach(s=>$(s).addEventListener(s==='#wSearch'?'input':'change', e=>{ e.stopPropagation(); renderWithdrawn(); }));

/* ================= 외부생 DB ================= */
const SIDO = {'서울특별시':'서울','서울시':'서울','서울':'서울','부산광역시':'부산','부산':'부산','대구광역시':'대구','대구':'대구','인천광역시':'인천','인천':'인천','광주광역시':'광주','광주':'광주','대전광역시':'대전','대전':'대전','울산광역시':'울산','울산':'울산','세종특별자치시':'세종','세종시':'세종','세종':'세종','경기도':'경기','경기':'경기','강원도':'강원','강원특별자치도':'강원','강원':'강원','충청북도':'충북','충북':'충북','충청남도':'충남','충남':'충남','전라북도':'전북','전북특별자치도':'전북','전북':'전북','전라남도':'전남','전남':'전남','경상북도':'경북','경북':'경북','경상남도':'경남','경남':'경남','제주특별자치도':'제주','제주도':'제주','제주':'제주'};
function parseRegion(v){
  const t = String(v ?? '').trim().split(/[\s,]+/).filter(Boolean);
  if (!t.length) return '';
  const sido = SIDO[t[0]];
  if (!sido) return t[0];                       // 시도 없이 '서초구' 등만 있는 경우
  if (sido === '세종' || !t[1] || !/(시|군|구)$/.test(t[1])) return sido;
  return sido + ' ' + t[1];
}
const extLevel = r => nowLevel(r._lv, r._yr, S.settings.extPromote);
const extGradeKey = r => { const lv = extLevel(r); return lv==null ? '미분류' : gradeLabel(lv); };
let gradeOff = new Set(), regionSel = new Set();
const rMode = () => document.querySelector('input[name=rMode]:checked').value;

async function externalUpload(fname, sheets){
  let t = locateTable(sheets, ['name','grade','region','phone','school'], ['grade']);
  if (!t) { if (!confirm('"학년" 열을 찾지 못했습니다. 학년 구분 없이(미분류) 업로드할까요?')) return;
    t = locateTable(sheets, ['name','grade','region','phone','school'], []) || {sheet:sheets[0], hi:0, map:{}}; }
  const {sheet, hi, map} = t;
  const header = sheet.rows[hi].map((h,i)=>String(h).trim() || `열${i+1}`);
  const baseYear = +$('#eBaseYear').value || CUR_YEAR;
  const replace = document.querySelector('input[name=eMode]:checked').value === 'replace';
  if (replace && S.external.rows.length && !confirm(`기존 외부생 DB ${S.external.rows.length}건을 모두 지우고 새 파일로 교체할까요?`)) return;
  const cols = replace ? [] : [...S.external.cols];
  header.forEach(h => { if (!cols.includes(h)) cols.push(h); });
  const keyOf = r => { const p = String(r[header[map.phone]] ?? '').replace(/\D/g,''); const n = norm(r[header[map.name]]); return p ? n+'|'+p : null; };
  const seen = new Set(replace ? [] : S.external.rows.map(r=>r._key).filter(Boolean));
  const added = []; let dup=0, unk=0;
  for (const row of sheet.rows.slice(hi+1)) {
    if (!row.some(c=>String(c).trim())) continue;
    const r = {}; header.forEach((h,i)=>{ const v = String(row[i] ?? '').trim(); if (v) r[h] = v; });
    if (map.phone!=null && r[header[map.phone]]) r[header[map.phone]] = fmtPhone(r[header[map.phone]]);
    r._key = map.phone!=null ? keyOf(r) : null;
    if (r._key && seen.has(r._key)) { dup++; continue; }
    if (r._key) seen.add(r._key);
    r._lv = map.grade!=null ? parseGrade(r[header[map.grade]]) : null; r._yr = baseYear;
    r._region = map.region!=null ? parseRegion(r[header[map.region]]) : '';
    r._src = fname;
    if (r._lv == null) unk++;
    added.push(r);
  }
  await run(`외부생 DB 저장 중… (${added.length}건)`, async () => {
    if (replace) await Store.replaceExternal(cols, added); else await Store.appendExternal(cols, added);
    S.external = { cols, rows: replace ? added : [...S.external.rows, ...added] };
    log('외부생 업로드', fname, `${added.length}건 추가${dup?` · 중복 ${dup}건 제외`:''}${unk?` · 학년 미분류 ${unk}건`:''} (기준 ${baseYear}년${replace?', 전체 교체':''})`);
  });
  renderExternal(); renderBackup();
  alert(`외부생 DB 업로드 완료\n추가 ${added.length}건${dup?` · 중복 제외 ${dup}건`:''}${unk?`\n학년을 인식하지 못한 ${unk}건은 '미분류'로 분류됩니다.`:''}`
    + `\n\n인식된 열: 학년=${map.grade!=null?header[map.grade]:'없음'}, 지역=${map.region!=null?header[map.region]:'없음'}, 이름=${map.name!=null?header[map.name]:'없음'}, 연락처=${map.phone!=null?header[map.phone]:'없음'}`);
}
async function clearExternal(){
  if (!S.external.rows.length) return;
  if (!confirm(`외부생 DB ${S.external.rows.length}건을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
  await run('삭제 중…', () => Store.replaceExternal([], []));
  S.external = {cols:[], rows:[]}; log('외부생 DB 비우기','',''); renderExternal(); renderBackup();
}
function filteredExternal(){
  const mode = rMode();
  return S.external.rows.filter(r => {
    if (gradeOff.has(extGradeKey(r))) return false;
    const rk = r._region || '__none';
    if (mode==='include') return regionSel.has(rk);
    if (mode==='exclude') return !regionSel.has(rk);
    return true;
  });
}
function renderExternal(){
  const rows = S.external.rows;
  const gCount = {}; rows.forEach(r => { const k = extGradeKey(r); gCount[k] = (gCount[k]||0)+1; });
  const rCount = {}; rows.forEach(r => { const k = r._region || '__none'; rCount[k] = (rCount[k]||0)+1; });
  const withRegion = rows.length - (rCount.__none||0);
  $('#eStats').innerHTML = rows.length ? `<div class="stat"><b>${rows.length.toLocaleString()}</b>건 외부생 DB</div><div class="stat"><b>${withRegion.toLocaleString()}</b>건 지역 입력됨</div>${gCount['미분류']?`<div class="stat warn"><b>${gCount['미분류']}</b>건 학년 미분류</div>`:''}` : '';
  // 학년
  const gKeys = Object.keys(gCount).sort((a,b)=>(a==='미분류')-(b==='미분류') || (parseGrade(a)??0)-(parseGrade(b)??0));
  $('#eGrades').innerHTML = gKeys.length ? gKeys.map(k=>`<label class="chip ${gradeOff.has(k)?'':'on'}"><input type="checkbox" data-grade="${esc(k)}" ${gradeOff.has(k)?'':'checked'}>${esc(k)} <small>${gCount[k]}</small></label>`).join('') : '<span class="muted">데이터가 없습니다.</span>';
  // 지역 (시도별 묶음)
  const groups = {};
  Object.keys(rCount).filter(k=>k!=='__none').forEach(k => { const sd = k.split(' ')[0]; (groups[sd] ||= []).push(k); });
  const tot = sd => groups[sd].reduce((s,k)=>s+rCount[k],0);
  const sidos = Object.keys(groups).sort((a,b)=>tot(b)-tot(a));
  let html = '';
  if (!withRegion) html = '<p class="muted">지역이 입력된 DB가 없습니다.</p>';
  for (const sd of sidos) {
    const ks = groups[sd].sort((a,b)=>rCount[b]-rCount[a]);
    const all = ks.every(k=>regionSel.has(k));
    html += `<div class="sido"><div class="sido-h"><input type="checkbox" data-sido="${esc(sd)}" ${all?'checked':''}> ${esc(sd)} 전체 <small class="muted">${tot(sd)}</small></div><div class="chips">`
      + ks.map(k=>`<label class="chip ${regionSel.has(k)?'on':''}"><input type="checkbox" data-region="${esc(k)}" ${regionSel.has(k)?'checked':''}>${esc(k===sd?sd+' (시군구 미상)':k.slice(sd.length+1))} <small>${rCount[k]}</small></label>`).join('') + '</div></div>';
  }
  if (rCount.__none) html += `<div class="sido"><div class="chips"><label class="chip ${regionSel.has('__none')?'on':''}"><input type="checkbox" data-region="__none" ${regionSel.has('__none')?'checked':''}>지역 미입력 <small>${rCount.__none}</small></label></div></div>`;
  $('#eRegions').innerHTML = html;
  $('#eRegions').classList.toggle('disabled', rMode()==='all');
  renderExternalResult();
}
function renderExternalResult(){
  const list = filteredExternal(), mode = rMode();
  const boxes = [...document.querySelectorAll('[data-grade]')], gSel = boxes.filter(c=>c.checked).map(c=>c.dataset.grade);
  const rLbl = [...regionSel].map(k=>k==='__none'?'지역 미입력':k);
  $('#eResultCount').textContent = `— ${list.length.toLocaleString()}건`;
  $('#eSummary').textContent = `학년: ${gSel.length===boxes.length?'전체':(gSel.join(', ')||'선택 없음')} / 지역: `
    + (mode==='all' ? '전체' : mode==='include' ? `${rLbl.join(', ')||'선택 없음'} 만` : `${rLbl.join(', ')||'없음'} 제외`) + (list.length>200?' · 미리보기는 200건까지 표시':'');
  const cols = S.external.cols;
  $('#eTable').innerHTML = cols.length ? `<thead><tr><th>현재 학년</th><th>지역(인식)</th>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`
    + list.slice(0,200).map(r=>`<tr><td><span class="tag">${esc(extGradeKey(r))}</span></td><td>${esc(r._region)}</td>${cols.map(c=>`<td>${esc(r[c])}</td>`).join('')}</tr>`).join('') + '</tbody>' : '';
}
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.grade != null) { el.checked ? gradeOff.delete(el.dataset.grade) : gradeOff.add(el.dataset.grade); el.parentElement.classList.toggle('on', el.checked); renderExternalResult(); }
  else if (el.dataset.region != null) { el.checked ? regionSel.add(el.dataset.region) : regionSel.delete(el.dataset.region); renderExternal(); }
  else if (el.dataset.sido != null) { document.querySelectorAll('[data-region]').forEach(c => { if (c.dataset.region===el.dataset.sido || c.dataset.region.startsWith(el.dataset.sido+' ')) el.checked ? regionSel.add(c.dataset.region) : regionSel.delete(c.dataset.region); }); renderExternal(); }
  else if (el.name === 'rMode') renderExternal();
});
function gradeAll(on){ document.querySelectorAll('[data-grade]').forEach(c => on ? gradeOff.delete(c.dataset.grade) : gradeOff.add(c.dataset.grade)); renderExternal(); }
function gradeBand(p){ document.querySelectorAll('[data-grade]').forEach(c => c.dataset.grade.startsWith(p) ? gradeOff.delete(c.dataset.grade) : gradeOff.add(c.dataset.grade)); renderExternal(); }
function downloadExternal(){
  const list = filteredExternal();
  if (!list.length) return alert('조건에 맞는 DB가 없습니다.');
  const cols = S.external.cols;
  const aoa = [['현재 학년', ...cols]];
  list.forEach(r => aoa.push([extGradeKey(r), ...cols.map(c=>r[c] ?? '')]));
  const boxes = [...document.querySelectorAll('[data-grade]')], gSel = boxes.filter(c=>c.checked).map(c=>c.dataset.grade);
  const tag = gSel.length === boxes.length ? '전체학년' : gSel.slice(0,4).join(',') + (gSel.length>4?'외':'');
  writeXlsx(aoa, '외부생DB', `외부생DB_${tag}_${ymd()}_${list.length}건.xlsx`, [10, ...cols.map(()=>14)]);
}

/* ================= 백업 / 복원 ================= */
async function backup(){
  S.lastBackup = new Date().toLocaleString('ko-KR');
  const {active, withdrawn, external, settings, lastRoster, lastBackup} = S;
  const blob = new Blob([JSON.stringify({active, withdrawn, external, settings, lastRoster, lastBackup})], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `학생DB_백업_${ymd()}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  Store.saveMeta({lastBackup:S.lastBackup}).catch(console.error);
  renderBackup();
}
async function restore(file){
  let d; try { d = JSON.parse(await file.text()); } catch(e){ return alert('백업 파일 형식이 올바르지 않습니다.'); }
  if (!d || !d.active || !d.withdrawn) return alert('학생 DB 백업 파일이 아닙니다.');
  if (!confirm(`백업 파일을 불러오면 Firebase에 저장된 현재 데이터가 모두 교체됩니다.\n\n백업 내용: 재원생 ${Object.keys(d.active).length}명 · 퇴원생 ${Object.keys(d.withdrawn).length}명 · 외부생 ${(d.external?.rows||[]).length}건\n\n계속할까요?`)) return;
  await run('백업 복원 중…', () => Store.replaceAll(d));
  log('백업 복원', file.name, '');
  await loadAll();
}
function renderBackup(){
  $('#lastBackup').textContent = S.lastBackup ? `마지막 백업: ${S.lastBackup}` : '아직 백업한 적이 없습니다.';
  $('#extPromote').checked = !!S.settings.extPromote;
  $('#curYearLbl').textContent = CUR_YEAR + '년';
  $('#logList').innerHTML = S.logs.length ? S.logs.slice(0,200).map(l=>`<li>${esc(l.at)} · <b>${esc(l.type)}</b> ${esc(l.file)} ${l.summary?'— '+esc(l.summary):''} <span class="muted">${esc(l.by||'')}</span></li>`).join('') : '<li class="muted">이력이 없습니다.</li>';
}
$('#extPromote').addEventListener('change', async e => {
  e.stopPropagation(); S.settings.extPromote = e.target.checked; renderExternal();
  await run('설정 저장 중…', () => Store.saveMeta({settings:S.settings}));
});

/* ================= 접근 권한 관리 ================= */
async function renderUsers(){
  try {
    const users = await Store.listUsers();
    $('#initPw').textContent = Store.initialPassword;
    $('#userList').innerHTML = users.map(u => `<li><b>${esc(u.email)}</b> ${esc(u.name||'')} ${u.mustChange ? '<span class="tag" style="color:var(--warn)">초기 비밀번호 미변경</span>' : ''}
      ${u.email===ME ? '<span class="muted">(나)</span>' : `<button class="btn sm" data-resetuser="${esc(u.email)}">비밀번호 재설정 메일</button> <button class="btn sm danger" data-rmuser="${esc(u.email)}">삭제</button>`}</li>`).join('');
  } catch(e){ $('#userList').innerHTML = `<li class="muted">목록을 불러오지 못했습니다: ${esc(e.message)}</li>`; }
}
async function addUser(){
  const email = $('#newUserEmail').value.trim().toLowerCase(), name = $('#newUserName').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return alert('이메일 주소를 정확히 입력해 주세요.');
  const r = await run('계정 만드는 중…', () => Store.addUser(email, name));
  $('#newUserEmail').value = ''; $('#newUserName').value = '';
  log('접근 권한 추가', '', email); renderUsers();
  alert(r.created ? `${email} 계정을 만들었습니다.\n초기 비밀번호: ${Store.initialPassword}\n(첫 로그인 때 비밀번호를 변경하게 됩니다)`
                  : `${email} 은(는) 이미 로그인 계정이 있어 접근 권한만 추가했습니다.\n기존 비밀번호로 로그인하면 되며, 비밀번호를 모르면 '비밀번호 재설정 메일'을 보내 주세요.`);
}
$('#userList').addEventListener('click', async e => {
  const reset = e.target.dataset && e.target.dataset.resetuser;
  if (reset) {
    if (!confirm(`${reset} 로 비밀번호 재설정 메일을 보낼까요?`)) return;
    await run('메일 보내는 중…', () => Store.sendReset(reset));
    return alert('비밀번호 재설정 메일을 보냈습니다. (메일이 안 보이면 스팸함을 확인해 주세요)');
  }
  const email = e.target.dataset && e.target.dataset.rmuser; if (!email) return;
  if (!confirm(`${email} 계정의 접근 권한을 삭제할까요?\n삭제하면 이 계정으로는 더 이상 학생 DB에 접근할 수 없습니다.`)) return;
  await run('삭제 중…', () => Store.removeUser(email));
  log('접근 권한 삭제', '', email); renderUsers();
});

/* ================= 시작 · 로그인 ================= */
function renderAll(){ renderActive(); renderWithdrawn(); renderExternal(); renderBackup(); }
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on', x===b));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on', t.id==='tab-'+b.dataset.tab));
  if (b.dataset.tab === 'backup') renderUsers();
});
$('#modalBg').addEventListener('click', e => { if (e.target.id==='modalBg') closeModal(); });
$('#eBaseYear').value = CUR_YEAR;

function showScreen(id){ ['login','pwBox','app'].forEach(k => $('#'+k).classList.toggle('on', k===id)); }
function showLogin(msg){ showScreen('login'); $('#loginMsg').innerHTML = msg || ''; }
const AUTH_ERR = {
  'auth/invalid-credential':'이메일 또는 비밀번호가 올바르지 않습니다.', 'auth/wrong-password':'이메일 또는 비밀번호가 올바르지 않습니다.',
  'auth/user-not-found':'등록되지 않은 이메일입니다.', 'auth/invalid-email':'이메일 형식이 올바르지 않습니다.',
  'auth/too-many-requests':'로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', 'auth/weak-password':'비밀번호는 6자 이상이어야 합니다.',
  'auth/requires-recent-login':'보안을 위해 다시 로그인한 뒤 변경해 주세요.', 'auth/operation-not-allowed':'Firebase 콘솔에서 이메일/비밀번호 로그인이 아직 켜져 있지 않습니다.',
};
const authMsg = e => AUTH_ERR[e.code] || e.message;

// 비밀번호 변경 화면 (forced: 초기 비밀번호 상태라 변경 전에는 사용 불가)
let pwForced = false;
function showPwChange(forced){
  pwForced = forced;
  $('#pwNotice').innerHTML = forced ? `초기 비밀번호(${esc(Store.initialPassword)})로 로그인했습니다.<br>계속하려면 새 비밀번호로 변경해 주세요.` : '';
  $('#pwCur').style.display = forced ? 'none' : '';
  $('#pwCur').required = !forced;
  $('#pwCancel').textContent = forced ? '로그아웃' : '취소';
  ['#pwCur','#pwNew','#pwNew2'].forEach(s => $(s).value = ''); $('#pwMsg').textContent = '';
  showScreen('pwBox');
}
async function enterApp(){
  showScreen('app');
  if (!S._loaded) { S._loaded = true; await loadAll(); }
}
function startApp(){
  $('#loginForm').onsubmit = async e => {
    e.preventDefault(); $('#loginMsg').textContent = '로그인 중…';
    try { await Store.signIn($('#loginEmail').value, $('#loginPw').value); $('#loginPw').value = ''; }
    catch(err){ $('#loginMsg').textContent = authMsg(err); }
  };
  $('#resetBtn').onclick = async () => {
    const email = $('#loginEmail').value.trim();
    if (!email) return $('#loginMsg').textContent = '이메일을 먼저 입력한 뒤 눌러 주세요.';
    try { await Store.sendReset(email); $('#loginMsg').textContent = `${email} 로 비밀번호 재설정 메일을 보냈습니다. (스팸함도 확인해 주세요)`; }
    catch(err){ $('#loginMsg').textContent = authMsg(err); }
  };
  $('#pwForm').onsubmit = async e => {
    e.preventDefault();
    const cur = pwForced ? '' : $('#pwCur').value, pw = $('#pwNew').value;
    if (pw.length < 6) return $('#pwMsg').textContent = '새 비밀번호는 6자 이상이어야 합니다.';
    if (pw !== $('#pwNew2').value) return $('#pwMsg').textContent = '새 비밀번호가 서로 다릅니다.';
    if (pw === Store.initialPassword) return $('#pwMsg').textContent = '초기 비밀번호와 다른 비밀번호를 입력해 주세요.';
    $('#pwMsg').textContent = '변경 중…';
    try { await Store.changePassword(cur, pw); alert('비밀번호를 변경했습니다.'); await enterApp(); }
    catch(err){ $('#pwMsg').textContent = authMsg(err); }
  };
  $('#pwCancel').onclick = () => pwForced ? Store.signOut() : showScreen('app');
  $('#pwChangeBtn').onclick = () => showPwChange(false);
  $('#logoutBtn').onclick = () => Store.signOut();
  $('#refreshBtn').onclick = () => loadAll();
  Store.onAuth(async user => {
    if (!user) { ME = null; S._loaded = false; return showLogin($('#loginMsg').innerHTML); }
    const email = (user.email || '').toLowerCase();
    const profile = await Store.getProfile(email);
    if (!profile) {
      await Store.signOut();
      return showLogin(`<b>${esc(email)}</b> 계정은 접근 권한이 없습니다.<br>관리자에게 등록을 요청해 주세요.`);
    }
    ME = email; $('#meEmail').textContent = email; $('#loginMsg').textContent = '';
    if (profile.mustChange) return showPwChange(true);
    await enterApp();
  });
}
if (window.Store) startApp(); else window.addEventListener('store-ready', startApp);
window.addEventListener('store-error', e => { $('#loginBtn').disabled = true; showLogin(esc(e.detail)); });
setTimeout(() => { if (!window.Store && !$('#loginMsg').textContent) showLogin('Firebase에 연결하지 못했습니다. 인터넷 연결 또는 firebase-config.js 설정을 확인해 주세요.'); }, 8000);
