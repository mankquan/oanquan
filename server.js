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

// Tắt hoàn toàn cache tĩnh để người chơi tải lại trang là nhận ngay client.js mới nhất
app.use(express.static('public', {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 2048 });

// === KHO 200 TÊN AFK MEME BÓNG ĐÁ VÀ BIỆT DANH TẤU HÀI ===
const AFK_NAMES_200 = [
  // 1. MU – Quỷ Đỏ (1 - 25)
  "Bố MU", "Chủ Tịch MU", "Quỷ Đỏ Online", "MU Trong Tim", "Fan Cứng MU",
  "Sir Alex Con", "Ten Hag Con", "Amorim Con", "Old Trafford Boy", "Quỷ Đỏ Báo",
  "MU Vô Đối", "MU Hết Cứu", "Gáy Thuê MU", "Bố Già Quỷ Đỏ", "Red Devil Mõm",
  "MU Có Biến", "Nhà Có Quỷ", "Quỷ Đỏ Tập Sự", "MU Đang Reset", "Quỷ Đỏ Bất Ổn",
  "Fan MU Hệ Tâm Linh", "MU Chờ Ngày Hồi Sinh", "Quỷ Đỏ Thất Thủ", "MU Không Ngủ", "Bố Của Arsenal",

  // 2. Arsenal – Pháo Thủ (26 - 40)
  "Bố Arsenal", "Pháo Thủ Mõm", "Chủ Tịch Emirates", "Arteta Con", "Arsenal Vô Địch",
  "Pháo Thủ Online", "Fan Arsenal Hệ Niềm Tin", "Arsenal Tháng 8", "Pháo Thủ Non", "Cúp Đâu Arteta",
  "Arsenal Chờ Cúp", "Pháo Thủ Tâm Linh", "Gáy Trước Chung Kết", "Arsenal Bất Ổn", "Nhà Vua Top 2",

  // 3. Liverpool (41 - 55)
  "Bố Liverpool", "Klopp Con", "Slot Machine", "Liver Gà", "The Kop Mõm",
  "Liverpool Online", "Fan Đỏ Hệ Gáy", "Anfield Boy", "Liverpool Hết Slot", "Chủ Tịch Anfield",
  "Liver Không Run", "Lữ Đoàn Đỏ", "Salah Con", "Liver Chạy KPI", "Gáy Từ Anfield",

  // 4. Man City (56 - 70)
  "Bố Man City", "Pep Con", "115 FC", "Chủ Tịch Etihad", "City Hệ Tài Chính",
  "Haaland Con", "Man Xanh Mõm", "Pep Guardiola Fake", "City Vô Đối", "Fan City Mới",
  "Máy Xay Điểm", "Man City Online", "VAR Cứu City", "City Hệ Thống", "Nhà Giàu Thích Gáy",

  // 5. Chelsea (71 - 85)
  "Bố Chelsea", "Chủ Tịch Stamford", "Chelsea FC Fake", "Blue Mõm", "Chelsea Báo Thủ",
  "Fan Chelsea Hệ Trẻ", "London Is Blue", "Chelsea Đang Xây", "Enzo Con", "Palmer Con",
  "Chelsea Hệ Tương Lai", "The Blues Online", "Chelsea Hết Cứu", "Chủ Tịch Chợ Cầu Thủ", "Chelsea Mua Tiếp",

  // 6. Real Madrid (86 - 100)
  "Bố Real", "Chủ Tịch Bernabeu", "Real Hệ Hoàng Gia", "Madridista Mõm", "Vua C1 Online",
  "Real Không Ngán", "Ancelotti Con", "Mbappe Con", "Vinicius Fake", "Real Hệ DNA",
  "Kền Kền Trắng", "Real Thích Lội Ngược", "Cúp C1 Nhà Tôi", "Galacticos Fake", "Hoàng Gia Báo",

  // 7. Barcelona (101 - 115)
  "Bố Barca", "Chủ Tịch Camp Nou", "Barca DNA", "Cule Mõm", "Barca Hệ La Masia",
  "Yamal Con", "Flick Con", "Tiki Taka Fake", "Barca Online", "Fan Barca Hệ Niềm Tin",
  "Gã Khổng Lồ Ngủ", "Barca Hết Tiền", "Catalan Boy", "Barca Đá Hay", "Nợ Lương Barca",

  // 8. Các CLB khác (116 - 140)
  "Bố Tottenham", "Gà Trống Gáy", "Spurs Vô Địch", "Bố Newcastle", "Chích Chòe Mõm",
  "Bố Aston Villa", "Villa Hệ Châu Âu", "Bố PSG", "Paris Mõm", "PSG Hệ Ngôi Sao",
  "Bố Bayern", "Hùm Xám Online", "Bayern Gáy Nhẹ", "Bố Dortmund", "Vàng Đen Mõm",
  "Bố Juventus", "Bà Đầm Già Fake", "Bố AC Milan", "Rossoneri Online", "Bố Inter",
  "Nerazzurri Mõm", "Bố Napoli", "Napoli Hệ Ăn Mừng", "Bố Atletico", "Simeone Con",

  // 9. Meme bóng đá (141 - 165)
  "Gánh Team", "Báo Thủ FC", "Chân Gỗ Online", "Sút Như Đấm", "Đá Bằng Niềm Tin",
  "VAR Là Bạn", "Trọng Tài Con", "Ông Vua Mõm", "Gáy Là Chính", "Đá Là Phụ",
  "Hết Cứu Bro", "Cầu Thủ Hệ Tấu Hài", "Chuyên Gia Nằm Sân", "Vua Phản Lưới", "Thánh Chuyền Về",
  "Chạy Không Có Bóng", "Đá Như Đi Bộ", "Bóng Đá Tâm Linh", "Siêu Sao Bàn Phím", "HLV Online",
  "Chủ Tịch FIFA", "Quả Bóng Mõm", "Vua Penalty", "Trùm Đá Phạt", "Gà Công Nghiệp",

  // 10. Biệt danh tấu hài (166 - 200)
  "Bố Đời Online", "Mõm Vương", "Đại Ca Sân Cỏ", "Trùm Cuối AFK", "Thánh Gáy",
  "Vua Báo", "Chúa Hề FC", "Hết Pin FC", "Tấu Hài Có Tổ Chức", "Mõm Không Biên Giới",
  "Đại Gia Nửa Mùa", "Chủ Tịch Tự Phong", "Siêu Nhân Sân Cỏ", "Người Chơi Hệ Ảo", "Bất Bại Trên Giấy",
  "Vua Lý Thuyết", "Huyền Thoại Tự Xưng", "Top 1 Trong Lòng", "Đá Hay Trong Mơ", "Gáy Xuyên Màn Đêm",
  "Xin Một Vé Vô Địch", "Thần Đồng Bàn Phím", "Chiến Thần Mõm", "Hệ Điều Hành Báo", "Đẳng Cấp Mõm",
  "Đá Bóng Bằng Mồm", "Từ Từ Mà Gáy", "Bố Của Các Bố", "Huyền Thoại AFK", "Đứng Đây Gáy",
  "Trùm Khu Vực", "Chuyên Gia Cà Khịa", "Mõm Có Bằng Cấp", "Vua Sân Đình", "Cúp Đâu Bro"
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

// === KHO 500 BÌNH LUẬN MEME GEN Z VIỆT NAM (ĐÃ LOẠI BỎ TRÙNG LẶP & RỖNG) ===
const NPC_MEME_QUOTES = require('./npc_quotes.json');

// Thuật toán xáo trộn Fisher-Yates shuffle
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Cơ chế cấp phát câu thoại ngẫu nhiên và chống trùng lặp tuyệt đối trong từng phòng
function getUniqueRoomQuote(room) {
  if (!room.chatDeck || room.chatDeck.length === 0) {
    // Khi toàn bộ câu trong kho của phòng đã sử dụng hết: Bắt đầu chu kỳ mới và xáo trộn lại
    let newDeck = shuffleArray(NPC_MEME_QUOTES);
    // Đảm bảo câu đầu tiên của chu kỳ mới không trùng với câu cuối cùng vừa dùng ở chu kỳ trước
    if (room.lastSpokenQuote && newDeck.length > 1 && newDeck[newDeck.length - 1] === room.lastSpokenQuote) {
      const swapIdx = Math.floor(Math.random() * (newDeck.length - 1));
      [newDeck[newDeck.length - 1], newDeck[swapIdx]] = [newDeck[swapIdx], newDeck[newDeck.length - 1]];
    }
    room.chatDeck = newDeck;
    room.chatCycle = (room.chatCycle || 1) + 1;
    room.usedQuotesInCycle = new Set();
  }

  const quote = room.chatDeck.pop();
  room.lastSpokenQuote = quote;
  if (room.usedQuotesInCycle) {
    room.usedQuotesInCycle.add(quote);
  }
  return quote;
}

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

// Cấu hình 4 phòng với số lượng NPC ban đầu khác nhau để tạo cảm giác tự nhiên, sống động ngay khi mở sảnh:
const ROOM_AFK_CONFIG = [
  { id: 'hang-01', initialCount: 7 },
  { id: 'hang-02', initialCount: 9 },
  { id: 'hang-03', initialCount: 6 },
  { id: 'hang-04', initialCount: 8 }
];

const personalities = ['meme', 'troller', 'fan_ruot', 'casual', 'interactor'];

// Khoảng thời gian xuất hiện NPC độc lập từng phòng: ngẫu nhiên trong khoảng 2 - 9 phút
const SPAWN_INTERVAL_MIN_MS = Number(process.env.TEST_SPAWN_MIN_MS) || (2 * 60 * 1000); // 2 phút
const SPAWN_INTERVAL_MAX_MS = Number(process.env.TEST_SPAWN_MAX_MS) || (9 * 60 * 1000); // 9 phút

function getNextSpawnDelay() {
  return SPAWN_INTERVAL_MIN_MS + Math.floor(Math.random() * (SPAWN_INTERVAL_MAX_MS - SPAWN_INTERVAL_MIN_MS + 1));
}

// Khoảng thời gian NPC tự rời phòng độc lập từng phòng: ngẫu nhiên trong khoảng 2.5 - 8 phút
const DEPARTURE_INTERVAL_MIN_MS = Number(process.env.TEST_DEPART_MIN_MS) || Math.round(2.5 * 60 * 1000); // 2.5 phút
const DEPARTURE_INTERVAL_MAX_MS = Number(process.env.TEST_DEPART_MAX_MS) || (8 * 60 * 1000); // 8 phút

function getNextDepartureDelay() {
  return DEPARTURE_INTERVAL_MIN_MS + Math.floor(Math.random() * (DEPARTURE_INTERVAL_MAX_MS - DEPARTURE_INTERVAL_MIN_MS + 1));
}

const ENTRANCE_POS = { x: 0, z: 9.8 }; // Vị trí cửa hang nhập sảnh
const FLAG_CEREMONY_POS = { x: 0, z: 2.0 }; // Vị trí trước thảm cờ thiêng làm nghi thức
const BOW_DURATION_MS = Number(process.env.TEST_BOW_MS) || 5000; // ~5 giây cúi chào cờ nhập hang
const KNEEL_DURATION_MS = Number(process.env.TEST_KNEEL_MS) || 10000; // ~10 giây quỳ bái cờ đổi tên

// Danh sách các câu chào kính cẩn, vui tươi của NPC khi tiếp cận người chơi hoặc đồng đội
const GREETING_QUOTES = [
  "Chào người anh em Quỷ Đỏ! 🔴🫡",
  "Chào đại ca! Nay MU thắng chắc nhé! 🔥",
  "Bái kiến đồng đội! Cùng nhau giữ vững niềm tin! 🤝",
  "Chào bác, vào hang cứ tự nhiên như ở nhà! 🔴",
  "Kính chào người anh em thiện lành! Quỷ Đỏ vô đối! 🫡",
  "Chào idol! Gáy cùng em cho vang hang nào! 🔴🔥",
  "Chào đồng chí, chúc anh em xem bóng vui vẻ! ⚽",
  "Bái phục bái phục! Cùng nhau nhuộm đỏ trời Âu! 🔴🫡",
  "Chào bro! Vững niềm tin, bền ý chí nhé! 🤝",
  "Chào người anh em, nay MU đá cháy máy luôn! ⚽🔥"
];

// === QUẢN LÝ VÀ PHÂN PHỐI TÊN NPC AFK NGẪU NHIÊN & KHÔNG TRÙNG LẶP ===
function getRoomUsedNames(room, excludeBotId = null) {
  const used = new Set();
  for (const b of room.afks.values()) {
    if (excludeBotId && b.id === excludeBotId) continue;
    if (b.name) used.add(b.name);
  }
  if (room.entranceQueue) {
    for (const b of room.entranceQueue) {
      if (excludeBotId && b.id === excludeBotId) continue;
      if (b.name) used.add(b.name);
    }
  }
  for (const q of room.ceremonyQueue) {
    if (excludeBotId && q.botId === excludeBotId) continue;
    if (q.newName) used.add(q.newName);
  }
  if (room.activeCeremony && (!excludeBotId || room.activeCeremony.botId !== excludeBotId)) {
    if (room.activeCeremony.newName) used.add(room.activeCeremony.newName);
  }
  return used;
}

function pickUniqueAfkName(room, bot = null) {
  const excludeId = bot ? bot.id : null;
  const usedNames = getRoomUsedNames(room, excludeId);
  const history = (bot && bot.nameHistory) ? new Set(bot.nameHistory) : new Set();
  if (bot && bot.name) history.add(bot.name);

  // 1. Ưu tiên: Chưa có ai trong phòng dùng VÀ không nằm trong lịch sử gần đây của bot
  let candidates = AFK_NAMES_200.filter(name => !usedNames.has(name) && !history.has(name));

  // 2. Nếu đã dùng gần hết: Chưa ai trong phòng dùng VÀ khác tên hiện tại của bot
  if (candidates.length === 0) {
    candidates = AFK_NAMES_200.filter(name => !usedNames.has(name) && (!bot || name !== bot.name));
  }

  // 3. Fallback an toàn: Chưa ai trong phòng dùng
  if (candidates.length === 0) {
    candidates = AFK_NAMES_200.filter(name => !usedNames.has(name));
  }

  // 4. Nếu phòng đầy đủ 200 bot (về mặt lý thuyết): Lấy bất kỳ tên nào trong kho 200
  if (candidates.length === 0) {
    candidates = AFK_NAMES_200;
  }

  // Chọn ngẫu nhiên thực sự từ danh sách ứng viên
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return chosen;
}

// Vùng cản bàn chiến thuật (Tactics Table) giữa sảnh
const OBSTACLE_TABLE = { minX: -3.2, maxX: 3.2, minZ: -12.6, maxZ: -8.4 };
// Vùng cản đốm lửa thiêng & bàn thờ
const OBSTACLE_ALTAR = { minX: -3.2, maxX: 3.2, minZ: -20.0, maxZ: -15.5 };

function isInsideObstacle(x, z) {
  if (x >= OBSTACLE_TABLE.minX && x <= OBSTACLE_TABLE.maxX && z >= OBSTACLE_TABLE.minZ && z <= OBSTACLE_TABLE.maxZ) return true;
  if (x >= OBSTACLE_ALTAR.minX && x <= OBSTACLE_ALTAR.maxX && z >= OBSTACLE_ALTAR.minZ && z <= OBSTACLE_ALTAR.maxZ) return true;
  return false;
}

function crossesTable(x1, z1, x2, z2) {
  const minZ = OBSTACLE_TABLE.minZ;
  const maxZ = OBSTACLE_TABLE.maxZ;
  if ((z1 > maxZ && z2 > maxZ) || (z1 < minZ && z2 < minZ)) return false;
  if ((x1 < OBSTACLE_TABLE.minX && x2 < OBSTACLE_TABLE.minX) || (x1 > OBSTACLE_TABLE.maxX && x2 > OBSTACLE_TABLE.maxX)) return false;
  return true;
}

// Tính toán tọa độ mặt sàn thời gian thực chính xác của NPC (mượt mà, không giật, bám sàn)
function getBotCurrentPos(bot, now = Date.now()) {
  if (bot.action === 'walk' && bot.walkArrivalAt && bot.walkStartAt && bot.walkArrivalAt > bot.walkStartAt) {
    const elapsed = now - bot.walkStartAt;
    const duration = bot.walkArrivalAt - bot.walkStartAt;
    const t = Math.min(1, Math.max(0, elapsed / duration));
    const smoothT = t * t * (3 - 2 * t);
    const targetX = bot.targetX !== undefined ? bot.targetX : bot.x;
    const targetZ = bot.targetZ !== undefined ? bot.targetZ : bot.z;
    const startX = bot.startX !== undefined ? bot.startX : bot.x;
    const startZ = bot.startZ !== undefined ? bot.startZ : bot.z;
    const curX = startX + (targetX - startX) * smoothT;
    const curZ = startZ + (targetZ - startZ) * smoothT;
    return { x: curX, z: curZ };
  }
  return { x: bot.x, z: bot.z };
}

// Bắt đầu quá trình đi bộ tự nhiên theo tốc độ đi bộ thực tế (không bay, không teleport)
function startBotWalk(roomId, bot, destX, destZ, onArrive = null, now = Date.now()) {
  destX = Math.max(-12, Math.min(12, destX));
  destZ = Math.max(-16.5, Math.min(9.5, destZ));
  if (isInsideObstacle(destX, destZ)) {
    destX = destX < 0 ? -4.5 : 4.5;
  }

  const curPos = getBotCurrentPos(bot, now);
  bot.startX = curPos.x;
  bot.startZ = curPos.z;
  bot.x = curPos.x;
  bot.z = curPos.z;

  // Nếu đường đi cắt xuyên bàn chiến thuật, đi qua hành lang bên cạnh trước
  if (crossesTable(curPos.x, curPos.z, destX, destZ)) {
    const waypointX = curPos.x <= 0 ? -4.5 : 4.5;
    const waypointZ = -10.5;
    bot.pendingFinalDest = { x: destX, z: destZ, onArrive };
    destX = waypointX;
    destZ = waypointZ;
  } else {
    bot.pendingFinalDest = null;
  }

  bot.targetX = destX;
  bot.targetZ = destZ;
  bot.action = 'walk';
  bot.facingRot = Math.atan2(destX - bot.startX, destZ - bot.startZ);

  const dist = Math.hypot(destX - bot.startX, destZ - bot.startZ);
  const walkSpeed = 2.7; // Tốc độ người đi bộ tự nhiên
  const walkMs = Math.max(1000, Math.round((dist / walkSpeed) * 1000));

  bot.walkStartAt = now;
  bot.walkArrivalAt = now + walkMs;
  bot.onWalkArrive = onArrive;

  broadcast(roomId, {
    type: 'player-updated',
    player: publicPlayer(bot)
  });
}

// Khởi tạo thực thể NPC độc lập với ID duy nhất, tên meme và vị trí tự nhiên
function createAfkBot(room, isInitial = false, spotIndex = 0) {
  room.afkSeq = (room.afkSeq || 0) + 1;
  const id = `afk-${room.id}-${room.afkSeq}`;
  const name = pickUniqueAfkName(room, null);
  const title = AFK_TITLES[Math.floor(Math.random() * AFK_TITLES.length)] || "Quỷ Đỏ trung kiên";
  const personality = personalities[Math.floor(Math.random() * personalities.length)];
  const jerseyNumber = 11 + ((room.afkSeq - 1) % 40);

  if (isInitial) {
    const spot = AFK_SPOTS[spotIndex % AFK_SPOTS.length];
    const initialActions = ['idle', 'cheer', 'sit', 'bow', 'prostrate'];
    const chosenAction = spot.action === 'carried' ? 'idle' : (spot.action || initialActions[Math.floor(Math.random() * initialActions.length)]);
    return {
      id,
      name,
      nameHistory: [name],
      title,
      jerseyNumber,
      personality,
      x: spot.x,
      z: spot.z,
      homeX: spot.x,
      homeZ: spot.z,
      startX: spot.x,
      startZ: spot.z,
      targetX: spot.x,
      targetZ: spot.z,
      facingRot: Math.PI,
      action: chosenAction,
      spotId: null,
      reservedSpotId: null,
      spotArrivalAt: 0,
      walkStartAt: 0,
      walkArrivalAt: 0,
      bowUntil: 0,
      stayOnSpotUntil: 0,
      onWalkArrive: null,
      pendingFinalDest: null,
      carryingId: null,
      carriedBy: null,
      carryAutoDropAt: 0,
      isAfk: true,
      joinedAt: Date.now() - 30000 - Math.floor(Math.random() * 180000),
      strongFanAt: 60000,
      nextActionAt: Date.now() + 1000 + Math.floor(Math.random() * 2500),
      inCeremony: false,
      ceremonyStep: null,
      inEntranceCeremony: false,
      entranceStep: null,
      entranceWalkMs: 0,
      entranceArrivalAt: 0,
      entranceBowUntil: 0,
      isDeparting: false,
      departureArrivalAt: 0,
      departureWalkMs: 0
    };
  } else {
    // NPC mới xuất hiện: chuẩn bị đi vào từ cửa hang
    return {
      id,
      name,
      nameHistory: [name],
      title,
      jerseyNumber,
      personality,
      x: ENTRANCE_POS.x,
      z: ENTRANCE_POS.z,
      homeX: 0,
      homeZ: 0,
      startX: ENTRANCE_POS.x,
      startZ: ENTRANCE_POS.z,
      targetX: ENTRANCE_POS.x,
      targetZ: ENTRANCE_POS.z,
      facingRot: Math.PI,
      action: 'walk',
      spotId: null,
      reservedSpotId: null,
      spotArrivalAt: 0,
      walkStartAt: 0,
      walkArrivalAt: 0,
      bowUntil: 0,
      stayOnSpotUntil: 0,
      onWalkArrive: null,
      pendingFinalDest: null,
      carryingId: null,
      carriedBy: null,
      carryAutoDropAt: 0,
      isAfk: true,
      joinedAt: Date.now(),
      strongFanAt: 60000,
      nextActionAt: 0,
      inCeremony: false,
      ceremonyStep: null,
      inEntranceCeremony: true,
      entranceStep: 'queued',
      entranceWalkMs: 0,
      entranceArrivalAt: 0,
      entranceBowUntil: 0,
      isDeparting: false,
      departureArrivalAt: 0,
      departureWalkMs: 0
    };
  }
}

for (let rIdx = 0; rIdx < ROOM_AFK_CONFIG.length; rIdx++) {
  const cfg = ROOM_AFK_CONFIG[rIdx];
  const roomId = cfg.id;

  // Thời điểm xuất hiện và rời phòng ban đầu được phân bổ lệch nhau giữa các phòng (không đồng bộ)
  const initialSpawnOffset = process.env.TEST_FIRST_SPAWN_MS 
    ? Number(process.env.TEST_FIRST_SPAWN_MS) + rIdx * 100
    : (70000 + rIdx * 50000 + Math.floor(Math.random() * 40000));

  const initialDepartOffset = process.env.TEST_FIRST_DEPART_MS 
    ? Number(process.env.TEST_FIRST_DEPART_MS) + rIdx * 100
    : (110000 + (3 - rIdx) * 45000 + Math.floor(Math.random() * 40000));

  const room = {
    id: roomId,
    roomIndex: rIdx,
    players: new Map(), // Người chơi thật có WebSocket
    afks: new Map(),    // AFK NPC đã spawn thành công
    afkList: [],        // Thứ tự danh sách AFK đã spawn
    afkSeq: 0,          // Bộ đếm tạo ID duy nhất không trùng lặp cho NPC
    entranceQueue: [],  // Hàng đợi các NPC chuẩn bị làm nghi thức chào cờ nhập hang
    nextAfkSpawnAt: serverStartTime + initialSpawnOffset,
    nextAfkDepartureAt: serverStartTime + initialDepartOffset,
    activeEntranceBotId: null, // NPC đang làm lễ chào cờ nhập hang
    ceremonyQueue: [],  // Hàng đợi nghi thức bái cờ đổi tên [{ botId, newName }]
    activeCeremony: null, // NPC hiện tại đang thực hiện nghi thức { botId, newName, state: 'walking'|'kneeling', arrivalAt, kneelUntil }
    nextAfkChatAt: serverStartTime + 10000 + Math.floor(Math.random() * 12000),
    nextNpcCarryRequestAt: serverStartTime + 40000 + Math.floor(Math.random() * 25000),
    chatDeck: shuffleArray(NPC_MEME_QUOTES), // Kho câu thoại 500 câu độc lập của phòng
    chatCycle: 1, // Chu kỳ câu thoại
    lastSpokenQuote: null, // Câu vừa sử dụng gần nhất của phòng
    usedQuotesInCycle: new Set(), // Tập hợp các câu đã dùng trong chu kỳ hiện tại
    lastNpcReplyToPlayerAt: 0
  };

  // Khởi tạo số lượng NPC ban đầu cho phòng (mỗi phòng một số lượng khác nhau: 7, 9, 6, 8)
  const initCount = process.env.TEST_INITIAL_BOTS !== undefined 
    ? Number(process.env.TEST_INITIAL_BOTS) 
    : cfg.initialCount;

  for (let bIdx = 0; bIdx < initCount; bIdx++) {
    const bot = createAfkBot(room, true, bIdx);
    room.afks.set(bot.id, bot);
    room.afkList.push(bot);
  }

  rooms.set(roomId, room);
}

// === TỰ ĐỘNG XẾP HÀNG ĐỔI TÊN 40 NPC THEO CHU KỲ 5 PHÚT (300 GIÂY) TỪ BỘ 200 TÊN (RANDOM KHÔNG TRÙNG) ===
const ROTATION_INTERVAL_MS = Number(process.env.TEST_ROTATION_MS) || (300 * 1000); // 300 giây (5 phút)
let afkNameCycle = 0;

function rotateAfkNames() {
  afkNameCycle++;
  for (let rIdx = 0; rIdx < ROOM_AFK_CONFIG.length; rIdx++) {
    const cfg = ROOM_AFK_CONFIG[rIdx];
    const roomId = cfg.id;
    const room = rooms.get(roomId);
    if (!room) continue;

    for (let j = 0; j < room.afkList.length; j++) {
      const bot = room.afkList[j];
      if (bot && !bot.isDeparting) {
        // Chọn ngẫu nhiên tên mới không trùng với các bot khác trong phòng và không trùng tên vừa dùng
        const nextName = pickUniqueAfkName(room, bot);
        const queuedItem = room.ceremonyQueue.find(item => item.botId === bot.id);
        if (queuedItem) {
          queuedItem.newName = nextName;
        } else {
          room.ceremonyQueue.push({ botId: bot.id, newName: nextName });
        }
      }
    }
  }
  console.log(`[AFK ROTATION] Chu kỳ ${afkNameCycle}: Đã xếp hàng ngẫu nhiên nghi thức bái cờ đổi tên cho các NPC.`);
}

setInterval(rotateAfkNames, ROTATION_INTERVAL_MS).unref();

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

// Lấy danh sách các đĩa tròn đang có người hoặc bot ngồi / đang đi tới
function getOccupiedSpotIds(room) {
  const occ = new Set();
  for (const p of room.players.values()) {
    if (p.spotId) occ.add(p.spotId);
  }
  for (const b of room.afks.values()) {
    if (b.spotId) occ.add(b.spotId);
    if (b.reservedSpotId) occ.add(b.reservedSpotId);
  }
  return occ;
}

// Lấy danh sách AFK đang hoạt động (khi phòng tầm 30 người, mỗi người vào thì 1 AFK nhường chỗ)
function getActiveAfks(room) {
  const realCount = room.players.size;
  const list = room.afkList.filter(b => !b.isDeparting);
  const maxAfk = list.length;
  const targetCount = realCount >= 30 ? Math.max(0, maxAfk - (realCount - 30)) : maxAfk;
  return list.slice(0, targetCount);
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
  const pos = p.isAfk ? getBotCurrentPos(p) : { x: p.x, z: p.z };
  const tx = p.isAfk && p.targetX !== undefined ? p.targetX : pos.x;
  const tz = p.isAfk && p.targetZ !== undefined ? p.targetZ : pos.z;
  return {
    id: p.id,
    name: p.name,
    jerseyNumber: p.jerseyNumber,
    x: Number(pos.x.toFixed(3)),
    z: Number(pos.z.toFixed(3)),
    targetX: Number(tx.toFixed(3)),
    targetZ: Number(tz.toFixed(3)),
    facingRot: p.facingRot !== undefined && p.facingRot !== null ? Number(p.facingRot.toFixed(3)) : null,
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

      // NPC tự động chào đón / bình luận khi có người chơi mới vào hang sau 2.5 giây
      setTimeout(() => {
        const currentActive = getActiveAfks(room);
        if (currentActive.length > 0 && room.players.has(id)) {
          const eligibleGreeters = currentActive.filter(b => !b.inCeremony && !b.inEntranceCeremony && !b.carryingId && !b.carriedBy);
          const greeter = eligibleGreeters.length > 0
            ? eligibleGreeters[Math.floor(Math.random() * eligibleGreeters.length)]
            : currentActive[Math.floor(Math.random() * currentActive.length)];
          const text = getUniqueRoomQuote(room);
          greeter.lastSpokenAt = Date.now();
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

      // NPC phản hồi lại câu chat của người chơi thật một cách tự nhiên (tỷ lệ ~55%, không spam)
      const currentRoom = rooms.get(state.roomId);
      if (currentRoom && Math.random() < 0.55 && (now - (currentRoom.lastNpcReplyToPlayerAt || 0) > 5000)) {
        currentRoom.lastNpcReplyToPlayerAt = now;
        const replyDelay = 1600 + Math.floor(Math.random() * 1800);
        setTimeout(() => {
          const r = rooms.get(state.roomId);
          if (!r || r.players.size === 0) return;
          const activeBots = getActiveAfks(r);
          const eligibleBots = activeBots.filter(b => !b.carryingId && !b.carriedBy && !b.inCeremony && !b.inEntranceCeremony);
          if (eligibleBots.length > 0) {
            const responder = eligibleBots[Math.floor(Math.random() * eligibleBots.length)];
            responder.lastSpokenAt = Date.now();
            const replyQuote = getUniqueRoomQuote(r);
            broadcast(state.roomId, {
              type: 'chat',
              id: responder.id,
              name: responder.name,
              jerseyNumber: responder.jerseyNumber,
              text: replyQuote,
              at: Date.now()
            });
          }
        }, replyDelay);
      }
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

      // Nếu có NPC đang ngồi hoặc đang bước tới vị trí này, NPC ngay lập tức nhường chỗ cho người chơi thật!
      for (const bot of room.afks.values()) {
        if (bot.spotId === spotId || bot.reservedSpotId === spotId) {
          bot.spotId = null;
          bot.reservedSpotId = null;
          bot.spotArrivalAt = 0;
          bot.action = 'walk';
          bot.x = Math.max(-10, Math.min(10, bot.x + (bot.x > 0 ? -1.8 : 1.8)));
          bot.walkArrivalAt = Date.now() + 2000;
          bot.nextActionAt = bot.walkArrivalAt;
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

// Vòng lặp định kỳ: Quản lý NPC Autonomous, Di chuyển liên tục, Điều hướng đĩa tròn chân thực (không bay/teleport), Tương tác & Chat
setInterval(() => {
  const now = Date.now();

  for (const [roomId, room] of rooms) {
    // 0. Bộ điều khiển xuất hiện NPC độc lập từng phòng (ngẫu nhiên 2 - 9 phút, xuất hiện 0, 1 hoặc 2 NPC)
    if (now >= room.nextAfkSpawnAt) {
      room.nextAfkSpawnAt = now + getNextSpawnDelay();

      // Số lượng xuất hiện thay đổi ngẫu nhiên: 0 (20%), 1 (55%), 2 (25%)
      const roll = Math.random();
      let spawnCount = roll < 0.20 ? 0 : (roll < 0.75 ? 1 : 2);

      const MAX_ROOM_AFKS = 14;
      const currentTotal = room.afks.size + room.entranceQueue.length;
      if (currentTotal + spawnCount > MAX_ROOM_AFKS) {
        spawnCount = Math.max(0, MAX_ROOM_AFKS - currentTotal);
      }

      if (spawnCount > 0) {
        for (let s = 0; s < spawnCount; s++) {
          const newBot = createAfkBot(room, false);
          room.entranceQueue.push(newBot);
        }
        console.log(`[AFK SPAWN] Phòng ${roomId}: Đã xếp hàng ${spawnCount} NPC vào sảnh (Hàng đợi: ${room.entranceQueue.length}, Hiện tại: ${room.afks.size}). Lần xuất hiện kế tiếp sau ${Math.round((room.nextAfkSpawnAt - now) / 1000)}s.`);
      } else {
        console.log(`[AFK SPAWN] Phòng ${roomId}: Đợt này không có NPC nào xuất hiện (roll 0). Lần xuất hiện kế tiếp sau ${Math.round((room.nextAfkSpawnAt - now) / 1000)}s.`);
      }
    }

    // 0.1. Xử lý hàng đợi vào hang tuần tự (Sequential Entrance Greeting Ceremony): mỗi lần đúng 1 NPC chào cờ
    const isFlagBusy = room.activeCeremony != null || room.activeEntranceBotId != null;
    if (!isFlagBusy && room.entranceQueue.length > 0) {
      const bot = room.entranceQueue.shift();

      bot.inEntranceCeremony = true;
      bot.entranceStep = 'walking';
      bot.x = ENTRANCE_POS.x;
      bot.z = ENTRANCE_POS.z;
      bot.startX = ENTRANCE_POS.x;
      bot.startZ = ENTRANCE_POS.z;

      room.afks.set(bot.id, bot);
      room.afkList.push(bot);
      room.activeEntranceBotId = bot.id;

      // 1. Thông báo bot xuất hiện tại cửa hang với bước đi vào
      broadcast(roomId, {
        type: 'player-joined',
        player: publicPlayer(bot)
      });
      broadcastRoomList();

      // 2. Bắt đầu đi bộ trên mặt đất từ cửa tới thảm cờ thiêng (0, 2.0) theo tốc độ thực tế
      startBotWalk(roomId, bot, FLAG_CEREMONY_POS.x, FLAG_CEREMONY_POS.z, (arrivedBot) => {
        // Giai đoạn 2: Đã đến thảm cờ thiêng (0, 2.0) -> Dừng lại, quay mặt bái cờ thiêng (action: 'bow') trong ~5 giây
        arrivedBot.facingRot = Math.PI; // Xoay mặt thẳng vào cờ thiêng (-Z)
        arrivedBot.action = 'bow';
        arrivedBot.entranceStep = 'bowing';
        arrivedBot.entranceBowUntil = Date.now() + BOW_DURATION_MS;

        broadcast(roomId, {
          type: 'player-updated',
          player: publicPlayer(arrivedBot)
        });

        const greetingText = getUniqueRoomQuote(room);
        arrivedBot.lastSpokenAt = Date.now();
        broadcast(roomId, {
          type: 'chat',
          id: arrivedBot.id,
          name: arrivedBot.name,
          jerseyNumber: arrivedBot.jerseyNumber,
          text: greetingText,
          at: Date.now()
        });
      }, now);
    }

    // 0.2. Tiến trình lễ cúi chào cờ nhập hang của NPC mới (Entrance Greeting Ceremony)
    if (room.activeEntranceBotId) {
      const bot = room.afks.get(room.activeEntranceBotId);
      if (!bot) {
        room.activeEntranceBotId = null;
      } else if (bot.entranceStep === 'bowing') {
        if (now >= bot.entranceBowUntil) {
          // Giai đoạn 3: Hoàn thành 5 giây cúi chào -> Đứng dậy tự nhiên (idle), kết thúc lễ nhập hang
          bot.action = 'idle';
          bot.inEntranceCeremony = false;
          bot.entranceStep = null;
          bot.entranceBowUntil = 0;
          bot.walkArrivalAt = 0;
          bot.nextActionAt = now + 1000 + Math.floor(Math.random() * 1500);
          room.activeEntranceBotId = null; // Giải phóng vị trí cờ

          broadcast(roomId, {
            type: 'player-updated',
            player: publicPlayer(bot)
          });
        }
      }
    }

    // 0.3. Bộ điều khiển NPC tự rời phòng độc lập từng phòng (ngẫu nhiên 2.5 - 8 phút)
    if (now >= room.nextAfkDepartureAt) {
      room.nextAfkDepartureAt = now + getNextDepartureDelay();

      const MIN_ROOM_AFKS = 4;
      if (room.afks.size > MIN_ROOM_AFKS) {
        // Tìm bot đủ điều kiện rời phòng: không đang làm lễ chào/đổi tên, không bị cõng/cõng, không đang rời đi
        const eligible = [...room.afks.values()].filter(b => 
          !b.isDeparting &&
          !b.inEntranceCeremony &&
          !b.inCeremony &&
          !b.carryingId &&
          !b.carriedBy &&
          (now - (b.joinedAt || 0) > 30000)
        );

        const pool = eligible.length > 0 ? eligible : [...room.afks.values()].filter(b => 
          !b.isDeparting &&
          !b.inEntranceCeremony &&
          !b.inCeremony &&
          !b.carryingId &&
          !b.carriedBy
        );

        if (pool.length > 0) {
          const departingBot = pool[Math.floor(Math.random() * pool.length)];
          departingBot.isDeparting = true;

          // Rời đĩa tròn / ghế ngồi nếu đang ngồi
          if (departingBot.spotId || departingBot.reservedSpotId) {
            departingBot.spotId = null;
            departingBot.reservedSpotId = null;
            departingBot.spotArrivalAt = 0;
          }

          // Hủy khỏi hàng đợi nghi thức đổi tên nếu có
          room.ceremonyQueue = room.ceremonyQueue.filter(q => q.botId !== departingBot.id);

          // Câu chào tạm biệt tự nhiên, hài hước trước khi rời sảnh
          const farewellQuotes = [
            "Thôi anh em ở lại chui hang vui vẻ, em xin phép sủi trước nhé! 🏃‍♂️💨",
            "Tạm biệt anh em, mai em lại vào hang bái cờ tiếp! 👋🔴",
            "Off đi ăn cơm đây anh em ơi, MU cố lên! 🍚👋",
            "Gấu réo rồi anh em ơi, xin phép rút lui trong danh dự! 🫡",
            "Em ra ngoài hít chút khí trời đây, tí lại vào hang quỳ tiếp! 🏃‍♂️",
            "Anh em giữ vững niềm tin nhé, em sủi đây! Quỷ Đỏ mãi đỉnh! 🔴🔥",
            "Hết giờ giải lao rồi, em đi cày cuốc kiếm tiền mua áo MU đây! 👋",
            "Thôi hang đông vui quá rồi, em nhường chỗ cho anh em khác nhé! 🫡🔴"
          ];
          const farewellText = farewellQuotes[Math.floor(Math.random() * farewellQuotes.length)];
          departingBot.lastSpokenAt = now;
          broadcast(roomId, {
            type: 'chat',
            id: departingBot.id,
            name: departingBot.name,
            jerseyNumber: departingBot.jerseyNumber,
            text: farewellText,
            at: now
          });

          // Đi bộ tự nhiên hướng về cửa hang (0, 9.8) bằng startBotWalk (không bay, không teleport)
          startBotWalk(roomId, departingBot, ENTRANCE_POS.x, ENTRANCE_POS.z, (arrivedBot) => {
            arrivedBot.departureReached = true;
          }, now);

          console.log(`[AFK DEPARTURE] Phòng ${roomId}: NPC ${departingBot.name} (${departingBot.id}) bắt đầu đi bộ ra cửa rời hang.`);
        }
      }
    }

    // 0.4. Xử lý các NPC đã đi đến cửa và hoàn thành việc rời phòng
    for (const [botId, bot] of room.afks) {
      if (bot.isDeparting && (bot.departureReached || (bot.walkArrivalAt && now >= bot.walkArrivalAt))) {
        room.afks.delete(botId);
        room.afkList = room.afkList.filter(b => b.id !== botId);
        room.ceremonyQueue = room.ceremonyQueue.filter(q => q.botId !== botId);

        // Thông báo WebSocket đến toàn phòng rằng NPC đã rời phòng
        broadcast(roomId, {
          type: 'player-left',
          id: bot.id,
          isAfk: true,
          reason: 'departed'
        });
        broadcastRoomList();

        console.log(`[AFK DEPARTURE] Phòng ${roomId}: NPC ${bot.name} (${bot.id}) đã rời hang qua cửa. Số NPC còn lại: ${room.afks.size}.`);
      }
    }

    if (room.players.size === 0) continue; // Chỉ chạy các tương tác chat/roam khi có người thật trong phòng
    const activeAfks = getActiveAfks(room);
    if (!activeAfks.length) continue;

    // === XỬ LÝ HÀNG ĐỢI NGHI THỨC BÁI CỜ ĐỔI TÊN (SEQUENTIAL KNEELING CEREMONY) ===
    // A. Kiểm tra tiến trình của NPC đang thực hiện nghi thức
    if (room.activeCeremony) {
      const active = room.activeCeremony;
      const bot = room.afks.get(active.botId);

      if (!bot) {
        room.activeCeremony = null;
      } else if (active.state === 'walking') {
        // NPC đang đi bộ tới cờ
        if (now >= active.arrivalAt) {
          // Giai đoạn 2: Đã đến cờ -> Quỳ lạy (prostrate) và nhận tên mới
          active.state = 'kneeling';
          active.kneelUntil = now + KNEEL_DURATION_MS;

          bot.name = active.newName;
          if (!bot.nameHistory) bot.nameHistory = [];
          bot.nameHistory.push(bot.name);
          if (bot.nameHistory.length > 15) bot.nameHistory.shift();

          bot.x = FLAG_CEREMONY_POS.x;
          bot.z = FLAG_CEREMONY_POS.z;
          bot.action = 'prostrate';
          bot.ceremonyStep = 'kneeling';
          bot.ceremonyKneelUntil = active.kneelUntil;

          broadcast(roomId, {
            type: 'player-updated',
            player: publicPlayer(bot)
          });

          // Bong bóng thoại và chat thông báo
          const ceremonySpeech = `Con xin bái cờ MU! Từ nay con mang tên "${bot.name}" để đổi vận cho Quỷ Đỏ! 🔴🔥`;
          broadcast(roomId, {
            type: 'chat',
            id: bot.id,
            name: bot.name,
            jerseyNumber: bot.jerseyNumber,
            text: ceremonySpeech,
            at: now
          });
        }
      } else if (active.state === 'kneeling') {
        // NPC đang quỳ bái cờ
        if (now >= active.kneelUntil) {
          // Giai đoạn 3: Hoàn thành 10 giây quỳ -> Đứng dậy và tiếp tục tự hành
          bot.action = 'idle';
          bot.inCeremony = false;
          bot.ceremonyStep = null;
          bot.ceremonyKneelUntil = 0;
          bot.nextActionAt = now + 1500 + Math.floor(Math.random() * 2000);

          broadcast(roomId, {
            type: 'player-updated',
            player: publicPlayer(bot)
          });

          room.activeCeremony = null; // Hoàn tất, vị trí cờ trống
        }
      }
    }

    // B. Nếu vị trí cờ đang trống (không có entrance ceremony và không có active ceremony)
    if (!room.activeCeremony && !room.activeEntranceBotId && room.ceremonyQueue.length > 0) {
      let candidateIdx = -1;
      for (let q = 0; q < room.ceremonyQueue.length; q++) {
        const item = room.ceremonyQueue[q];
        const b = room.afks.get(item.botId);
        if (!b) {
          room.ceremonyQueue.splice(q, 1);
          q--;
          continue;
        }
        const isBusyWithRealPlayer = (b.carriedBy && room.players.has(b.carriedBy)) ||
                                     (b.carryingId && room.players.has(b.carryingId)) ||
                                     (b.pendingInteraction != null);
        if (!isBusyWithRealPlayer) {
          candidateIdx = q;
          break;
        }
      }

      if (candidateIdx >= 0) {
        const item = room.ceremonyQueue.splice(candidateIdx, 1)[0];
        const bot = room.afks.get(item.botId);

        if (bot) {
          // Nếu đang cõng bot khác: thả nhau xuống
          if (bot.carryingId || bot.carriedBy) {
            const otherId = bot.carryingId || bot.carriedBy;
            const other = room.afks.get(otherId);
            bot.carryingId = null;
            bot.carriedBy = null;
            if (other) {
              other.carryingId = null;
              other.carriedBy = null;
              other.action = 'idle';
              broadcast(roomId, { type: 'carry-ended', carrierId: bot.id, passengerId: other.id });
              broadcast(roomId, { type: 'player-updated', player: publicPlayer(other) });
            }
          }

          // Rời đĩa tròn nếu đang ở trên đĩa tròn
          if (bot.spotId || bot.reservedSpotId) {
            bot.spotId = null;
            bot.reservedSpotId = null;
            bot.spotArrivalAt = 0;
          }

          // Bắt đầu đi bộ trên mặt đất tới cờ (không teleport, không bay)
          bot.inCeremony = true;
          bot.ceremonyStep = 'walking';
          room.activeCeremony = {
            botId: bot.id,
            newName: item.newName,
            state: 'walking'
          };

          startBotWalk(roomId, bot, FLAG_CEREMONY_POS.x, FLAG_CEREMONY_POS.z, (arrivedBot) => {
            const currentRoom = rooms.get(roomId);
            if (!currentRoom || !currentRoom.activeCeremony) return;
            const active = currentRoom.activeCeremony;
            active.state = 'kneeling';
            active.kneelUntil = Date.now() + KNEEL_DURATION_MS;

            arrivedBot.name = active.newName;
            if (!arrivedBot.nameHistory) arrivedBot.nameHistory = [];
            arrivedBot.nameHistory.push(arrivedBot.name);
            if (arrivedBot.nameHistory.length > 15) arrivedBot.nameHistory.shift();

            arrivedBot.facingRot = Math.PI; // Xoay mặt thẳng vào cờ thiêng (-Z)
            arrivedBot.action = 'prostrate';
            arrivedBot.ceremonyStep = 'kneeling';
            arrivedBot.ceremonyKneelUntil = active.kneelUntil;

            broadcast(roomId, {
              type: 'player-updated',
              player: publicPlayer(arrivedBot)
            });

            const ceremonySpeech = `Con xin bái cờ MU! Từ nay con mang tên "${arrivedBot.name}" để đổi vận cho Quỷ Đỏ! 🔴🔥`;
            broadcast(roomId, {
              type: 'chat',
              id: arrivedBot.id,
              name: arrivedBot.name,
              jerseyNumber: arrivedBot.jerseyNumber,
              text: ceremonySpeech,
              at: Date.now()
            });
          }, now);
        }
      }
    }

    // 1. Tự động thả NPC xuống nếu đã được người chơi cõng đủ thời gian
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
      const freeBots = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.spotId && !b.reservedSpotId && !b.inCeremony && !b.inEntranceCeremony);

      if (freePlayers.length > 0 && freeBots.length > 0) {
        const targetPlayer = freePlayers[Math.floor(Math.random() * freePlayers.length)];
        const promptBot = freeBots[Math.floor(Math.random() * freeBots.length)];

        // Bot đi bộ lại gần người chơi một cách tự nhiên
        const destX = targetPlayer.x + (Math.random() < 0.5 ? 1.0 : -1.0);
        const destZ = targetPlayer.z + 0.3;
        startBotWalk(roomId, promptBot, destX, destZ, null, now);

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

    // 3. Tự động gửi tin nhắn chat & đối thoại 2-3 chiều qua lại tự nhiên giữa các NPC (mỗi 12 - 24 giây)
    if (now >= (room.nextAfkChatAt || 0)) {
      room.nextAfkChatAt = now + 12000 + Math.floor(Math.random() * 12000);
      const candidates = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.inCeremony && !b.inEntranceCeremony && (now - (b.lastSpokenAt || 0) > 12000));
      const pool = candidates.length > 0 ? candidates : activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.inCeremony && !b.inEntranceCeremony);

      if (pool.length >= 1) {
        // 60% cơ hội kích hoạt đối thoại qua lại 2-3 lượt giữa các NPC
        if (pool.length >= 2 && Math.random() < 0.60) {
          const idxA = Math.floor(Math.random() * pool.length);
          const botA = pool[idxA];
          const remaining = pool.filter(b => b.id !== botA.id);
          const botB = remaining[Math.floor(Math.random() * remaining.length)];

          // Bot A lên tiếng trước (kèm overhead bubble)
          const quoteA = getUniqueRoomQuote(room);
          botA.lastSpokenAt = now;
          broadcast(roomId, {
            type: 'chat',
            id: botA.id,
            name: botA.name,
            jerseyNumber: botA.jerseyNumber,
            text: quoteA,
            at: now
          });

          // Bot B phản hồi sau 2.0 - 3.5 giây
          const replyDelay = 2000 + Math.floor(Math.random() * 1500);
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (!currentRoom || currentRoom.players.size === 0) return;
            const currentBotB = currentRoom.afks.get(botB.id);
            if (currentBotB && !currentBotB.inCeremony && !currentBotB.inEntranceCeremony && !currentBotB.carryingId && !currentBotB.carriedBy) {
              const quoteB = getUniqueRoomQuote(currentRoom);
              currentBotB.lastSpokenAt = Date.now();
              broadcast(roomId, {
                type: 'chat',
                id: currentBotB.id,
                name: currentBotB.name,
                jerseyNumber: currentBotB.jerseyNumber,
                text: quoteB,
                at: Date.now()
              });

              // 30% cơ hội Bot C nói thêm 1 câu tạo hội thoại 3 người sôi động
              const candidatesC = currentRoom.afkList.filter(b => b.id !== botA.id && b.id !== botB.id && !b.inCeremony && !b.inEntranceCeremony && !b.carryingId && !b.carriedBy);
              if (candidatesC.length > 0 && Math.random() < 0.30) {
                const botC = candidatesC[Math.floor(Math.random() * candidatesC.length)];
                setTimeout(() => {
                  const r = rooms.get(roomId);
                  if (!r || r.players.size === 0) return;
                  const currentBotC = r.afks.get(botC.id);
                  if (currentBotC && !currentBotC.inCeremony && !currentBotC.inEntranceCeremony && !currentBotC.carryingId && !currentBotC.carriedBy) {
                    const quoteC = getUniqueRoomQuote(r);
                    currentBotC.lastSpokenAt = Date.now();
                    broadcast(roomId, {
                      type: 'chat',
                      id: currentBotC.id,
                      name: currentBotC.name,
                      jerseyNumber: currentBotC.jerseyNumber,
                      text: quoteC,
                      at: Date.now()
                    });
                  }
                }, 2200 + Math.floor(Math.random() * 1400));
              }
            }
          }, replyDelay);
        } else {
          // 40% NPC tự phát biểu một câu nhận xét / meme riêng
          const bot = pool[Math.floor(Math.random() * pool.length)];
          const quote = getUniqueRoomQuote(room);
          bot.lastSpokenAt = now;
          broadcast(roomId, {
            type: 'chat',
            id: bot.id,
            name: bot.name,
            jerseyNumber: bot.jerseyNumber,
            text: quote,
            at: now
          });
        }
      }
    }

    // 4. Tương tác ngẫu nhiên giữa 2 NPC (đập tay, bắt tay) khi ở gần nhau
    if (activeAfks.length >= 2 && Math.random() < 0.25) {
      const freeBots = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.spotId && !b.reservedSpotId && !b.inCeremony && !b.inEntranceCeremony);
      if (freeBots.length >= 2) {
        for (let i = 0; i < freeBots.length - 1; i++) {
          for (let j = i + 1; j < freeBots.length; j++) {
            const b1 = freeBots[i];
            const b2 = freeBots[j];
            if (Math.hypot(b1.x - b2.x, b1.z - b2.z) < 2.5) {
              const kind = Math.random() < 0.5 ? 'highfive' : 'handshake';
              broadcast(roomId, { type: 'interaction-started', kind, playerA: b1.id, playerB: b2.id, duration: 1500 });
              b1.action = 'cheer';
              b2.action = 'cheer';
              b1.nextActionAt = now + 1800;
              b2.nextActionAt = now + 1800;
              broadcast(roomId, { type: 'player-updated', player: publicPlayer(b1) });
              broadcast(roomId, { type: 'player-updated', player: publicPlayer(b2) });
              break;
            }
          }
        }
      }
    }

    // 5. NPC Autonomous AI: Di chuyển liên tục bám sát sàn, cúi chào người chơi và tự hành thông minh
    const occupiedSpots = getOccupiedSpotIds(room);

    for (let idx = 0; idx < activeAfks.length; idx++) {
      const bot = activeAfks[idx];

      // Đang trong nghi thức bái cờ nhập hang, đổi tên hoặc đang đi ra cửa rời phòng: giữ nguyên
      if (bot.isDeparting || bot.inCeremony || bot.inEntranceCeremony) continue;

      // Đang được cõng bởi người chơi thật hoặc đang cõng người chơi thật: giữ nguyên
      if (bot.carriedBy && room.players.has(bot.carriedBy)) continue;
      if (bot.carryingId && room.players.has(bot.carryingId)) continue;

      // 5.1. Xử lý NPC đang đi bộ (walk): Kiểm tra xem đã đến đích chưa
      if (bot.action === 'walk' && bot.walkArrivalAt) {
        if (now >= bot.walkArrivalAt) {
          // Cập nhật vị trí thực tế tại đích đến
          bot.x = bot.targetX;
          bot.z = bot.targetZ;
          bot.startX = bot.targetX;
          bot.startZ = bot.targetZ;
          bot.walkStartAt = 0;
          bot.walkArrivalAt = 0;

          // Nếu có điểm đến tiếp theo (do đi đường vòng tránh bàn chiến thuật)
          if (bot.pendingFinalDest) {
            const next = bot.pendingFinalDest;
            bot.pendingFinalDest = null;
            startBotWalk(roomId, bot, next.x, next.z, next.onArrive, now);
            continue;
          }

          // Nếu có callback khi đến đích (bái cờ, ngồi lên đệm, cúi chào đối tượng)
          if (bot.onWalkArrive) {
            const cb = bot.onWalkArrive;
            bot.onWalkArrive = null;
            cb(bot);
            continue;
          }

          // Đến nơi đi dạo bình thường: dừng lại nghỉ ngắn 1.0 - 2.0s trước khi chọn hành động tiếp
          bot.action = 'idle';
          bot.nextActionAt = now + 1000 + Math.floor(Math.random() * 1000);
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        }
        continue; // Đang đi bộ trên mặt đất, tiếp tục di chuyển
      }

      // 5.2. Xử lý NPC đang cúi chào (bow): Hết thời gian cúi chào thì đứng thẳng dậy
      if (bot.action === 'bow' && bot.bowUntil) {
        if (now >= bot.bowUntil) {
          bot.bowUntil = 0;
          bot.action = 'idle';
          bot.nextActionAt = now + 800 + Math.floor(Math.random() * 800);
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        }
        continue;
      }

      // 5.3. Xử lý NPC đang ở trên đĩa tròn (spotId)
      if (bot.spotId) {
        if (now >= (bot.stayOnSpotUntil || 0)) {
          // Hết thời gian ngồi trên đệm -> Bước xuống sàn và đi bộ tiếp
          bot.spotId = null;
          bot.stayOnSpotUntil = 0;
          const side = bot.x < 0 ? -1 : 1;
          const destX = side * (4.2 + Math.random() * 1.5);
          const destZ = Math.max(-14, Math.min(6, bot.z + (Math.random() - 0.5) * 3));
          startBotWalk(roomId, bot, destX, destZ, null, now);
        } else if (Math.random() < 0.25) {
          // Thỉnh thoảng đổi dáng giữa ngồi và vỗ tay/hô cổ vũ
          bot.action = bot.action === 'sit' ? 'cheer' : 'sit';
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        }
        continue;
      }

      // Chưa đến thời điểm NPC đưa ra quyết định hành động tiếp theo
      if (now < (bot.nextActionAt || 0)) continue;

      // Xử lý 2 NPC đang cõng nhau: 50% cơ hội thả nhau xuống
      if (bot.carryingId || bot.carriedBy) {
        if (Math.random() < 0.5) {
          const otherId = bot.carryingId || bot.carriedBy;
          const other = room.afks.get(otherId);
          bot.carryingId = null;
          bot.carriedBy = null;
          bot.action = 'idle';
          bot.nextActionAt = now + 1500;
          if (other) {
            other.carryingId = null;
            other.carriedBy = null;
            other.action = 'idle';
            other.x = bot.x + 0.8;
            other.z = bot.z;
            other.nextActionAt = now + 1500;
            broadcast(roomId, { type: 'carry-ended', carrierId: bot.id, passengerId: other.id });
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(other) });
          }
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // 5.4. ĐƯA RA QUYẾT ĐỊNH HÀNH ĐỘNG TỰ HÀNH MỚI CHO NPC TRÊN SÀN (WEIGHTED STATE MACHINE)
      const roll = Math.random();

      // === NHÁNH 1: 30% TIẾP CẬN NGƯỜI CHƠI HOẶC NPC KHÁC VÀ CÚI CHÀO KÍNH CẨN (APPROACH & BOW) ===
      if (roll < 0.30) {
        // Tìm đối tượng để tiếp cận: ưu tiên người chơi thật trong phòng (nếu có)
        const realPlayers = [...room.players.values()].filter(p => !p.carryingId && !p.carriedBy);
        const otherBots = activeAfks.filter(b => b.id !== bot.id && !b.inEntranceCeremony && !b.inCeremony && !b.isDeparting && !b.carryingId && !b.carriedBy);

        let target = null;
        let isRealPlayer = false;

        if (realPlayers.length > 0 && Math.random() < 0.50) {
          target = realPlayers[Math.floor(Math.random() * realPlayers.length)];
          isRealPlayer = true;
        } else if (otherBots.length > 0) {
          target = otherBots[Math.floor(Math.random() * otherBots.length)];
        }

        if (target) {
          // Tính điểm dừng cách đối tượng 1.4m để đứng chào đối diện
          const targetPos = target.isAfk ? getBotCurrentPos(target, now) : { x: target.x, z: target.z };
          const angle = Math.atan2(bot.x - targetPos.x, bot.z - targetPos.z);
          let approachX = targetPos.x + Math.sin(angle) * 1.4;
          let approachZ = targetPos.z + Math.cos(angle) * 1.4;

          approachX = Math.max(-11.5, Math.min(11.5, approachX));
          approachZ = Math.max(-15.5, Math.min(8.5, approachZ));
          if (isInsideObstacle(approachX, approachZ)) {
            approachX = approachX < 0 ? -4.5 : 4.5;
          }

          startBotWalk(roomId, bot, approachX, approachZ, (arrivedBot) => {
            const currentR = rooms.get(roomId);
            if (!currentR) return;
            const liveTarget = isRealPlayer ? currentR.players.get(target.id) : currentR.afks.get(target.id);
            const livePos = liveTarget ? (liveTarget.isAfk ? getBotCurrentPos(liveTarget) : { x: liveTarget.x, z: liveTarget.z }) : targetPos;

            // Xoay mặt nhìn thẳng vào đối tượng
            arrivedBot.facingRot = Math.atan2(livePos.x - arrivedBot.x, livePos.z - arrivedBot.z);
            // Thực hiện động tác cúi chào (bow) giống hệt người chơi
            arrivedBot.action = 'bow';
            arrivedBot.bowUntil = Date.now() + 2400 + Math.floor(Math.random() * 600); // Cúi chào 2.4 - 3.0s
            arrivedBot.nextActionAt = arrivedBot.bowUntil;

            // Lời chào kính cẩn trong chat và bong bóng thoại
            const greeting = GREETING_QUOTES[Math.floor(Math.random() * GREETING_QUOTES.length)];
            arrivedBot.lastSpokenAt = Date.now();
            broadcast(roomId, {
              type: 'chat',
              id: arrivedBot.id,
              name: arrivedBot.name,
              jerseyNumber: arrivedBot.jerseyNumber,
              text: greeting,
              at: Date.now()
            });
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(arrivedBot) });

            // Nếu đối tượng là một NPC khác và đang rảnh: 60% cơ hội quay sang cúi chào đáp lễ!
            if (!isRealPlayer && liveTarget && liveTarget.action !== 'walk' && !liveTarget.inCeremony && !liveTarget.isDeparting) {
              if (Math.random() < 0.60) {
                liveTarget.facingRot = Math.atan2(arrivedBot.x - liveTarget.x, arrivedBot.z - liveTarget.z);
                liveTarget.action = 'bow';
                liveTarget.bowUntil = Date.now() + 2000 + Math.floor(Math.random() * 500);
                liveTarget.nextActionAt = liveTarget.bowUntil;
                broadcast(roomId, { type: 'player-updated', player: publicPlayer(liveTarget) });
              }
            }
          }, now);
          continue;
        }
      }

      // === NHÁNH 2: 20% ĐI BỘ ĐẾN ĐĨA TRÒN / ĐỆM NGỒI (VISIT SEAT CUSHION) ===
      if (roll < 0.50) {
        const freeSpots = CAVE_SPOTS.filter(s => !occupiedSpots.has(s.id));
        if (freeSpots.length > 0) {
          const chosen = freeSpots[Math.floor(Math.random() * freeSpots.length)];
          occupiedSpots.add(chosen.id);

          // Đi bộ trên mặt sàn (spotId: null, y: 0) đến tọa độ của đĩa tròn
          startBotWalk(roomId, bot, chosen.x, chosen.z, (arrivedBot) => {
            const currentR = rooms.get(roomId);
            if (!currentR) return;

            // Kiểm tra xem vị trí có bị người chơi thật chiếm trong lúc đi bộ tới không
            const takenByReal = [...currentR.players.values()].some(p => p.spotId === chosen.id);
            if (takenByReal) {
              // Nhường cho người thật, bước sang bên cạnh trên sàn
              startBotWalk(roomId, arrivedBot, arrivedBot.x + (arrivedBot.x < 0 ? -1.2 : 1.2), arrivedBot.z, null, Date.now());
            } else {
              // Đã bước lên đệm thành công -> gán spotId và chuyển động tác ngồi hoặc cổ vũ!
              arrivedBot.spotId = chosen.id;
              arrivedBot.action = Math.random() < 0.65 ? 'sit' : 'cheer';
              arrivedBot.stayOnSpotUntil = Date.now() + 3500 + Math.floor(Math.random() * 2500); // 3.5 - 6s
              arrivedBot.nextActionAt = arrivedBot.stayOnSpotUntil;
              broadcast(roomId, { type: 'player-updated', player: publicPlayer(arrivedBot) });
            }
          }, now);
          continue;
        }
      }

      // === NHÁNH 3: 40% DI CHUYỂN TỰ DO QUANH CÁC KHU VỰC TRONG HANG (ROAM SAFE ZONES) ===
      if (roll < 0.90) {
        const safeZones = [
          { minX: -2.5, maxX: 2.5, minZ: -3.5, maxZ: 5.5 },   // Thảm đỏ trung tâm
          { minX: -8.5, maxX: -4.2, minZ: -14.0, maxZ: 5.0 }, // Hành lang cánh trái
          { minX: 4.2, maxX: 8.5, minZ: -14.0, maxZ: 5.0 },   // Hành lang cánh phải
          { minX: -4.0, maxX: 4.0, minZ: 6.0, maxZ: 8.5 },    // Sảnh đón tiếp gần lối vào
          { minX: -7.0, maxX: -4.0, minZ: -15.0, maxZ: -11.0 }, // Góc phụ bên trái bàn thờ
          { minX: 4.0, maxX: 7.0, minZ: -15.0, maxZ: -11.0 }    // Góc phụ bên phải bàn thờ
        ];
        const zone = safeZones[Math.floor(Math.random() * safeZones.length)];
        let destX = zone.minX + Math.random() * (zone.maxX - zone.minX);
        let destZ = zone.minZ + Math.random() * (zone.maxZ - zone.minZ);

        // Tránh vị trí cờ thiêng nếu đang có người làm lễ
        if (room.activeCeremony && Math.hypot(destX - FLAG_CEREMONY_POS.x, destZ - FLAG_CEREMONY_POS.z) < 1.8) {
          destZ += 2.5;
        }

        startBotWalk(roomId, bot, destX, destZ, null, now);
        continue;
      }

      // === NHÁNH 4: 10% VỖ TAY / HÔ CỔ VŨ NHANH TRÊN SÀN (CHEER / STRETCH) ===
      bot.action = 'cheer';
      bot.nextActionAt = now + 1200 + Math.floor(Math.random() * 1000); // Nghỉ ngắn 1.2 - 2.2s
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
}, 1000).unref();

server.listen(PORT, () => console.log(`Hang MU running on ${PORT}; ${MAX_ROOMS} rooms x ${ROOM_CAPACITY} players (40 Autonomous NPCs active across 4 rooms)`));
