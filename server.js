const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOM_CAPACITY = Math.max(2, Math.min(50, Number(process.env.ROOM_CAPACITY || 50)));
const MAX_ROOMS = 4;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const CHAT_COOLDOWN_MS = 5000;

const app = express();

// Phục vụ audio streaming tương thích Safari iOS, Android & Desktop
function serveAudio(filePath, contentType, res) {
  res.sendFile(path.join(__dirname, filePath), {
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

app.get('/audio/1.mp3', (req, res) => serveAudio('public/audio/1.mp3', 'audio/mpeg', res));
app.get('/audio/1.m4a', (req, res) => serveAudio('public/audio/1.m4a', 'audio/mp4', res));
app.get('/audio/1.mp4a', (req, res) => serveAudio('public/audio/1.m4a', 'audio/mp4', res));
app.get('/audio/2.mp3', (req, res) => serveAudio('public/audio/2.mp3', 'audio/mpeg', res));
app.get('/audio/2.m4a', (req, res) => serveAudio('public/audio/2.m4a', 'audio/mp4', res));

app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 2048 });

// === 40 TÊN NHÂN VẬT AFK THEO YÊU CẦU CHÍNH XÁC ===
const AFK_NAMES = [
  // Phòng 1: hang-01 (15 nhân vật)
  "Bố Ronaldo", "Mõm MU", "Quỷ Đỏ", "Đỏ Lòm", "Gáy Thuê",
  "Sút Ngu", "Chân Gỗ", "Gỗ Lim", "Tạ Tấn", "Mười Khó",
  "Hết Cứu", "Báo Thủ", "Phế Vật", "Cu Li", "Mõm To",
  // Phòng 2: hang-02 (12 nhân vật)
  "Đá Mướn", "Chúa Hề", "Thánh Lầy", "Gánh Team", "Bán Độ",
  "Nằm Sân", "Ngáo Đá", "Cò Đất", "Bún Chả", "Mì Tôm",
  "Cơm Nguội", "Nợ Lương",
  // Phòng 3: hang-03 (8 nhân vật)
  "Trả Góp", "Đá Mồm", "Chém Gió", "Chạy Show",
  "Thủ Môn", "Phản Lưới", "Tấu Hài", "Đầu Bò",
  // Phòng 4: hang-04 (5 nhân vật)
  "Gà Mờ", "Bố Đời", "Trùm Cuối", "Vua Báo", "Hết Pin"
];

// === 40 DANH HIỆU KHÁC NHAU CHO TỪNG NHÂN VẬT AFK ===
const AFK_TITLES = [
  // Phòng 1
  "Quỷ Đỏ kỳ cựu", "Fan MU 20 năm", "Trưởng thôn Hang MU", "Chiến thần gáy thuê", "Bình luận viên mõm",
  "Hộ pháp Old Trafford", "Fan ruột Sir Alex", "Thánh lạc quan", "Tín đồ Quỷ Đỏ", "Chuyên gia chui hang",
  "Chiến thần thức đêm", "Chúa tể niềm tin", "Người truyền lửa", "Fan ruột Ten Hag", "Quỷ Đỏ bất diệt",
  // Phòng 2
  "Đại sứ niềm tin", "Vua ăn mì tôm", "Fan MU chân chính", "Cổ động viên cứng", "Tay gáy chuyên nghiệp",
  "Giáo sư phân tích", "Thánh bắt pen", "Huyền thoại chém gió", "Quản lý hang MU", "Cây hài của hang",
  "Fan MU từ bé", "Quỷ Đỏ ngầm",
  // Phòng 3
  "Siêu fan nghị lực", "Chuyên gia xem đêm", "Thánh soi VAR", "Chiến thần cổ vũ",
  "Hội phó hang MU", "Fan MU trung kiên", "Người gác đền đỏ", "Thợ săn bàn thắng",
  // Phòng 4
  "Bậc thầy kiên nhẫn", "Tộc trưởng Quỷ Đỏ", "Bố già Hang MU", "Đấng cứu thế đỏ", "Fan cứng bất tử"
];

// Câu thoại fan MU phong phú, hài hước, phản ánh đúng trận đấu và văn hóa chui hang
const AFK_CHAT_QUOTES = [
  "Trận tới gặp Aston Villa 23:30 Chủ nhật phải thắng anh em ơi! 🔥",
  "Thắng Roma 3-2 hú vía, tim suýt nhảy ra ngoài 😅",
  "Ai có gói mì tôm Hảo Hảo nào không cho xin ăn đỡ đói 🍜",
  "Bruno trận trước đá cháy thật sự, đội trưởng gánh còng lưng!",
  "Matheus Cunha làm cú đúp đẳng cấp quá anh em ơi! ⚽",
  "Vào hang đông vui ấm cúng hẳn, quẩy lên nào Quỷ Đỏ! 🔴",
  "Mong chủ nhật này Rashford vào sân múa lửa ghi bàn!",
  "Đá thế này thì đối thủ sao mà đỡ được!",
  "Anh em nào rảnh cõng tao đi dạo quanh hang ngắm cờ với 🏃",
  "Thức 3 giờ sáng xem bóng đá xong nay đi làm mắt như gấu trúc luôn 🐼",
  "Niềm tin vào MU chưa bao giờ tắt, bão giông thì ta vào hang ❤️",
  "Dập đầu bái cờ MU lấy may cho trận Aston Villa nào anh em! 🚩",
  "Ai châm lại ngọn đuốc thiêng hộ với, gió hang lạnh quá 🕯️",
  "Hang MU hôm nay rộn ràng phết, anh em hô to lên nào!",
  "Chủ nhật 23:30 giờ đẹp uống bia xem MU quẩy là chuẩn bài 🍻",
  "Cứ ngỡ toang mà lội ngược dòng Roma đỉnh chóp!",
  "Gáy to lên anh em Quỷ Đỏ ơi, sợ gì ai! 🗣️",
  "Thắng thì cùng gáy, bại thì cùng chui hang anh em nhé!",
  "Tối chủ nhật này anh em nhớ điểm danh đúng 23:30 nhé!"
];

// 15 Vị trí xuất phát của bot AFK
const AFK_SPOTS = [
  { x: -3.2, z: -8.0, action: 'cheer' },
  { x:  3.2, z: -8.0, action: 'idle' },
  { x: -4.8, z: -4.0, action: 'sit' },
  { x:  4.8, z: -4.0, action: 'bow' },
  { x: -2.8, z:  1.5, action: 'idle' },
  { x:  2.8, z:  1.5, action: 'cheer' },
  { x: -3.6, z:  6.0, action: 'idle' },
  { x: -3.6, z:  6.0, action: 'carried' },
  { x:  3.6, z:  6.0, action: 'prostrate' },
  { x: -1.8, z: -14.5, action: 'cheer' },
  { x:  1.8, z: -14.5, action: 'bow' },
  { x: -1.6, z:  8.5, action: 'cheer' },
  { x:  1.6, z:  8.5, action: 'idle' },
  { x: -4.5, z: -11.5, action: 'prostrate' },
  { x:  4.5, z: -11.5, action: 'sit' }
];

// Danh sách 50 đĩa tròn ghế ngồi trong hang
const CAVE_SPOTS = [];
for (const side of ['l', 'r']) {
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      const s = side === 'l' ? -1 : 1;
      CAVE_SPOTS.push({
        id: `spot-${side}-${col}-${row}`,
        x: s * (6.7 + col * 1.45),
        z: -10 + row * 3.5
      });
    }
  }
}

