// script.js (type="module")
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, remove,
  onDisconnect, serverTimestamp, child
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyBX5StSnJDYcm8T2Kh2rrN-rWyjDQ12H-k",
  authDomain: "codenames-58720.firebaseapp.com",
  projectId: "codenames-58720",
  storageBucket: "codenames-58720.firebasestorage.app",
  messagingSenderId: "213322653482",
  appId: "1:213322653482:web:3bc34d491320ee6a60c853",
  measurementId: "G-HMQ11RVCNH"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Helpers
const qs = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

function genRoomId() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "RED-";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function uid() {
  let u = localStorage.getItem("rs_uid");
  if (!u) {
    u = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    localStorage.setItem("rs_uid", u);
  }
  return u;
}

function toast(el, msg, ok = true) {
  el.textContent = msg;
  el.className = "feedback " + (ok ? "ok" : "no");
  setTimeout(() => { el.textContent = ""; el.className = "feedback"; }, 3000);
}

// Arabic Word Lists
const ARABIC_WORDS = [
  "مكتب", "قلم", "ورقة", "كتاب", "مدرسة", "طالب", "معلم", "فصل", "سبورة", "محفظة",
  "حاسوب", "شاشة", "لوحة", "فأرة", "طابعة", "إنترنت", "برنامج", "لعبة", "كرة", "ملعب",
  "حكم", "رياضة", "سباحة", "جري", "قفز", "تسلق", "موسيقى", "غناء", "عزف", "رقص",
  "فنان", "لوحة", "رسم", "تمثال", "متجر", "بائع", "زبون", "سلعة", "سعر", "شراء",
  "بيع", "سوق", "مال", "بنك", "عملة", "ذهب", "فضة", "مجوهرات", "ساعة", "خاتم",
  "حديقة", "زهرة", "شجرة", "وردة", "طبيعة", "جبل", "نهر", "بحر", "شاطئ", "رمال",
  "سماء", "نجمة", "قمر", "شمس", "سحاب", "مطر", "ثلج", "رياح", "عاصفة", "برق",
  "منزل", "غرفة", "باب", "نافذة", "سرير", "طاولة", "كرسي", "مطبخ", "ثلاجة", "فرن",
  "طعام", "شراب", "خبز", "لحم", "دجاج", "سمك", "أرز", "معكرونة", "فاكهة", "خضار"
];

// Game Logic & State
function generateBoard() {
  const shuffled = [...ARABIC_WORDS].sort(() => 0.5 - Math.random()).slice(0, 16);
  const board = [];
  
  const roles = [
    ...Array(6).fill('red'),
    ...Array(5).fill('blue'),
    ...Array(4).fill('bystander'),
    ...Array(1).fill('assassin')
  ].sort(() => 0.5 - Math.random());
  
  for (let i = 0; i < 16; i++) {
    board.push({
      word: shuffled[i],
      role: roles[i],
      revealed: false,
      index: i
    });
  }
  
  return board;
}

function getRemainingCounts(board, team) {
  return board.filter(card => card.role === team && !card.revealed).length;
}

