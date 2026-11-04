import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
const $ = s => document.querySelector(s);
const landing = $("#landing"), game = $("#game"), nameInput = $("#playerName"), numberInput = $("#jerseyNumber"), roomList = $("#roomList");
let socket, myId = null, roomId = null, selectedRoom = "hang-01", capacity = 50, scene, camera, renderer, clock, localPlayer, ritualActive = false, ritualStart = 0, lastActivity = Date.now(), presenceTimer = null, presenceDeadline = 0, lastRitualSend = 0;
// Camera cố định phía sau nhân vật; không hỗ trợ xoay 360° hoặc zoom.
let isJumping = false, jumpVelocity = 0, jumpHeight = 0;
const JUMP_POWER = 7, JUMP_GRAVITY = 18;
const seatSpots = new Map(), raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
let spotMaterials = null; const fireEffects = []; let bannerTimer = null;
const players = new Map(), keys = {}, pressedMoves = new Set(), joystickVector = { x: 0, z: 0 }; let lastSend = 0, moveAction = "idle", chatUnread = 0, selectedCarryTarget = null, carryInviteTimer = null, interactionInviteTimer = null, activeInteractions = new Map();
function wsUrl() { return (location.protocol === "https:" ? "wss://" : "ws://") + location.host }
function connect() { socket = new WebSocket(wsUrl()); socket.onmessage = e => handleMessage(JSON.parse(e.data)); socket.onclose = () => { if (!game.classList.contains("hidden")) toast("Mất kết nối máy chủ. Hãy tải lại trang để vào lại.") } }
function send(data) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)) }
function markActivity() { lastActivity = Date.now(); }
function dismissPresence() {}
function showPresence() {}
function addChatLine(name, number, text) { const box = $('#chatMessages'); const line = document.createElement('div'); line.className = 'chat-line'; const b = document.createElement('b'); b.textContent = name; const n = document.createElement('span'); n.className = 'jersey'; n.textContent = ` (${number})`; const t = document.createTextNode(`: ${text}`); line.append(b, n, t); box.append(line); while (box.children.length > 40) box.firstChild.remove(); box.scrollTop = box.scrollHeight; if ($('#chatPanel').classList.contains('hidden')) { chatUnread++; $('#chatUnread').textContent = chatUnread; $('#chatUnread').classList.remove('hidden'); } }
function handleMessage(m) {
    if (m.type === "room-list") renderRooms(m.rooms);
    if (m.type === "join-error") { toast(m.message || "Tên hiển thị không hợp lệ."); $("#nameHint").textContent = m.message || "Hãy chọn tên khác."; $("#nameHint").classList.add("invalid"); }
    if (m.type === "joined") {
        myId = m.id; roomId = m.roomId; capacity = m.capacity; if (m.hangMode) applyHangMode(m.hangMode, m.by, m.mood); $("#roomLabel").textContent = roomId.toUpperCase(); $("#capacity").textContent = capacity; $("#onlineCount").textContent = m.totalCount || m.players.length;
        landing.classList.add("hidden"); game.classList.remove("hidden"); init3D(); for (const p of m.players) addPlayer(p, p.id === myId); updateCount(); if (localPlayer) { ritualActive = true; ritualStart = performance.now(); localPlayer.avatar.root.position.set(0, 0, 10); localPlayer.target.set(0, 0, 10); localPlayer.avatar.root.rotation.y = Math.PI; localPlayer.action = "walk"; if (localPlayer.carryingId || localPlayer.carriedBy) showCarryRelease(true); toast("Đang tiến đến thảm làm nghi thức nhập hang…"); }
        startBackgroundMusic();
    }
    if (m.type === "player-joined") { addPlayer(m.player, false); updateCount(); }
    if (m.type === "player-left") { removePlayer(m.id); updateCount(); _rebuildSeatPanelIfOpen(); }
    if (m.type === "player-updated") { const p = players.get(m.player.id); if (p) { const wasCheering = p.action === "cheer"; p.target.set(m.player.x, 0, m.player.z); if (p === localPlayer && m.player.spotId) p.avatar.root.position.set(m.player.x, 0, m.player.z); p.action = m.player.action; p.spotId = m.player.spotId || null; p.carryingId = m.player.carryingId || null; p.carriedBy = m.player.carriedBy || null; if (p === localPlayer && p.spotId && p.action === "cheer" && !wasCheering) playCheerAudio(); } _rebuildSeatPanelIfOpen(); }
    if (m.type === "carry-invite") { showCarryInvite(m.from, m.text); }
    if (m.type === "carry-pending") toast(`Đã gửi lời mời cõng ${m.targetName}.`);
    if (m.type === "carry-declined") toast(`${m.targetName} đã từ chối lời mời cõng.`);
    if (m.type === "carry-error") toast(m.message || "Không thể thực hiện tương tác cõng.");
    if (m.type === "interaction-invite") showInteractionInvite(m);
    if (m.type === "interaction-pending") toast(`Đã gửi lời mời tương tác tới ${m.targetName}.`);
    if (m.type === "interaction-declined") toast(`${m.targetName} đã từ chối.`);
    if (m.type === "interaction-error") toast(m.message || "Không thể tương tác lúc này.");
    if (m.type === "interaction-started") { activeInteractions.set(`${m.playerA}:${m.playerB}`, { kind: m.kind, until: performance.now() + m.duration, a: m.playerA, b: m.playerB }); const a = players.get(m.playerA), b = players.get(m.playerB); if (a && b) { a.action = m.kind === 'highfive' ? 'highfive' : m.kind === 'handshake' ? 'handshake' : 'push'; b.action = a.action; const dx = b.avatar.root.position.x - a.avatar.root.position.x, dz = b.avatar.root.position.z - a.avatar.root.position.z; a.avatar.root.rotation.y = Math.atan2(dx, dz); b.avatar.root.rotation.y = Math.atan2(-dx, -dz); } showHangEvent(m.kind === 'highfive' ? '🙌 ĐẬP TAY!' : m.kind === 'handshake' ? '🤝 BẮT TAY!' : '👉 ĐẨY NHẸ!'); }
    if (m.type === "carry-started") { const carrier = players.get(m.carrierId), passenger = players.get(m.passengerId); if (carrier && passenger) { carrier.carryingId = passenger.id; passenger.carriedBy = carrier.id; passenger.carryStyle = m.style || "piggyback"; carrier.action = "idle"; passenger.action = "carried"; carrier.spotId = null; passenger.spotId = null; } hideCarryMenu(); if (localPlayer && (localPlayer.id === m.carrierId || localPlayer.id === m.passengerId)) showCarryRelease(true); }
    if (m.type === "carry-ended") { const carrier = players.get(m.carrierId), passenger = players.get(m.passengerId); if (carrier) carrier.carryingId = null; if (passenger) { passenger.carriedBy = null; passenger.carryStyle = null; passenger.avatar.root.rotation.z = 0; } if (carrier && carrier.action === "carried") carrier.action = "idle"; if (passenger && passenger.action === "carried") passenger.action = "idle"; if (localPlayer && (localPlayer.id === m.carrierId || localPlayer.id === m.passengerId)) { showCarryRelease(false); toast("Đã kết thúc cõng."); } }
    if (m.type === "spot-error") toast(m.message);
    if (m.type === "chat") { addChatLine(m.name, m.jerseyNumber, m.text); showSpeechBubble(m.id, m.text); }
    if (m.type === "chat-error") toast(m.message);
    if (m.type === "hang-mode") applyHangMode(m.mode, m.by, m.mood);
    if (m.type === "hang-event") showHangEvent(m.message);

    if (m.type === "collective-cheer") showHangEvent("🔥 CẢ HANG ĐANG BÙNG CHÁY — QUỶ ĐỎ ƠI, CỔ VŨ NÀO! 🔥");
    if (m.type === "force-reload") { toast(m.message || "Bạn đã rời phòng."); setTimeout(() => location.reload(), 400); }
    if (m.type === "ritual-locked") toast("Nghi thức chưa hoàn tất, vui lòng chờ một chút.");
}
function renderRooms(rooms) {
    const all = Array.from({ length: 4 }, (_, i) => rooms.find(r => r.id === `hang-${String(i + 1).padStart(2, "0")}`) || { id: `hang-${String(i + 1).padStart(2, "0")}`, count: 0, capacity: 50 });
    $("#roomTotal").textContent = `${all.length} phòng`;
    roomList.innerHTML = all.map((r, i) => { const full = r.count >= r.capacity, pct = Math.min(100, Math.round(r.count / r.capacity * 100)), active = selectedRoom === r.id; return `<button type="button" class="room-card ${active ? "selected" : ""} ${full ? "full" : ""}" data-room="${r.id}" ${full ? "disabled" : ""} aria-pressed="${active}"><span class="room-card-top"><span class="room-number">0${i + 1}</span><span class="room-status"><i></i>${full ? "ĐÃ ĐẦY" : active ? "ĐANG CHỌN" : "CÒN CHỖ"}</span></span><span class="room-card-title">${r.id.replace("hang-", "HANG ").toUpperCase()}</span><span class="room-card-sub">HANG ĐẤU QUỶ ĐỎ · KHU VỰC ${i + 1}</span><span class="room-progress"><i style="width:${pct}%"></i></span><span class="room-card-bottom"><b>${r.count}<small> / ${r.capacity} người</small></b><em>${full ? "HẾT CHỖ" : active ? "✓ PHÒNG ĐÃ CHỌN" : "CHỌN PHÒNG →"}</em></span></button>` }).join("");
    roomList.querySelectorAll("[data-room]").forEach(b => b.addEventListener("click", () => { selectedRoom = b.dataset.room; renderRooms(all); $("#roomHint").textContent = `Đã chọn ${selectedRoom.toUpperCase()} — nhập tên và số áo rồi vào hang.`; }));
}
function applyHangMode(mode, by, mood) { const fallback = { normal: { title: 'HANG ĐANG YÊN ẮNG', text: 'MU đang trong tình trạng khá tồi tệ… nhưng anh em vẫn còn đây.', icon: '🕯️' }, gloomy: { title: 'MU ĐANG TRONG TÌNH TRẠNG KHÁ TỒI TỆ', text: 'Xin giữ bình tĩnh. Ban quản lý hang chưa có phát ngôn.', icon: '🥀' }, crisis: { title: 'KHỦNG HOẢNG TINH THẦN', text: 'Đề nghị các thành viên không nhìn thẳng vào bảng tin.', icon: '🚨' }, despair: { title: 'TUYỆT VỌNG TOÀN TẬP', text: 'Chỉ còn ánh lửa và tình đồng đội.', icon: '🫠' } }; const v = mood || fallback[mode] || fallback.gloomy; $('#hangMoodIcon').textContent = v.icon; $('#hangMoodTitle').textContent = v.title; $('#hangMoodText').textContent = v.text; }
function showHangEvent(message) { const el = $('#hangEventBanner'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.add('hidden'), 4200) }

