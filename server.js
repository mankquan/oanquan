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

// === HỆ THỐNG TIN NHẮN TỰ NHIÊN CHUẨN GAMER VIỆT & VĂN HÓA HANG MU (220+ CÂU MEME) ===

const CASUAL_MESSAGES = [
  "ê ae",
  "đâu r ae",
  "alo alo",
  "có ai ko",
  "vẫn đông vui nhỉ :))",
  "nay chill thế",
  "xin slot ngồi với",
  "đợi tí ae",
  "hang nay ấm cúng ghê",
  "ngồi hóng mát tí ae",
  "ai làm cốc trà đá ko",
  "vào hang chill thôi ae",
  "ngồi ngắm cờ MU tĩnh tâm",
  "thơm phức mùi mì tôm ae ơi",
  "hang Quỷ Đỏ hôm nay đông vui phết",
  "làm cốc nước chè đá thuốc lào ae",
  "chui hang tránh bão thôi anh em ơi",
  "ngồi đây ấm áp hơn ở ngoài nhiều",
  "anh em ai có đồ ăn vặt chia sẻ tí nào",
  "hôm nay tâm trạng ai cũng phấn khởi nhỉ"
];

const MU_MEME_MESSAGES = [
  "thắng Roma 3-2 đỉnh chóp, quẩy tiếp thôi anh em!",
  "chủ nhật 23:30 gặp Aston Villa, anh em chuẩn bị bia mồi sẵn chưa?",
  "Bruno trận trước gánh còng lưng 🔥",
  "Matheus Cunha làm cú đúp cháy thật sự!",
  "quỷ đỏ mãi đỉnh anh em ơi 🔴",
  "thắng thì cùng gáy, bại thì cùng chui hang!",
  "dập đầu bái cờ MU lấy may cho trận Aston Villa nào!",
  "fan MU 20 năm vẫn một tình yêu bất diệt!",
  "ở trong hang ấm cúng quen rồi, giờ ra ngoài thấy chói chang quá :))",
  "Sir Alex còn tại vị thì chấp cả giải Ngoại Hạng!",
  "thời Amorim đang tới, chuẩn bị reset cuộc chơi nhé!",
  "ai bảo MU hết cứu? Vẫn đá cho Roma tối tăm mặt mũi kia kìa!",
  "mì tôm trong hang MU lúc nào cũng thơm ngon nhất quả đất!",
  "hang MU có điều hòa 2 chiều, wifi căng đét, ae cứ yên tâm trú bão!",
  "trận tới mà thắng Aston Villa nữa là hang mở tiệc linh đình!",
  "chân gỗ lim đã được mài sắc, anh em chờ xem!",
  "hàng thủ MU làm tôi thót tim hơn cả đi tàu lượn siêu tốc =)))",
  "cứ mỗi lần MU đá là tim đập chân run, huyết áp tăng vọt!",
  "yêu MU là bài học kiên nhẫn nhất cuộc đời tôi!",
  "top 4 trong tầm tay, top 1 trong tim!",
  "thắng hú vía 3-2 nhưng 3 điểm vẫn là 3 điểm, gáy lên!",
  "anh em đâu rồi, đồng thanh hô vang: GLORY GLORY MAN UNITED!",
  "Tạ Tấn hôm nay đá chuẩn chỉ thế mà vẫn bị chê à :))",
  "thầy Mười Khó tuy đi nhưng tinh thần di sản vẫn còn phảng phất!",
  "bàn chiến thuật này vẽ đường đưa MU vào chung kết C1 nhé!",
  "hang Quỷ Đỏ hôm nay đón tiếp bao nhiêu anh em rồi nhỉ?",
  "thắp ngọn đuốc thiêng cầu may cho hàng tiền đạo nào!",
  "trận trước Cunha ăn thẻ đỏ phút bù giờ hơi cay nhưng vẫn đỉnh!",
  "đá pen tín như Bruno thì bố ai cản được!",
  "gáy sớm thì ăn gì không biết, nhưng fan MU là phải gáy trước đã :))",
  "bao năm chui hang luyện thành thần công rồi anh em ạ!",
  "Old Trafford là nhà, còn hang này là nơi sưởi ấm tâm hồn!",
  "dù ai nói ngả nói nghiêng, lòng tôi vẫn hướng về Nhà Hát Của Những Giấc Mơ!",
  "một ngày là Quỷ Đỏ, cả đời làm Quỷ Đỏ 🔴",
  "chủ nhật này Aston Villa sẽ biết thế nào là bản lĩnh Quỷ!",
  "chiến thắng trước Roma là bước đệm hoàn hảo cho chặng đường tới!",
  "ngồi trên đĩa tròn ngắm cờ MU thấy lòng bình yên đến lạ!",
  "hang này ấm hơn chăn ấm nệm êm ở nhà nữa ae!",
  "anh em ai có trà đá thuốc lào mang ra chia sẻ tí nào!",
  "Bố Ronaldo có về lại MU gánh team không nhỉ haha :))",
  "hôm nay ai phụ trách nấu mì tôm cho cả hang thế?",
  "bàn cờ chiến thuật 4-4-2 chuẩn bài Sir Alex thời hoàng kim!",
  "trận gặp Aston Villa anh em dự đoán tỷ số bao nhiêu?",
  "tôi tin MU sẽ đè bẹp Aston Villa 2-0 lấy trọn 3 điểm!",
  "cửa hang mở rộng đón anh em bốn phương về đoàn tụ!",
  "MU vô địch trong lòng người hâm mộ là chân lý bất diệt!",
  "anh em bái cờ một lạy để cầu cho hàng thủ không báo nữa nào!",
  "có ai vừa chạy show về kịp xem đá bóng không?",
  "trọng tài bắt trận tới mà thiên vị là anh em tính sổ ngay!",
  "hang MU v21 đẳng cấp chưa từng thấy, đông vui như trẩy hội!"
];

