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
app.get('/audio/2.mp4a', (req, res) => serveAudio('public/audio/2.m4a', 'audio/mp4', res));

app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 2048 });

// === 40 TÊN NHÂN VẬT AFK THEO YÊU CẦU CHÍNH XÁC ===
const AFK_NAMES = [
  // Phòng 1: hang-01
  "Bố Ronaldo", "Mõm MU", "Quỷ Đỏ", "Đỏ Lòm", "Gáy Thuê",
  "Sút Ngu", "Chân Gỗ", "Gỗ Lim", "Tạ Tấn", "Mười Khó",
  // Phòng 2: hang-02
  "Hết Cứu", "Báo Thủ", "Phế Vật", "Cu Li", "Mõm To",
  "Đá Mướn", "Chúa Hề", "Thánh Lầy", "Gánh Team", "Bán Độ",
  // Phòng 3: hang-03
  "Nằm Sân", "Ngáo Đá", "Cò Đất", "Bún Chả", "Mì Tôm",
  "Cơm Nguội", "Nợ Lương", "Trả Góp", "Đá Mồm", "Chém Gió",
  // Phòng 4: hang-04
  "Chạy Show", "Thủ Môn", "Phản Lưới", "Tấu Hài", "Đầu Bò",
  "Gà Mờ", "Bố Đời", "Trùm Cuối", "Vua Báo", "Hết Pin"
];

// Danh sách câu nói chân thực của fan MU chui hang để bot chat chậm chậm tạo không khí
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

// 10 Vị trí đứng/ngồi/cõng phân bố hợp lý trong hang (không chặn lối đi, không đè lên đĩa tròn của người chơi)
// 15 Vị trí đứng/ngồi/cõng phân bố hợp lý trong hang (không chặn lối đi, không đè lên đĩa tròn của người chơi)
const AFK_SPOTS = [
  { x: -3.2, z: -8.0, action: 'cheer' },     // 0: Trái bàn chiến thuật - Đứng hát / cổ vũ
  { x: 3.2, z: -8.0, action: 'idle' },      // 1: Phải bàn chiến thuật - Đứng xem
  { x: -4.8, z: -4.0, action: 'sit' },       // 2: Cánh trái - Ngồi tĩnh tâm
  { x: 4.8, z: -4.0, action: 'bow' },       // 3: Cánh phải - Cúi chào
  { x: -2.8, z: 1.5, action: 'idle' },      // 4: Mép thảm trái - Đứng tĩnh tâm
  { x: 2.8, z: 1.5, action: 'cheer' },     // 5: Mép thảm phải - Hô cổ vũ
  { x: -3.6, z: 6.0, action: 'idle' },      // 6: Cõng bạn (carrier)
  { x: -3.6, z: 6.0, action: 'carried' },   // 7: Được cõng trên lưng (passenger)
  { x: 3.6, z: 6.0, action: 'prostrate' }, // 8: Quỳ dập đầu bái cờ
  { x: -1.8, z: -14.5, action: 'cheer' }     // 9: Gần đốm lửa thiêng - Hô cổ vũ
  { x: -1.8, z: -14.5, action: 'cheer' },    // 9: Gần đốm lửa thiêng trái - Hô cổ vũ
  { x: 1.8, z: -14.5, action: 'bow' },      // 10: Gần đốm lửa thiêng phải - Cúi chào trước lửa
  { x: -1.6, z: 8.5, action: 'cheer' },     // 11: Lối vào hang bên trái - Cổ vũ đón anh em
  { x: 1.6, z: 8.5, action: 'idle' },      // 12: Lối vào hang bên phải - Đứng đón anh em
  { x: -4.5, z: -11.5, action: 'prostrate' },// 13: Hành lang trên bên trái - Quỳ bái
  { x: 4.5, z: -11.5, action: 'sit' }       // 14: Hành lang trên bên phải - Ngồi tĩnh tâm
];

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