function updateCount() { $("#onlineCount").textContent = players.size; }
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1800) }
function showSpeechBubble(playerId, text) {
    const p = players.get(playerId);
    if (!p || !p.avatar) return;
    if (p._bubbleSprite) {
        p.avatar.root.remove(p._bubbleSprite);
        p._bubbleSprite.material.map?.dispose();
        p._bubbleSprite.material.dispose();
        p._bubbleSprite = null;
    }
    clearTimeout(p._bubbleTimer);

    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    // Giới hạn độ dài để bong bóng luôn gọn đẹp, không bị tràn màn hình
    const displayText = cleanText.length > 38 ? cleanText.slice(0, 36) + '…' : cleanText;

    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 160;
    const ctx = c.getContext("2d");

    // Đo độ rộng chữ để tạo khung bóng thoại co giãn tự nhiên
    ctx.font = "bold 32px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
    const textMetrics = ctx.measureText(displayText);
    const textWidth = Math.min(470, Math.max(140, textMetrics.width + 52));
    const bubbleX = (512 - textWidth) / 2;
    const bubbleY = 14;
    const bubbleH = 92;
    const cornerRadius = 20;

    // Bóng đổ nhẹ cho bong bóng thoại nổi bật
    ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;

    // Nền bong bóng thoại: tone tối sang trọng, tương phản cao, dễ nhìn cả ngày lẫn đêm
    ctx.fillStyle = "rgba(18, 10, 8, 0.94)";
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, textWidth, bubbleH, cornerRadius);
    ctx.fill();

    // Viền vàng kim tinh tế
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#eeb93a";
    ctx.stroke();

    // Mũi nhọn đuôi bong bóng thoại chỉ thẳng xuống đỉnh đầu nhân vật
    ctx.fillStyle = "rgba(18, 10, 8, 0.94)";
    ctx.beginPath();
    ctx.moveTo(256 - 14, bubbleY + bubbleH - 1);
    ctx.lineTo(256, bubbleY + bubbleH + 26);
    ctx.lineTo(256 + 14, bubbleY + bubbleH - 1);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#eeb93a";
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(256 - 14, bubbleY + bubbleH);
    ctx.lineTo(256, bubbleY + bubbleH + 26);
    ctx.lineTo(256 + 14, bubbleY + bubbleH);
    ctx.stroke();

    // Text chữ trắng ngà sắc nét, căn giữa
    ctx.fillStyle = "#fff8e7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 30px 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
    ctx.fillText(displayText, 256, bubbleY + bubbleH / 2);

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);

    // Kích thước sprite tự co giãn theo chiều dài chữ
    const aspectW = Math.max(1.85, (textWidth / 512) * 3.3);
    sprite.scale.set(aspectW, aspectW * (160 / 512), 1);
    // Vị trí nằm ngay phía trên đầu & trên cả nhãn tên
    sprite.position.set(0, 2.95, 0);

    p.avatar.root.add(sprite);
    p._bubbleSprite = sprite;

    // Tự động biến mất sau 3.8 giây (trong khoảng 3 - 5 giây chuẩn yêu cầu)
    p._bubbleTimer = setTimeout(() => {
        if (p._bubbleSprite) {
            p.avatar.root.remove(p._bubbleSprite);
            p._bubbleSprite.material.map?.dispose();
            p._bubbleSprite.material.dispose();
            p._bubbleSprite = null;
        }
    }, 3800);
}
function textSprite(text, opts = {}) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 128; const x = c.getContext("2d"); x.clearRect(0, 0, 512, 128);
    x.font = `900 ${opts.size || 64}px system-ui,sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.lineWidth = 12; x.strokeStyle = "#210908"; x.strokeText(text, 256, 64); x.fillStyle = opts.color || "#fff2cf"; x.fillText(text, 256, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(opts.width || 1.5, opts.height || .38, 1); return s;
}
function makeAvatar(name, number) {
    const root = new THREE.Group(), bodyRig = new THREE.Group(); root.add(bodyRig);
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9a477, roughness: .88 });
    const red = new THREE.MeshStandardMaterial({ color: 0xb90d19, roughness: .78 });
    const darkRed = new THREE.MeshStandardMaterial({ color: 0x760812, roughness: .9 });
    const black = new THREE.MeshStandardMaterial({ color: 0x171719, roughness: .95 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xf0c45f, roughness: .65 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0x780b15, roughness: .82 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf5eee0, roughness: .8 });
    // Hips/torso pivot: animation rotates around the waist, never around the floor.
    bodyRig.position.y = .82;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.31, .48, 6, 12), red); torso.position.y = .02; torso.scale.set(1.05, 1, 0.82); bodyRig.add(torso);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.115, .035, 8, 20), gold); collar.position.set(0, .285, 0); collar.rotation.x = Math.PI / 2; bodyRig.add(collar);
    // Football-shirt styling: subtle vertical panels follow the front of the torso.
    for (const x of [-.145, 0, .145]) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(.052, .49, .018), stripeMat); stripe.position.set(x, .015, .257 - Math.abs(x) * .08); bodyRig.add(stripe) }
    const chestLine = new THREE.Mesh(new THREE.BoxGeometry(.46, .018, .022), gold); chestLine.position.set(0, -.205, .247); bodyRig.add(chestLine);
    // Original Hang MU fan emblem: shield + cave flame + HM monogram (not a club crest).
    const badgeShape = new THREE.Shape(); badgeShape.moveTo(-.085, .075); badgeShape.lineTo(.085, .075); badgeShape.lineTo(.075, -.035); badgeShape.quadraticCurveTo(0, -.14, -.075, -.035); badgeShape.closePath();
    const badge = new THREE.Mesh(new THREE.ShapeGeometry(badgeShape), gold); badge.position.set(-.19, .16, .279); bodyRig.add(badge);
    const badgeCore = new THREE.Mesh(new THREE.CircleGeometry(.047, 20), darkRed); badgeCore.position.set(-.19, .145, .284); bodyRig.add(badgeCore);
    const badgeFlame = new THREE.Mesh(new THREE.ConeGeometry(.022, .064, 7), white); badgeFlame.position.set(-.19, .16, .291); bodyRig.add(badgeFlame);
    const badgeText = textSprite('HM', { size: 48, width: .24, height: .09, color: '#fff0c2' }); badgeText.position.set(-.19, .095, .295); badgeText.scale.set(.12, .045, 1); bodyRig.add(badgeText);
    const sleeves = []; for (const x of [-.39, .39]) { const pivot = new THREE.Group(); pivot.position.set(x, .17, 0); bodyRig.add(pivot); const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(.115, .28, 5, 10), red); sleeve.position.y = -.12; pivot.add(sleeve); const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.115, .115, .055, 12), gold); cuff.position.y = -.29; pivot.add(cuff); const sleeveStripe = new THREE.Mesh(new THREE.BoxGeometry(.018, .23, .13), gold); sleeveStripe.position.set(0, -.12, .085); pivot.add(sleeveStripe); sleeves.push(pivot) }
    // Printed jersey panel: number, club line and trim are one texture attached to the shirt.
    const printCanvas = document.createElement("canvas"); printCanvas.width = 512; printCanvas.height = 512; const pc = printCanvas.getContext("2d");
    pc.fillStyle = "#a90e1b"; pc.beginPath(); pc.roundRect(48, 18, 416, 476, 54); pc.fill();
    pc.strokeStyle = "#e5b653"; pc.lineWidth = 12; pc.beginPath(); pc.roundRect(55, 25, 402, 462, 48); pc.stroke();
    pc.textAlign = "center"; pc.fillStyle = "#f4d58d"; pc.font = "900 42px system-ui"; pc.fillText("HANG MU", 256, 100);
    pc.fillStyle = "#fff7e8"; pc.font = "1000 220px system-ui"; pc.shadowColor = "#5a0710"; pc.shadowBlur = 8; pc.fillText(String(number).padStart(2, "0"), 256, 335); pc.shadowBlur = 0;
    pc.fillStyle = "#f4d58d"; pc.font = "900 34px system-ui"; pc.fillText("CAVE CREW", 256, 425);
    const printTex = new THREE.CanvasTexture(printCanvas); printTex.colorSpace = THREE.SRGBColorSpace;
    const jerseyPrint = new THREE.Mesh(new THREE.PlaneGeometry(.43, .43), new THREE.MeshBasicMaterial({ map: printTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    jerseyPrint.position.set(0, .035, -.268); jerseyPrint.rotation.y = Math.PI; bodyRig.add(jerseyPrint);
    // Oversized rounded chibi head, ears and simple face details.
    const headGroup = new THREE.Group(); headGroup.position.set(0, .53, .015); bodyRig.add(headGroup);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.37, 24, 18), skin); head.scale.set(1, 1.02, .94); headGroup.add(head);
    for (const x of [-.355, .355]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(.105, 12, 10), skin); ear.position.set(x, -.02, 0); headGroup.add(ear) }
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.365, 20, 12, 0, Math.PI * 2, 0, Math.PI * .32), black); hair.position.y = .12; headGroup.add(hair);
    // Expressive chibi face: paired eyes, pupils, brows and a small friendly smile.
    const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .38 });
    const eyeDark = new THREE.MeshStandardMaterial({ color: 0x211713, roughness: .42 });
    const eyeGlint = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (const x of [-.125, .125]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(.061, 16, 12), eyeWhite); eye.scale.set(1, .94, .48); eye.position.set(x, -.015, .323); headGroup.add(eye);
        const pupil = new THREE.Mesh(new THREE.SphereGeometry(.033, 14, 10), eyeDark); pupil.scale.set(1, 1, .55); pupil.position.set(x + .006, -.019, .352); headGroup.add(pupil);
        const glint = new THREE.Mesh(new THREE.SphereGeometry(.011, 8, 8), eyeGlint); glint.position.set(x - .006, -.004, .367); headGroup.add(glint);
        const brow = new THREE.Mesh(new THREE.CapsuleGeometry(.012, .075, 3, 8), black); brow.position.set(x, .075, .319); brow.rotation.z = x < 0 ? -.12 : .12; headGroup.add(brow);
    }
    const smileCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-.075, -.105, .331), new THREE.Vector3(-.038, -.128, .348), new THREE.Vector3(0, -.133, .352), new THREE.Vector3(.038, -.128, .348), new THREE.Vector3(.075, -.105, .331)]);
    const smile = new THREE.Mesh(new THREE.TubeGeometry(smileCurve, 16, .009, 6, false), eyeDark); headGroup.add(smile);
    // Separate hinged legs and chunky boots make kneeling readable.
    const legPivots = []; for (const x of [-.145, .145]) { const hip = new THREE.Group(); hip.position.set(x, .75, 0); root.add(hip); const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(.105, .24, 4, 10), black); thigh.position.y = -.16; hip.add(thigh); const knee = new THREE.Group(); knee.position.y = -.29; hip.add(knee); const shin = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .2, 4, 10), black); shin.position.y = -.12; knee.add(shin); const boot = new THREE.Mesh(new THREE.BoxGeometry(.19, .12, .31), black); boot.position.set(0, -.25, .075); knee.add(boot); legPivots.push({ hip, knee }) }
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.43, 24), new THREE.MeshBasicMaterial({ color: 0x080504, transparent: true, opacity: .32 })); shadow.rotation.x = -Math.PI / 2; shadow.position.y = .012; root.add(shadow);
    const nameSprite = textSprite(name.slice(0, 18), { size: 54, width: 1.55, height: .38, color: "#ffffff" }); nameSprite.position.y = 2.42; root.add(nameSprite); const titleSprite = textSprite('Fan nửa mùa', { size: 34, width: 1.5, height: .28, color: '#ffd58a' }); titleSprite.position.y = 2.12; root.add(titleSprite);
    return { root, bodyRig, arms: sleeves, legs: legPivots, headGroup, nameSprite, titleSprite, jerseyPrint };
}
function addPlayer(p, isLocal) { if (players.has(p.id)) return; const avatar = makeAvatar(p.name, p.jerseyNumber ?? 7); avatar.root.position.set(p.x, 0, p.z); avatar.root.rotation.y = Math.PI; avatar.root.traverse(o => { o.userData.playerId = p.id }); scene.add(avatar.root); const entry = { id: p.id, name: p.name, title: p.title, jerseyNumber: p.jerseyNumber, isAfk: !!p.isAfk, joinedAt: p.joinedAt || Date.now(), strongFanAt: p.strongFanAt || 1050000, avatar, target: new THREE.Vector3(p.x, 0, p.z), action: p.action || "idle", spotId: p.spotId || null, carryingId: p.carryingId || null, carriedBy: p.carriedBy || null, phase: Math.random() * 6 }; players.set(p.id, entry); if (isLocal) localPlayer = entry; updateCount(); }
function removePlayer(id) {
    const p = players.get(id);
    if (p) {
        if (p._bubbleTimer) clearTimeout(p._bubbleTimer);
        if (p._bubbleSprite) {
            p.avatar.root.remove(p._bubbleSprite);
            p._bubbleSprite.material.map?.dispose();
            p._bubbleSprite.material.dispose();
            p._bubbleSprite = null;
        }
        scene.remove(p.avatar.root);
        players.delete(id);
    }
}
function mat(color, roughness = 1) { return new THREE.MeshStandardMaterial({ color, roughness }) }
function createFlame(position, scale = 1) {
    const group = new THREE.Group(); group.position.copy(position); group.scale.setScalar(scale); scene.add(group);
    const layers = []; for (let i = 0; i < 4; i++) { const material = new THREE.MeshBasicMaterial({ color: [0xff2600, 0xff6500, 0xffb21c, 0xffe58a][i], transparent: true, opacity: [.78, .76, .7, .62][i], blending: THREE.AdditiveBlending, depthWrite: false }); const mesh = new THREE.Mesh(new THREE.ConeGeometry([.95, .72, .48, .25][i], [3.1, 2.5, 1.8, 1.2][i], 12), material); mesh.position.y = [1.35, 1.12, .9, .68][i]; mesh.scale.set(1, .9, 1); group.add(mesh); layers.push(mesh); }
    const count = 180, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), velocities = [], sizes = []; for (let i = 0; i < count; i++) { positions[i * 3] = (Math.random() - .5) * 1.35; positions[i * 3 + 1] = Math.random() * 3.1; positions[i * 3 + 2] = (Math.random() - .5) * .8; const c = new THREE.Color().setHSL(.02 + Math.random() * .12, .98, .48 + Math.random() * .22); colors.set([c.r, c.g, c.b], i * 3); velocities.push(.0 + ((Math.random() - .5) * .45), .8 + Math.random() * 2.5, (Math.random() - .5) * .3); sizes.push(.6 + Math.random() * .8) }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: .22, vertexColors: true, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true })); group.add(points);
    const light = new THREE.PointLight(0xff5a0a, 170, 28, 1.7); light.position.set(0, 1.8, 0); group.add(light);
    fireEffects.push({ group, layers, geo, positions, velocities, light, phase: Math.random() * 10 }); return group;
}
function updateFlames(time, dt) { for (const f of fireEffects) { const { positions, velocities, layers, light, phase } = f; for (let i = 0; i < positions.length / 3; i++) { const k = i * 3; positions[k] += velocities[k] * dt; positions[k + 1] += velocities[k + 1] * dt; positions[k + 2] += velocities[k + 2] * dt; if (positions[k + 1] > 3.5 || Math.abs(positions[k]) > .9) { positions[k] = (Math.random() - .5) * 1.15; positions[k + 1] = Math.random() * .25; positions[k + 2] = (Math.random() - .5) * .65; } } f.geo.attributes.position.needsUpdate = true; layers.forEach((m, i) => { m.scale.x = (.82 + Math.sin(time * 8 + phase + i) * .18); m.scale.z = .8 + Math.cos(time * 7 + phase + i) * .15; m.rotation.y = Math.sin(time * 5 + phase + i) * .16; m.position.x = Math.sin(time * 6 + phase + i) * .08 }); light.intensity = 145 + Math.sin(time * 18 + phase) * 28 + Math.sin(time * 31 + phase) * 17; } }
function createMiniPlayer(x, z, color, number, rotation = 0) {
    const g = new THREE.Group(); g.position.set(x, .18, z); g.rotation.y = rotation;
    const shirt = new THREE.Mesh(new THREE.CylinderGeometry(.16, .19, .34, 10), new THREE.MeshStandardMaterial({ color, roughness: .72 })); shirt.position.y = .42; g.add(shirt);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.115, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd7aa83 })); head.position.y = .69; g.add(head);
    const shorts = new THREE.Mesh(new THREE.CylinderGeometry(.15, .16, .16, 10), new THREE.MeshStandardMaterial({ color: 0x202027 })); shorts.position.y = .17; g.add(shorts);
    const n = document.createElement('canvas'); n.width = 128; n.height = 64; const c = n.getContext('2d'); c.fillStyle = '#fff'; c.font = 'bold 48px Arial'; c.textAlign = 'center'; c.fillText(String(number), 64, 48); const t = new THREE.CanvasTexture(n); const tag = new THREE.Mesh(new THREE.PlaneGeometry(.18, .09), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide })); tag.position.set(0, .43, .195); g.add(tag); scene.add(g); return g;
}
function createTacticsDisplay() {
    // Bàn chiến thuật nhỏ dạng bục trưng bày một chân, nằm giữa banner tường và thảm.
    const centerZ = -10.5, topY = 1.72, fieldW = 5.25, fieldD = 3.55;
    const stone = mat(0x59463a, .82), trim = mat(0xb98a4d, .55);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(.72, .86, .18, 32), stone); foot.position.set(0, .09, centerZ); scene.add(foot);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(.23, .34, 1.36, 20), stone); column.position.set(0, .86, centerZ); scene.add(column);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(.28, .055, 8, 24), trim); collar.rotation.x = Math.PI / 2; collar.position.set(0, 1.48, centerZ); scene.add(collar);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(fieldW + .34, .18, fieldD + .34), stone); rim.position.set(0, topY - .09, centerZ); scene.add(rim);
    const goldEdge = new THREE.Mesh(new THREE.BoxGeometry(fieldW + .38, .035, fieldD + .38), trim); goldEdge.position.set(0, topY + .005, centerZ); scene.add(goldEdge);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(fieldW, fieldD), new THREE.MeshStandardMaterial({ color: 0x28613b, roughness: .95 })); pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, topY + .012, centerZ); scene.add(pitch);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe9e2c9 });
    function line(x, z, w, h) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, .012, h), lineMat); m.position.set(x, topY + .025, z); scene.add(m) }
    const left = -fieldW / 2, right = fieldW / 2, near = centerZ - fieldD / 2, far = centerZ + fieldD / 2;
    line(0, near, fieldW, .025); line(0, far, fieldW, .025); line(left, centerZ, .025, fieldD); line(right, centerZ, .025, fieldD); line(0, centerZ, .025, fieldD);
    const circle = new THREE.Mesh(new THREE.TorusGeometry(.38, .012, 6, 40), lineMat); circle.rotation.x = Math.PI / 2; circle.position.set(0, topY + .03, centerZ); scene.add(circle);
    // Đội hình 4-4-2 kinh điển: Toàn bộ 11 cầu thủ ĐỎ MU bên sân trái (x < 0), toàn bộ 11 cầu thủ XANH bên sân phải (x > 0)
    const sx = fieldW / 10.5, sz = fieldD / 7.1;
    const mu = [
        [-4.55, 0],                                                   // Thủ môn
        [-3.25, -2.45], [-3.25, -.82], [-3.25, .82], [-3.25, 2.45], // Hậu vệ
        [-1.95, -2.35], [-1.95, -.78], [-1.95, .78], [-1.95, 2.35], // Tiền vệ
        [-0.72, -.85],  [-0.72, .85]                                 // Tiền đạo (x < 0, hoàn toàn bên phần sân MU)
    ];
    const opp = [
        [4.55, 0],                                                   // Thủ môn
        [3.25, -2.45],  [3.25, -.82],  [3.25, .82],  [3.25, 2.45],  // Hậu vệ
        [1.95, -2.35],  [1.95, -.78],  [1.95, .78],  [1.95, 2.35],  // Tiền vệ
        [0.72, -.85],   [0.72, .85]                                  // Tiền đạo (x > 0, hoàn toàn bên phần sân ĐỐI THỦ)
    ];
    function miniAt(v, color, num, rot) { const g = createMiniPlayer(v[0] * sx, centerZ + v[1] * sz, color, num, rot); g.scale.setScalar(.55); g.position.y = topY + .04; return g; }
    // 11 áo đỏ MU bên trái và 11 áo xanh đối thủ bên phải, tuyệt đối không bị lẫn màu sang sân nhau
    mu.forEach((v, i) => miniAt(v, 0xc8102e, i + 1, Math.PI));
    opp.forEach((v, i) => miniAt(v, 0x174ea6, i + 1, 0));
    // Trọng tài ở vòng tròn giữa sân, có còi bạc trước miệng.
    miniAt([0, 0], 0xf2cf27, 0, 0);
    const whistle = new THREE.Mesh(new THREE.BoxGeometry(.075, .032, .035), new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: .7, roughness: .25 })); whistle.position.set(0, topY + .04 + .55 * .96, centerZ + .55 * .29); scene.add(whistle);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(.075, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf2eee2 })); ball.position.set(.22, topY + .11, centerZ + .22); scene.add(ball);
    const board = document.createElement('canvas'); board.width = 768; board.height = 96; const ctx = board.getContext('2d'); ctx.fillStyle = '#261712'; ctx.fillRect(0, 0, 768, 96); ctx.fillStyle = '#f1d18b'; ctx.font = 'bold 38px Arial'; ctx.textAlign = 'center'; ctx.fillText('MU 4–4–2  •  ĐỐI THỦ 4–4–2', 384, 62);
    const tex = new THREE.CanvasTexture(board); const label = new THREE.Mesh(new THREE.PlaneGeometry(4.5, .42), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })); label.position.set(0, topY + .18, centerZ - fieldD / 2 - .08); label.rotation.x = -.18; scene.add(label);
}

function init3D() {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x160b09); scene.fog = new THREE.FogExp2(0x21100c, .025); camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 160);
    renderer = new THREE.WebGLRenderer({ canvas: $("#world"), antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; clock = new THREE.Clock();
    scene.add(new THREE.HemisphereLight(0xffe4c4, 0x39201b, 2.8)); const key = new THREE.PointLight(0xffa044, 210, 58); key.position.set(0, 10, -8); scene.add(key); const fill = new THREE.DirectionalLight(0xffd8a8, 2.2); fill.position.set(-8, 14, 10); scene.add(fill);
    const floorCanvas = document.createElement("canvas"); floorCanvas.width = 512; floorCanvas.height = 512; const fx = floorCanvas.getContext("2d");
    fx.fillStyle = "#54251e"; fx.fillRect(0, 0, 512, 512); for (let y = 0; y < 512; y += 64) { for (let x = 0; x < 512; x += 64) { fx.fillStyle = ((x / 64 + y / 64) % 2) ? "#743329" : "#8a4031"; fx.fillRect(x + 2, y + 2, 60, 60); fx.strokeStyle = "#c18a54"; fx.lineWidth = 3; fx.strokeRect(x + 1, y + 1, 62, 62); for (let k = 0; k < 18; k++) { fx.fillStyle = "rgba(255,190,120,.12)"; fx.fillRect(x + Math.random() * 60, y + Math.random() * 60, 2, 2) } } }
    const floorTex = new THREE.CanvasTexture(floorCanvas); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(5, 7); floorTex.colorSpace = THREE.SRGBColorSpace;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 60), new THREE.MeshStandardMaterial({ map: floorTex, color: 0xffffff, roughness: .92 })); floor.rotation.x = -Math.PI / 2; floor.position.z = -8; scene.add(floor);
    // Vòm hang đá tự nhiên: vỏ hang cong và các mảng đá bất quy tắc thay cho tường hộp/cột xưởng.
    const cavernShell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x38231f, roughness: 1, side: THREE.BackSide })); cavernShell.scale.set(25, 18, 39); cavernShell.position.set(0, 0, -8); scene.add(cavernShell);
    for (const side of [-1, 1]) { for (let z = -34; z <= 18; z += 3.2) { const cluster = new THREE.Group(); cluster.position.set(side * (18.2 + Math.random() * 1.5), 0, z); const count = 3 + Math.floor(Math.random() * 3); for (let j = 0; j < count; j++) { const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.8 + Math.random() * 1.8, 1), mat([0x30201d, 0x49302a, 0x5a3b32, 0x241715][Math.floor(Math.random() * 4)])); rock.position.set(side * (Math.random() * 1.3), 1.2 + Math.random() * 3.2, (Math.random() - .5) * 2.8); rock.scale.set(.8 + Math.random(), 1 + Math.random() * 1.8, .8 + Math.random()); cluster.add(rock); } scene.add(cluster); } }
    // Măng đá rủ từ trần và gờ đá tạo đường viền tự nhiên cho đại sảnh.
    for (let i = 0; i < 42; i++) { const x = (Math.random() - .5) * 37, z = -31 + Math.random() * 46; const stal = new THREE.Mesh(new THREE.ConeGeometry(.35 + Math.random() * .65, 1.8 + Math.random() * 3.4, 7), mat(0x49332c)); stal.position.set(x, 12 + Math.random() * 3, z); stal.rotation.x = Math.PI; scene.add(stal); }
    for (let i = 0; i < 26; i++) { const x = (Math.random() - .5) * 36, z = -30 + Math.random() * 44; const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(.7 + Math.random() * 1.5, 1), mat(0x47302a)); stone.position.set(x, .15 + Math.random() * .25, z); stone.scale.set(1.5, .35, 1.2); scene.add(stone); }
    createTacticsDisplay();
    // Biểu trưng Hang MU tự thiết kế trên tấm vải nghi lễ, không dùng huy hiệu câu lạc bộ.
    const flagCanvas = document.createElement("canvas"); flagCanvas.width = 1024; flagCanvas.height = 512; const fc = flagCanvas.getContext("2d");
    fc.fillStyle = "#8f1018"; fc.fillRect(0, 0, 1024, 512); fc.strokeStyle = "#e9bd65"; fc.lineWidth = 22; fc.strokeRect(18, 18, 988, 476);
    fc.fillStyle = "#f4d58d"; fc.font = "900 88px Georgia"; fc.textAlign = "center"; fc.fillText("HANG MU", 512, 105);
    fc.beginPath(); fc.moveTo(512, 155); fc.bezierCurveTo(430, 220, 430, 300, 512, 370); fc.bezierCurveTo(594, 300, 594, 220, 512, 155); fc.closePath(); fc.fillStyle = "#e9bd65"; fc.fill();
    fc.fillStyle = "#8f1018"; fc.beginPath(); fc.moveTo(512, 205); fc.bezierCurveTo(475, 250, 490, 280, 512, 300); fc.bezierCurveTo(540, 270, 552, 242, 512, 205); fc.fill();
    fc.fillStyle = "#f4d58d"; fc.font = "bold 42px Georgia"; fc.fillText("CAVE COMMUNITY", 512, 450);
    const flagTex = new THREE.CanvasTexture(flagCanvas); flagTex.colorSpace = THREE.SRGBColorSpace;
    const floorFlagMaterial = new THREE.MeshStandardMaterial({ map: flagTex, roughness: .9, side: THREE.DoubleSide });
    const floorFlag = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorFlagMaterial); floorFlag.rotation.x = -Math.PI / 2; floorFlag.position.set(0, .035, -1.5); scene.add(floorFlag);
    const customFloorTexture = new THREE.TextureLoader().load("/2.jpg?v=21.4", tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        floorFlagMaterial.map = tex;
        floorFlagMaterial.needsUpdate = true;
        if (tex.image && tex.image.width && tex.image.height) {
            const aspect = tex.image.width / tex.image.height;
            const w = aspect >= 1 ? 8 : 8 * aspect;
            const h = aspect >= 1 ? 8 / aspect : 8;
            floorFlag.geometry.dispose();
            floorFlag.geometry = new THREE.PlaneGeometry(w, h);
        }
    }, undefined, () => console.info("Chưa có public/2.jpg; đang dùng biểu trưng mặc định cho thảm sàn."));
    // 50 vị trí đứng tĩnh tâm: chỉ là đĩa tròn thấp trên nền, tuyệt đối không tạo hình ghế.
    // Chia đều hai bên (25 vị trí mỗi bên), chừa lối giữa rộng cho thảm nghi lễ.
    spotMaterials = { free: mat(0xb52a20), rim: mat(0xf0bd58), taken: mat(0x4c4035) };
    for (const side of [-1, 1]) for (let row = 0; row < 5; row++)for (let col = 0; col < 5; col++) {
        const spotId = `spot-${side < 0 ? 'l' : 'r'}-${col}-${row}`, x = side * (6.7 + col * 1.45), z = -10 + row * 3.5;
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(.62, .66, .16, 32), spotMaterials.rim); rim.position.set(x, .09, z); scene.add(rim);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(.56, .59, .16, 32), spotMaterials.free); pad.position.set(x, .18, z); pad.userData.spotId = spotId; pad.userData.baseMaterial = spotMaterials.free; scene.add(pad); seatSpots.set(spotId, pad);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(.48, .025, 8, 32), mat(0xe8bd65)); ring.rotation.x = Math.PI / 2; ring.position.set(x, .27, z); scene.add(ring);
    }
    const altar = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, 1.2, 8), mat(0x625044)); altar.position.set(0, .6, -18); scene.add(altar);
    // Lửa 3D nhiều lớp + hạt lửa bay + ánh sáng nhấp nháy, thay khối đá cam cũ.
    createFlame(new THREE.Vector3(0, .15, -18), 1.35);
    for (let i = 0; i < 34; i++) { const side = i % 2 ? 1 : -1, z = -25 + (i / 2) * 3.1; const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(2.1, 1), mat(i % 3 ? 0x30221d : 0x49352b)); rock.position.set(side * (14 + Math.random() * 2), 2 + Math.random() * 3, z); rock.scale.set(1.2, 1.5, 1.1); scene.add(rock) }
    for (let i = 0; i < 22; i++) { const stal = new THREE.Mesh(new THREE.ConeGeometry(.45, 2.5, 6), mat(0x514033)); stal.position.set((Math.random() - .5) * 26, 9 + Math.random() * 2, -26 + Math.random() * 40); stal.rotation.x = Math.PI; scene.add(stal) }
    const bannerCanvas = document.createElement("canvas"); bannerCanvas.width = 512; bannerCanvas.height = 320; const bx = bannerCanvas.getContext("2d"); bx.fillStyle = "#a50918"; bx.fillRect(0, 0, 512, 320); bx.strokeStyle = "#f0c35d"; bx.lineWidth = 12; bx.strokeRect(8, 8, 496, 304); bx.fillStyle = "#f3ce75"; bx.font = "bold 48px Georgia"; bx.textAlign = "center"; bx.fillText("HANG MU", 256, 66); bx.beginPath(); bx.moveTo(256, 105); bx.bezierCurveTo(190, 105, 160, 155, 174, 226); bx.lineTo(338, 226); bx.bezierCurveTo(352, 155, 322, 105, 256, 105); bx.closePath(); bx.fill(); bx.fillStyle = "#a50918"; bx.beginPath(); bx.moveTo(256, 128); bx.bezierCurveTo(246, 153, 224, 162, 224, 187); bx.bezierCurveTo(224, 229, 288, 229, 288, 187); bx.bezierCurveTo(288, 169, 273, 154, 265, 145); bx.bezierCurveTo(266, 165, 253, 173, 251, 174); bx.bezierCurveTo(255, 153, 249, 141, 256, 128); bx.fill(); bx.fillStyle = "#f3ce75"; bx.font = "bold 34px Georgia"; bx.fillText("CAVE COMMUNITY", 256, 285); const fallbackBannerTex = new THREE.CanvasTexture(bannerCanvas); fallbackBannerTex.colorSpace = THREE.SRGBColorSpace; const bannerMaterial = new THREE.MeshStandardMaterial({ map: fallbackBannerTex, emissive: 0x250000, side: THREE.DoubleSide }); const banner = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), bannerMaterial); banner.position.set(0, 7, -24); scene.add(banner); const customBannerTexture = new THREE.TextureLoader().load("/1.jpg", tex => { tex.colorSpace = THREE.SRGBColorSpace; bannerMaterial.map = tex; bannerMaterial.needsUpdate = true; }, undefined, () => console.info("Chưa có public/1.jpg; đang dùng biểu trưng mặc định."));
    for (const x of [-10, 10]) createFlame(new THREE.Vector3(x, .05, -12), .48);
    camera.position.set(0, 8, 17); camera.lookAt(0, 1, -7); addEventListener("resize", resize);
    // Click một lần để chọn người chơi hoặc đĩa tròn; camera luôn cố định góc nhìn.
    // Desktop: click. Mobile: touchend (instant, no 300ms delay). Guard prevents double-fire.
    let _lastTouchFired = 0;
    renderer.domElement.addEventListener("touchend", event => {
        if (event.changedTouches.length !== 1) return;
        if (_seatPanelOpen) return; // seat picker handles its own touches
        const t = event.changedTouches[0];
        _lastTouchFired = Date.now();
        onSpotPointer({ clientX: t.clientX, clientY: t.clientY, button: 0 });
    }, { passive: true });
    renderer.domElement.addEventListener("click", event => {
        if (Date.now() - _lastTouchFired < 800) return; // skip synthetic click after touchend
        onSpotPointer(event);
    });
    animate();
}
function onSpotPointer(event) {
    if (!localPlayer || ritualActive) return;
    // event.button: 0 = left click / touch; -1 can appear on some pointer events. Allow both.
    if (event.button !== undefined && event.button !== 0 && event.button !== -1) return; const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; raycaster.setFromCamera(pointer, camera);
    const avatarRoots = [...players.values()].filter(p => p !== localPlayer).map(p => p.avatar.root); const playerHits = raycaster.intersectObjects(avatarRoots, true);
    if (playerHits.length) {
        let obj = playerHits[0].object;
        while (obj && !obj.userData.playerId) obj = obj.parent;
        const target = obj && players.get(obj.userData.playerId);
        if (target) {
            markActivity();
            showCarryMenu(target, event.clientX, event.clientY);
            return;
        }
    }
    hideCarryMenu(); const hits = raycaster.intersectObjects([...seatSpots.values()], false); if (!hits.length) return; const spotId = hits[0].object.userData.spotId; markActivity(); send({ type: "spot", spotId });
}
function showCarryMenu(target, x, y) { selectedCarryTarget = target; const menu = $("#carryMenu"); menu.querySelector("span").textContent = `Tương tác với ${target.name} (#${target.jerseyNumber})`; menu.style.left = `${Math.min(x, innerWidth - 205)}px`; menu.style.top = `${Math.min(y, innerHeight - 230)}px`; menu.classList.remove("hidden"); }
function hideCarryMenu() { const menu = $("#carryMenu"); if (menu) menu.classList.add("hidden"); selectedCarryTarget = null; }
function showCarryInvite(from, text) { clearTimeout(carryInviteTimer); const modal = $("#carryInviteModal"); $("#carryInviteText").textContent = text || `${from.name} (#${from.jerseyNumber}) muốn cõng bạn. Bạn có đồng ý không?`; modal.dataset.fromId = from.id; modal.classList.remove("hidden"); carryInviteTimer = setTimeout(() => { modal.classList.add("hidden"); }, 15000); }
function showInteractionInvite(m) { clearTimeout(interactionInviteTimer); const modal = $("#interactionInviteModal"); const labels = { highfive: "đập tay", handshake: "bắt tay", push: "đẩy nhẹ" }; modal.dataset.inviteId = m.inviteId; modal.dataset.fromId = m.from.id; modal.dataset.kind = m.kind; $("#interactionInviteText").textContent = `${m.from.name} (#${m.from.jerseyNumber}) mời bạn ${labels[m.kind] || "tương tác"}. Bạn đồng ý chứ?`; modal.classList.remove("hidden"); interactionInviteTimer = setTimeout(() => modal.classList.add("hidden"), 15000); }
function sendInteraction(kind) { if (!selectedCarryTarget) return; send({ type: "interaction-request", targetId: selectedCarryTarget.id, kind }); hideCarryMenu(); markActivity(); }
function showCarryRelease(show) { $("#carryRelease").classList.toggle("hidden", !show); }
$("#carryInviteBtn")?.addEventListener("click", () => { if (selectedCarryTarget) { send({ type: "carry-request", targetId: selectedCarryTarget.id, style: "piggyback" }); markActivity(); } hideCarryMenu(); });
$("#interactionAccept")?.addEventListener("click", () => { const m = $("#interactionInviteModal"); send({ type: "interaction-response", inviteId: m.dataset.inviteId, fromId: m.dataset.fromId, accept: true }); clearTimeout(interactionInviteTimer); m.classList.add("hidden"); markActivity(); });
$("#interactionDecline")?.addEventListener("click", () => { const m = $("#interactionInviteModal"); send({ type: "interaction-response", inviteId: m.dataset.inviteId, fromId: m.dataset.fromId, accept: false }); clearTimeout(interactionInviteTimer); m.classList.add("hidden"); });
$("#carryAccept")?.addEventListener("click", () => { const modal = $("#carryInviteModal"), fromId = modal.dataset.fromId; if (fromId) send({ type: "carry-response", fromId, accept: true }); clearTimeout(carryInviteTimer); modal.classList.add("hidden"); markActivity(); });
$("#carryDecline")?.addEventListener("click", () => { const modal = $("#carryInviteModal"), fromId = modal.dataset.fromId; if (fromId) send({ type: "carry-response", fromId, accept: false }); clearTimeout(carryInviteTimer); modal.classList.add("hidden"); });
$("#carryReleaseBtn")?.addEventListener("click", () => { send({ type: "carry-stop" }); showCarryRelease(false); markActivity(); });
document.addEventListener("pointerdown", e => { if (!e.target.closest("#carryMenu") && !e.target.closest("#world")) hideCarryMenu(); });
function resize() { if (!renderer) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) }
function animate() {
    requestAnimationFrame(animate); const dt = Math.min(clock.getDelta(), .05), now = clock.elapsedTime; updateFlames(now, dt);
    for (const pad of seatSpots.values()) pad.material = spotMaterials.free;
    for (const p of players.values()) {
        const a = p.avatar, active = p.action;
        const elapsed = Date.now() - p.joinedAt;
        const fanTitle = p.title || (elapsed >= (p.strongFanAt || 315000) ? 'Fan nghị lực' : elapsed >= 90000 ? 'Fan MU' : 'Fan nửa mùa');
        if (p._shownTitle !== fanTitle) {
            a.titleSprite.material.map.dispose();
            a.titleSprite.material.dispose();
            a.root.remove(a.titleSprite);
            a.titleSprite = textSprite(fanTitle, { size: 34, width: 1.6, height: .28, color: '#ffe0a0' });
            a.titleSprite.position.y = 2.12;
            a.root.add(a.titleSprite);
            p._shownTitle = fanTitle;
        }
        if (p !== localPlayer) a.root.position.lerp(p.target, .22);
        const interaction = [...activeInteractions.values()].find(v => (v.a === p.id || v.b === p.id) && v.until > performance.now()); const cheering = active === "cheer", bowing = active === "bow", walking = active === "walk", prostrating = active === "prostrate", standingSpot = active === "sit", carried = active === "carried";
        // A low, stable kneeling bow: legs fold first, torso lowers from the hips.
        const pose = prostrating ? 1 : bowing ? .48 : 0;
        a.bodyRig.rotation.x = THREE.MathUtils.damp(a.bodyRig.rotation.x, carried ? -.28 : prostrating ? 1.05 : bowing ? .52 : 0, 8, dt);
        a.bodyRig.position.y = THREE.MathUtils.damp(a.bodyRig.position.y, prostrating ? .48 : bowing ? .76 : .82, 8, dt);
        a.legs[0].hip.rotation.x = THREE.MathUtils.damp(a.legs[0].hip.rotation.x, carried ? -.85 : prostrating ? -1.15 : walking ? Math.sin(now * 10 + p.phase) * .25 : 0, 9, dt);
        a.legs[1].hip.rotation.x = THREE.MathUtils.damp(a.legs[1].hip.rotation.x, carried ? -.85 : prostrating ? -1.15 : walking ? Math.sin(now * 10 + p.phase + Math.PI) * .25 : 0, 9, dt);
        for (const leg of a.legs) leg.knee.rotation.x = THREE.MathUtils.damp(leg.knee.rotation.x, carried ? 1.25 : prostrating ? 1.45 : 0, 9, dt);
        a.arms[0].rotation.z = THREE.MathUtils.damp(a.arms[0].rotation.z, interaction ? (interaction.kind === "highfive" ? (interaction.a === p.id ? 2.8 : -2.8) : interaction.kind === "handshake" ? (interaction.a === p.id ? -.7 : .7) : 1.35) : carried ? .48 : cheering ? 2.55 : prostrating ? -.28 : 0, 10, dt);
        a.arms[1].rotation.z = THREE.MathUtils.damp(a.arms[1].rotation.z, interaction ? (interaction.kind === "highfive" ? (interaction.a === p.id ? -.3 : .3) : interaction.kind === "handshake" ? (interaction.a === p.id ? .7 : -.7) : -1.35) : carried ? -.48 : cheering ? -2.55 : prostrating ? .28 : 0, 10, dt);
        a.arms[0].rotation.x = a.arms[1].rotation.x = cheering ? Math.sin(now * 8 + p.phase) * .16 : prostrating ? -.5 : 0;
        a.headGroup.rotation.x = THREE.MathUtils.damp(a.headGroup.rotation.x, prostrating ? .45 : bowing ? .25 : 0, 9, dt);
        if (p === localPlayer && isJumping) { jumpHeight += jumpVelocity * dt; jumpVelocity -= JUMP_GRAVITY * dt; if (jumpHeight <= 0) { jumpHeight = 0; jumpVelocity = 0; isJumping = false; if (localPlayer.action === "jump") localPlayer.action = "idle"; } }
        a.root.position.y = (cheering ? Math.abs(Math.sin(now * 8 + p.phase)) * .1 : 0) + (p === localPlayer ? jumpHeight : 0);
        if (p.spotId) { const pad = seatSpots.get(p.spotId); if (pad) pad.material = spotMaterials.taken; }
    }
    if (localPlayer) {
        if (ritualActive) {
            const elapsed = performance.now() - ritualStart; const startZ = 10, targetZ = 2.2; const walkMs = 2500;
            if (elapsed < walkMs) { const t = THREE.MathUtils.clamp(elapsed / walkMs, 0, 1); localPlayer.avatar.root.position.set(0, 0, THREE.MathUtils.lerp(startZ, targetZ, t)); localPlayer.avatar.root.rotation.y = Math.PI; localPlayer.action = "walk"; }
            else if (elapsed < 7500) { localPlayer.avatar.root.position.set(0, 0, targetZ); localPlayer.action = "prostrate"; }
            else { localPlayer.avatar.root.position.set(0, 0, targetZ); localPlayer.action = "idle"; ritualActive = false; toast("Nghi thức hoàn tất! Bạn đã chính thức nhập hang."); }
            if (performance.now() - lastRitualSend > 120) { send({ type: 'ritual-progress', x: localPlayer.avatar.root.position.x, z: localPlayer.avatar.root.position.z, action: localPlayer.action }); lastRitualSend = performance.now(); }
        }
        let dx = 0, dz = 0; if (keys.KeyA || keys.ArrowLeft || pressedMoves.has("left")) dx--; if (keys.KeyD || keys.ArrowRight || pressedMoves.has("right")) dx++; if (keys.KeyW || keys.ArrowUp || pressedMoves.has("up")) dz--; if (keys.KeyS || keys.ArrowDown || pressedMoves.has("down")) dz++;
        dx += joystickVector.x; dz += joystickVector.z;
        const len = Math.hypot(dx, dz);
        if (!ritualActive && !localPlayer.carriedBy && len > 0.08) { if (localPlayer.action === "prostrate" || localPlayer.action === "bow" || localPlayer.action === "sit" || localPlayer.spotId) { localPlayer.action = "walk"; localPlayer.spotId = null; } const dirX = dx / len, dirZ = dz / len; const speed = 5 * Math.min(1, Math.max(0.4, len)); localPlayer.avatar.root.position.x = THREE.MathUtils.clamp(localPlayer.avatar.root.position.x + dirX * dt * speed, -13, 13); localPlayer.avatar.root.position.z = THREE.MathUtils.clamp(localPlayer.avatar.root.position.z + dirZ * dt * speed, -9, 13); localPlayer.avatar.root.rotation.y = Math.atan2(dirX, dirZ); if (localPlayer.action !== "cheer" && localPlayer.action !== "bow") localPlayer.action = "walk"; }
        else if (!ritualActive && !localPlayer.carriedBy && localPlayer.action === "walk") localPlayer.action = "idle";
        const target = localPlayer.avatar.root.position; const desiredCameraPosition = new THREE.Vector3(target.x, 8, target.z + 17); camera.position.lerp(desiredCameraPosition, .12); camera.lookAt(target.x, target.y + 1.2, target.z - 7);
        if (!ritualActive && !localPlayer.carriedBy && localPlayer.action !== "sit" && performance.now() - lastSend > 90) { send({ type: "move", x: localPlayer.avatar.root.position.x, z: localPlayer.avatar.root.position.z, action: localPlayer.action }); lastSend = performance.now() }
    }
    // Passenger follows the carrier locally; only relationship changes are sent to the server.
    for (const [key, v] of activeInteractions) { if (v.until <= performance.now()) { activeInteractions.delete(key); for (const id of [v.a, v.b]) { const q = players.get(id); if (q && ["highfive", "handshake", "push"].includes(q.action)) q.action = "idle"; } } }
    for (const passenger of players.values()) { if (!passenger.carriedBy) continue; const carrier = players.get(passenger.carriedBy); if (!carrier) continue; const offset = passenger.carryStyle === "bridal" ? new THREE.Vector3(.62, .72, .02) : new THREE.Vector3(0, 1.12, -.42); carrier.avatar.root.localToWorld(offset); passenger.avatar.root.position.copy(offset); passenger.avatar.root.rotation.y = carrier.avatar.root.rotation.y; passenger.avatar.root.rotation.z = passenger.carryStyle === "bridal" ? Math.PI / 2 : 0; }
    renderer.render(scene, camera);
}
// === AUDIO ENGINE HANG MU V21: NHẠC NỀN (1.mp3/1.m4a) & HÔ CỔ VŨ (2.mp3/2.m4a) CÓ DUCKING ===
const isAppleDevice = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && !window.MSStream;
const BG_MUSIC_SRC = isAppleDevice ? '/audio/1.m4a' : '/audio/1.mp3';
const CHEER_MUSIC_SRC = isAppleDevice ? '/audio/2.m4a' : '/audio/2.mp3';