const RIVAL_MEME_MESSAGES = [
  "bố Arsenal ơi, cúp đâu rồi mang ra ngắm tí nào :))",
  "pháo thủ vô địch tháng 8, tháng 5 về top 2 quen thuộc haha!",
  "Arteta tin vào quy trình nhưng quy trình chạy bằng niềm tin à?",
  "Emirates hôm nay lại có mưa nước mắt à các anh em Pháo?",
  "Arsenal đá đẹp mắt nhưng bảng thành tích thì trống trơn =)))",
  "thôi anh em Pháo thủ vào hang MU giao lưu chén trà đá cho ấm!",
  "gáy trước chung kết là đặc sản của Pháo thủ rồi!",
  "định mệnh á quân khó thoát lắm anh em Arsenal ơi!",
  "pháo thủ online lúc nào cũng tự tin cho đến trận gặp MU haha!",
  "Liverpool bay cao nhưng coi chừng Slot Machine gãy đòn bẩy nhé!",
  "The Kop múa may cho lắm rồi lại trắng tay thôi :))",
  "Salah cứu rỗi cả mùa giải, khi Salah tịt ngòi thì ai gánh đây?",
  "Anfield chảo lửa nhưng vào Old Trafford vẫn phải e dè!",
  "fan Liver bảo không sợ MU, nhưng nhìn lịch thi đấu lại toát mồ hôi!",
  "lữ đoàn đỏ chạy KPI kinh thật nhưng cẩn thận hụt hơi tháng 3!",
  "115 cáo buộc xử đến đâu rồi anh em Man Xanh ơi :))",
  "VAR cứu Man City nhiều quá đâm ra quen tay rồi!",
  "Haaland tàng hình mấy trận lớn lại bắt đầu rồi đấy!",
  "Pep trọc lại bắt đầu nghĩ nhiều ở Champions League rồi haha!",
  "tiền nhiều để làm gì khi hang MU vẫn đông vui hơn Etihad?",
  "fan Man City mới xem bóng từ 2021 đúng không anh em?",
  "Chelsea ký hợp đồng 8 năm, đá 8 trận lại đổi huấn luyện viên =)))",
  "Palmer gánh cả bệnh viện Chelsea còng cả lưng!",
  "bỏ 1 tỷ bảng mua sắm xong về xếp giữa bảng xếp hạng, đỉnh cao chi tiêu!",
  "London is Red chứ Blue gì tầm này nữa các anh em!",
  "Chelsea trẻ trung triển vọng... của 10 năm sau nữa nhé haha!",
  "Tottenham cúp phòng trưng bày vẫn bám đầy bụi chưa lau à?",
  "Son Heung-min gánh gà trống mệt nghỉ mà vẫn trắng tay!",
  "Newcastle đại gia dầu mỏ mới nổi nhưng gặp MU vẫn tắt điện!",
  "anh em Chelsea qua đây ngồi nhờ đĩa tròn cho ấm cúng nè!",
  "Pep trọc năm nay rụng thêm mấy cọng tóc vì toan tính rồi!",
  "Arsenal mà vô địch thì tuyết rơi giữa mùa hè Hà Nội luôn!",
  "Man City đá như máy xay điểm nhưng gặp Quỷ Đỏ là nghẽn máy ngay!"
];

const EUROPE_MEME_MESSAGES = [
  "Real Madrid lại chuẩn bị bật aura ADN C1 phút 90+ à?",
  "Barca đòn bẩy tài chính kéo mãi không hết, bán nốt cỏ sân Camp Nou chưa?",
  "Bayern đè bẹp đối thủ ở Bundesliga nhưng ra C1 cũng rén!",
  "PSG đốt tiền mua siêu sao xong vẫn chỉ quanh quẩn vô địch nông dân!",
  "Dortmund chuyên ươm mầm tài năng xong bán lấy tiền chia nhau!",
  "Juventus với Milan đợt này chui chung hang với fan MU luôn cho ấm!",
  "Atletico Madrid đá thủ tiêu cực dựng xe buýt ba tầng luôn chứ 2 tầng gì!",
  "Camp Nou xây lại xong chưa hay là nợ tiền nhà thầu rồi :))",
  "Real Madrid ăn rùa quen thói nhưng công nhận rùa đỉnh cao thật!",
  "Mbappe sang Real xong pressing bằng mắt à anh em haha!",
  "Harry Kane sang Bayern tính thoát dớp mà dớp bám dai như đỉa!",
  "Inter Milan với Napoli đợt này gáy to ở Serie A ghê!",
  "bóng đá châu Âu dạo này tấu hài không kém gì rạp xiếc trung ương!"
];

