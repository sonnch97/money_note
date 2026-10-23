# MoneyNote

PWA quản lý thu chi chạy trên Android và trình duyệt Windows. Trang tĩnh có thể host bằng GitHub Pages. Ứng dụng lưu dữ liệu trên thiết bị để dùng ngoại tuyến; có thể bật Supabase để đồng bộ giữa các thiết bị.

## Tính năng

- Ghi khoản thu và chi, xem biểu đồ, đặt ngân sách tháng và theo danh mục. Thẻ **Chênh lệch thu chi tháng** bằng thu nhập trừ chi tiêu trong tháng đang chọn; đây không phải số dư tài khoản tích lũy.
- Tìm giao dịch trong mọi tháng, riêng tháng đã chọn hoặc một khoảng ngày; xuất CSV theo bộ lọc hiện tại.
- Bấm ☆ ở một giao dịch để lưu thành **mẫu nhanh**. Bấm mẫu để mở giao dịch mới với số tiền, danh mục và ghi chú đã điền sẵn; kiểm tra rồi lưu.
- App hiển thị cảnh báo khi chi tiêu đạt từ 80% ngân sách, và cảnh báo mạnh hơn khi đạt hoặc vượt 100%.
- Tạo **khoản định kỳ** theo ngày trong tháng. Khi đến hạn, app cho xem bản nháp và yêu cầu xác nhận trước khi ghi vào sổ; có thể bỏ qua tháng đó. Ngày 29–31 được lùi về cuối tháng nếu cần. Không có giao dịch nào tự động được ghi.
- Sao lưu JSON gồm cả mẫu nhanh và khoản định kỳ. Bản sao lưu định dạng cũ vẫn khôi phục được.

## Chạy và kiểm tra

```powershell
node scripts/serve.mjs
```

Mở `http://localhost:8000`. Chạy `npm test` để kiểm tra logic. Thư mục `vendor/` đã chứa bản Supabase JS dùng trực tiếp trên GitHub Pages; chỉ cần `npm ci` và `npm run build:vendor` khi muốn tạo lại bản này. GitHub Pages không cần chạy npm hoặc bước build.

## Bật đồng bộ Supabase

1. Tạo dự án tại [Supabase](https://supabase.com/dashboard). Giữ riêng mật khẩu quản trị dự án.
2. Mở **SQL Editor**, dán toàn bộ nội dung [schema.sql](supabase/schema.sql) rồi chạy. Nếu đã dùng bản MoneyNote cũ, **chạy lại tệp SQL này trước khi đăng bản app mới**. Tệp nâng cấp bảng tại chỗ, giữ dữ liệu cũ và thêm phiên bản ghi để phát hiện xung đột. Bảng `moneynote_records` dùng Row Level Security: tài khoản chỉ đọc và ghi hàng mang `user_id` của chính mình.
3. Trong **Project Settings → API Keys**, lấy **Project URL** và **publishable key** (hoặc `anon` key cũ). Điền hai chuỗi này vào [sync-config.js](sync-config.js). **Không điền secret/service_role key** và không commit bất kỳ mật khẩu nào.
4. Trong **Authentication → URL Configuration**, đặt **Site URL** và thêm địa chỉ GitHub Pages của ứng dụng vào **Redirect URLs**, ví dụ `https://USERNAME.github.io/REPO/`. Nếu thử ở máy cá nhân, thêm cả `http://localhost:8000/` (hoặc đúng địa chỉ bạn mở). Bật Email provider / magic link trong **Authentication → Providers** nếu chưa bật.
5. Commit và push mã đã cấu hình lên GitHub. Trên từng thiết bị, mở app, nhấn biểu tượng đám mây, nhập **cùng một email** rồi mở liên kết đăng nhập trong thư. Lần đầu kết nối, app cho chọn dùng dữ liệu đám mây hoặc gộp những mục chỉ có trên thiết bị. Có thể tải bản sao lưu JSON trước khi chọn.

Khi đã đăng nhập, mỗi giao dịch, danh mục, ngân sách, mẫu nhanh và khoản định kỳ được lưu thành một hàng riêng. Thao tác được xếp hàng trên thiết bị rồi gửi lên từng hàng; xóa dùng dấu `deleted` để các thiết bị khác không tự làm mục đó xuất hiện lại. App đọc lại dữ liệu khi mở, trở lại tab, kết nối lại hoặc nhận thông báo Realtime. Nếu hai thiết bị sửa cùng một mục trước khi nhận thay đổi của nhau, app giữ bản trên thiết bị đang chờ, dừng gửi mục đó và hỏi bạn giữ bản nào. Các mục khác tiếp tục đồng bộ. Chọn **Giữ bản trên thiết bị** sẽ ghi đè bản đám mây mới nhất của đúng mục đó; chọn **Giữ bản đám mây** sẽ bỏ thay đổi đang chờ trên thiết bị. Khi chưa chọn, nhấn trạng thái đồng bộ để mở lại hộp thoại.

Nếu chưa cấu hình hoặc chưa đăng nhập, dữ liệu vẫn nằm trong trình duyệt và không tự đồng bộ. Nếu một thao tác đang chờ gửi, trạng thái đồng bộ cho biết số thay đổi đang chờ. Đừng xóa dữ liệu trang web trên thiết bị đang có thao tác chưa gửi.

## Đưa lên GitHub Pages

Trong GitHub repository, mở **Settings → Pages**, chọn **Deploy from a branch**, nhánh `main`, thư mục `/(root)`. Mở `https://USERNAME.github.io/REPO/` trên Windows và Android rồi dùng lệnh **Cài đặt ứng dụng** của Chrome hoặc Edge nếu muốn có biểu tượng riêng.

Mã nguồn trên GitHub Pages công khai, gồm Project URL và publishable key. Dữ liệu tài chính nằm trong Supabase, chỉ truy cập được sau đăng nhập nhờ chính sách Row Level Security ở tệp SQL. Không đưa tệp JSON sao lưu hoặc secret key lên GitHub.

## Sao lưu và chuyển dữ liệu cũ

**Sao lưu JSON** chứa đầy đủ giao dịch, danh mục, ngân sách, mẫu nhanh và khoản định kỳ. **Khôi phục JSON** thay thế dữ liệu hiện có trên thiết bị; khi đã bật đồng bộ, các thay đổi sau khôi phục sẽ được gửi lên Supabase theo từng hàng. Hãy tải bản sao lưu hiện tại trước khi khôi phục. CSV chỉ chứa giao dịch để xem trong bảng tính.

Dữ liệu ở `localhost` và GitHub Pages thuộc hai địa chỉ trình duyệt khác nhau. Nếu dữ liệu cũ còn ở `localhost`, hãy xuất JSON tại đó và khôi phục tại địa chỉ GitHub Pages trước khi bật đồng bộ. Giữ tệp JSON riêng tư.