// WebRTC Audio Connection
class AudioConnection {
  constructor(roomId, userId) {
    this.roomId = roomId;
    this.userId = userId;
    this.peers = {};
    this.localStream = null;
    this.isMuted = false;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  async init() {
    try {
      // Get microphone access
      this.localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      // Set up mute button
      const muteBtn = byId('muteBtn');
      const volumeSlider = byId('volumeSlider');
      
      muteBtn.addEventListener('click', () => this.toggleMute());
      volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
      
      // Set initial volume
      this.setVolume(volumeSlider.value);
      
      // Listen for new users joining
      const peersRef = ref(db, `rooms/${this.roomId}/peers`);
      onValue(peersRef, (snapshot) => {
        const peers = snapshot.val() || {};
        
        // Connect to new peers
        Object.keys(peers).forEach(peerId => {
          if (peerId !== this.userId && !this.peers[peerId]) {
            this.connectToPeer(peerId, peers[peerId]);
          }
        });
        
        // Remove disconnected peers
        Object.keys(this.peers).forEach(peerId => {
          if (!peers[peerId]) {
            this.disconnectPeer(peerId);
          }
        });
      });
      
      // Add myself to peers list
      await set(ref(db, `rooms/${this.roomId}/peers/${this.userId}`), {
        joined: Date.now()
      });
      
      // Remove myself on disconnect
      onDisconnect(ref(db, `rooms/${this.roomId}/peers/${this.userId}`)).remove();
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      alert('تعذر الوصول إلى الميكروفون. يرجى التحقق من الأذونات.');
    }
  }
  
  toggleMute() {
    this.isMuted = !this.isMuted;
    const muteBtn = byId('muteBtn');
    const icon = muteBtn.querySelector('i');
    
    if (this.isMuted) {
      icon.className = 'fas fa-microphone-slash';
      muteBtn.classList.add('muted');
      this.localStream.getAudioTracks().forEach(track => track.enabled = false);
    } else {
      icon.className = 'fas fa-microphone';
      muteBtn.classList.remove('muted');
      this.localStream.getAudioTracks().forEach(track => track.enabled = true);
    }
  }
  
  setVolume(volume) {
    Object.values(this.peers).forEach(peer => {
      if (peer.audio) {
        peer.audio.volume = volume;
      }
    });
  }
  
  async connectToPeer(peerId, peerInfo) {
    // Create peer connection
    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    // Add local stream
    this.localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, this.localStream);
    });
    
    // Create audio element for remote stream
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.volume = byId('volumeSlider').value;
    document.body.appendChild(audio);
    
    // Handle remote stream
    peerConnection.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };
    
    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Send offer to peer via Firebase
    const offerRef = ref(db, `rooms/${this.roomId}/offers/${this.userId}_${peerId}`);
    await set(offerRef, {
      from: this.userId,
      to: peerId,
      offer: offer
    });
    
    // Remove offer when done
    setTimeout(() => remove(offerRef), 5000);
    
    // Listen for answer
    const answerRef = ref(db, `rooms/${this.roomId}/answers/${peerId}_${this.userId}`);
    onValue(answerRef, async (snapshot) => {
      const answerData = snapshot.val();
      if (answerData && peerConnection.signalingState !== 'stable') {
        await peerConnection.setRemoteDescription(answerData.answer);
        remove(answerRef);
      }
    });
    
    // Listen for ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        set(ref(db, `rooms/${this.roomId}/iceCandidates/${this.userId}_${peerId}_${Date.now()}`), {
          from: this.userId,
          to: peerId,
          candidate: event.candidate
        });
      }
    };
    
    // Listen for remote ICE candidates
    const candidateRef = ref(db, `rooms/${this.roomId}/iceCandidates`);
    onValue(candidateRef, (snapshot) => {
      const candidates = snapshot.val() || {};
      Object.values(candidates).forEach(candidateData => {
        if (candidateData.to === this.userId && candidateData.from === peerId) {
          peerConnection.addIceCandidate(candidateData.candidate);
        }
      });
    });
    
    // Store peer connection
    this.peers[peerId] = { connection: peerConnection, audio };
  }
  
  async disconnectPeer(peerId) {
    if (this.peers[peerId]) {
      this.peers[peerId].connection.close();
      if (this.peers[peerId].audio) {
        this.peers[peerId].audio.remove();
      }
      delete this.peers[peerId];
    }
  }
  
  async cleanup() {
    // Close all peer connections
    Object.values(this.peers).forEach(peer => {
      peer.connection.close();
      if (peer.audio) peer.audio.remove();
    });
    
    // Remove myself from peers list
    await remove(ref(db, `rooms/${this.roomId}/peers/${this.userId}`));
    
    // Stop local stream
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
  }
}