const GENERAL_MEME_MESSAGES = [
  "đá như này thì bác sĩ trả về, hết cứu thật sự =)))",
  "chân gỗ lim nhập khẩu, sút bóng lên thẳng khán đài bắn chim!",
  "trọng tài thiên vị rõ ràng, VAR để làm cảnh à anh em!",
  "hàng thủ giăng bẫy việt vị mà bẫy luôn cả thủ môn nhà mình!",
  "bán độ lộ liễu thế này công an bắt ngay bây giờ đấy :))",
  "quả bóng tròn chuyện gì cũng có thể xảy ra, cứ tin đi!",
  "chiến thuật xe buýt 2 tầng đỗ kín khung thành bất khả xâm phạm!",
  "sút mù mắt người xem luôn rồi các bro ơi haha!",
  "thánh lầy tấu hài, xem bóng đá mà ngỡ xem Gala Cười!",
  "đá mồm thì vô địch thiên hạ, ra sân thì thở bằng tai!",
  "tâm linh không đùa được đâu, thắp hương bái cờ trước trận là chuẩn bài!",
  "đỉnh nóc kịch trần bay phấp phới luôn anh em ơi 🔥",
  "uy tín 100% không cần cọc, kèo này MU ăn chắc!",
  "bro ra đây cõng tôi đi dạo quanh hang ngắm cờ tí nào!",
  "ngồi đĩa tròn uống trà đá xem bóng đá thì chill nhất hệ mặt trời!",
  "bro nào cõng tôi với, đi bộ nhiều mỏi chân quá!",
  "hang Quỷ Đỏ nơi hội tụ tinh hoa võ học tấu hài!",
  "xem bóng đá giải trí thôi, quạu làm gì tổn thọ anh em ơi!",
  "cầu thủ đá bóng bằng chân, fan đá bóng bằng phím :))",
  "ảo ma canada thật sự, tình huống khó thế cũng làm được!",
  "nghe vô lý nhưng lại cực kỳ thuyết phục luôn!",
  "bất ngờ chưa bà già, tỷ số không ai ngờ tới!",
  "10 điểm về chỗ, không có nhưng nhị gì hết!",
  "trận đấu mãn nhãn, đau tim nghẹt thở đến giây cuối cùng!",
  "đang ngồi thiền dưỡng sinh chờ trận cầu đinh chủ nhật!",
  "làm cái đập tay hữu nghị anh em ơi 🙌",
  "ra đây bắt tay làm quen tí nào người anh em 🤝",
  "đẩy nhẹ một cái xem chân có vững không nào haha 👉",
  "ăn mừng nhiệt tình lên anh em, Quỷ Đỏ bùng cháy!",
  "hang MU hôm nay mở đại tiệc ăn mừng chiến thắng!",
  "đứng hát vang bài ca chiến thắng cùng đồng đội nào!",
  "quỳ lạy cờ thiêng, xin thần linh phù hộ cho trận tới toàn thắng!",
  "chào cờ đầu tuần chưa anh em, bái một lạy cho đỏ cả tuần!"
];

const INTERACT_MESSAGES = [
  "ê bro",
  "sang đây ngồi với ae",
  "bế tôi đi bro :))",
  "cho xin cái tương tác",
  "ơ kìa bỏ tôi à",
  "bro im thế",
  "chào cái coi",
  "ae mình làm quen tí",
  "cõng tôi một đoạn đi bro!",
  "nhìn bro uy tín phết đấy",
  "làm cái đập tay lấy may nào",
  "ra đây ngắm bàn chiến thuật với tôi"
];

const ALL_FOOTBALL_MEMES = [
  ...MU_MEME_MESSAGES,
  ...RIVAL_MEME_MESSAGES,
  ...EUROPE_MEME_MESSAGES,
  ...GENERAL_MEME_MESSAGES
];

const MEME_MESSAGES = ALL_FOOTBALL_MEMES;
const TROLL_MESSAGES = [...RIVAL_MEME_MESSAGES, ...EUROPE_MEME_MESSAGES];
const FAN_MESSAGES = MU_MEME_MESSAGES;

