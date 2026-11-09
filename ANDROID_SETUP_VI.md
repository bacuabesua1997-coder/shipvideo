# ShipVideo trên Android – Hướng dẫn triển khai

Repository: https://github.com/bacuabesua1997-coder/shipvideo

Bản fork này được bổ sung quy trình GitHub Actions để tạo video từ điện thoại Android. Điện thoại chỉ cần trình duyệt hoặc ứng dụng GitHub; quá trình chạy AI, Chromium và FFmpeg diễn ra trên cloud.

## 1. Cần chuẩn bị

- Tài khoản OpenComputer.
- OpenComputer organization API key.
- Quyền truy cập model được khai báo trong agent: `anthropic/claude-opus-5.5`.
- GitHub Actions được bật trong repository.

**Chi phí:** Không nên coi đây là công cụ miễn phí không giới hạn. OpenComputer tính usage theo gói/tín dụng và mức sử dụng model, thời gian máy cloud. Workflow chỉ chạy khi bạn chủ động bấm Run workflow; không tự động tạo video khi push code.

Tài liệu OpenComputer: https://opencomputer.dev/developers/ và https://www.npmjs.com/package/@opencomputer/cli

## 2. Thêm API key vào GitHub (chỉ làm một lần)

Trên Android:

1. Mở repository và vào **Settings**.
2. Chọn **Secrets and variables → Actions**.
3. Chọn **New repository secret**.
4. Name: `OPENCOMPUTER_API_KEY`.
5. Secret: dán organization API key lấy từ tài khoản OpenComputer.
6. Chọn **Add secret**.

Không dán API key vào workflow input, file code, README hoặc issue. Không chia sẻ key trong ảnh chụp màn hình.

Tùy chọn: trong **Settings → Secrets and variables → Actions → Variables**, tạo:
- `OC_AGENT_ID`: mặc định `shipvideo@development`; chỉ đổi nếu agent có ID khác.
- `OPENCOMPUTER_API_URL`: mặc định `https://app.opencomputer.dev`; thường không cần tạo.

## 3. Deploy AI Agent

1. Mở tab **Actions** trong repository.
2. Chọn workflow **ShipVideo - Deploy AI Agent**.
3. Chọn **Run workflow**.
4. Project `shipvideo` đã được tạo ở lần chạy đầu trước đó, vì vậy để `create_project` là `false`.
5. Để `project_slug` là `shipvideo`.
6. Bấm **Run workflow** và chờ hoàn tất.

Workflow tạo/liên kết project OpenComputer, chạy chẩn đoán và deploy agent với alias production. Agent ID mặc định dùng ở bước tạo video là `shipvideo@production`.

Những lần cập nhật agent sau đó: chạy lại workflow, tắt `create_project`, giữ project slug `shipvideo`.

Nếu project đã được tạo sẵn trên OpenComputer, luôn tắt `create_project` và nhập đúng project slug hiện có. Chỉ bật khi thực sự chưa có project.

## 4. Tạo video ngay trên Android

1. Vào **Actions**.
2. Chọn **ShipVideo - Create MP4 (Android)**.
3. Bấm **Run workflow**.
4. Chọn mode:
   - `prompt`: tạo video từ mô tả.
   - `url`: phân tích website và tạo video giới thiệu.
5. Nhập nội dung vào ô `input` (tối đa 2.000 ký tự).
6. Bấm **Run workflow**.

Agent sẽ viết phim HTML, kiểm tra cảnh, render từng frame bằng Chromium và mã hóa MP4 bằng FFmpeg. Thời lượng mục tiêu của agent là 20–40 giây; tốc độ render và thời gian hoàn tất phụ thuộc nội dung, model và runtime.

## 5. Tải video

Sau khi workflow báo thành công:

1. Mở lần chạy vừa hoàn thành trong **Actions**.
2. Kéo xuống mục **Artifacts**.
3. Tải file `shipvideo-<run-number>`.
4. Giải nén ZIP trên Android.
5. Mở `video.mp4`.

Artifact được giữ 14 ngày. Hãy tải về thiết bị trước khi hết hạn.

## 6. Kiểm tra và xử lý lỗi

- **Missing OPENCOMPUTER_API_KEY:** kiểm tra lại repository secret ở bước 2.
- **Agent not found / deployment not found:** chạy lại workflow deploy; kiểm tra `OC_AGENT_ID` và project slug.
- **Model unavailable:** tài khoản OpenComputer chưa có quyền hoặc chưa cấu hình quyền sử dụng model được agent yêu cầu.
- **Runtime timeout / render failed:** mở OpenComputer dashboard, kiểm tra session/logs; lần chạy đầu có thể mất thêm thời gian để cài Chromium, thư viện hệ thống và FFmpeg.
- **Artifact không xuất hiện:** workflow phải kết thúc thành công và bước upload artifact phải hoàn tất.

## 7. Lưu ý trước khi triển khai website công khai

Frontend Next.js trong repo là giao diện riêng, deploy độc lập trên Vercel. Hai workflow Android ở trên không cần Vercel.

Không nên mở frontend công khai cho người lạ dùng ngay: giới hạn lượt hiện tại trong code là bộ đếm mềm theo tiến trình, chưa phải hạn mức bền vững giữa nhiều serverless instance. Trước khi public cần bổ sung rate limiting dùng storage bền vững, chống lạm dụng và quy tắc Vercel Firewall.

## 8. License

Repository gốc hiện không có file `LICENSE`. GitHub cho phép fork, nhưng việc sử dụng, phân phối lại hoặc khai thác thương mại mã nguồn có thể cần sự cho phép của chủ sở hữu bản quyền. Hãy xác minh quyền sử dụng trước khi public hoặc thương mại hóa sản phẩm.
