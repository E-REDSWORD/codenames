// script.js (type="module")
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, remove,
  onDisconnect, serverTimestamp, child
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* =======================
   1) Firebase config
   ======================= */
const firebaseConfig = {
  apiKey: "AIzaSyBX5StSnJDYcm8T2Kh2rrN-rWyjDQ12H-k",
  authDomain: "codenames-58720.firebaseapp.com",
  projectId: "codenames-58720",
  storageBucket: "codenames-58720.firebasestorage.app",
  messagingSenderId: "213322653482",
  appId: "1:213322653482:web:3bc34d491320ee6a60c853",
  measurementId: "G-HMQ11RVCNH"
};
// هام: استبدل القيم أعلاه من إعدادات تطبيق الويب في Firebase

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* =======================
   2) Helpers
   ======================= */
const qs = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

function genRoomId() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "REDSWORD-";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function uid() {
  // ثابت عبر الجلسات
  let u = localStorage.getItem("rs_uid");
  if (!u) {
    u = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem("rs_uid", u);
  }
  return u;
}

function normalizeArabic(s) {
  if (!s) return "";
  return s
    .toString()
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, "") // إزالة التشكيل
    .replace(/\u0640/g, "") // تطويل
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function toast(el, msg, ok = true) {
  el.textContent = msg;
  el.className = "feedback " + (ok ? "ok" : "no");
}

/* =======================
   3) Puzzles (Arabic)
   ======================= */
const DEFAULT_PUZZLES = [
  { q: "شيءٌ إذا ذكرتَهُ كَبُرَ، وإذا كتمتَهُ صَغُرَ. ما هو؟", a: ["السر"], clue: "يتعلّق بالكتمان" },
  { q: "يمشي بلا قدمين، ويَبكي بلا عينين. ما هو؟", a: ["السحاب","الغيم"], clue: "في السماء" },
  { q: "بيتٌ بلا أبوابٍ ولا نوافذ. ما هو؟", a: ["البيضه","بيضة"], clue: "كروية هشّة" },
  { q: "ما هو الشيء الذي يسمع بلا أذن ويتكلم بلا لسان؟", a: ["الهاتف","تلفون","الجوال"], clue: "في يدك الآن" },
  { q: "تجري ولا تتعب، تشرب ولا تأكل. ما هي؟", a: ["النهر","الماء"], clue: "سائلة دائمة الجريان" },
  { q: "شيءٌ يزيد إذا أكلتَ منه. ما هو؟", a: ["الجوع"], clue: "مفارقة" },
];

/* =======================
   4) Index page logic
   ======================= */
if (document.body.dataset.page === "index") {
  const nameInput = byId("playerName");
  const createBtn = byId("createRoomBtn");
  const joinInput = byId("joinRoomId");
  const joinBtn = byId("joinRoomBtn");
  const errorEl = byId("indexError");

  createBtn.addEventListener("click", async () => {
    const name = (nameInput.value || "").trim();
    if (name.length < 2) {
      errorEl.textContent = "اكتب اسمًا من حرفين على الأقل.";
      return;
    }
    const roomId = genRoomId();

    // أنشئ الغرفة
    const roomRef = ref(db, `rooms/${roomId}`);
    const puzzles = DEFAULT_PUZZLES;
    const me = uid();

    await set(roomRef, {
      createdAt: Date.now(),
      host: me,
      status: "waiting",
      currentIndex: -1,
      timerEndsAt: 0,
      puzzles,
      players: {}
    });

    // أضف اللاعب
    await set(child(roomRef, `players/${me}`), {
      name,
      score: 0,
      joinedAt: serverTimestamp()
    });

    // وجود/مغادرة تلقائية
    onDisconnect(child(roomRef, `players/${me}`)).remove();

    // اذهب للغرفة
    const url = new URL("game.html", location.href);
    url.searchParams.set("room", roomId);
    url.searchParams.set("name", name);
    location.href = url.toString();
  });

  joinBtn.addEventListener("click", async () => {
    const name = (nameInput.value || "").trim();
    const rid = (joinInput.value || "").trim().toUpperCase();
    if (name.length < 2) return errorEl.textContent = "اكتب اسمًا من حرفين على الأقل.";
    if (!rid) return errorEl.textContent = "أدخل رمز الغرفة.";

    const snap = await get(ref(db, `rooms/${rid}`));
    if (!snap.exists()) {
      errorEl.textContent = "الغرفة غير موجودة. تحقق من الرمز.";
      return;
    }
    const me = uid();
    const roomRef = ref(db, `rooms/${rid}`);
    await set(child(roomRef, `players/${me}`), {
      name,
      score: 0,
      joinedAt: serverTimestamp()
    });
    onDisconnect(child(roomRef, `players/${me}`)).remove();

    const url = new URL("game.html", location.href);
    url.searchParams.set("room", rid);
    url.searchParams.set("name", name);
    location.href = url.toString();
  });
}

