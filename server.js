const express=require('express');
const http=require('http');
const path=require('path');
const WebSocket=require('ws');
const crypto=require('crypto');
const PORT=process.env.PORT||3000;
const ROOM_CAPACITY=Math.max(2,Math.min(50,Number(process.env.ROOM_CAPACITY||50)));
const MAX_ROOMS=4;
const IDLE_PROMPT_MS=120000;
const IDLE_GRACE_MS=60000;
const CHAT_COOLDOWN_MS=5000;
const app=express();
app.get('/audio/1.mp3',(req,res)=>{
  res.sendFile(path.join(__dirname,'public/audio/1.mp3'),{
    headers:{'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600'}
  });
});
app.get('/audio/1.m4a',(req,res)=>{
  res.sendFile(path.join(__dirname,'public/audio/1.m4a'),{
    headers:{'Content-Type':'audio/mp4','Accept-Ranges':'bytes','Cache-Control':'public, max-age=3600'}
  });
});
app.use(express.static('public'));
const server=http.createServer(app);
const wss=new WebSocket.Server({server,maxPayload:2048});
const rooms=new Map(),clients=new Map(),playerStats=new Map(),cheerWindows=new Map();let hangMode='gloomy';
const MOODS={normal:{title:'HANG ĐANG YÊN ẮNG',text:'MU đang trong tình trạng khá tồi tệ… nhưng anh em vẫn còn đây.',icon:'🕯️'},gloomy:{title:'MU ĐANG TRONG TÌNH TRẠNG KHÁ TỒI TỆ',text:'Xin giữ bình tĩnh. Ban quản lý hang chưa có phát ngôn.',icon:'🥀'},crisis:{title:'KHỦNG HOẢNG TINH THẦN',text:'Đề nghị các thành viên không nhìn thẳng vào bảng tin.',icon:'🚨'},despair:{title:'TUYỆT VỌNG TOÀN TẬP',text:'Chỉ còn ánh lửa và tình đồng đội.',icon:'🫠'}};
for(let i=1;i<=MAX_ROOMS;i++)rooms.set(`hang-${String(i).padStart(2,'0')}`,{players:new Map()});
const bannedTerms=['dit','du','deo','lon','cac','buoi','dmm','vcl','fuck','shit','bitch'];
function send(ws,data){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function normalizeName(v){return String(v||'').normalize('NFC').replace(/[<>\\{}\[\]$%`]/g,'').replace(/\s+/g,' ').trim().slice(0,18);}
function inappropriateName(name){const n=name.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');return bannedTerms.some(w=>n.split(/[^a-z0-9]+/).includes(w));}
function roomSnapshot(){return [...rooms.entries()].map(([id,r])=>({id,count:r.players.size,capacity:ROOM_CAPACITY}));}
function broadcastRoomList(){const d={type:'room-list',rooms:roomSnapshot()};for(const ws of wss.clients)send(ws,d);}
function broadcast(roomId,data,except){const r=rooms.get(roomId);if(!r)return;for(const [id,p] of r.players)if(id!==except)send(p.ws,data);}
function fanTitle(p,now=Date.now()){const elapsed=now-p.joinedAt;if(elapsed>=p.strongFanAt)return 'Fan nghị lực';if(elapsed>=90000)return 'Fan MU';return 'Fan nửa mùa';}
function publicPlayer(p){return{id:p.id,name:p.name,jerseyNumber:p.jerseyNumber,x:p.x,z:p.z,action:p.action,spotId:p.spotId||null,carryingId:p.carryingId||null,carriedBy:p.carriedBy||null,title:fanTitle(p),joinedAt:p.joinedAt,strongFanAt:p.strongFanAt};}
function endCarry(roomId,p){const room=rooms.get(roomId);if(!room||!p)return;const carrierId=p.carryingId?p.id:(p.carriedBy||null),passengerId=p.carryingId||(p.carriedBy?p.id:null);if(!carrierId||!passengerId)return;const carrier=room.players.get(carrierId),passenger=room.players.get(passengerId);if(carrier){carrier.carryingId=null;carrier.action='idle';carrier.spotId=null;}if(passenger){passenger.carriedBy=null;passenger.action='idle';passenger.spotId=null;}broadcast(roomId,{type:'carry-ended',carrierId,passengerId});if(carrier)broadcast(roomId,{type:'player-updated',player:publicPlayer(carrier)});if(passenger)broadcast(roomId,{type:'player-updated',player:publicPlayer(passenger)});}
function roomIdForJoin(requested){if(requested){const r=rooms.get(String(requested));return r&&r.players.size<ROOM_CAPACITY?String(requested):null;}for(const [id,r] of rooms)if(r.players.size<ROOM_CAPACITY)return id;return null;}
function removePlayer(ws,reason='disconnect') {const s=clients.get(ws);if(!s)return;const r=rooms.get(s.roomId);if(r){const p=r.players.get(s.id);if(p&&(p.carryingId||p.carriedBy))endCarry(s.roomId,p);if(p?.pendingInteraction){const other=r.players.get(p.pendingInteraction.targetId||p.pendingInteraction.fromId);if(other)other.pendingInteraction=null;}if(p?.pendingCarryFrom){const other=r.players.get(p.pendingCarryFrom.id);if(other)other.pendingCarryFrom=null;}r.players.delete(s.id);broadcast(s.roomId,{type:'player-left',id:s.id,reason});}clients.delete(ws);broadcastRoomList();}
function closeFor(ws,code,reason){send(ws,{type:'force-reload',message:reason});setTimeout(()=>{try{ws.close(code,reason)}catch{}},80);}
wss.on('connection',ws=>{
 send(ws,{type:'room-list',rooms:roomSnapshot()});
 ws.on('message',raw=>{let m;try{m=JSON.parse(raw.toString())}catch{return}const state=clients.get(ws);
  if(m.type==='join'){
   if(state){send(ws,{type:'join-error',message:'Bạn đã ở trong hang rồi.'});return;}
   if(m.approved!==true){send(ws,{type:'join-error',message:'Bạn cần đồng ý nghi thức nhập hang trước.'});return;}
   const name=normalizeName(m.name);if(!name||inappropriateName(name)){send(ws,{type:'join-error',message:'Tên không hợp lệ hoặc chứa từ ngữ không phù hợp.'});return;}
   const requestedRoom=String(m.roomId||'');if(!/^hang-0[1-4]$/.test(requestedRoom)){send(ws,{type:'join-error',message:'Bạn hãy chọn một phòng trước khi vào hang.'});return;}const roomId=roomIdForJoin(requestedRoom);if(!roomId){send(ws,{type:'join-error',message:`Phòng ${requestedRoom.toUpperCase()} đã đầy hoặc không tồn tại. Hãy chọn phòng khác.`});broadcastRoomList();return;}
   const id=crypto.randomUUID(),room=rooms.get(roomId),joinedAt=Date.now();const usedNumbers=new Set([...room.players.values()].map(q=>Number(q.jerseyNumber)));let jerseyNumber=0;for(let n=1;n<=ROOM_CAPACITY;n++){if(!usedNumbers.has(n)){jerseyNumber=n;break;}}if(!jerseyNumber){send(ws,{type:'join-error',message:'Phòng đã đủ 50 số áo. Hãy chọn phòng khác.'});return;}const statKey=name.toLocaleLowerCase('vi');const stats=playerStats.get(statKey)||{name,jerseyNumber,visits:0,rituals:0,cheers:0};stats.name=name;stats.jerseyNumber=jerseyNumber;stats.visits++;playerStats.set(statKey,stats);const p={id,name,jerseyNumber,x:0,z:10,action:'walk',ws,joinedAt,strongFanAt:270000+Math.floor(Math.random()*90001),lastActivity:joinedAt,presencePromptAt:0,lastChat:0,ritualUntil:Date.now()+7500,ritualCounted:false};room.players.set(id,p);clients.set(ws,{id,name,roomId});
   send(ws,{type:'joined',id,roomId,capacity:ROOM_CAPACITY,ritualMs:5000,hangMode,mood:MOODS[hangMode],players:[...room.players.values()].map(publicPlayer)});
   broadcast(roomId,{type:'player-joined',player:publicPlayer(p)},id);broadcastRoomList();return;
  }
  if(!state)return;const room=rooms.get(state.roomId),p=room?.players.get(state.id);if(!p)return;
  if(m.type==='set-hang-mode'){const mode=Object.hasOwn(MOODS,String(m.mode))?String(m.mode):'gloomy';hangMode=mode;for(const id of rooms.keys())broadcast(id,{type:'hang-mode',mode,mood:MOODS[mode],by:p.name});p.lastActivity=Date.now();p.presencePromptAt=0;return;}
  if(m.type==='heartbeat'){send(ws,{type:'heartbeat-ack',at:Date.now()});return;}
  if(m.type==='still-here'){p.lastActivity=Date.now();p.presencePromptAt=0;send(ws,{type:'still-here-ack'});return;}
  if(m.type==='activity'){p.lastActivity=Date.now();p.presencePromptAt=0;return;}
  if(m.type==='inactive'){removePlayer(ws,'inactive');closeFor(ws,4001,'inactive');return;}
  if(m.type==='chat'){
   p.lastActivity=Date.now();p.presencePromptAt=0;const now=Date.now();const text=String(m.text||'').replace(/[<>]/g,'').replace(/\s+/g,' ').trim().slice(0,180);
   if(!text)return;if(now-p.lastChat<CHAT_COOLDOWN_MS){send(ws,{type:'chat-error',message:`Chờ ${Math.ceil((CHAT_COOLDOWN_MS-(now-p.lastChat))/1000)} giây nữa rồi hãy gửi tin tiếp nhé.`});return;}
   p.lastChat=now;broadcast(state.roomId,{type:'chat',id:p.id,name:p.name,jerseyNumber:p.jerseyNumber,text,at:now});return;
  }
  if(Date.now()<p.ritualUntil && ['move','action'].includes(m.type)){send(ws,{type:'ritual-locked',remaining:Math.max(0,p.ritualUntil-Date.now())});return;}
  if(m.type==='ritual-progress'){p.lastActivity=Date.now();p.presencePromptAt=0;if(m.action==='prostrate'&&!p.ritualCounted){p.ritualCounted=true;const st=playerStats.get(p.name.toLocaleLowerCase('vi'));if(st)st.rituals++;}p.x=Math.max(-13,Math.min(13,Number(m.x)||0));p.z=Math.max(-9,Math.min(13,Number(m.z)||0));p.action=m.action==='prostrate'?'prostrate':'walk';broadcast(state.roomId,{type:'player-updated',player:publicPlayer(p)},state.id);return;}
  if(m.type==='carry-request'){
   if(Date.now()<p.ritualUntil){send(ws,{type:'carry-error',message:'Hoàn tất nghi thức nhập hang rồi hãy mời cõng nhé.'});return;}
   p.lastActivity=Date.now();p.presencePromptAt=0;const targetId=String(m.targetId||''),target=room.players.get(targetId);
   if(!target||target.id===p.id){send(ws,{type:'carry-error',message:'Không tìm thấy người chơi đó.'});return;}
   if(p.carryingId||p.carriedBy||target.carryingId||target.carriedBy){send(ws,{type:'carry-error',message:'Một trong hai người đang tham gia cõng rồi.'});return;}
   if(Math.hypot(p.x-target.x,p.z-target.z)>3.5){send(ws,{type:'carry-error',message:'Hãy đến gần người đó hơn rồi mời cõng nhé.'});return;}
   target.pendingCarryFrom={id:p.id,at:Date.now(),style:m.style==='bridal'?'bridal':'piggyback'};send(target.ws,{type:'carry-invite',style:target.pendingCarryFrom.style,from:{id:p.id,name:p.name,jerseyNumber:p.jerseyNumber}});send(ws,{type:'carry-pending',targetName:target.name});return;
  }
  if(m.type==='carry-response'){
   if(Date.now()<p.ritualUntil){send(ws,{type:'carry-error',message:'Hoàn tất nghi thức nhập hang rồi hãy nhận lời cõng nhé.'});return;}
   const fromId=String(m.fromId||''),from=room.players.get(fromId),pending=p.pendingCarryFrom;
   if(!from||Date.now()<from.ritualUntil||!pending||pending.id!==fromId||Date.now()-pending.at>15000){p.pendingCarryFrom=null;send(ws,{type:'carry-error',message:'Lời mời cõng đã hết hạn.'});return;}
   p.pendingCarryFrom=null;
   if(m.accept!==true){send(from.ws,{type:'carry-declined',targetName:p.name});return;}
   if(p.carryingId||p.carriedBy||from.carryingId||from.carriedBy||Math.hypot(p.x-from.x,p.z-from.z)>3.5){send(ws,{type:'carry-error',message:'Không thể bắt đầu cõng; hãy đứng gần nhau và thử lại.'});send(from.ws,{type:'carry-error',message:'Không thể bắt đầu cõng; hãy đứng gần nhau và thử lại.'});return;}
   from.carryingId=p.id;p.carriedBy=from.id;from.action='idle';p.action='carried';from.spotId=null;p.spotId=null;from.lastActivity=Date.now();p.lastActivity=Date.now();
   broadcast(state.roomId,{type:'carry-started',style:pending.style||'piggyback',carrierId:from.id,passengerId:p.id});broadcast(state.roomId,{type:'player-updated',player:publicPlayer(from)});broadcast(state.roomId,{type:'player-updated',player:publicPlayer(p)});return;
  }
  if(m.type==='interaction-request'){
   const target=room.players.get(String(m.targetId||'')),kind=String(m.kind||'');
   if(!['highfive','handshake','push'].includes(kind)||!target||target.id===p.id){send(ws,{type:'interaction-error',message:'Không thể gửi lời mời tương tác.'});return;}
   if(p.carryingId||p.carriedBy||target.carryingId||target.carriedBy||p.pendingInteraction||target.pendingInteraction){send(ws,{type:'interaction-error',message:'Một trong hai người đang bận tương tác.'});return;}
   if(Date.now()<p.ritualUntil||Date.now()<target.ritualUntil||Math.hypot(p.x-target.x,p.z-target.z)>3.5){send(ws,{type:'interaction-error',message:'Hai người cần đứng gần nhau và hoàn tất nghi thức nhập hang.'});return;}
   const inviteId=crypto.randomUUID();p.pendingInteraction={id:inviteId,targetId:target.id,kind,at:Date.now()};target.pendingInteraction={id:inviteId,fromId:p.id,kind,at:Date.now()};
   send(target.ws,{type:'interaction-invite',inviteId,kind,from:{id:p.id,name:p.name,jerseyNumber:p.jerseyNumber}});send(ws,{type:'interaction-pending',targetName:target.name});return;
  }
  if(m.type==='interaction-response'){
   const inviteId=String(m.inviteId||''),fromId=String(m.fromId||''),from=room.players.get(fromId),pending=p.pendingInteraction;
   if(!from||!pending||pending.id!==inviteId||pending.fromId!==fromId||Date.now()-pending.at>15000){p.pendingInteraction=null;send(ws,{type:'interaction-error',message:'Lời mời đã hết hạn.'});return;}
   const kind=pending.kind;p.pendingInteraction=null;from.pendingInteraction=null;
   if(m.accept!==true){send(from.ws,{type:'interaction-declined',targetName:p.name});return;}
   if(Math.hypot(p.x-from.x,p.z-from.z)>4){send(ws,{type:'interaction-error',message:'Hai người đã đứng quá xa nhau.'});send(from.ws,{type:'interaction-error',message:'Hai người đã đứng quá xa nhau.'});return;}
   const duration=kind==='push'?650:kind==='handshake'?1800:1300;p.lastInteractionAt=Date.now();from.lastInteractionAt=Date.now();
   broadcast(state.roomId,{type:'interaction-started',kind,playerA:from.id,playerB:p.id,duration});
   if(kind==='push'){const dx=p.x-from.x,dz=p.z-from.z,len=Math.max(.01,Math.hypot(dx,dz));p.x=Math.max(-13,Math.min(13,p.x+dx/len*1.15));p.z=Math.max(-9,Math.min(13,p.z+dz/len*1.15));setTimeout(()=>{if(room.players.has(p.id))broadcast(state.roomId,{type:'player-updated',player:publicPlayer(p)});},180);}
   return;
  }
  if(m.type==='carry-stop'){
   p.lastActivity=Date.now();p.presencePromptAt=0;if(p.carryingId||p.carriedBy)endCarry(state.roomId,p);return;
  }
  if(m.type==='spot'){if(p.carriedBy){send(ws,{type:'carry-error',message:'Bạn đang được cõng, hãy chờ được thả xuống nhé.'});return;}p.lastActivity=Date.now();p.presencePromptAt=0;
   const spotId=String(m.spotId||'');if(!/^spot-[a-z0-9-]{1,24}$/.test(spotId))return;
   for(const otherRoom of rooms.values())for(const other of otherRoom.players.values())if(other.id!==p.id&&otherRoom===room&&other.spotId===spotId){send(ws,{type:'spot-error',message:'Vị trí tròn này đã có Quỷ Đỏ đứng rồi, bạn chọn chỗ khác nhé!'});return;}
   const parts=spotId.split('-');const side=parts[1]==='l'?-1:1,col=Number(parts[2]),row=Number(parts[3]);if(!Number.isInteger(col)||!Number.isInteger(row)||col<0||col>4||row<0||row>4)return;
   p.spotId=spotId;p.x=side*(6.7+col*1.45);p.z=-10+row*3.5;p.action='cheer';const cheerStat=playerStats.get(p.name.toLocaleLowerCase('vi'));if(cheerStat)cheerStat.cheers++;const cheerNow=Date.now(),recentCheers=(cheerWindows.get(state.roomId)||[]).filter(x=>cheerNow-x.at<3500&&x.id!==p.id);recentCheers.push({id:p.id,at:cheerNow});cheerWindows.set(state.roomId,recentCheers);if(recentCheers.length>=3){broadcast(state.roomId,{type:'collective-cheer'});cheerWindows.set(state.roomId,[]);}broadcast(state.roomId,{type:'player-updated',player:publicPlayer(p)});return;
  }
  if(m.type==='move'||m.type==='action'){if(p.carriedBy){send(ws,{type:'carry-error',message:'Bạn đang được cõng, chưa thể tự di chuyển.'});return;}p.lastActivity=Date.now();p.presencePromptAt=0;
   if(m.type==='action'&&m.action==='cheer'){const st=playerStats.get(p.name.toLocaleLowerCase('vi'));if(st)st.cheers++;const now=Date.now(),recent=(cheerWindows.get(state.roomId)||[]).filter(x=>now-x.at<3500&&x.id!==p.id);recent.push({id:p.id,at:now});cheerWindows.set(state.roomId,recent);if(recent.length>=3){broadcast(state.roomId,{type:'collective-cheer'});cheerWindows.set(state.roomId,[]);}}
   if(m.type==='move'){const nx=Math.max(-13,Math.min(13,Number(m.x)||0)),nz=Math.max(-9,Math.min(13,Number(m.z)||0));if(Math.abs(nx-p.x)>.03||Math.abs(nz-p.z)>.03)p.spotId=null;p.x=nx;p.z=nz;}
   if(m.type==='action'&&m.action!=='sit')p.spotId=null;p.action=['idle','walk','cheer','bow','prostrate','sit','jump'].includes(m.action)?m.action:'idle';
   broadcast(state.roomId,{type:'player-updated',player:publicPlayer(p)},state.id);
  }
 });
 ws.on('close',()=>removePlayer(ws));ws.on('error',()=>removePlayer(ws));
});
setInterval(()=>{const now=Date.now();for(const [ws,s] of clients){const r=rooms.get(s.roomId),p=r?.players.get(s.id);if(!p)continue;if(p.pendingInteraction&&now-p.pendingInteraction.at>15000){const pending=p.pendingInteraction;p.pendingInteraction=null;const other=r.players.get(pending.targetId||pending.fromId);if(other)other.pendingInteraction=null;}if(p.pendingCarryFrom&&now-p.pendingCarryFrom.at>15000)p.pendingCarryFrom=null;if(!p.presencePromptAt&&now-p.lastActivity>IDLE_PROMPT_MS){p.presencePromptAt=now;send(ws,{type:'presence-check',graceMs:IDLE_GRACE_MS});}else if(p.presencePromptAt&&now-p.presencePromptAt>IDLE_GRACE_MS){removePlayer(ws,'inactive');closeFor(ws,4001,'inactive');}}},1000).unref();
server.listen(PORT,()=>console.log(`Hang MU running on ${PORT}; ${MAX_ROOMS} rooms x ${ROOM_CAPACITY} players`));