const rooms = new Map();
const clients = new Map();
const playerStats = new Map();
const cheerWindows = new Map();
let hangMode = 'gloomy';

const MOODS = {
  normal: { title: 'HANG ĐANG YÊN ẮNG', text: 'MU đang trong tình trạng khá tồi tệ… nhưng anh em vẫn còn đây.', icon: '🕯️' },
  gloomy: { title: 'MU ĐANG TRONG TÌNH TRẠNG KHÁ TỒI TỆ', text: 'Xin giữ bình tĩnh. Ban quản lý hang chưa có phát ngôn.', icon: '🥀' },
  crisis: { title: 'KHỦNG HOẢNG TINH THẦN', text: 'Đề nghị các thành viên không nhìn thẳng vào bảng tin.', icon: '🚨' },
  despair: { title: 'TUYỆT VỌNG TOÀN TẬP', text: 'Chỉ còn ánh lửa và tình đồng đội.', icon: '🫠' }
};

const serverStartTime = Date.now();

// Cấu hình phân bổ 40 nhân vật AFK hoàn toàn phía server qua 4 phòng:
// Phòng 1 (Hang chính): 15 AFK
// Phòng 2 (Hang sôi động): 12 AFK
// Phòng 3 (Hang vừa): 8 AFK
// Phòng 4 (Hang tĩnh tâm): 5 AFK
const ROOM_AFK_CONFIG = [
  { id: 'hang-01', count: 15 },
  { id: 'hang-02', count: 12 },
  { id: 'hang-03', count: 8 },
  { id: 'hang-04', count: 5 }
];

let globalNameIndex = 0;
for (const cfg of ROOM_AFK_CONFIG) {
  const roomId = cfg.id;
  const afkCount = cfg.count;
  const room = {
    players: new Map(), // Người chơi thật có WebSocket
    afks: new Map(),    // AFK NPC phía server của phòng
    afkList: [],        // Thứ tự danh sách AFK
    nextAfkChatAt: serverStartTime + 10000 + Math.floor(Math.random() * 20000),
    nextNpcCarryRequestAt: serverStartTime + 20000 + Math.floor(Math.random() * 25000)
  };

  const personalities = ['wanderer', 'cheerer', 'sitter', 'social'];

  for (let j = 0; j < afkCount; j++) {
    const idx = globalNameIndex++;
    const name = AFK_NAMES[idx];
    const title = AFK_TITLES[idx] || "Quỷ Đỏ trung kiên";
    const spot = AFK_SPOTS[j];
    const id = `afk-${roomId}-${j}`;
    const bot = {
      id,
      name,
      title,
      jerseyNumber: 11 + j,
      personality: personalities[j % personalities.length],
      x: spot.x,
      z: spot.z,
      homeX: spot.x,
      homeZ: spot.z,
      action: spot.action,
      spotId: null,
      carryingId: null,
      carriedBy: null,
      carryAutoDropAt: 0,
      isAfk: true,
      joinedAt: serverStartTime,
      strongFanAt: 60000,
      nextActionAt: serverStartTime + 3000 + j * 1500
    };
    room.afks.set(id, bot);
    room.afkList.push(bot);
  }

  // Khởi tạo cặp cõng nhau giữa bot 6 và bot 7 tạo không khí (phòng >= 8 bot)
  if (afkCount >= 8) {
    const b6 = room.afks.get(`afk-${roomId}-6`);
    const b7 = room.afks.get(`afk-${roomId}-7`);
    if (b6 && b7) {
      b6.carryingId = b7.id;
      b7.carriedBy = b6.id;
    }
  }

  rooms.set(roomId, room);
}

