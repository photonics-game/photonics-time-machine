/* 光電時光機：Firebase（Firestore＋匿名登入）連線。介面和練習模式的本機資料庫相同。 */
const V = "10.14.1";
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

export async function createFirebaseStore(cfg) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(BASE + "firebase-app.js"),
    import(BASE + "firebase-auth.js"),
    import(BASE + "firebase-firestore.js")
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const cred = await A.signInAnonymously(auth);
  const uid = cred.user.uid;
  const ref = p => F.doc(db, p);
  return {
    uid, kind: "firebase",
    get: async p => { const s = await F.getDoc(ref(p)); return s.exists() ? s.data() : null; },
    set: (p, d, merge) => F.setDoc(ref(p), d, merge ? { merge: true } : {}),
    update: (p, patch) => F.updateDoc(ref(p), patch),
    watchDoc: (p, cb, onErr) => F.onSnapshot(ref(p), s => cb(s.exists() ? s.data() : null), e => { console.error(e); onErr && onErr(e); }),
    watchCol: (p, cb, onErr) => F.onSnapshot(F.collection(db, p), qs => cb(qs.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.error(e); onErr && onErr(e); })
  };
}