const NORMAL_BG_VOLUME = 0.45;
const DUCKED_BG_VOLUME = 0.10;

let audioCtx = null;
let cheerAudioBuffer = null;
let bgAudio = null;
let cheerAudio = null;
let isAudioMuted = false;
let duckTimer = null;

function getAudioContext() {
    if (!audioCtx) {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (AudioCtxClass) audioCtx = new AudioCtxClass();
    }
    return audioCtx;
}

function loadCheerBuffer() {
    const ctx = getAudioContext();
    if (!ctx || cheerAudioBuffer) return;
    fetch(CHEER_MUSIC_SRC)
        .then(r => {
            if (!r.ok) throw new Error("HTTP error " + r.status);
            return r.arrayBuffer();
        })
        .then(buf => ctx.decodeAudioData(buf))
        .then(decoded => { cheerAudioBuffer = decoded; })
        .catch(() => {
            fetch('/audio/2.mp3')
                .then(r => r.arrayBuffer())
                .then(buf => ctx.decodeAudioData(buf))
                .then(decoded => { cheerAudioBuffer = decoded; })
                .catch(() => {});
        });
}

function initAudioElements() {
    if (!bgAudio) {
        bgAudio = new Audio(BG_MUSIC_SRC);
        bgAudio.loop = true;
        bgAudio.volume = isAudioMuted ? 0 : NORMAL_BG_VOLUME;
        bgAudio.preload = 'auto';
        bgAudio.addEventListener('error', () => {
            if (bgAudio.src.endsWith('.m4a') || bgAudio.src.includes('1.m4a')) {
                bgAudio.src = '/audio/1.mp3';
                bgAudio.load();
                if (!landing.classList.contains('hidden') || !game.classList.contains('hidden')) {
                    if (!isAudioMuted) bgAudio.play().catch(() => {});
                }
            }
        });
    }
    if (!cheerAudio) {
        cheerAudio = new Audio(CHEER_MUSIC_SRC);
        cheerAudio.volume = isAudioMuted ? 0 : 1.0;
        cheerAudio.preload = 'auto';
        cheerAudio.addEventListener('error', () => {
            if (cheerAudio.src.endsWith('.m4a') || cheerAudio.src.includes('2.m4a')) {
                cheerAudio.src = '/audio/2.mp3';
                cheerAudio.load();
            }
        });
    }
}