// Khởi tạo 4 phòng, mỗi phòng đúng 10 nhân vật AFK cố định
for (let i = 1; i <= MAX_ROOMS; i++) {
  const roomId = `hang-${String(i).padStart(2, '0')}`;
  // Phân bổ 40 nhân vật AFK hoàn toàn phía server qua 4 phòng:
  // Phòng 1 (Hang chính/VIP): 15 AFK (đông đúc, khí thế nhất)
  // Phòng 2 (Hang sôi động): 12 AFK
  // Phòng 3 (Hang vừa phải): 8 AFK
  // Phòng 4 (Hang tĩnh tâm): 5 AFK
  // Tổng cộng: 15 + 12 + 8 + 5 = đúng 40 AFK với 40 tên khác nhau không trùng lặp
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
    players: new Map(), // Danh sách người chơi thật có WebSocket
    afks: new Map(),    // AFK cố định phía server của phòng
    afkList: [],        // Thứ tự danh sách AFK
    nextAfkChatAt: serverStartTime + 10000 + Math.floor(Math.random() * 20000)
  };

  for (let j = 0; j < afkCount; j++) {
    const name = AFK_NAMES[globalNameIndex++];
    const spot = AFK_SPOTS[j];
    const id = `afk-${roomId}-${j}`;
    const bot = {
      id,
      name,
      jerseyNumber: 11 + j,
      x: spot.x,
      z: spot.z,
      homeX: spot.x,
      homeZ: spot.z,
      action: spot.action,
      carryingId: null,
      carriedBy: null,
      isAfk: true,
      joinedAt: serverStartTime,
      strongFanAt: 60000,
      nextActionAt: serverStartTime + 8000 + j * 3200
    };

    for (let j = 0; j < 10; j++) {
      const nameIndex = (i - 1) * 10 + j;
      const name = AFK_NAMES[nameIndex];
      for (let j = 0; j < afkCount; j++) {
        const name = AFK_NAMES[globalNameIndex++];
        const spot = AFK_SPOTS[j];
        const id = `afk-${roomId}-${j}`;
        const bot = {
          id,
          name,
          jerseyNumber: 11 + j,
          x: spot.x,
          z: spot.z,
          homeX: spot.x,
          homeZ: spot.z,
          action: spot.action,
          carryingId: null,
          carriedBy: null,
          isAfk: true,
          joinedAt: serverStartTime,
          strongFanAt: 60000,
          nextActionAt: serverStartTime + 8000 + j * 3200
        };
        room.afks.set(id, bot);
        room.afkList.push(bot);
      }

      // Khởi tạo cặp cõng nhau giữa bot 6 và bot 7 tạo không khí
      const b6 = room.afks.get(`afk-${roomId}-6`);
      const b7 = room.afks.get(`afk-${roomId}-7`);
      if (b6 && b7) {
        b6.carryingId = b7.id;
        b7.carriedBy = b6.id;
        // Khởi tạo cặp cõng nhau giữa bot 6 và bot 7 tạo không khí (cho các phòng có đủ từ 8 bot trở lên)
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

      // Số lượng người chơi thật hiển thị trên danh sách phòng (chỉ tính người thật)
      function roomSnapshot() {
        return [...rooms.entries()].map(([id, r]) => ({
          id,
          count: r.players.size,
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
          title: p.isAfk ? 'Fan cứng' : fanTitle(p),
          joinedAt: p.joinedAt,
          strongFanAt: p.strongFanAt,
          isAfk: !!p.isAfk
        };
      }

      // Lấy danh sách AFK đang hoạt động (khi phòng tầm 30 người, mỗi người vào thì 1 AFK nhường chỗ)
      // Lấy danh sách AFK đang hoạt động (khi phòng tầm 30 người, cứ mỗi người vào thì 1 AFK nhường chỗ)
      function getActiveAfks(room) {
        const realCount = room.players.size;
        const targetCount = realCount >= 30 ? Math.max(0, 40 - realCount) : 10;
        const maxAfk = room.afkList.length;
        const targetCount = realCount >= 30 ? Math.max(0, maxAfk - (realCount - 30)) : maxAfk;
        return room.afkList.slice(0, targetCount);
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
            const prevAfkCount = Math.max(0, 40 - prevReal);
            const newAfkCount = Math.max(0, 40 - (prevReal - 1));
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
          try { ws.close(code, reason); } catch { }
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
              const prevAfkCount = Math.max(0, 40 - prevReal);
              const newAfkCount = Math.max(0, 40 - (prevReal + 1));
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
              realCount: room.players.size
            });

            broadcast(roomId, { type: 'player-joined', player: publicPlayer(p) }, id);
            broadcastRoomList();
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

        broadcast(state.roomId, { type: 'carry-started', style: target.carryStyle, carrierId: p.id, passengerId: target.id });
        broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(p) });
        broadcast(state.roomId, { type: 'player-updated', player: publicPlayer(target) });

        // Bot phản hồi vào chat
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
            const from = room.players.get(fromId);
            const pending = p.pendingCarryFrom;
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
            for (const otherRoom of rooms.values()) {
              for (const other of otherRoom.players.values()) {
                if (other.id !== p.id && otherRoom === room && other.spotId === spotId) {
                  send(ws, { type: 'spot-error', message: 'Vị trí tròn này đã có Quỷ Đỏ đứng rồi, bạn chọn chỗ khác nhé!' });
                  return;
                }
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

      // Vòng lặp định kỳ: Quản lý AFK ngẫu nhiên hành động và kiểm tra Inactivity 15 phút
      setInterval(() => {
        const now = Date.now();

        // 1. AFK Bot Update Loop
        for (const [roomId, room] of rooms) {
          if (room.players.size === 0) continue; // Phòng không có người chơi thật thì không tốn CPU broadcast
          const activeAfks = getActiveAfks(room);

          for (let idx = 0; idx < activeAfks.length; idx++) {
            const bot = activeAfks[idx];
            if (now < bot.nextActionAt) continue;

            // Mỗi bot đổi hành động ngẫu nhiên sau 15 - 35 giây (lệch pha nhau)
            bot.nextActionAt = now + 15000 + Math.floor(Math.random() * 20000);

    // Tự động nhắn tin chat chậm chậm để tạo không khí thật, nhộn nhịp (mỗi 30-65 giây một tin)
    if (now >= (room.nextAfkChatAt || 0) && activeAfks.length > 0) {
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

    for (let idx = 0; idx < activeAfks.length; idx++) {
      const bot = activeAfks[idx];

      // Nếu người chơi thật đang cõng bot này hoặc bot đang cõng người chơi thật, không can thiệp hành động
      if ((bot.carriedBy && room.players.has(bot.carriedBy)) || (bot.carryingId && room.players.has(bot.carryingId))) {
        continue;
      }

      if (now < bot.nextActionAt) continue;

      // Mỗi bot đổi hành động ngẫu nhiên sau 15 - 35 giây (lệch pha nhau)
      bot.nextActionAt = now + 15000 + Math.floor(Math.random() * 20000);

      // Nếu đang cõng nhau (giữa 2 bot), thỉnh thoảng thả xuống
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
        }

        // 2. Inactive check (15 phút không hoạt động mới rời phòng)
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

      server.listen(PORT, () => console.log(`Hang MU running on ${PORT}; ${MAX_ROOMS} rooms x ${ROOM_CAPACITY} players (40 AFK bots ready)`));
      server.listen(PORT, () => console.log(`Hang MU running on ${PORT}; ${MAX_ROOMS} rooms x ${ROOM_CAPACITY} players (40 AFK bots distributed: 15/12/8/5)`));
