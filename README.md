# MoneyNote

PWA quản lý thu chi cá nhân, chạy trên Android và trình duyệt Windows.

## Chạy ứng dụng

Ứng dụng không cần cài thư viện hoặc bước build. Chạy một HTTP server trong thư mục dự án, ví dụ:

```powershell
node scripts/serve.mjs
```

Mở `http://localhost:8000`. Trên Android, truy cập qua một địa chỉ HTTPS đã triển khai để cài PWA. Service worker hỗ trợ mở ứng dụng khi mất mạng sau lần tải đầu tiên.

## Đưa lên GitHub Pages

1. Trên GitHub, tạo repository **MoneyNote** ở chế độ **Public**. Để repository trống, không tạo sẵn README hay `.gitignore`.
2. Kiểm tra email sẽ gắn với commit bằng `git config user.email`. Nếu muốn giữ riêng tư, đặt email `noreply` do GitHub cung cấp bằng `git config user.email "EMAIL_NOREPLY_CUA_BAN"` trước khi commit.
3. Trong thư mục dự án, chạy các lệnh sau (thay `USERNAME` bằng tên tài khoản GitHub):

   ```powershell
   git add .
   git commit -m "Initial MoneyNote PWA"
   git remote add origin https://github.com/USERNAME/MoneyNote.git
   git push -u origin main
   ```

4. Trên GitHub, mở **Settings → Pages**. Ở **Build and deployment**, chọn **Deploy from a branch**, nhánh **main**, thư mục **/(root)** rồi lưu.
5. Mở `https://USERNAME.github.io/MoneyNote/` trên Windows và Android. Trong Chrome hoặc Edge, dùng tùy chọn **Cài đặt ứng dụng** để có biểu tượng riêng.

Mã nguồn và trang GitHub Pages có thể được mọi người truy cập. Dữ liệu chi tiêu vẫn lưu trong trình duyệt của từng thiết bị, không tự đưa lên repository và không tự đồng bộ. Trước khi chuyển từ `localhost`, hãy sao lưu JSON ở địa chỉ cũ rồi khôi phục JSON ở địa chỉ GitHub Pages. Không commit tệp JSON sao lưu lên GitHub.

## Tính năng

- Thêm, sửa, xóa khoản thu và chi; danh mục tùy chỉnh.
- Tổng quan theo tháng, biểu đồ dòng tiền 6 tháng và tỷ trọng chi tiêu.
- Ngân sách chung và ngân sách từng danh mục theo tháng.
- Tìm kiếm, lọc giao dịch và xuất CSV.
- Sao lưu và khôi phục đầy đủ giao dịch, danh mục, ngân sách bằng tệp JSON.

## Lưu trữ

Dữ liệu hiện lưu trong `localStorage` của trình duyệt trên từng thiết bị. Chưa có tài khoản hoặc đồng bộ tự động giữa Android và Windows.

Để chuyển dữ liệu sang thiết bị khác hoặc từ `localhost` sang địa chỉ GitHub Pages: mở trang **Giao dịch**, chọn **Sao lưu JSON**, chuyển tệp sang thiết bị mới, rồi chọn **Khôi phục JSON** tại địa chỉ mới. Xem số liệu trong hộp xác nhận trước khi khôi phục. Việc khôi phục sẽ thay thế toàn bộ dữ liệu đang lưu tại địa chỉ và thiết bị đó. CSV chỉ xuất giao dịch để xem trong bảng tính; CSV không chứa ngân sách và không dùng để khôi phục.

Tệp JSON chứa toàn bộ số liệu tài chính của bạn. Hãy giữ tệp riêng tư và đừng đưa nó lên repository GitHub công khai.