// Index page logic
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

    const roomRef = ref(db, `rooms/${roomId}`);
    const me = uid();
    const board = generateBoard();
    const startingTeam = Math.random() > 0.5 ? 'red' : 'blue';

    await set(roomRef, {
      createdAt: Date.now(),
      host: me,
      status: "waiting",
      currentTeam: startingTeam,
      board: board,
      hints: [],
      players: {},
      remaining: {
        red: 6,
        blue: 5
      }
    });

    await set(child(roomRef, `players/${me}`), {
      name,
      team: startingTeam,
      isSpymaster: true,
      score: 0,
      joinedAt: serverTimestamp()
    });

    onDisconnect(child(roomRef, `players/${me}`)).remove();

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
    
    const roomData = snap.val();
    const me = uid();
    const roomRef = ref(db, `rooms/${rid}`);
    
    const players = roomData.players || {};
    const redCount = Object.values(players).filter(p => p.team === 'red').length;
    const blueCount = Object.values(players).filter(p => p.team === 'blue').length;
    const teamToJoin = redCount <= blueCount ? 'red' : 'blue';
    
    await set(child(roomRef, `players/${me}`), {
      name,
      team: teamToJoin,
      isSpymaster: false,
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

// Game page logic
if (document.body.dataset.page === "game") {
  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");
  const myName = params.get("name") || "لاعب";
  const myId = uid();

  const roomRef = ref(db, `rooms/${roomId}`);
  const playersRef = child(roomRef, "players");

  // UI Elements
  const roomIdLabel = byId("roomIdLabel");
  const copyRoomBtn = byId("copyRoomBtn");
  const playersList = byId("playersList");
  const hostControls = byId("hostControls");
  const startGameBtn = byId("startGameBtn");
  const restartGameBtn = byId("restartGameBtn");
  const boardContainer = byId("boardContainer");
  const teamTurnIndicator = byId("teamTurnIndicator");
  const redScore = byId("redScore");
  const blueScore = byId("blueScore");
  const hintForm = byId("hintForm");
  const hintInput = byId("hintInput");
  const hintCountInput = byId("hintCountInput");
  const submitHintBtn = byId("submitHintBtn");
  const currentHint = byId("currentHint");
  const toggleSpymasterBtn = byId("toggleSpymasterBtn");
  const muteBtn = byId("muteBtn");
  const volumeSlider = byId("volumeSlider");

  // Initialize audio connection
  let audioConnection = null;
  
  // Display room info
  roomIdLabel.textContent = roomId || "—";

  copyRoomBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(roomId);
    alert("تم نسخ رمز الغرفة.");
  });

  // Ensure player is registered
  (async () => {
    const snap = await get(child(playersRef, myId));
    if (!snap.exists()) {
      await set(child(playersRef, myId), {
        name: myName,
        team: 'red',
        isSpymaster: false,
        score: 0,
        joinedAt: serverTimestamp()
      });
      onDisconnect(child(playersRef, myId)).remove();
    }
    
    // Initialize audio connection after player is registered
    audioConnection = new AudioConnection(roomId, myId);
    await audioConnection.init();
  })();

  // Players listener
  onValue(playersRef, (s) => {
    const players = s.val() || {};
    renderPlayers(players);
  });

  // Game state listener
  onValue(roomRef, (s) => {
    const data = s.val();
    if (!data) return;
    
    const { host, status, currentTeam, board, hints, remaining } = data;
    const iAmHost = (host === myId);
    
    // Show host controls
    hostControls.classList.toggle("hidden", !iAmHost);
    
    // Update game state UI
    updateGameUI(data);
  });

  // Start game (host only)
  startGameBtn.addEventListener("click", async () => {
    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.host !== myId) return;
    
    await update(roomRef, {
      status: "playing",
      currentTeam: data.currentTeam || 'red'
    });
  });

  // Restart game (host only)
  restartGameBtn.addEventListener("click", async () => {
    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    if (data.host !== myId) return;
    
    const newBoard = generateBoard();
    const startingTeam = Math.random() > 0.5 ? 'red' : 'blue';
    
    await update(roomRef, {
      status: "waiting",
      board: newBoard,
      hints: [],
      currentTeam: startingTeam,
      remaining: {
        red: 6,
        blue: 5
      }
    });
    
    // Reset all players' spymaster status except host
    const players = data.players || {};
    const updates = {};
    
    for (const [playerId, player] of Object.entries(players)) {
      updates[`players/${playerId}/isSpymaster`] = (playerId === myId);
    }
    
    await update(roomRef, updates);
  });

  // Toggle spymaster view
  toggleSpymasterBtn.addEventListener("click", () => {
    boardContainer.classList.toggle("spymaster-view");
  });

  // Submit hint (spymaster only)
  submitHintBtn.addEventListener("click", async () => {
    const hint = (hintInput.value || "").trim();
    const count = parseInt(hintCountInput.value) || 0;
    
    if (!hint || count < 1) return;
    
    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    
    // Check if player is spymaster of current team
    const player = data.players[myId];
    if (!player || !player.isSpymaster || player.team !== data.currentTeam) {
      alert("只有当前队伍的队长才能提供提示！");
      return;
    }
    
    const newHint = {
      word: hint,
      count: count,
      team: data.currentTeam,
      timestamp: Date.now()
    };
    
    const hints = data.hints || [];
    hints.push(newHint);
    
    await update(roomRef, {
      hints: hints,
      status: "clue_given"
    });
    
    hintInput.value = "";
    hintCountInput.value = "";
  });

  // Render players list
  function renderPlayers(players) {
    const entries = Object.entries(players);
    playersList.innerHTML = "";
    
    entries.forEach(([pid, info]) => {
      const li = document.createElement("li");
      if (pid === myId) li.classList.add("me");
      
      const left = document.createElement("div");
      left.textContent = info.name || "لاعب";
      
      const right = document.createElement("div");
      const badge = document.createElement("span");
      badge.className = "badge";
      
      if (info.team === 'red') {
        badge.classList.add("red-team");
        badge.textContent = "أحمر";
      } else {
        badge.classList.add("blue-team");
        badge.textContent = "أزرق";
      }
      
      if (info.isSpymaster) {
        const spymasterBadge = document.createElement("span");
        spymasterBadge.className = "badge host";
        spymasterBadge.textContent = "قائد";
        right.appendChild(spymasterBadge);
      }
      
      right.appendChild(badge);
      li.appendChild(left);
      li.appendChild(right);
      playersList.appendChild(li);
    });
  }

  // Update game UI based on state
  function updateGameUI(data) {
    const { status, currentTeam, board, hints, remaining } = data;
    
    // Update scores
    redScore.textContent = remaining?.red || 0;
    blueScore.textContent = remaining?.blue || 0;
    
    // Update team turn indicator
    teamTurnIndicator.textContent = `دور: ${currentTeam === 'red' ? 'الفريق الأحمر' : 'الفريق الأزرق'}`;
    teamTurnIndicator.className = `team-turn ${currentTeam}`;
    
    // Render board
    renderBoard(board);
    
    // Show latest hint
    const latestHint = hints && hints.length > 0 ? hints[hints.length - 1] : null;
    if (latestHint) {
      currentHint.textContent = `تلميح: ${latestHint.word} (${latestHint.count})`;
    } else {
      currentHint.textContent = "لا توجد تلميحات بعد";
    }
    
    // Show appropriate UI based on game status
    if (status === "waiting") {
      startGameBtn.disabled = false;
      restartGameBtn.disabled = true;
      hintForm.classList.add("hidden");
    } else if (status === "playing" || status === "clue_given") {
      startGameBtn.disabled = true;
      restartGameBtn.disabled = false;
      
      // Show hint form only for spymaster of current team
      const player = data.players[myId];
      const isCurrentSpymaster = player && player.isSpymaster && player.team === currentTeam;
      hintForm.classList.toggle("hidden", !isCurrentSpymaster);
    }
  }

  // Render the code names board
  function renderBoard(board) {
    if (!board) return;
    
    boardContainer.innerHTML = "";
    
    board.forEach(card => {
      const cardEl = document.createElement("div");
      cardEl.className = `code-card ${card.revealed ? card.role : 'unknown'}`;
      cardEl.textContent = card.word;
      cardEl.dataset.index = card.index;
      
      if (!card.revealed) {
        cardEl.addEventListener("click", () => revealCard(card.index));
      }
      
      boardContainer.appendChild(cardEl);
    });
  }

  // Reveal a card
  async function revealCard(index) {
    const snap = await get(roomRef);
    if (!snap.exists()) return;
    const data = snap.val();
    
    // Check if game is in progress and it's player's turn
    if (data.status !== "clue_given") {
      alert("不是猜测时间或游戏未开始！");
      return;
    }
    
    const player = data.players[myId];
    if (!player || player.team !== data.currentTeam || player.isSpymaster) {
      alert("只有当前队伍的普通队员才能猜词！");
      return;
    }
    
    const board = data.board;
    const card = board[index];
    
    if (card.revealed) {
      alert("这张卡已经被揭示了！");
      return;
    }
    
    // Reveal the card
    board[index].revealed = true;
    
    const updates = {
      board: board
    };
    
    // Check card role and update game state accordingly
    if (card.role === 'assassin') {
      // Game over - current team loses
      updates.status = "finished";
      updates.winner = card.role === 'red' ? 'blue' : 'red';
      alert(card.role === 'red' ? "الفريق الأحمر خسر! الكلمة كانت قاتلة!" : "الفريق الأزرق خسر! الكلمة كانت قاتلة!");
    } else if (card.role === 'bystander' || card.role !== data.currentTeam) {
      // Turn ends
      updates.currentTeam = data.currentTeam === 'red' ? 'blue' : 'red';
      updates.status = "playing";
    } else {
      // Correct guess - update remaining count
      const remainingKey = card.role === 'red' ? 'red' : 'blue';
      updates.remaining = {
        ...data.remaining,
        [remainingKey]: data.remaining[remainingKey] - 1
      };
      
      // Check for win condition
      if (updates.remaining[remainingKey] === 0) {
        updates.status = "finished";
        updates.winner = remainingKey;
        alert(remainingKey === 'red' ? "الفريق الأحمر فاز!" : "الفريق الأزرق فاز!");
      }
    }
    
    await update(roomRef, updates);
  }
  
  // Clean up audio connection when leaving the page
  window.addEventListener('beforeunload', () => {
    if (audioConnection) {
      audioConnection.cleanup();
    }
  });
}