function startBackgroundMusic() {
    initAudioElements();
    if (isAudioMuted) return;
    if (bgAudio && bgAudio.paused) {
        bgAudio.play().catch(() => {});
    }
}

function stopBackgroundMusic() {
    if (bgAudio) {
        bgAudio.pause();
        bgAudio.currentTime = 0;
    }
    if (cheerAudio) {
        cheerAudio.pause();
        cheerAudio.currentTime = 0;
    }
}

function duckBackgroundMusic(targetVol, durationMs = 200) {
    if (!bgAudio || isAudioMuted) return;
    clearInterval(duckTimer);
    const startVol = bgAudio.volume;
    const diff = targetVol - startVol;
    const steps = 10;
    const stepTime = durationMs / steps;
    let step = 0;
    duckTimer = setInterval(() => {
        step++;
        bgAudio.volume = Math.max(0, Math.min(1, startVol + diff * (step / steps)));
        if (step >= steps) {
            clearInterval(duckTimer);
            bgAudio.volume = targetVol;
        }
    }, stepTime);
}

let _audioUnlocked = false;
function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
    initAudioElements();
    loadCheerBuffer();

    if (!_audioUnlocked) {
        _audioUnlocked = true;
        startBackgroundMusic();
    }
}

['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click'].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { passive: true });
});