/* =======================
   5) Game page logic
   ======================= */
if (document.body.dataset.page === "game") {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");
  const myName = params.get("name") || "لاعب";
  const myId = uid();

  const roomRef = ref(db, `rooms/${roomId}`);
  const playersRef = child(roomRef, "players");

  // عناصر واجهة
  const roomIdLabel = byId("roomIdLabel");
  const copyRoomBtn = byId("copyRoomBtn");
  const shareLink = byId("shareLink");
  const playersList = byId("playersList");
  const hostControls = byId("hostControls");
  const startGameBtn = byId("startGameBtn");
  const nextPuzzleBtn = byId("nextPuzzleBtn");
  const puzzleTitle = byId("puzzleTitle");
  const puzzleClue = byId("puzzleClue");
  const timerValue = byId("timerValue");
  const answerInput = byId("answerInput");
  const submitAnswerBtn = byId("submitAnswerBtn");
  const feedback = byId("feedback");

  const toggleVoice = byId("toggleVoice");
  const voicePanel = byId("voicePanel");
  const jitsiFrame = byId("jitsiFrame");
  const openVoiceExternal = byId("openVoiceExternal");

  // عرض معلومات الغرفة
  roomIdLabel.textContent = roomId || "—";
  const roomURL = new URL(location.href);
  shareLink.href = roomURL.toString();
  openVoiceExternal.href = `https://meet.jit.si/${encodeURIComponent(roomId)}`;

  copyRoomBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(roomId);
    alert("تم نسخ رمز الغرفة.");
  });

  // دمج/إظهار الصوت
  toggleVoice.addEventListener("click", () => {
    const hidden = voicePanel.classList.toggle("hidden");
    if (!hidden && !jitsiFrame.src) {
      jitsiFrame.src = `https://meet.jit.si/${encodeURIComponent(roomId)}#config.startWithVideoMuted=true`;
    }
  });

  // تأكيد التسجيل ضمن اللاعبين (إذا فتح أحدهم الرابط مباشرة)
  (async () => {
    const snap = await get(child(playersRef, myId));
    if (!snap.exists()) {
      await set(child(playersRef, myId), {
        name: myName,
        score: 0,
        joinedAt: serverTimestamp()
      });
      onDisconnect(child(playersRef, myId)).remove();
    }
  })();

  // مستمع قائمة اللاعبين
  onValue(playersRef, (s) => {
    const players = s.val() || {};
    renderPlayers(players);
  });

  // مستمع حالة الغرفة/اللعبة
  onValue(roomRef, (s) => {
    const data = s.val();
    if (!data) return;
    const { host, status, currentIndex, puzzles, timerEndsAt } = data;

    // إظهار أدوات المضيف
    const iAmHost = (host === myId);
    hostControls.classList.toggle("hidden", !iAmHost);

    // حالة اللعبة
    if (status === "waiting") {
      puzzleTitle.textContent = "بانتظار بدء الجولة…";
      puzzleClue.textContent = "عند الضغط على بدء الجولة سيظهر أول سؤال";
      timerValue.textContent = "—";
    } else if (status === "playing") {
      const p = puzzles?.[currentIndex];
      if (p) {
        puzzleTitle.textContent = p.q;
        puzzleClue.textContent = "تلميح: " + p.clue;
      }
      updateTimer(timerEndsAt);
    } else if (status === "finished") {
      puzzleTitle.textContent = "انتهت الجولة! 👏";
      puzzleClue.textContent = "أعد البدء أو أنشئ غرفة جديدة.";
      timerValue.textContent = "—";
    }
  });

  // بدء الجولة (المضيف)
  startGameBtn.addEventListener("click", async () => {
    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.host !== myId) return;
    await update(roomRef, {
      status: "playing",
      currentIndex: 0,
      timerEndsAt: Date.now() + 60_000 // 60 ثانية للسؤال
    });
    feedback.textContent = "";
  });

  // السؤال التالي (المضيف)
  nextPuzzleBtn.addEventListener("click", async () => {
    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.host !== myId) return;
    const next = (data.currentIndex ?? -1) + 1;
    if (next < (data.puzzles?.length || 0)) {
      await update(roomRef, {
        currentIndex: next,
        status: "playing",
        timerEndsAt: Date.now() + 60_000
      });
      feedback.textContent = "";
      answerInput.value = "";
    } else {
      await update(roomRef, { status: "finished", timerEndsAt: 0 });
    }
  });

  // إرسال إجابة
  submitAnswerBtn.addEventListener("click", () => trySubmit());
  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") trySubmit();
  });

  async function trySubmit() {
    const ans = normalizeArabic(answerInput.value);
    answerInput.value = "";
    if (!ans) return;

    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.status !== "playing") return;

    const p = data.puzzles?.[data.currentIndex];
    if (!p) return;

    const ok = (p.a || []).some(x => normalizeArabic(x) === ans);
    if (ok) {
      toast(feedback, "إجابة صحيحة! أحسنت.", true);
      // +10 نقاط
      const myScoreRef = child(playersRef, `${myId}/score`);
      const s2 = await get(myScoreRef);
      const current = s2.exists() ? s2.val() : 0;
      await update(child(db, `rooms/${roomId}/players/${myId}`), { score: current + 10 });
      // الانتقال للسؤال التالي
      setTimeout(() => nextPuzzleBtn.click(), 600);
    } else {
      toast(feedback, "ليست الإجابة الصحيحة. جرّب مرة أخرى.", false);
    }
  }

  // مؤقت السؤال
  let timerInterval = null;
  function updateTimer(endTs) {
    if (timerInterval) clearInterval(timerInterval);
    const tick = () => {
      const left = Math.max(0, endTs - Date.now());
      const s = Math.ceil(left / 1000);
      timerValue.textContent = s + " ثانية";
      if (left <= 0) {
        clearInterval(timerInterval);
        timerValue.textContent = "انتهى الوقت";
      }
    };
    tick();
    timerInterval = setInterval(tick, 500);
  }

  function renderPlayers(players) {
    const entries = Object.entries(players);
    entries.sort((a, b) => (b[1].score||0) - (a[1].score||0));
    playersList.innerHTML = "";
    entries.forEach(([pid, info], idx) => {
      const li = document.createElement("li");
      if (pid === myId) li.classList.add("me");
      const left = document.createElement("div");
      left.textContent = info.name || "لاعب";
      const right = document.createElement("div");
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = (info.score || 0) + " نقطة";
      right.appendChild(badge);
      if (idx === 0 && entries.length > 1 && (info.score||0)>0) {
        const hostB = document.createElement("span");
        hostB.className = "badge host";
        hostB.textContent = "متصدر";
        right.appendChild(hostB);
      }
      li.appendChild(left);
      li.appendChild(right);
      playersList.appendChild(li);
    });
  }
}