const bannedTerms = ['dit', 'du', 'deo', 'lon', 'cac', 'buoi', 'dmm', 'vcl', 'fuck', 'shit', 'bitch'];

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function normalizeName(v) {
  return String(v || '').normalize('NFC').replace(/[<>\\{}\[\]$%`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
}

function inappropriateName(name) {
  const n = name.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  return bannedTerms.some(w => n.split(/[^a-z0-9]+/).includes(w));
}

// Lấy danh sách các đĩa tròn đang có người hoặc bot ngồi
function getOccupiedSpotIds(room) {
  const occ = new Set();
  for (const p of room.players.values()) {
    if (p.spotId) occ.add(p.spotId);
  }
  for (const b of room.afks.values()) {
    if (b.spotId) occ.add(b.spotId);
  }
  return occ;
}

// Lấy danh sách AFK đang hoạt động (khi phòng tầm 30 người, mỗi người vào thì 1 AFK nhường chỗ)
function getActiveAfks(room) {
  const realCount = room.players.size;
  const maxAfk = room.afkList.length;
  const targetCount = realCount >= 30 ? Math.max(0, maxAfk - (realCount - 30)) : maxAfk;
  return room.afkList.slice(0, targetCount);
}

// Số lượng người chơi hiển thị trên danh sách phòng (gồm người thật + AFK để sảnh luôn đông vui, đẹp mắt)
function roomSnapshot() {
  return [...rooms.entries()].map(([id, r]) => ({
    id,
    count: r.players.size + getActiveAfks(r).length,
    realCount: r.players.size,
    capacity: ROOM_CAPACITY
  }));
}

function broadcastRoomList() {
  const d = { type: 'room-list', rooms: roomSnapshot() };
  for (const ws of wss.clients) send(ws, d);
}

function broadcast(roomId, data, except) {
  const r = rooms.get(roomId);
  if (!r) return;
  for (const [id, p] of r.players) {
    if (id !== except) send(p.ws, data);
  }
}

function fanTitle(p, now = Date.now()) {
  const elapsed = now - p.joinedAt;
  if (elapsed >= p.strongFanAt) return 'Fan nghị lực';
  if (elapsed >= 90000) return 'Fan MU';
  return 'Fan nửa mùa';
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    jerseyNumber: p.jerseyNumber,
    x: p.x,
    z: p.z,
    action: p.action,
    spotId: p.spotId || null,
    carryingId: p.carryingId || null,
    carriedBy: p.carriedBy || null,
    title: p.title || (p.isAfk ? 'Fan cứng' : fanTitle(p)),
    joinedAt: p.joinedAt,
    strongFanAt: p.strongFanAt,
    isAfk: !!p.isAfk
  };
}

function endCarry(roomId, p) {
  const room = rooms.get(roomId);
  if (!room || !p) return;
  const carrierId = p.carryingId ? p.id : (p.carriedBy || null);
  const passengerId = p.carryingId || (p.carriedBy ? p.id : null);
  if (!carrierId || !passengerId) return;

  const carrier = room.players.get(carrierId) || room.afks?.get(carrierId);
  const passenger = room.players.get(passengerId) || room.afks?.get(passengerId);

  if (carrier) {
    carrier.carryingId = null;
    carrier.action = 'idle';
    carrier.spotId = null;
  }
  if (passenger) {
    passenger.carriedBy = null;
    passenger.action = 'idle';
    passenger.spotId = null;
    passenger.carryAutoDropAt = 0;
    if (carrier) {
      passenger.x = Math.max(-12, Math.min(12, carrier.x + 0.8));
      passenger.z = Math.max(-16, Math.min(8, carrier.z));
    }
  }

  broadcast(roomId, { type: 'carry-ended', carrierId, passengerId });
  if (carrier) broadcast(roomId, { type: 'player-updated', player: publicPlayer(carrier) });
  if (passenger) broadcast(roomId, { type: 'player-updated', player: publicPlayer(passenger) });
}

function roomIdForJoin(requested) {
  if (requested) {
    const r = rooms.get(String(requested));
    return r && r.players.size < ROOM_CAPACITY ? String(requested) : null;
  }
  for (const [id, r] of rooms) {
    if (r.players.size < ROOM_CAPACITY) return id;
  }
  return null;
}

function removePlayer(ws, reason = 'disconnect') {
  const s = clients.get(ws);
  if (!s) return;
  const r = rooms.get(s.roomId);
  if (r) {
    const p = r.players.get(s.id);
    if (p && (p.carryingId || p.carriedBy)) endCarry(s.roomId, p);
    if (p?.pendingInteraction) {
      const other = r.players.get(p.pendingInteraction.targetId || p.pendingInteraction.fromId);
      if (other) other.pendingInteraction = null;
    }
    if (p?.pendingCarryFrom) {
      const other = r.players.get(p.pendingCarryFrom.id);
      if (other) other.pendingCarryFrom = null;
    }

    const prevReal = r.players.size;
    r.players.delete(s.id);
    broadcast(s.roomId, { type: 'player-left', id: s.id, reason, isAfk: false });

    // Khi người chơi thật giảm xuống, AFK quay trở lại phòng
    if (prevReal > 30) {
      const maxAfk = r.afkList.length;
      const prevAfkCount = Math.max(0, maxAfk - (prevReal - 30));
      const newAfkCount = Math.max(0, maxAfk - ((prevReal - 1) - 30));
      if (newAfkCount > prevAfkCount && r.afkList[prevAfkCount]) {
        const returningAfk = r.afkList[prevAfkCount];
        broadcast(s.roomId, { type: 'player-joined', player: publicPlayer(returningAfk) });
      }
    }
  }
  clients.delete(ws);
  broadcastRoomList();
}

function closeFor(ws, code, reason) {
  send(ws, { type: 'force-reload', message: reason });
  setTimeout(() => {
    try { ws.close(code, reason); } catch {}
  }, 80);
}

wss.on('connection', ws => {
  send(ws, { type: 'room-list', rooms: roomSnapshot() });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const state = clients.get(ws);

    if (m.type === 'join') {
      if (state) { send(ws, { type: 'join-error', message: 'Bạn đã ở trong hang rồi.' }); return; }
      if (m.approved !== true) { send(ws, { type: 'join-error', message: 'Bạn cần đồng ý nghi thức nhập hang trước.' }); return; }

      const name = normalizeName(m.name);
      if (!name || inappropriateName(name)) { send(ws, { type: 'join-error', message: 'Tên không hợp lệ hoặc chứa từ ngữ không phù hợp.' }); return; }

      const requestedRoom = String(m.roomId || '');
      if (!/^hang-0[1-4]$/.test(requestedRoom)) { send(ws, { type: 'join-error', message: 'Bạn hãy chọn một phòng trước khi vào hang.' }); return; }

      const roomId = roomIdForJoin(requestedRoom);
      if (!roomId) { send(ws, { type: 'join-error', message: `Phòng ${requestedRoom.toUpperCase()} đã đầy hoặc không tồn tại. Hãy chọn phòng khác.` }); broadcastRoomList(); return; }

      const id = crypto.randomUUID();
      const room = rooms.get(roomId);
      const joinedAt = Date.now();

      // Phân chia số áo cho người chơi thật (tránh trùng số giữa người chơi thật)
      const usedNumbers = new Set([...room.players.values()].map(q => Number(q.jerseyNumber)));
      let jerseyNumber = 0;
      for (let n = 1; n <= ROOM_CAPACITY; n++) {
        if (!usedNumbers.has(n)) { jerseyNumber = n; break; }
      }
      if (!jerseyNumber) { send(ws, { type: 'join-error', message: 'Phòng đã đủ 50 số áo. Hãy chọn phòng khác.' }); return; }

      const statKey = name.toLocaleLowerCase('vi');
      const stats = playerStats.get(statKey) || { name, jerseyNumber, visits: 0, rituals: 0, cheers: 0 };
      stats.name = name;
      stats.jerseyNumber = jerseyNumber;
      stats.visits++;
      playerStats.set(statKey, stats);

      const p = {
        id,
        name,
        jerseyNumber,
        x: 0,
        z: 10,
        action: 'walk',
        ws,
        joinedAt,
        strongFanAt: 270000 + Math.floor(Math.random() * 90001),
        lastActivity: joinedAt,
        presencePromptAt: 0,
        lastChat: 0,
        ritualUntil: Date.now() + 7500,
        ritualCounted: false,
        isAfk: false
      };

      const prevReal = room.players.size;
      room.players.set(id, p);
      clients.set(ws, { id, name, roomId });

      // Nếu số người thật >= 30, mỗi người vào thêm làm 1 AFK nhường chỗ
      if (prevReal >= 30) {
        const maxAfk = room.afkList.length;
        const prevAfkCount = Math.max(0, maxAfk - (prevReal - 30));
        const newAfkCount = Math.max(0, maxAfk - ((prevReal + 1) - 30));
        if (newAfkCount < prevAfkCount && room.afkList[newAfkCount]) {
          const yieldingAfk = room.afkList[newAfkCount];
          broadcast(roomId, { type: 'player-left', id: yieldingAfk.id, isAfk: true, reason: 'afk-room-yield' });
        }
      }

      // Danh sách đầy đủ gồm người chơi thật + các AFK đang hoạt động trong phòng
      const activeAfks = getActiveAfks(room);
      const allEntities = [...room.players.values(), ...activeAfks].map(publicPlayer);

      send(ws, {
        type: 'joined',
        id,
        roomId,
        capacity: ROOM_CAPACITY,
        ritualMs: 5000,
        hangMode,
        mood: MOODS[hangMode],
        players: allEntities,
        totalCount: allEntities.length,
        onlineCount: allEntities.length,
        realCount: room.players.size
      });

      broadcast(roomId, { type: 'player-joined', player: publicPlayer(p) }, id);
      broadcastRoomList();

      // NPC tự động chào mừng người chơi mới vào hang sau 2.5 giây
      setTimeout(() => {
        const currentActive = getActiveAfks(room);
        if (currentActive.length > 0 && room.players.has(id)) {
          const greeter = currentActive[Math.floor(Math.random() * currentActive.length)];
          const greetings = [
            `Chào mừng ${name} (#${jerseyNumber}) vào Hang Quỷ Đỏ! 🔴`,
            `Ê bro ${name}, vào hang ngồi cho ấm cúng nhé! 🔥`,
            `Chào mừng người anh em ${name}! Cùng quẩy chờ Chủ nhật này nào! 🍻`,
            `Hello ${name}, hôm nay hang đông vui lắm bro ơi!`
          ];
          const text = greetings[Math.floor(Math.random() * greetings.length)];
          broadcast(roomId, { type: 'chat', id: greeter.id, name: greeter.name, jerseyNumber: greeter.jerseyNumber, text, at: Date.now() });
        }
      }, 2500);

      return;
    }

    if (!state) return;
    const room = rooms.get(state.roomId);
    const p = room?.players.get(state.id);
    if (!p) return;

    if (m.type === 'set-hang-mode') {
      const mode = Object.hasOwn(MOODS, String(m.mode)) ? String(m.mode) : 'gloomy';
      hangMode = mode;
      for (const id of rooms.keys()) broadcast(id, { type: 'hang-mode', mode, mood: MOODS[mode], by: p.name });
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      return;
    }

    if (m.type === 'heartbeat') {
      send(ws, { type: 'heartbeat-ack', at: Date.now() });
      return;
    }

    if (m.type === 'still-here') {
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      send(ws, { type: 'still-here-ack' });
      return;
    }

    if (m.type === 'activity') {
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      return;
    }

    if (m.type === 'inactive') {
      removePlayer(ws, 'inactive');
      closeFor(ws, 4001, 'inactive');
      return;
    }

    if (m.type === 'chat') {
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      const now = Date.now();
      const text = String(m.text || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
      if (!text) return;
      if (now - p.lastChat < CHAT_COOLDOWN_MS) {
        send(ws, { type: 'chat-error', message: `Chờ ${Math.ceil((CHAT_COOLDOWN_MS - (now - p.lastChat)) / 1000)} giây nữa rồi hãy gửi tin tiếp nhé.` });
        return;
      }
      p.lastChat = now;
      broadcast(state.roomId, { type: 'chat', id: p.id, name: p.name, jerseyNumber: p.jerseyNumber, text, at: now });
      return;
    }

    if (Date.now() < p.ritualUntil && ['move', 'action'].includes(m.type)) {
      send(ws, { type: 'ritual-locked', remaining: Math.max(0, p.ritualUntil - Date.now()) });
      return;
    }

    if (m.type === 'ritual-progress') {
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      if (m.action === 'prostrate' && !p.ritualCounted) {
        p.ritualCounted = true;
        const st = playerStats.get(p.name.toLocaleLowerCase('vi'));
        if (st) st.rituals++;
      }
      p.x = Math.max(-13, Math.min(13, Number(m.x) || 0));
      p.z = Math.max(-9, Math.min(13, Number(m.z) || 0));
      p.action = m.action === 'prostrate' ? 'prostrate' : 'walk';
      broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) }, state.id);
      return;
    }

    // Xử lý khi người chơi yêu cầu cõng
    if (m.type === 'carry-request') {
      if (Date.now() < p.ritualUntil) {
        send(ws, { type: 'carry-error', message: 'Hoàn tất nghi thức nhập hang rồi hãy mời cõng nhé.' });
        return;
      }
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      const targetId = String(m.targetId || '');
      const target = room.players.get(targetId) || room.afks.get(targetId);
      if (!target || target.id === p.id) {
        send(ws, { type: 'carry-error', message: 'Không tìm thấy người chơi đó.' });
        return;
      }
      if (p.carryingId || p.carriedBy) {
        send(ws, { type: 'carry-error', message: 'Bạn đang tham gia cõng người khác rồi.' });
        return;
      }
      if (Math.hypot(p.x - target.x, p.z - target.z) > 4.5) {
        send(ws, { type: 'carry-error', message: `Hãy đến gần ${target.name} hơn rồi mời cõng nhé.` });
        return;
      }

      // NẾU LÀ AFK BOT: Tự động đồng ý cõng luôn!
      if (target.isAfk) {
        if (target.carryingId || target.carriedBy) {
          endCarry(state.roomId, target);
        }
        p.carryingId = target.id;
        target.carriedBy = p.id;
        target.carryStyle = m.style === 'bridal' ? 'bridal' : 'piggyback';
        p.action = 'idle';
        target.action = 'carried';
        p.spotId = null;
        target.spotId = null;
        p.lastActivity = Date.now();
        // Cõng trong 5 - 10 giây sẽ tự động tụt xuống
        target.carryAutoDropAt = Date.now() + (5000 + Math.floor(Math.random() * 5000));

        broadcast(state.roomId, { type: 'carry-started', style: target.carryStyle, carrierId: p.id, passengerId: target.id });
        broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) });
        broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(target) });

        const carryReplies = [
          `Được ${p.name} cõng thích quá, quẩy banh nóc hang nào! 🚀`,
          `Lên lưng ${p.name} đi ngắm cờ MU thôi anh em ơi! 🔥`,
          `Ok cõng tao đi dạo quanh hang ngắm đốm lửa thiêng nào ${p.name}! 🕯️`,
          `Cõng cẩn thận nha ${p.name}, tui hơi nặng đấy 😂`
        ];
        const reply = carryReplies[Math.floor(Math.random() * carryReplies.length)];
        broadcast(state.roomId, { type: 'chat', id: target.id, name: target.name, jerseyNumber: target.jerseyNumber, text: reply, at: Date.now() });
        return;
      }

      if (target.carryingId || target.carriedBy) {
        send(ws, { type: 'carry-error', message: 'Người đó đang tham gia cõng rồi.' });
        return;
      }
      target.pendingCarryFrom = { id: p.id, at: Date.now(), style: m.style === 'bridal' ? 'bridal' : 'piggyback' };
      send(target.ws, { type: 'carry-invite', style: target.pendingCarryFrom.style, from: { id: p.id, name: p.name, jerseyNumber: p.jerseyNumber } });
      send(ws, { type: 'carry-pending', targetName: target.name });
      return;
    }

    if (m.type === 'carry-response') {
      if (Date.now() < p.ritualUntil) {
        send(ws, { type: 'carry-error', message: 'Hoàn tất nghi thức nhập hang rồi hãy nhận lời cõng nhé.' });
        return;
      }
      const fromId = String(m.fromId || '');
      const pending = p.pendingCarryFrom;

      // Nếu là NPC mời người chơi cõng nó
      if (pending && pending.isNpc) {
        const npc = room.afks.get(fromId);
        p.pendingCarryFrom = null;
        if (!npc || Date.now() - pending.at > 15000) {
          send(ws, { type: 'carry-error', message: 'Lời mời cõng đã hết hạn.' });
          return;
        }
        if (m.accept !== true) {
          broadcast(state.roomId, { type: 'chat', id: npc.id, name: npc.name, jerseyNumber: npc.jerseyNumber, text: `Haha không sao bro, để tui tự đi bộ ngắm cờ vậy!`, at: Date.now() });
          return;
        }
        if (p.carryingId || p.carriedBy || npc.carryingId || npc.carriedBy) {
          send(ws, { type: 'carry-error', message: 'Không thể bắt đầu cõng lúc này.' });
          return;
        }
        p.carryingId = npc.id;
        npc.carriedBy = p.id;
        p.action = 'idle';
        npc.action = 'carried';
        p.spotId = null;
        npc.spotId = null;
        // Tự động nhảy xuống sau 5 - 10 giây
        npc.carryAutoDropAt = Date.now() + (5000 + Math.floor(Math.random() * 5000));
        p.lastActivity = Date.now();

        broadcast(state.roomId, { type: 'carry-started', style: 'piggyback', carrierId: p.id, passengerId: npc.id });
        broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) });
        broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(npc) });
        broadcast(state.roomId, { type: 'chat', id: npc.id, name: npc.name, jerseyNumber: npc.jerseyNumber, text: `Cảm ơn bro ${p.name} nhé, lên lưng quẩy thôi nào! 🚀`, at: Date.now() });
        return;
      }

      const from = room.players.get(fromId);
      if (!from || Date.now() < from.ritualUntil || !pending || pending.id !== fromId || Date.now() - pending.at > 15000) {
        p.pendingCarryFrom = null;
        send(ws, { type: 'carry-error', message: 'Lời mời cõng đã hết hạn.' });
        return;
      }
      p.pendingCarryFrom = null;
      if (m.accept !== true) {
        send(from.ws, { type: 'carry-declined', targetName: p.name });
        return;
      }
      if (p.carryingId || p.carriedBy || from.carryingId || from.carriedBy || Math.hypot(p.x - from.x, p.z - from.z) > 3.5) {
        send(ws, { type: 'carry-error', message: 'Không thể bắt đầu cõng; hãy đứng gần nhau và thử lại.' });
        send(from.ws, { type: 'carry-error', message: 'Không thể bắt đầu cõng; hãy đứng gần nhau và thử lại.' });
        return;
      }
      from.carryingId = p.id;
      p.carriedBy = from.id;
      from.action = 'idle';
      p.action = 'carried';
      from.spotId = null;
      p.spotId = null;
      from.lastActivity = Date.now();
      p.lastActivity = Date.now();
      broadcast(state.roomId, { type: 'carry-started', style: pending.style || 'piggyback', carrierId: from.id, passengerId: p.id });
      broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(from) });
      broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) });
      return;
    }

    if (m.type === 'interaction-request') {
      const target = room.players.get(String(m.targetId || '')) || room.afks.get(String(m.targetId || ''));
      const kind = String(m.kind || '');
      if (!['highfive', 'handshake', 'push'].includes(kind) || !target || target.id === p.id) {
        send(ws, { type: 'interaction-error', message: 'Không thể gửi lời mời tương tác.' });
        return;
      }
      if (p.carryingId || p.carriedBy) {
        send(ws, { type: 'interaction-error', message: 'Bạn đang bận cõng rồi.' });
        return;
      }
      if (Date.now() < p.ritualUntil || Math.hypot(p.x - target.x, p.z - target.z) > 4.5) {
        send(ws, { type: 'interaction-error', message: 'Hai người cần đứng gần nhau và hoàn tất nghi thức nhập hang.' });
        return;
      }

      // NẾU LÀ AFK BOT: Tương tác ngay!
      if (target.isAfk) {
        const duration = kind === 'push' ? 650 : kind === 'handshake' ? 1800 : 1300;
        p.lastActivity = Date.now();
        broadcast(state.roomId, { type: 'interaction-started', kind, playerA: p.id, playerB: target.id, duration });
        if (kind === 'push') {
          const dx = target.x - p.x, dz = target.z - p.z, len = Math.max(.01, Math.hypot(dx, dz));
          target.x = Math.max(-13, Math.min(13, target.x + dx / len * 1.15));
          target.z = Math.max(-9, Math.min(13, target.z + dz / len * 1.15));
          broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(target) });
        }
        return;
      }

      if (target.carryingId || target.carriedBy || p.pendingInteraction || target.pendingInteraction) {
        send(ws, { type: 'interaction-error', message: 'Một trong hai người đang bận tương tác.' });
        return;
      }
      if (Date.now() < target.ritualUntil) {
        send(ws, { type: 'interaction-error', message: 'Người chơi chưa hoàn tất nghi thức nhập hang.' });
        return;
      }
      const inviteId = crypto.randomUUID();
      p.pendingInteraction = { id: inviteId, targetId: target.id, kind, at: Date.now() };
      target.pendingInteraction = { id: inviteId, fromId: p.id, kind, at: Date.now() };
      send(target.ws, { type: 'interaction-invite', inviteId, kind, from: { id: p.id, name: p.name, jerseyNumber: p.jerseyNumber } });
      send(ws, { type: 'interaction-pending', targetName: target.name });
      return;
    }

    if (m.type === 'interaction-response') {
      const inviteId = String(m.inviteId || '');
      const fromId = String(m.fromId || '');
      const from = room.players.get(fromId);
      const pending = p.pendingInteraction;
      if (!from || !pending || pending.id !== inviteId || pending.fromId !== fromId || Date.now() - pending.at > 15000) {
        p.pendingInteraction = null;
        send(ws, { type: 'interaction-error', message: 'Lời mời đã hết hạn.' });
        return;
      }
      const kind = pending.kind;
      p.pendingInteraction = null;
      from.pendingInteraction = null;
      if (m.accept !== true) {
        send(from.ws, { type: 'interaction-declined', targetName: p.name });
        return;
      }
      if (Math.hypot(p.x - from.x, p.z - from.z) > 4) {
        send(ws, { type: 'interaction-error', message: 'Hai người đã đứng quá xa nhau.' });
        send(from.ws, { type: 'interaction-error', message: 'Hai người đã đứng quá xa nhau.' });
        return;
      }
      const duration = kind === 'push' ? 650 : kind === 'handshake' ? 1800 : 1300;
      p.lastInteractionAt = Date.now();
      from.lastInteractionAt = Date.now();
      broadcast(state.roomId, { type: 'interaction-started', kind, playerA: from.id, playerB: p.id, duration });
      if (kind === 'push') {
        const dx = p.x - from.x, dz = p.z - from.z, len = Math.max(.01, Math.hypot(dx, dz));
        p.x = Math.max(-13, Math.min(13, p.x + dx / len * 1.15));
        p.z = Math.max(-9, Math.min(13, p.z + dz / len * 1.15));
        setTimeout(() => {
          if (room.players.has(p.id)) broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) });
        }, 180);
      }
      return;
    }

    if (m.type === 'carry-stop') {
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      if (p.carryingId || p.carriedBy) endCarry(state.roomId, p);
      return;
    }

    if (m.type === 'spot') {
      if (p.carriedBy) { send(ws, { type: 'carry-error', message: 'Bạn đang được cõng, hãy chờ được thả xuống nhé.' }); return; }
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      const spotId = String(m.spotId || '');
      if (!/^spot-[a-z0-9-]{1,24}$/.test(spotId)) return;

      // Kiểm tra người chơi thật khác đã ngồi chưa
      for (const other of room.players.values()) {
        if (other.id !== p.id && other.spotId === spotId) {
          send(ws, { type: 'spot-error', message: 'Vị trí tròn này đã có Quỷ Đỏ đứng rồi, bạn chọn chỗ khác nhé!' });
          return;
        }
      }

      // Nếu có NPC đang ngồi ở đây, NPC lịch sự nhường chỗ cho người thật!
      for (const bot of room.afks.values()) {
        if (bot.spotId === spotId) {
          bot.spotId = null;
          bot.action = 'walk';
          bot.x = Math.max(-10, Math.min(10, bot.x + (bot.x > 0 ? -1.5 : 1.5)));
          broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(bot) });
          break;
        }
      }

      const parts = spotId.split('-');
      const side = parts[1] === 'l' ? -1 : 1, col = Number(parts[2]), row = Number(parts[3]);
      if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col > 4 || row < 0 || row > 4) return;
      p.spotId = spotId;
      p.x = side * (6.7 + col * 1.45);
      p.z = -10 + row * 3.5;
      p.action = 'cheer';
      const cheerStat = playerStats.get(p.name.toLocaleLowerCase('vi'));
      if (cheerStat) cheerStat.cheers++;
      const cheerNow = Date.now();
      const recentCheers = (cheerWindows.get(state.roomId) || []).filter(x => cheerNow - x.at < 3500 && x.id !== p.id);
      recentCheers.push({ id: p.id, at: cheerNow });
      cheerWindows.set(state.roomId, recentCheers);
      if (recentCheers.length >= 3) {
        broadcast(state.roomId, { type: 'collective-cheer' });
        cheerWindows.set(state.roomId, []);
      }
      broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) });
      return;
    }

    if (m.type === 'move' || m.type === 'action') {
      if (p.carriedBy) { send(ws, { type: 'carry-error', message: 'Bạn đang được cõng, chưa thể tự di chuyển.' }); return; }
      p.lastActivity = Date.now();
      p.presencePromptAt = 0;
      if (m.type === 'action' && m.action === 'cheer') {
        const st = playerStats.get(p.name.toLocaleLowerCase('vi'));
        if (st) st.cheers++;
        const now = Date.now();
        const recent = (cheerWindows.get(state.roomId) || []).filter(x => now - x.at < 3500 && x.id !== p.id);
        recent.push({ id: p.id, at: now });
        cheerWindows.set(state.roomId, recent);
        if (recent.length >= 3) {
          broadcast(state.roomId, { type: 'collective-cheer' });
          cheerWindows.set(state.roomId, []);
        }
      }
      if (m.type === 'move') {
        const nx = Math.max(-13, Math.min(13, Number(m.x) || 0));
        const nz = Math.max(-9, Math.min(13, Number(m.z) || 0));
        if (Math.abs(nx - p.x) > .03 || Math.abs(nz - p.z) > .03) p.spotId = null;
        p.x = nx;
        p.z = nz;
      }
      if (m.type === 'action' && m.action !== 'sit') p.spotId = null;
      p.action = ['idle', 'walk', 'cheer', 'bow', 'prostrate', 'sit', 'jump'].includes(m.action) ? m.action : 'idle';
      broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) }, state.id);
    }
  });

  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

