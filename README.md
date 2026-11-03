# Hang MU Online

## Chạy local
- Cài Node.js LTS.
- Mở Terminal tại thư mục dự án.
- Chạy `npm install`, sau đó `npm start`.
- Mở http://localhost:3000.

## Quy tắc phòng trong bản này
- Tối đa 4 phòng, mỗi phòng tối đa 50 người (tổng giới hạn ứng dụng 200 kết nối).
- Số áo 00–999 phải duy nhất trên toàn bộ người đang online.
- Người chơi phải đồng ý nghi thức nhập hang; nhân vật tự đi đến thảm và quỳ trong 5 giây.
- Chat cùng phòng real-time, máy chủ giới hạn một tin nhắn mỗi 5 giây và tối đa 180 ký tự.
- Sau 120 giây không có thao tác/di chuyển/chat, máy chủ hỏi người chơi còn ở đó không; nếu không phản hồi trong 60 giây tiếp theo thì tự rời phòng. Đứng yên vẫn bị tính là không hoạt động.

## Lưu ý triển khai
Đây là giới hạn bảo thủ ở tầng ứng dụng, không phải cam kết chịu tải của mọi máy chủ. Trước khi mở công khai, cần thử tải với cấu hình hosting thực tế, thêm HTTPS/WSS, logging, chống spam/nội dung chat xấu và giám sát bộ nhớ/CPU. Mô hình hiện tại lưu trạng thái trong RAM; chạy nhiều instance cần Redis hoặc một dịch vụ đồng bộ trạng thái chung.

## v12 changes in progress
- Vietnamese IME-safe name entry: no destructive normalization while composition is active; NFC cleanup only on blur/submit.
- Server-authoritative inactivity: 120 seconds idle then 60-second confirmation grace; heartbeat packets do not count as user activity.
- Fan titles: Fan nửa mùa on entry, Fan MU after 90 seconds, Fan nghị lực after a randomized 15–20 minutes.
- Original Hang MU banner emblem; generic cave-community wording instead of club crest/official wordmark.
- Cave architecture uses a vaulted cavern shell, irregular rock clusters and stalactites rather than box walls and industrial pillars.
- Mood presets: normal, gloomy, crisis, despair; no match-result integration.

## v12 implementation notes
- Vietnamese IME-safe name entry: no destructive normalization while composition is active; NFC cleanup only on blur/submit.
- Server-authoritative inactivity: 120 seconds without user activity, then a 60-second confirmation grace. Heartbeats are not counted as user activity; standing still does not exempt a player.
- Fan titles: Fan nửa mùa on entry, Fan MU after 90 seconds, Fan nghị lực after a randomized 15–20 minutes.
- Original Hang MU banner emblem; in-world ritual banner uses a cave/flame mark and generic cave-community wording.
- Cave architecture now has a vaulted cavern shell, irregular rock clusters and stalactites instead of box walls and industrial pillars.
- Mood presets: normal, gloomy, crisis, despair; there is no match-result integration.

## Known limitations before public launch
- This is still a prototype. The 4 x 50 room target has not been load-tested.
- Admin-only authorization for changing cave mood/announcements, persistent memorial wall, secret-room unlock, awards, group ritual and scheduled random events remain to be completed before calling the full v12 scope finished.
- State is in RAM; multi-instance hosting requires shared persistence/state (for example Redis/PostgreSQL).
- Add HTTPS/WSS, logging, abuse controls and real-device browser testing before public launch.

## Logo note (v11)
The previous text-only shield marks have been replaced with an original cave-arch-and-flame symbol designed for this fan community. It does not reproduce the Manchester United crest, club shield layout, ship, devil mascot, or official wordmark. The in-world banner now uses the same original visual language. The community name “Hang MU” remains plain text as the project name.

## Tùy chỉnh ảnh biểu trưng treo phía trước
- Đặt ảnh của bạn tên chính xác là `1.jpg` vào thư mục `public/` (cùng cấp với `index.html`).
- Tải lại trang; ảnh sẽ tự thay biểu trưng mặc định trên banner treo ở cuối hang. Nên dùng ảnh ngang tỷ lệ khoảng 5:3.
- Nếu chưa có `public/1.jpg`, ứng dụng tự hiển thị biểu trưng Hang MU mặc định.

## Bảng chiến thuật mini
- Bảng sân bóng thu nhỏ được đặt trước thảm nghi lễ, có hai đội 11 cầu thủ (áo đỏ và áo xanh), trọng tài áo vàng ở giữa, còi nhỏ và bóng.


### Bàn chiến thuật trưng bày (v16)
Bàn sân bóng mini dạng bục một trụ được đặt giữa banner treo tường và thảm nghi lễ (tâm z=-10.5). Hai đội bố trí đối xứng theo sơ đồ 4-4-2, lấy cảm hứng đội hình MU mùa ăn ba 1998/99; đội đối thủ dùng sơ đồ 4-4-2 đối xứng. Bàn được thu nhỏ để không chắn lối đi.


## Tương tác cõng người chơi (v0.4)
- Bấm trực tiếp vào nhân vật khác để mở menu **Mời cõng**.
- Người được mời có thể đồng ý hoặc từ chối; lời mời hết hạn sau 15 giây.
- Server xác thực hai người cùng phòng, khoảng cách tối đa 3,5 đơn vị và mỗi người chỉ tham gia một cặp cõng.
- Khi bắt đầu, server chỉ phát sự kiện trạng thái; vị trí người được cõng được dựng cục bộ theo nhân vật đang cõng, không truyền tọa độ riêng từng khung hình.
- Cả hai có thể nhấn **Thả xuống**; nếu một người rời phòng, trạng thái cõng tự kết thúc.