function playCheerAudio() {
    unlockAudio();
    if (isAudioMuted) return;
    const ctx = getAudioContext();

    // Giảm nhỏ nhạc nền khi hô cổ vũ
    duckBackgroundMusic(DUCKED_BG_VOLUME, 150);

    const onCheerComplete = () => {
        // Hồi phục âm lượng nhạc nền sau khi hô xong
        duckBackgroundMusic(NORMAL_BG_VOLUME, 400);
    };

    // 1. Web Audio API (Primary: tức thì, tương thích cao trên iOS khi context đã mở)
    if (ctx && cheerAudioBuffer) {
        try {
            if (ctx.state === 'suspended') ctx.resume();
            const src = ctx.createBufferSource();
            src.buffer = cheerAudioBuffer;
            src.connect(ctx.destination);
            src.onended = onCheerComplete;
            src.start(0);
            return;
        } catch (_) {}
    }

    // 2. HTML5 Audio fallback
    if (cheerAudio) {
        try {
            cheerAudio.pause();
            cheerAudio.currentTime = 0;
            cheerAudio.muted = false;
            cheerAudio.onended = onCheerComplete;
            const p = cheerAudio.play();
            if (p && typeof p.then === 'function') {
                p.catch(() => { onCheerComplete(); });
            }
            setTimeout(onCheerComplete, 5200);
        } catch (_) {
            onCheerComplete();
        }
    }
}

