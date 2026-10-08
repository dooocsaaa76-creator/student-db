// ==========================================================================
// Firebase 저장소 (Firestore + 이메일/비밀번호 로그인)
//   students/{학생ID}        재원생·퇴원생 (status: 'active' | 'withdrawn')
//   externalChunks/{id}      외부생 DB (행 묶음 단위로 저장)
//   meta/main, meta/external 설정·최근 업로드 정보, 외부생 열 목록
//   logs/{auto}              작업 이력
//   allowedUsers/{email}     접근 허용 계정 (mustChange: 초기 비밀번호 미변경)
// ==========================================================================
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initializeFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch,
  deleteField, arrayUnion, query, orderBy, limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

if (!firebaseConfig.apiKey) {
  window.dispatchEvent(new CustomEvent("store-error", { detail: "firebase-config.js 에 Firebase 프로젝트 설정값이 아직 입력되지 않았습니다." }));
  throw new Error("firebaseConfig 미설정");
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
// 새 계정을 만들 때 현재 로그인한 관리자가 로그아웃되지 않도록 별도 인스턴스 사용
const authForCreate = getAuth(initializeApp(firebaseConfig, "account-create"));
export const INITIAL_PASSWORD = "123456";

const BATCH = 400;
const docId = id => String(id).replace(/\//g, "_");

async function commitInBatches(ops) {            // ops: (batch) => void
  for (let i = 0; i < ops.length; i += BATCH) {
    const b = writeBatch(db);
    ops.slice(i, i + BATCH).forEach(op => op(b));
    await b.commit();
  }
}

// 외부생 행을 문서 크기 제한(1MB) 아래로 나누기
function chunkRows(rows) {
  const out = []; let cur = [], size = 0;
  for (const r of rows) {
    const s = JSON.stringify(r).length * 2;
    if (cur.length && (size + s > 700000 || cur.length >= 1500)) { out.push(cur); cur = []; size = 0; }
    cur.push(r); size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}
async function writeChunks(rows) {
  const base = Date.now() * 1000;
  const chunks = chunkRows(rows);
  for (let i = 0; i < chunks.length; i++)
    await setDoc(doc(db, "externalChunks", `c${base + i}`), { seq: base + i, rows: chunks[i] });
}
async function deleteCollection(name) {
  const snap = await getDocs(collection(db, name));
  await commitInBatches(snap.docs.map(d => b => b.delete(d.ref)));
}

window.Store = {
  /* ---------- 로그인 ---------- */
  initialPassword: INITIAL_PASSWORD,
  onAuth(cb) { onAuthStateChanged(auth, cb); },
  signIn(email, pw) { return signInWithEmailAndPassword(auth, email.trim().toLowerCase(), pw); },
  signOut() { return signOut(auth); },
  // 허용 목록에 있으면 프로필({name, mustChange}) 반환, 없으면 null
  async getProfile(email) {
    try { const s = await getDoc(doc(db, "allowedUsers", email.toLowerCase())); return s.exists() ? s.data() : null; }
    catch (e) { return null; }                   // 규칙상 권한 없으면 읽기 자체가 거부됨
  },
  async changePassword(currentPw, newPw) {
    const user = auth.currentUser;
    if (currentPw) await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPw));
    await updatePassword(user, newPw);
    await setDoc(doc(db, "allowedUsers", user.email.toLowerCase()), { mustChange: false, pwChangedAt: new Date().toISOString() }, { merge: true });
  },
  sendReset(email) { return sendPasswordResetEmail(auth, email.trim().toLowerCase()); },

  /* ---------- 불러오기 ---------- */
  async loadStudents() {
    return (await getDocs(collection(db, "students"))).docs.map(d => d.data());
  },
  async loadAll() {
    const [students, mainSnap, extSnap, chunkSnap, logSnap] = await Promise.all([
      this.loadStudents(),
      getDoc(doc(db, "meta", "main")),
      getDoc(doc(db, "meta", "external")),
      getDocs(query(collection(db, "externalChunks"), orderBy("seq"))),
      getDocs(query(collection(db, "logs"), orderBy("ts", "desc"), limit(200))),
    ]);
    return {
      students,
      meta: mainSnap.exists() ? mainSnap.data() : {},
      external: { cols: extSnap.exists() ? (extSnap.data().cols || []) : [], rows: chunkSnap.docs.flatMap(d => d.data().rows || []) },
      logs: logSnap.docs.map(d => d.data()),
    };
  },

  /* ---------- 학생 ---------- */
  // writes: [{ id, data, del:[필드명], hist:'이력 문구' }]  — 항상 merge 저장이라 data에 없는 필드(연락처 등)는 그대로 유지됨
  async writeStudents(writes) {
    await commitInBatches(writes.map(w => b => {
      const data = { ...w.data };
      (w.del || []).forEach(f => { data[f] = deleteField(); });
      if (w.hist) data.history = arrayUnion(w.hist);
      b.set(doc(db, "students", docId(w.id)), data, { merge: true });
    }));
  },
  updateStudent(id, patch) { return setDoc(doc(db, "students", docId(id)), patch, { merge: true }); },
  deleteStudent(id) { return deleteDoc(doc(db, "students", docId(id))); },

  /* ---------- 외부생 ---------- */
  async appendExternal(cols, rows) {
    await setDoc(doc(db, "meta", "external"), { cols });
    await writeChunks(rows);
  },
  async replaceExternal(cols, rows) {
    await deleteCollection("externalChunks");
    await setDoc(doc(db, "meta", "external"), { cols });
    await writeChunks(rows);
  },

  /* ---------- 설정 · 이력 ---------- */
  saveMeta(patch) { return setDoc(doc(db, "meta", "main"), patch, { merge: true }); },
  addLog(entry) { return setDoc(doc(collection(db, "logs")), entry); },

  /* ---------- 백업 복원 (전체 교체) ---------- */
  async replaceAll(d) {
    const students = [...Object.values(d.active || {}).map(r => ({ ...r, status: "active" })),
                      ...Object.values(d.withdrawn || {}).map(r => ({ ...r, status: "withdrawn" }))];
    const keep = new Set(students.map(r => docId(r.id)));
    const old = await getDocs(collection(db, "students"));
    await commitInBatches([
      ...old.docs.filter(x => !keep.has(x.id)).map(x => b => b.delete(x.ref)),
      ...students.map(r => b => b.set(doc(db, "students", docId(r.id)), r)),
    ]);
    await this.replaceExternal(d.external?.cols || [], d.external?.rows || []);
    await setDoc(doc(db, "meta", "main"), { settings: d.settings || { extPromote: true }, lastRoster: d.lastRoster || null, lastBackup: d.lastBackup || null });
  },

  /* ---------- 접근 권한 ---------- */
  async listUsers() {
    return (await getDocs(collection(db, "allowedUsers"))).docs.map(d => ({ email: d.id, ...d.data() }))
      .sort((a, b) => a.email.localeCompare(b.email));
  },
  // 로그인 계정(초기 비밀번호) 생성 + 허용 목록 등록. 이미 계정이 있으면 허용 목록에만 추가
  async addUser(email, name) {
    email = email.toLowerCase();
    let created = true;
    try { await createUserWithEmailAndPassword(authForCreate, email, INITIAL_PASSWORD); }
    catch (e) { if (e.code === "auth/email-already-in-use") created = false; else throw e; }
    finally { await signOut(authForCreate).catch(() => {}); }
    await setDoc(doc(db, "allowedUsers", email), { name: name || "", mustChange: true, addedAt: new Date().toISOString() });
    return { created };
  },
  removeUser(email) { return deleteDoc(doc(db, "allowedUsers", email)); },
};

window.dispatchEvent(new Event("store-ready"));
