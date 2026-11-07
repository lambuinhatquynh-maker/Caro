# Caro Online

Caro 15x15 cho 2 người, chơi qua link. React + TypeScript + Tailwind, Supabase (Postgres + Realtime), Vercel.

- Luật chơi, lượt đi, người thắng được kiểm tra **ở server** (hàm SQL `make_move`) – client không ghi trực tiếp vào bảng được.
- Trạng thái ván đấu lưu trong Postgres → tải lại trang vẫn giữ nguyên; mỗi trình duyệt có id ẩn danh cố định để vào lại đúng chỗ.
- Không có máy chủ nào chạy trên máy bạn: sau khi triển khai, tắt máy tính vẫn chơi bình thường.

## Triển khai (khoảng 15 phút, miễn phí)

### Bước 1 – Supabase
1. Vào https://supabase.com → **New project** (chọn region gần Việt Nam, ví dụ Singapore). Đặt mật khẩu database và lưu lại.
2. **SQL Editor** → New query → dán toàn bộ `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers** → bật **Allow anonymous sign-ins** → Save.
4. **Project Settings → API**: copy **Project URL** và khóa **anon public**.
   (Không dùng và không đưa `service_role` key vào dự án.)

### Bước 2 – Đưa mã lên GitHub
```bash
git init && git add . && git commit -m "caro online"
# tạo repo trống trên github.com rồi:
git remote add origin https://github.com/<ban>/caro-online.git
git push -u origin main
```

### Bước 3 – Vercel
1. https://vercel.com → **Add New → Project** → import repo vừa tạo (Framework tự nhận Vite).
2. **Environment Variables**:
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = khóa anon public
3. **Deploy**. Link dạng `https://caro-online-xxxx.vercel.app` là link công khai để chia sẻ.

> Khóa `anon` được thiết kế để công khai trong trình duyệt; an toàn nhờ RLS và các hàm SQL ở trên.

## Kiểm tra sau khi triển khai
1. Mở link ở trình duyệt thường → nhập tên → **Tạo phòng mới**.
2. Mở link mời (nút **Mời bạn**) trên điện thoại (dùng 4G) hoặc cửa sổ ẩn danh → nhập tên.
3. Hai bên đánh luân phiên: nước đi phải hiện bên kia gần như tức thì; thử tải lại trang giữa ván; thử đánh khi chưa tới lượt (ô bị khóa).
4. Có 5 quân liền nhau → báo thắng; bấm **Chơi lại** (đổi bên X/O).

## Chạy thử trên máy (chỉ để phát triển)
```bash
cp .env.example .env   # điền URL + anon key
npm install
npm run dev
```

## Lưu ý gói miễn phí
- Supabase Free **tự tạm dừng project sau ~1 tuần không có hoạt động**. Khi bị tạm dừng, vào dashboard bấm Restore (hoặc thỉnh thoảng chơi một ván) để giữ hoạt động.
- Phòng không hoạt động quá 2 ngày sẽ được dọn tự động mỗi khi có người tạo phòng mới.
- Nếu muốn chống lạm dụng: bật CAPTCHA/giới hạn tốc độ trong Authentication → Rate Limits.