function toggleAudioMute() {
    isAudioMuted = !isAudioMuted;
    initAudioElements();
    if (bgAudio) {
        if (isAudioMuted) {
            bgAudio.pause();
        } else {
            bgAudio.volume = NORMAL_BG_VOLUME;
            bgAudio.play().catch(() => {});
        }
    }
    if (cheerAudio) cheerAudio.muted = isAudioMuted;
    const btn = document.getElementById("audioToggleBtn");
    if (btn) {
        btn.textContent = isAudioMuted ? "🔇 Nhạc: Tắt" : "🔊 Nhạc: Bật";
        btn.classList.toggle("muted", isAudioMuted);
    }
    toast(isAudioMuted ? "Đã tắt âm thanh." : "Đã bật âm thanh.");
}
function setAction(a) { if (!localPlayer || ritualActive || localPlayer.carriedBy) return; markActivity(); localPlayer.spotId = null; localPlayer.action = a; send({ type: "action", action: a }); if (a === "cheer") playCheerAudio(); toast(a === "cheer" ? "📣 Bạn đang hô cổ vũ! (Gạt nút chuông nếu iPhone im lặng)" : a === "bow" ? "🙇 Bạn cúi chào!" : a === "prostrate" ? "🙏 Bạn quỳ dập đầu bái cờ MU!" : "🧍 Trạng thái: Bình thường"); }
addEventListener("keydown", e => { const typing = e.target instanceof HTMLElement && (["INPUT", "TEXTAREA"].includes(e.target.tagName) || e.target.isContentEditable); if (typing) return; keys[e.code] = true; if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault(); if (e.repeat) return; if (e.code === "Space") { if (localPlayer && !ritualActive && !localPlayer.carriedBy && !isJumping && !(["bow", "prostrate", "sit"].includes(localPlayer.action))) { isJumping = true; jumpVelocity = JUMP_POWER; localPlayer.action = "jump"; markActivity(); } return; } const binds = { KeyQ: "bow", KeyE: "cheer", KeyF: "idle", KeyG: "prostrate" }; if (binds[e.code]) setAction(binds[e.code]); }); addEventListener("keyup", e => keys[e.code] = false);
function clearMovementInputs() { for (const code of Object.keys(keys)) keys[code] = false; pressedMoves.clear(); joystickVector.x = 0; joystickVector.z = 0; if (document.getElementById("joystickThumb")) document.getElementById("joystickThumb").style.transform = "translate(0px, 0px)"; }
addEventListener("blur", clearMovementInputs); document.addEventListener("visibilitychange", () => { if (document.hidden) clearMovementInputs(); }); addEventListener("pointerup", clearMovementInputs); addEventListener("pointercancel", clearMovementInputs);
document.querySelectorAll("[data-action]").forEach(b => {
    b.addEventListener("pointerdown", e => {
        e.preventDefault();
        setAction(b.dataset.action);
    });
});
// === SEAT PICKER PANEL ===
let _seatPanelOpen = false;
function _rebuildSeatPanelIfOpen() {
    if (!_seatPanelOpen) return;
    const panel = document.getElementById('seatPickerPanel');
    if (!panel) return;
    const body = panel.querySelector('.sp-body');
    if (!body) return;
    let html = '<div class="sp-grid">';
    for (const side of ['l', 'r']) {
        html += `<div class="sp-side"><div class="sp-side-label">${side === 'l' ? '◀ Trái' : 'Phải ▶'}</div><div class="sp-spots">`;
        for (let row = 4; row >= 0; row--) {
            for (let col = 0; col < 5; col++) {
                const spotId = `spot-${side}-${col}-${row}`;
                const taken = [...players.values()].some(p => p.spotId === spotId && p.id !== (localPlayer && localPlayer.id));
                const isMine = localPlayer && localPlayer.spotId === spotId;
                const label = isMine ? '★' : taken ? '●' : '○';
                const cls = `sp-spot${taken ? ' taken' : ''}${isMine ? ' mine' : ''}`;
                html += `<button class="${cls}" data-spot="${spotId}"${taken ? ' disabled' : ''}>${label}</button>`;
            }
        }
        html += '</div></div>';
    }
    html += '</div>';
    body.innerHTML = html;
    body.querySelectorAll('.sp-spot:not([disabled])').forEach(btn => {
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            const spotId = btn.dataset.spot;
            if (!localPlayer || ritualActive || localPlayer.carriedBy) return;
            markActivity();
            send({ type: 'spot', spotId });
            _closeSeatPanel();
        });
    });
}
function _openSeatPanel() {
    if (!localPlayer || ritualActive) { toast('Hoàn tất nghi thức nhập hang trước đã nhé!'); return; }
    _seatPanelOpen = true;
    const panel = document.getElementById('seatPickerPanel');
    if (panel) { panel.classList.remove('hidden'); _rebuildSeatPanelIfOpen(); }
}
function _closeSeatPanel() {
    _seatPanelOpen = false;
    const panel = document.getElementById('seatPickerPanel');
    if (panel) panel.classList.add('hidden');
}
$("#spotHelp")?.addEventListener("click", () => _seatPanelOpen ? _closeSeatPanel() : _openSeatPanel());
document.getElementById('seatPickerClose')?.addEventListener('click', _closeSeatPanel);
// === VIRTUAL JOYSTICK CONTROLLER ===
const joystickZone = document.getElementById("joystickZone");
const joystickBase = document.getElementById("joystickBase");
const joystickThumb = document.getElementById("joystickThumb");
let joystickTouchId = null;
let joystickCenter = { x: 0, y: 0 };
const JOYSTICK_MAX_RADIUS = 36;