// === CÁC CẶP HỘI THOẠI ĐỐI ĐÁP QUA LẠI TỰ NHIÊN GIỮA 2 NPC (38 CẶP) ===
const NPC_DIALOG_PAIRS = [
  { from: "ê ae", reply: "alo nghe nè bro ơi :))" },
  { from: "đâu r ae", reply: "đang ngồi ngắm đốm lửa thiêng nè" },
  { from: "hết cứu =)))", reply: "bác sĩ lắc đầu trả về luôn à haha" },
  { from: "ảo ma canada", reply: "10 điểm ko có nhưng luôn =)))" },
  { from: "MU nay đông phết nhỉ", reply: "thắng Roma xong hang mở hội mà bro!" },
  { from: "fan MU nhưng tâm hồn bất ổn", reply: "bất ổn từ chục năm nay rồi bro ơi :))" },
  { from: "đá thế này thì top 1 kiểu gì", reply: "top 1 trong lòng anh em là được rồi =)))" },
  { from: "ae gáy ít thôi =)))", reply: "không gáy thì sao là fan MU được haha" },
  { from: "thua nhưng vẫn gáy", reply: "khí chất quỷ đỏ không bao giờ tắt nhé!" },
  { from: "lại báo nữa rồi", reply: "báo quen rồi, ko báo ko phải MU =)))" },
  { from: "xin slot ngồi với", reply: "qua đây ngồi đĩa tròn chill nè bro" },
  { from: "đỉnh nóc kịch trần", reply: "bay phấp phới luôn ae ơi 🔥" },
  { from: "nghe vô lý nhưng lại hợp lý", reply: "chính là triết lý chui hang MU đấy :))" },
  { from: "chủ nhật 23:30 gặp Aston Villa", reply: "chuẩn bị bia mồi sẵn sàng quẩy tiếp thôi!" },
  { from: "uy tín chưa ae", reply: "uy tín 100% ko cần cọc luôn nhé haha" },
  { from: "bế tôi đi bro :))", reply: "tự đi bộ cho khỏe chân đi ông tướng =)))" },
  { from: "bro im thế", reply: "đang tĩnh tâm cầu may cho trận tới nè!" },
  { from: "vẫn đông vui nhỉ :))", reply: "hang MU lúc nào chẳng rôm rả ấm cúng" },
  { from: "khó thế cũng nghĩ ra", reply: "đẳng cấp fan MU nó phải khác bọt chứ :))" },
  { from: "nay chill thế", reply: "chill chờ chủ nhật lại leo lên đỉnh nóc!" },
  { from: "Cunha ghi 2 bàn cháy thật", reply: "trận tới chắc chắn lại nổ súng tiếp!" },
  { from: "Bruno đá pen đỉnh thật sự", reply: "đội trưởng uy tín nhất mùa này rồi!" },
  { from: "có ai đói bụng ko", reply: "làm gói mì tôm ăn chống đói đi bro" },
  { from: "chào cái coi ae", reply: "hé lô người anh em cùng chung chiến tuyến!" },
  { from: "Arsenal mùa này vô địch chắc luôn ae", reply: "vô địch tháng 8 thôi bro, tháng 5 lại á quân quen thuộc haha!" },
  { from: "Man City đá như máy xay điểm sợ thật", reply: "chờ 115 cáo buộc xử xong rồi tính tiếp bro ơi :))" },
  { from: "Chelsea chi 1 tỷ bảng mua cầu thủ rồi đấy", reply: "chi 1 tỷ xong lại thay tướng đổi vận à haha =)))" },
  { from: "Liverpool dạo này gáy to thế nhỉ", reply: "để chủ nhật chạm trán xem còn gáy được không nè!" },
  { from: "Real Madrid phút 90 lại bật aura C1 à", reply: "aura ăn rùa chân truyền từ đời này qua đời khác rồi!" },
  { from: "Barca vừa kích hoạt thêm đòn bẩy thứ 5 rồi ae", reply: "bán nốt cả mặt cỏ sân bóng để mua cầu thủ à haha" },
  { from: "sao bro cứ đứng nhìn bàn chiến thuật mãi thế?", reply: "đang tìm sơ đồ chiến thuật cứu vãn mùa giải đây bro =)))" },
  { from: "đốm lửa thiêng trong hang ấm áp ghê", reply: "ngồi quây quần sưởi ấm tâm hồn sau những ngày bão gió bro ơi!" },
  { from: "cõng tôi đi dạo một đoạn đi bro!", reply: "tự đi cho chân dài ra đi ông thần, lười thế =)))" },
  { from: "trọng tài trận vừa rồi thổi mù mắt thật", reply: "VAR trận đấy như mất kết nối wifi vậy bro haha!" },
  { from: "hàng thủ đá làm tôi thót cả tim", reply: "xem MU là phải chuẩn bị sẵn thuốc trợ tim bro ạ :))" },
  { from: "anh em bái cờ một lạy lấy may chưa", reply: "bái cờ thành tâm mong chủ nhật ẵm trọn 3 điểm!" },
  { from: "hôm nay có ai chạy show về muộn không", reply: "chạy show mệt nhưng vẫn kịp vào hang điểm danh nè!" },
  { from: "GLORY GLORY MAN UNITED!", reply: "AS THE REDS GO MARCHING ON ON ON! 🔥🔴" }
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
// Cấu hình 4 phòng: mỗi phòng có đúng 10 nhân vật AFK (tổng 40 AFK phân bổ đều)
const ROOM_AFK_CONFIG = [
  { id: 'hang-01', count: 10 },
  { id: 'hang-02', count: 10 },
  { id: 'hang-03', count: 10 },
  { id: 'hang-04', count: 10 }
];

const personalities = ['meme', 'troller', 'fan_ruot', 'casual', 'interactor'];
const SPAWN_INTERVAL_MS = Number(process.env.TEST_SPAWN_INTERVAL_MS) || 10000; // Mỗi ~10 giây sinh ra đúng 1 bot
const FIRST_SPAWN_MS = Number(process.env.TEST_FIRST_SPAWN_MS) || 10000;

for (let rIdx = 0; rIdx < ROOM_AFK_CONFIG.length; rIdx++) {
  const cfg = ROOM_AFK_CONFIG[rIdx];
  const roomId = cfg.id;
  const room = {
    id: roomId,
    roomIndex: rIdx,
    players: new Map(), // Người chơi thật có WebSocket
    afks: new Map(),    // AFK NPC đã spawn thành công
    afkList: [],        // Thứ tự danh sách AFK đã spawn
    targetAfkCount: cfg.count, // 10 bot
    afkSpawnIndex: 0,   // Số lượng bot đã spawn (0..10)
    nextAfkSpawnAt: serverStartTime + FIRST_SPAWN_MS,
    ceremonyQueue: [],  // Hàng đợi nghi thức bái cờ đổi tên [{ botId, newName }]
    activeCeremony: null, // NPC hiện tại đang thực hiện nghi thức { botId, newName, state: 'walking'|'kneeling', arrivalAt, kneelUntil }
    nextAfkChatAt: serverStartTime + 15000 + Math.floor(Math.random() * 15000),
    nextNpcCarryRequestAt: serverStartTime + 40000 + Math.floor(Math.random() * 25000)
  };
  rooms.set(roomId, room);
}

// === TỰ ĐỘNG XẾP HÀNG ĐỔI TÊN 40 NPC THEO CHU KỲ 5 PHÚT (300 GIÂY) TỪ BỘ 200 TÊN ===
const ROTATION_INTERVAL_MS = Number(process.env.TEST_ROTATION_MS) || (300 * 1000); // 300 giây (5 phút)
let afkNameCycle = 0;

function rotateAfkNames() {
  afkNameCycle++;
  let botIndex = 0;
  for (let rIdx = 0; rIdx < ROOM_AFK_CONFIG.length; rIdx++) {
    const cfg = ROOM_AFK_CONFIG[rIdx];
    const roomId = cfg.id;
    const room = rooms.get(roomId);
    if (!room) continue;

    for (let j = 0; j < room.afkList.length; j++) {
      const idx = botIndex++;
      const nameIndex = (afkNameCycle * 40 + idx) % AFK_NAMES_200.length;
      const bot = room.afkList[j];
      if (bot) {
        const nextName = AFK_NAMES_200[nameIndex];
        // Đưa vào ceremonyQueue để bái cờ đổi tên tuần tự, tránh trùng lặp
        const queuedItem = room.ceremonyQueue.find(item => item.botId === bot.id);
        if (queuedItem) {
          queuedItem.newName = nextName;
        } else {
          room.ceremonyQueue.push({ botId: bot.id, newName: nextName });
        }
      }
    }
  }
  const startNum = (afkNameCycle * 40) % AFK_NAMES_200.length + 1;
  const endNum = startNum + 39;
  console.log(`[AFK ROTATION] Chu kỳ ${afkNameCycle}: Đã xếp hàng nghi thức bái cờ đổi tên sang nhóm tên ${startNum}–${endNum}`);
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
            `Chào mừng bro ${name} đã nhập hang MU! Vào đây quây quần cho ấm nè 🔥`,
            `Hé lô bro ${name}, quỷ đỏ thứ thiệt đây rồi! Cùng nhau quẩy nhé 🔴`,
            `Welcome bro ${name}, qua đây ngồi đĩa tròn ngắm cờ chill với tôi!`,
            `Bro ${name} vào hang đúng lúc ghê, chuẩn bị bia mồi quẩy trận Aston Villa nào!`,
            `Hé lô ${name}, vào bái cờ MU lấy may đê, thắng thì cùng gáy nhé :))`
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
    // 0. Sequential AFK NPC Spawning: Mỗi ~10 giây sinh ra đúng 1 NPC độc lập cho từng phòng
    if (room.afkSpawnIndex < room.targetAfkCount && now >= room.nextAfkSpawnAt) {
      const j = room.afkSpawnIndex;
      const globalIdx = room.roomIndex * 10 + j;
      const name = AFK_NAMES_200[globalIdx % AFK_NAMES_200.length];
      const title = AFK_TITLES[globalIdx % AFK_TITLES.length] || "Quỷ Đỏ trung kiên";
      const spot = AFK_SPOTS[j % AFK_SPOTS.length];
      const id = `afk-${roomId}-${j}`;
      const bot = {
        id,
        name,
        title,
        jerseyNumber: 11 + j,
        personality: personalities[globalIdx % personalities.length],
        x: spot.x,
        z: spot.z,
        homeX: spot.x,
        homeZ: spot.z,
        action: spot.action || 'idle',
        spotId: null,
        reservedSpotId: null,
        spotArrivalAt: 0,
        walkArrivalAt: 0,
        carryingId: null,
        carriedBy: null,
        carryAutoDropAt: 0,
        isAfk: true,
        joinedAt: now,
        strongFanAt: 60000,
        nextActionAt: now + 2000 + Math.floor(Math.random() * 2500),
        inCeremony: false,
        ceremonyStep: null
      };

      room.afks.set(id, bot);
      room.afkList.push(bot);
      room.afkSpawnIndex++;
      room.nextAfkSpawnAt = now + SPAWN_INTERVAL_MS;

      // Cặp cõng nhau giữa bot 6 và bot 7 (sau khi bot 7 xuất hiện)
      if (j === 7 && room.afks.has(`afk-${roomId}-6`)) {
        const b6 = room.afks.get(`afk-${roomId}-6`);
        if (b6 && !b6.carryingId && !b6.carriedBy) {
          b6.carryingId = bot.id;
          bot.carriedBy = b6.id;
          bot.action = 'carried';
        }
      }

      broadcast(roomId, {
        type: 'player-joined',
        player: publicPlayer(bot)
      });
      broadcastRoomList();
    }

    if (room.players.size === 0) continue; // Chỉ chạy khi có người thật trong phòng
    const activeAfks = getActiveAfks(room);
    if (!activeAfks.length) continue;

    // === XỬ LÝ HÀNG ĐỢI NGHI THỨC BÁI CỜ ĐỔI TÊN (SEQUENTIAL KNEELING CEREMONY) ===
    const FLAG_CEREMONY_POS = { x: 0, z: 2.0 };
    const KNEEL_DURATION_MS = Number(process.env.TEST_KNEEL_MS) || 10000; // ~10 giây quỳ

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

    // B. Nếu vị trí cờ đang trống và có NPC đang đợi trong hàng đợi
    if (!room.activeCeremony && room.ceremonyQueue.length > 0) {
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
          const dist = Math.hypot(FLAG_CEREMONY_POS.x - bot.x, FLAG_CEREMONY_POS.z - bot.z);
          const walkMs = Math.max(1500, Math.min(6500, Math.round((dist / 2.3) * 1000)));

          bot.inCeremony = true;
          bot.ceremonyStep = 'walking';
          bot.action = 'walk';
          bot.x = FLAG_CEREMONY_POS.x;
          bot.z = FLAG_CEREMONY_POS.z;

          room.activeCeremony = {
            botId: bot.id,
            newName: item.newName,
            state: 'walking',
            arrivalAt: now + walkMs
          };

          broadcast(roomId, {
            type: 'player-updated',
            player: publicPlayer(bot)
          });
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
      const freeBots = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.spotId && !b.reservedSpotId);

      if (freePlayers.length > 0 && freeBots.length > 0) {
        const targetPlayer = freePlayers[Math.floor(Math.random() * freePlayers.length)];
        const promptBot = freeBots[Math.floor(Math.random() * freeBots.length)];

        // Bot đi bộ lại gần người chơi một cách tự nhiên
        const destX = targetPlayer.x + (Math.random() < 0.5 ? 1.0 : -1.0);
        const destZ = targetPlayer.z + 0.3;
        const dist = Math.hypot(destX - promptBot.x, destZ - promptBot.z);
        const walkMs = Math.max(1200, Math.min(4500, Math.round((dist / 2.3) * 1000)));

        promptBot.x = destX;
        promptBot.z = destZ;
        promptBot.action = 'walk';
        promptBot.walkArrivalAt = now + walkMs;
        promptBot.nextActionAt = promptBot.walkArrivalAt + 1500;
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

    // 3. Tự động gửi tin nhắn chat & đối thoại 2 chiều qua lại tự nhiên giữa các NPC (mỗi 16 - 32 giây)
    if (now >= (room.nextAfkChatAt || 0)) {
      room.nextAfkChatAt = now + 16000 + Math.floor(Math.random() * 16000);
      const candidates = activeAfks.filter(b => !b.carryingId && !b.carriedBy);

      if (candidates.length >= 1) {
        // 55% cơ hội kích hoạt đối thoại 2 chiều qua lại giữa 2 NPC
        if (candidates.length >= 2 && Math.random() < 0.55) {
          const idxA = Math.floor(Math.random() * candidates.length);
          const botA = candidates[idxA];
          const remaining = candidates.filter(b => b.id !== botA.id);
          const botB = remaining[Math.floor(Math.random() * remaining.length)];

          const pair = NPC_DIALOG_PAIRS[Math.floor(Math.random() * NPC_DIALOG_PAIRS.length)];

          // Bot A lên tiếng trước (kèm overhead bubble)
          broadcast(roomId, {
            type: 'chat',
            id: botA.id,
            name: botA.name,
            jerseyNumber: botA.jerseyNumber,
            text: pair.from,
            at: now
          });

          // Bot B phản hồi sau 2.2 - 3.8 giây
          const replyDelay = 2200 + Math.floor(Math.random() * 1600);
          setTimeout(() => {
            const currentRoom = rooms.get(roomId);
            if (!currentRoom || currentRoom.players.size === 0) return;
            const currentBotB = currentRoom.afks.get(botB.id);
            if (currentBotB) {
              broadcast(roomId, {
                type: 'chat',
                id: currentBotB.id,
                name: currentBotB.name,
                jerseyNumber: currentBotB.jerseyNumber,
                text: pair.reply,
                at: Date.now()
              });
            }
          }, replyDelay);
        } else {
          // 45% NPC tự nói theo cá tính riêng từ kho 220+ câu meme
          const bot = candidates[Math.floor(Math.random() * candidates.length)];
          let pool = ALL_FOOTBALL_MEMES;
          if (bot.personality === 'meme') pool = ALL_FOOTBALL_MEMES;
          else if (bot.personality === 'troller') pool = RIVAL_MEME_MESSAGES;
          else if (bot.personality === 'fan_ruot') pool = MU_MEME_MESSAGES;
          else if (bot.personality === 'interactor') pool = GENERAL_MEME_MESSAGES;
          else pool = CASUAL_MESSAGES;

          const quote = pool[Math.floor(Math.random() * pool.length)];
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
      const freeBots = activeAfks.filter(b => !b.carryingId && !b.carriedBy && !b.spotId && !b.reservedSpotId);
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

    // 5. NPC Autonomous AI: Di chuyển liên tục, điều hướng đĩa tròn chân thực (không bay/teleport)
    const occupiedSpots = getOccupiedSpotIds(room);

    for (let idx = 0; idx < activeAfks.length; idx++) {
      const bot = activeAfks[idx];

      // Đang trong nghi thức bái cờ đổi tên: giữ nguyên, không can thiệp lệnh di chuyển khác
      if (bot.inCeremony) continue;

      // Đang được cõng bởi người chơi thật: giữ nguyên
      if (bot.carriedBy && room.players.has(bot.carriedBy)) continue;
      if (bot.carryingId && room.players.has(bot.carryingId)) continue;

      // TH1: Bot đang đi bộ đến đĩa tròn đã đặt chỗ (Phase 2 của Spot Arrival)
      if (bot.reservedSpotId && bot.spotArrivalAt) {
        if (now >= bot.spotArrivalAt) {
          // Kiểm tra xem vị trí có bị người chơi thật chiếm trong lúc đi bộ không
          let takenByReal = false;
          for (const p of room.players.values()) {
            if (p.spotId === bot.reservedSpotId) {
              takenByReal = true;
              break;
            }
          }

          if (takenByReal) {
            // Nhường cho người thật, bot đi tiếp sang vị trí sàn trống
            bot.reservedSpotId = null;
            bot.spotArrivalAt = 0;
            bot.x = Math.max(-4, Math.min(4, (Math.random() - 0.5) * 6));
            bot.z = Math.max(-5, Math.min(5, (Math.random() - 0.5) * 8));
            bot.action = 'walk';
            bot.walkArrivalAt = now + 2500;
            bot.nextActionAt = bot.walkArrivalAt;
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          } else {
            // Đã đi bộ đến đĩa tròn thành công trên mặt sàn!
            bot.spotId = bot.reservedSpotId;
            bot.reservedSpotId = null;
            bot.spotArrivalAt = 0;
            // Chỉ sau khi bước đến đĩa tròn mới đổi sang ngồi hoặc hô cổ vũ!
            bot.action = Math.random() < 0.65 ? 'cheer' : 'sit';
            bot.nextActionAt = now + 4000 + Math.floor(Math.random() * 6000); // Ở lại 4 - 10s
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          }
        }
        continue; // Đang trong quá trình đi bộ tới spot, không ngắt quãng
      }

      // TH2: Bot đang đi bộ tự do trên sàn
      if (bot.action === 'walk' && bot.walkArrivalAt) {
        if (now >= bot.walkArrivalAt) {
          // Đã tới đích đi bộ, chuyển sang động tác dừng nghỉ ngắn (1.5 - 3.8s)
          bot.walkArrivalAt = 0;
          const pauseActs = ['idle', 'cheer', 'bow', 'prostrate'];
          bot.action = pauseActs[Math.floor(Math.random() * pauseActs.length)];
          bot.nextActionAt = now + 1500 + Math.floor(Math.random() * 2300);
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        }
        continue;
      }

      // Chưa tới lúc bot đưa ra quyết định hành động tiếp theo
      if (now < (bot.nextActionAt || 0)) continue;

      // Xử lý khi bot đang cõng nhau giữa 2 bot: thỉnh thoảng thả xuống
      if (bot.carryingId || bot.carriedBy) {
        if (Math.random() < 0.5) {
          const otherId = bot.carryingId || bot.carriedBy;
          const other = room.afks.get(otherId);
          bot.carryingId = null;
          bot.carriedBy = null;
          bot.action = 'idle';
          bot.nextActionAt = now + 2000;
          if (other) {
            other.carryingId = null;
            other.carriedBy = null;
            other.action = 'idle';
            other.x = bot.x + 0.8;
            other.z = bot.z;
            other.nextActionAt = now + 2000;
            broadcast(roomId, { type: 'carry-ended', carrierId: bot.id, passengerId: other.id });
            broadcast(roomId, { type: 'player-updated', player: publicPlayer(other) });
          }
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // TH3: Bot đang ở trên đĩa tròn (spotId)
      if (bot.spotId) {
        // 45% khả năng rời đĩa tròn để đi dạo tiếp quanh hang
        if (Math.random() < 0.45) {
          bot.spotId = null;
          const destX = Math.max(-4.5, Math.min(4.5, (Math.random() - 0.5) * 6));
          const destZ = Math.max(-6, Math.min(6, -2 + (Math.random() - 0.5) * 8));
          const dist = Math.hypot(destX - bot.x, destZ - bot.z);
          const walkMs = Math.max(1200, Math.min(4500, Math.round((dist / 2.3) * 1000)));

          bot.x = destX;
          bot.z = destZ;
          bot.action = 'walk';
          bot.walkArrivalAt = now + walkMs;
          bot.nextActionAt = bot.walkArrivalAt;
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        } else {
          // Vẫn ở trên đĩa tròn: đổi tư thế giữa ngồi và hô cổ vũ
          bot.action = bot.action === 'sit' ? 'cheer' : 'sit';
          bot.nextActionAt = now + 3500 + Math.floor(Math.random() * 4500);
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // TH4: Bot tự do trên mặt sàn (không có đĩa tròn)
      const roll = Math.random();

      // 1. 25% cơ hội chọn một đĩa tròn trống và ĐI BỘ ĐẾN ĐÓ (Phase 1 of Spot Arrival)
      if (roll < 0.25) {
        const freeSpots = CAVE_SPOTS.filter(s => !occupiedSpots.has(s.id));
        if (freeSpots.length > 0) {
          const chosen = freeSpots[Math.floor(Math.random() * freeSpots.length)];
          occupiedSpots.add(chosen.id);

          bot.reservedSpotId = chosen.id;
          bot.spotId = null; // CHƯA gán spotId! Để chân bot di chuyển bình thường trên sàn
          bot.action = 'walk'; // Đi bộ trên mặt đất

          const dist = Math.hypot(chosen.x - bot.x, chosen.z - bot.z);
          const walkMs = Math.max(1500, Math.min(6500, Math.round((dist / 2.3) * 1000)));

          bot.x = chosen.x;
          bot.z = chosen.z;
          bot.spotArrivalAt = now + walkMs;
          bot.nextActionAt = now + walkMs;

          // Phát sóng player-updated với action: 'walk' và spotId: null
          broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
          continue;
        }
      }

      // 2. 50% cơ hội di chuyển liên tục, tự nhiên đến các khu vực hoặc tiếp cận nhân vật khác
      if (roll < 0.75) {
        let destX, destZ;

        // 20% khả năng tiếp cận một người chơi thật để tạo không khí giao lưu
        const realPlayers = [...room.players.values()].filter(p => !p.carryingId && !p.carriedBy);
        if (realPlayers.length > 0 && Math.random() < 0.20) {
          const targetP = realPlayers[Math.floor(Math.random() * realPlayers.length)];
          destX = Math.max(-10, Math.min(10, targetP.x + (Math.random() < 0.5 ? 1.2 : -1.2)));
          destZ = Math.max(-8, Math.min(8, targetP.z + 0.3));
        } else if (activeAfks.length > 1 && Math.random() < 0.20) {
          // 20% tiếp cận một NPC khác
          const otherBot = activeAfks.filter(b => b.id !== bot.id)[Math.floor(Math.random() * (activeAfks.length - 1))];
          destX = Math.max(-10, Math.min(10, otherBot.x + (Math.random() < 0.5 ? 1.0 : -1.0)));
          destZ = Math.max(-8, Math.min(8, otherBot.z + 0.3));
        } else {
          // 60% di chuyển vào một trong 6 khu vực đặc trưng của hang
          const zones = [
            { minX: -2.2, maxX: 2.2, minZ: -3.5, maxZ: 6.0 },   // Thảm đỏ trung tâm
            { minX: -3.5, maxX: 3.5, minZ: -9.5, maxZ: -7.5 },  // Bàn chiến thuật
            { minX: -2.5, maxX: 2.5, minZ: -15.0, maxZ: -12.5 },// Đốm lửa thiêng & bàn thờ
            { minX: -5.5, maxX: -3.8, minZ: -7.0, maxZ: 3.0 },  // Hành lang cánh trái
            { minX: 3.8, maxX: 5.5, minZ: -7.0, maxZ: 3.0 },   // Hành lang cánh phải
            { minX: -2.2, maxX: 2.2, minZ: 7.0, maxZ: 9.5 }     // Lối vào hang
          ];
          const z = zones[Math.floor(Math.random() * zones.length)];
          destX = z.minX + Math.random() * (z.maxX - z.minX);
          destZ = z.minZ + Math.random() * (z.maxZ - z.minZ);
          // Tránh vị trí cờ khi đang có NPC làm nghi thức bái cờ đổi tên
          if (room.activeCeremony && Math.hypot(destX - FLAG_CEREMONY_POS.x, destZ - FLAG_CEREMONY_POS.z) < 1.5) {
            destZ += 2.0;
          }
        }

        const dist = Math.hypot(destX - bot.x, destZ - bot.z);
        const walkMs = Math.max(1200, Math.min(5000, Math.round((dist / 2.3) * 1000)));

        bot.x = destX;
        bot.z = destZ;
        bot.action = 'walk';
        bot.walkArrivalAt = now + walkMs;
        bot.nextActionAt = bot.walkArrivalAt;
        broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        continue;
      }

      // 3. 15% thực hiện cổ vũ hoặc quỳ bái cờ trong khoảng ngắn (1.8 - 3.8s)
      if (roll < 0.90) {
        bot.action = Math.random() < 0.6 ? 'cheer' : 'prostrate';
        bot.nextActionAt = now + 1800 + Math.floor(Math.random() * 2000);
        broadcast(roomId, { type: 'player-updated', player: publicPlayer(bot) });
        continue;
      }

      // 4. 10% cúi chào hoặc tĩnh tâm ngắn (1.5 - 3.0s)
      bot.action = Math.random() < 0.5 ? 'bow' : 'idle';
      bot.nextActionAt = now + 1500 + Math.floor(Math.random() * 1500);
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