// Vòng lặp định kỳ: Quản lý NPC Autonomous, Di chuyển, Điểm đĩa tròn, Xin cõng (5-10s) và Chat
setInterval(() => {
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    if (room.players.size === 0) continue; // Chỉ chạy khi có người thật trong phòng
    const activeAfks = getActiveAfks(room);
    if (!activeAfks.length) continue;

    // 1. Tự động thả NPC xuống nếu đã được người chơi cõng đủ 5 - 10 giây
    for (const bot of activeAfks) {
      if (bot.carriedBy && bot.carryAutoDropAt && now >= bot.carryAutoDropAt) {
        const carrier = room.players.get(bot.carriedBy);
        endCarry(roomId, carrier || bot);
        bot.carryAutoDropAt = 0;
        bot.x = carrier ? carrier.x + 0.9 : bot.x;
        bot.z = carrier ? carrier.z : bot.z;
        bot.action = 'bow';
        broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        broadcast(roomId, {
          type: 'chat',
          id: bot.id,
          name: bot.name,
          jerseyNumber: bot.jerseyNumber,
          text: `Xuống đây rồi, cảm ơn bro ${carrier ? carrier.name : ''} đã cõng nhé! Mát mẻ đỡ mỏi chân hẳn 😄`,
          at: now
        });
      }
    }

    // 2. NPC chủ động tiếp cận người chơi thật và xin cõng (mỗi 50 - 85 giây một lần)
    if (now >= (room.nextNpcCarryRequestAt || 0)) {
      room.nextNpcCarryRequestAt = now + 50000 + Math.floor(Math.random() * 35000);
      const freePlayers = [...room.players.values()].filter(p => !p.carryingId && !p.carriedBy && now >= p.ritualUntil && (now - (p.lastNpcCarryPromptAt || 0) > 60000));
      const freeBots = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.spotId);

      if (freePlayers.length > 0 && freeBots.length > 0) {
        const targetPlayer = freePlayers[Math.floor(Math.random() * freePlayers.length)];
        const promptBot = freeBots[Math.floor(Math.random() * freeBots.length)];

        // Bot tiến lại gần người chơi
        promptBot.x = targetPlayer.x + (Math.random() < 0.5 ? 1.0 : -1.0);
        promptBot.z = targetPlayer.z + 0.3;
        promptBot.action = 'walk';
        broadcast(roomId, { type: 'player-updated', player: publicPlayer(promptBot) });

        const carryRequests = [
          "Bro cõng tôi một đoạn 5-10 giây được không? Mỏi chân quá!",
          "Cho xin ké lưng một đoạn ngắn nào bro ơi!",
          "Cõng tôi đi dạo quanh hang ngắm cờ tí bro!",
          "Mỏi chân quá, cho ké lưng 5-10 giây được không bro?"
        ];
        const reqText = carryRequests[Math.floor(Math.random() * carryRequests.length)];

        targetPlayer.pendingCarryFrom = { id: promptBot.id, at: now, isNpc: true };
        targetPlayer.lastNpcCarryPromptAt = now;

        send(targetPlayer.ws, {
          type: 'carry-invite',
          style: 'piggyback',
          isNpc: true,
          from: { id: promptBot.id, name: promptBot.name, jerseyNumber: promptBot.jerseyNumber },
          text: reqText
        });

        broadcast(roomId, {
          type: 'chat',
          id: promptBot.id,
          name: promptBot.name,
          jerseyNumber: promptBot.jerseyNumber,
          text: `Ê bro ${targetPlayer.name}, ${reqText.toLowerCase()}`,
          at: now
        });
      }
    }

    // 3. Tự động gửi tin nhắn chat chậm chậm để tạo không khí thật, nhộn nhịp (mỗi 30 - 65 giây)
    if (now >= (room.nextAfkChatAt || 0)) {
      room.nextAfkChatAt = now + 30000 + Math.floor(Math.random() * 35000);
      const chatBot = activeAfks[Math.floor(Math.random() * activeAfks.length)];
      const quote = AFK_CHAT_QUOTES[Math.floor(Math.random() * AFK_CHAT_QUOTES.length)];
      broadcast(roomId, {
        type: 'chat',
        id: chatBot.id,
        name: chatBot.name,
        jerseyNumber: chatBot.jerseyNumber,
        text: quote,
        at: now
      });
    }

    // 4. Tương tác ngẫu nhiên giữa 2 NPC (chào nhau, đập tay, bắt tay, hô hào)
    if (activeAfks.length >= 2 && Math.random() < 0.22) {
      const freeBots = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.spotId);
      if (freeBots.length >= 2) {
        const b1 = freeBots[0];
        const b2 = freeBots[1];
        if (Math.hypot(b1.x - b2.x, b1.z - b2.z) < 3.2) {
          const kind = Math.random() < 0.5 ? 'highfive' : 'handshake';
          broadcast(roomId, { type: 'interaction-started', kind, playerA: b1.id, playerB: b2.id, duration: 1500 });
          b1.action = 'cheer';
          b2.action = 'cheer';
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(b1) });
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(b2) });
        }
      }
    }

    // 5. NPC Autonomous: Di chuyển, chọn đĩa tròn ngồi/hô, đổi hành động tự nhiên
    const occupiedSpots = getOccupiedSpotIds(room);

    for (let idx = 0; idx < activeAfks.length; idx++) {
      const bot = activeAfks[idx];

      // Đang được cõng bởi người chơi thật: giữ nguyên
      if (bot.carriedBy && room.players.has(bot.carriedBy)) continue;
      if (bot.carryingId && room.players.has(bot.carryingId)) continue;
      if (now < bot.nextActionAt) continue;

      // Chu kỳ hành động ngẫu nhiên: 6 - 16 giây
      bot.nextActionAt = now + 6000 + Math.floor(Math.random() * 10000);

      // Nếu đang cõng nhau giữa 2 bot: thỉnh thoảng thả xuống
      if (bot.carryingId || bot.carriedBy) {
        if (Math.random() < 0.6) {
          const otherId = bot.carryingId || bot.carriedBy;
          const other = room.afks.get(otherId);
          bot.carryingId = null;
          bot.carriedBy = null;
          bot.action = 'idle';
          if (other) {
            other.carryingId = null;
            other.carriedBy = null;
            other.action = 'idle';
            other.x = bot.x + 0.8;
            other.z = bot.z;
            broadcast(roomId, { type: 'carry-ended', carrierId: bot.id, passengerId: other.id });
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(other) });
          }
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // A. Nếu bot đang ở trên một đĩa tròn
      if (bot.spotId) {
        // 45% khả năng rời đĩa tròn để đi dạo tiếp
        if (Math.random() < 0.45) {
          bot.spotId = null;
          bot.action = 'walk';
          bot.x = Math.max(-3, Math.min(3, (Math.random() - 0.5) * 5));
          bot.z = Math.max(-6, Math.min(6, (Math.random() - 0.5) * 8));
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          setTimeout(() => {
            if (!bot.spotId && bot.action === 'walk') {
              bot.action = 'idle';
              broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
            }
          }, 2200);
          continue;
        } else {
          // Vẫn ở trên đĩa tròn: luân phiên ngồi hoặc hô cổ vũ
          bot.action = Math.random() < 0.65 ? 'cheer' : 'sit';
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // B. Nếu bot đang tự do (không ở đĩa tròn):
      const roll = Math.random();

      // 1. 25% cơ hội tìm đĩa tròn trống để vào ngồi/cổ vũ
      if (roll < 0.25) {
        const freeSpots = CAVE_SPOTS.filter(s => !occupiedSpots.has(s.id));
        if (freeSpots.length > 0) {
          const chosen = freeSpots[Math.floor(Math.random() * freeSpots.length)];
          occupiedSpots.add(chosen.id);
          bot.spotId = chosen.id;
          bot.x = chosen.x;
          bot.z = chosen.z;
          bot.action = Math.random() < 0.6 ? 'cheer' : 'sit';
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // 2. 40% cơ hội di chuyển tự nhiên đến các khu vực trong hang
      if (roll < 0.65) {
        const zones = [
          { name: 'corridor', minX: -2.5, maxX: 2.5, minZ: -4, maxZ: 7 },    // Hành lang giữa thảm
          { name: 'tactics',  minX: -3.8, maxX: 3.8, minZ: -9.5, maxZ: -7.5 },// Bàn chiến thuật
          { name: 'altar',    minX: -2.8, maxX: 2.8, minZ: -15.5, maxZ: -13 }, // Đốm lửa thiêng
          { name: 'leftAisle', minX: -5.5, maxX: -4.0, minZ: -8, maxZ: 4 },   // Hành lang cánh trái
          { name: 'rightAisle', minX: 4.0, maxX: 5.5, minZ: -8, maxZ: 4 },    // Hành lang cánh phải
          { name: 'entrance', minX: -2.5, maxX: 2.5, minZ: 7, maxZ: 9.5 }     // Lối vào hang
        ];
        const z = zones[Math.floor(Math.random() * zones.length)];
        bot.x = z.minX + Math.random() * (z.maxX - z.minX);
        bot.z = z.minZ + Math.random() * (z.maxZ - z.minZ);
        bot.action = 'walk';
        broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });

        setTimeout(() => {
          if (!bot.spotId && bot.action === 'walk') {
            const nextActs = ['idle', 'cheer', 'bow', 'prostrate'];
            bot.action = nextActs[Math.floor(Math.random() * nextActs.length)];
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          }
        }, 2200);
        continue;
      }

      // 3. 20% thực hiện động tác cổ vũ hoặc quỳ bái cờ
      if (roll < 0.85) {
        bot.action = Math.random() < 0.6 ? 'cheer' : 'prostrate';
        broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        continue;
      }

      // 4. 15% cúi chào hoặc đứng tĩnh tâm
      bot.action = Math.random() < 0.5 ? 'bow' : 'idle';
      broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
    }
  }

  // Inactive check (15 phút không hoạt động mới rời phòng)
  for (const [ws, s] of clients) {
    const r = rooms.get(s.roomId), p = r?.players.get(s.id);
    if (!p) continue;
    if (p.pendingInteraction && now - p.pendingInteraction.at > 15000) {
      const pending = p.pendingInteraction;
      p.pendingInteraction = null;
      const other = r.players.get(pending.targetId || pending.fromId);
      if (other) other.pendingInteraction = null;
    }
    if (p.pendingCarryFrom && now - p.pendingCarryFrom.at > 15000) p.pendingCarryFrom = null;
    if (now - p.lastActivity > IDLE_TIMEOUT_MS) {
      removePlayer(ws, 'inactive');
      closeFor(ws, 4001, 'Bạn đã rời hang do không hoạt động trong 15 phút.');
    }
  }
}, 2000).unref();

server.listen(PORT, () => console.log(`Hang MU running on ${PORT}; ${MAX_ROOMS} rooms x ${ROOM_CAPACITY} players (40 Autonomous NPCs active across 4 rooms)`));