if (joystickZone && joystickThumb && joystickBase) {
    function startJoystick(clientX, clientY, touchId) {
        joystickTouchId = touchId;
        const rect = joystickBase.getBoundingClientRect();
        joystickCenter = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
        updateJoystick(clientX, clientY);
        unlockAudio();
        markActivity();
    }

    function updateJoystick(clientX, clientY) {
        const dx = clientX - joystickCenter.x;
        const dy = clientY - joystickCenter.y;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const clampedDist = Math.min(dist, JOYSTICK_MAX_RADIUS);

        const thumbX = Math.cos(angle) * clampedDist;
        const thumbY = Math.sin(angle) * clampedDist;

        joystickThumb.style.transform = `translate(${thumbX}px, ${thumbY}px)`;

        if (dist < 4) {
            joystickVector.x = 0;
            joystickVector.z = 0;
        } else {
            const intensity = clampedDist / JOYSTICK_MAX_RADIUS;
            joystickVector.x = Math.cos(angle) * intensity;
            joystickVector.z = Math.sin(angle) * intensity;
        }
    }

    function resetJoystick() {
        joystickTouchId = null;
        joystickThumb.style.transform = "translate(0px, 0px)";
        joystickVector.x = 0;
        joystickVector.z = 0;
    }

    joystickZone.addEventListener("touchstart", e => {
        e.preventDefault();
        if (joystickTouchId !== null) return;
        const t = e.changedTouches[0];
        startJoystick(t.clientX, t.clientY, t.identifier);
    }, { passive: false });

    window.addEventListener("touchmove", e => {
        if (joystickTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === joystickTouchId) {
                e.preventDefault();
                updateJoystick(t.clientX, t.clientY);
                break;
            }
        }
    }, { passive: false });

    const stopTouch = e => {
        if (joystickTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === joystickTouchId) {
                resetJoystick();
                break;
            }
        }
    };
    window.addEventListener("touchend", stopTouch, { passive: true });
    window.addEventListener("touchcancel", stopTouch, { passive: true });

    // Pointer support for mouse dragging on desktop
    joystickZone.addEventListener("pointerdown", e => {
        if (e.pointerType === "touch") return;
        e.preventDefault();
        startJoystick(e.clientX, e.clientY, "mouse");
        const onPointerMove = ev => updateJoystick(ev.clientX, ev.clientY);
        const onPointerUp = () => {
            resetJoystick();
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    });
}
document.querySelectorAll("[data-move]").forEach(b => { const k = b.dataset.move; const on = () => pressedMoves.add(k), off = () => pressedMoves.delete(k); b.addEventListener("pointerdown", e => { e.preventDefault(); on(); b.setPointerCapture(e.pointerId) }); b.addEventListener("pointerup", off); b.addEventListener("pointercancel", off); b.addEventListener("lostpointercapture", off); window.addEventListener("pointerup", off); window.addEventListener("pointercancel", off) });
const bannedNames = ["địt", "đụ", "đéo", "lồn", "cặc", "buồi", "đmm", "dmm", "vcl", "fuck", "shit", "bitch"];
function cleanName(v) { return v.normalize("NFC").replace(/[<>\{}\[\]$%`]/g, "").replace(/\s+/g, " ").trim().slice(0, 18) }
function badName(v) { const n = v.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d"); return bannedNames.some(w => { const t = w.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d"); return n.split(/[^a-z0-9]+/).includes(t) }) }
let nameComposing = false; nameInput.addEventListener('compositionstart', () => { nameComposing = true }); nameInput.addEventListener('compositionend', () => { nameComposing = false; validateNameHint() }); function validateNameHint() { const v = nameInput.value.normalize('NFC'); const bad = badName(v); $('#nameHint').textContent = bad ? 'Tên này không phù hợp. Hãy chọn tên lịch sự nhé.' : 'Cho phép tiếng Việt có dấu, tối đa 18 ký tự.'; $('#nameHint').classList.toggle('invalid', bad) } nameInput.addEventListener('input', () => { if (nameComposing) return; validateNameHint() }); nameInput.addEventListener('blur', () => { nameInput.value = cleanName(nameInput.value); validateNameHint() }); nameInput.addEventListener('input', () => { if (localPlayer) send({ type: 'activity' }); });
numberInput.addEventListener("input", () => { numberInput.value = numberInput.value.replace(/\D/g, "").slice(0, 3) });
let pendingJoin = null;
$("#enterBtn").addEventListener("click", () => { const name = cleanName(nameInput.value); if (!name) { nameInput.focus(); $("#nameHint").textContent = "Bạn hãy nhập tên hiển thị."; return } if (badName(name)) { nameInput.focus(); $("#nameHint").textContent = "Tên không được chứa từ ngữ tục tĩu."; $("#nameHint").classList.add("invalid"); return } if (!socket || socket.readyState !== WebSocket.OPEN) { toast("Đang kết nối máy chủ…"); return } pendingJoin = { name, roomId: selectedRoom }; $("#ritualModal").classList.remove("hidden") });
$("#ritualYes").addEventListener("click", () => { if (!pendingJoin) return; $("#ritualModal").classList.add("hidden"); send({ type: "join", ...pendingJoin, approved: true }); pendingJoin = null });
$("#ritualNo").addEventListener("click", () => { $("#ritualModal").classList.add("hidden"); toast("Nghi vấn gián điệp! Quỷ Đỏ chỉ mở cửa hang cho người sẵn lòng bái cờ MU!"); pendingJoin = null; });
$("#stillHereBtn").addEventListener("click", dismissPresence);
$("#leaveBtn").addEventListener("click", () => {
    stopBackgroundMusic();
    location.reload();
});
document.getElementById("audioToggleBtn")?.addEventListener("click", toggleAudioMute);
const chatPanel = $("#chatPanel"), chatToggle = $("#chatToggle");
function openChat() { for (const k of Object.keys(keys)) keys[k] = false; pressedMoves.clear(); chatPanel.classList.remove("hidden"); chatToggle.setAttribute("aria-expanded", "true"); chatUnread = 0; $("#chatUnread").classList.add("hidden"); $("#chatUnread").textContent = "0"; $("#chatInput").focus(); }
function closeChat() { chatPanel.classList.add("hidden"); chatToggle.setAttribute("aria-expanded", "false"); chatToggle.focus(); }
chatToggle.addEventListener("click", () => chatPanel.classList.contains("hidden") ? openChat() : closeChat());
$('#moodToggle').addEventListener('click', () => { const modes = ['normal', 'gloomy', 'crisis', 'despair']; const current = modes.findIndex(m => $('#hangMoodTitle').textContent === ({ normal: 'HANG ĐANG YÊN ẮNG', gloomy: 'MU ĐANG TRONG TÌNH TRẠNG KHÁ TỒI TỆ', crisis: 'KHỦNG HOẢNG TINH THẦN', despair: 'TUYỆT VỌNG TOÀN TẬP' }[m])); const mode = modes[(current + 1) % modes.length]; send({ type: 'set-hang-mode', mode }); markActivity(); });
document.querySelectorAll('[data-phrase]').forEach(b => b.addEventListener('click', () => { if (chatPanel.classList.contains('hidden')) openChat(); $('#chatInput').value = b.dataset.phrase; $('#chatInput').focus(); }));
$("#chatClose").addEventListener("click", closeChat);
$("#chatForm").addEventListener("submit", e => { e.preventDefault(); const input = $("#chatInput"), text = input.value.trim(); if (!text) return; send({ type: "chat", text }); input.value = ""; markActivity(); input.focus() });
$("#chatInput").addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); closeChat(); } }); $("#chatInput").addEventListener('input', () => { if (localPlayer) send({ type: 'activity' }); });
addEventListener('pointerdown', () => { markActivity(); if (localPlayer) send({ type: 'activity' }); }, { passive: true }); addEventListener('keydown', e => { if (e.isComposing || e.keyCode === 229) return; markActivity(); if (localPlayer) send({ type: 'activity' }); }); addEventListener('touchstart', () => { markActivity(); if (localPlayer) send({ type: 'activity' }); }, { passive: true });
// === POP-UP CHIẾN THẮNG ROMA & LỊCH ĐẤU ASTON VILLA ===
const victoryModal = document.getElementById("victoryModal");
const victoryModalClose = document.getElementById("victoryModalClose");
const victoryModalNext = document.getElementById("victoryModalNext");

const matchModal = document.getElementById("matchModal");
const matchModalClose = document.getElementById("matchModalClose");
const matchModalOk = document.getElementById("matchModalOk");
const matchModalBack = document.getElementById("matchModalBack");

const matchNoticeBar = document.getElementById("matchNoticeBar");
const hudMatchNoticeBtn = document.getElementById("hudMatchNoticeBtn");

function openVictoryModal() {
    if (matchModal) matchModal.classList.add("hidden");
    if (victoryModal) victoryModal.classList.remove("hidden");
    markActivity();
}
function closeVictoryModal(proceedToMatch = false) {
    if (victoryModal) victoryModal.classList.add("hidden");
    if (proceedToMatch) {
        openMatchModal();
    }
    markActivity();
}
function openMatchModal() {
    if (victoryModal) victoryModal.classList.add("hidden");
    if (matchModal) matchModal.classList.remove("hidden");
    markActivity();
}
function closeMatchModal() {
    if (matchModal) matchModal.classList.add("hidden");
    markActivity();
}

victoryModalNext?.addEventListener("click", () => closeVictoryModal(true));
victoryModalClose?.addEventListener("click", () => closeVictoryModal(false));
victoryModal?.addEventListener("click", e => {
    if (e.target === victoryModal) closeVictoryModal(false);
});

matchModalOk?.addEventListener("click", closeMatchModal);
matchModalClose?.addEventListener("click", closeMatchModal);
matchModalBack?.addEventListener("click", openVictoryModal);
matchModal?.addEventListener("click", e => {
    if (e.target === matchModal) closeMatchModal();
});

matchNoticeBar?.addEventListener("click", openVictoryModal);
hudMatchNoticeBtn?.addEventListener("click", openVictoryModal);

setInterval(() => { if (localPlayer) send({ type: 'heartbeat' }); }, 15000);
connect();
