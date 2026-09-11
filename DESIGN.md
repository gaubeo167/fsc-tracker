---
version: 1
name: fsc-design-system
description: Chuẩn giao diện của FSC Tracker, lấy từ fsc-cots ở mọi thứ trừ màu hành động. Token màu dạng biến, nền xám rất nhạt, thẻ trắng bo 16, khung 1440, Inter làm mặt chữ. Màu hành động là XANH DƯƠNG chứ không phải cam, để nhìn là biết ngay đang ở hệ thống nào.
adopted_from: fsc-cots (README §6 Design System, §7 Chuẩn UX)
adopted_on: 2026-09-11
---

# Chuẩn giao diện FSC Tracker

Hệ thống này lấy chuẩn đang chạy ở `fsc-cots` làm gốc: nền, bo góc, đổ bóng,
mặt chữ, thang chữ, bề rộng khung đều theo cots từng con số. Nguồn của mọi con
số dưới đây là `fsc-cots/src/app/globals.css`, `tailwind.config.ts` và
`components/layout/app-shell.tsx`.

**Một thứ cố ý khác:** màu hành động. cots dùng FPT Orange, tracker dùng xanh
dương — để nhìn là biết ngay đang ở hệ thống nào. Xem §4.

Nơi các con số đó sống trong repo này: **`src/index.css`**. Đó là file duy nhất
cần sửa khi chuẩn đổi.

## 1. Cách tầng token hoạt động ở đây

fsc-cots dùng shadcn/ui: component nhận màu qua biến semantic (`bg-primary`,
`text-muted-foreground`). Tracker thì không — 6.4 nghìn dòng TSX gọi thẳng thang
Tailwind (`bg-indigo-600`, `text-slate-500`).

Nên tầng token ở đây **định nghĩa lại chính những thang đó**. Đổi một file là
mọi màn đổi cùng lúc, không màn nào bị bỏ sót và không dòng JSX nào phải sửa.

| Thang Tailwind | Ý nghĩa thật sau khi đè |
|---|---|
| `indigo-*` | Màu hành động — xanh dương `#0066CC` |
| `slate-*` | Trung tính: nền, viền, chữ |
| `red-*` | destructive |
| `amber-*` | warning |
| `emerald-*` | success |
| `sky-*` | info |
| `violet-*` | đề xuất tính năng (riêng của tracker) |

## 2. Token

| Token | Giá trị |
|---|---|
| Màu hành động | Xanh dương `#0066CC`, thang 10 bậc 50→900 — **điểm lệch cố ý**, xem §4 |
| Nền trang | `#F8F9FB` |
| Thẻ | `#FFFFFF` |
| Viền | `#E5E7EB` (gray-200) |
| Chữ chính | `#141A29` |
| Chữ phụ | `#6B7280` |
| Bo góc | 16 thẻ · 12 control · 8 chip |
| Đổ bóng | 5 bậc rất nhẹ, tính trên `#101828` |
| Khoảng cách | lưới 8pt |
| Mặt chữ | Inter, subset tiếng Việt, nạp `display=swap` |
| Thang chữ | 8 bậc: 28 / 22 / 16 / 15 / 14 / 13 / 12 / 11 |
| Trạng thái | destructive `#DC2828` · warning `#F59F0A` · success `#249460` · info `#3182ED` |
| Khung nội dung | rộng tối đa 1440px, đệm 16 / 24 (`KHUNG_NOI_DUNG` trong App.tsx) |

## 3. Chuẩn UX

Lấy từ `fsc-cots` README §7. Cột cuối là tình trạng thật ở tracker, cập nhật
2026-09-11 — không phải mục tiêu, mà là kết quả rà soát.

| Hạng mục | Yêu cầu | Tracker |
|---|---|---|
| Trạng thái | Loading · Skeleton · Empty · Error · Success · Confirmation · Toast | Có đủ ở module Hỗ trợ (`StateBlock`); module Công việc thiếu Skeleton |
| Xoá dữ liệu | Hộp thoại xác nhận; thao tác nguy hiểm phải gõ đúng mã | Có xác nhận; **có gõ mã** cho xoá dự án |
| Accessibility | Contrast ≥ 4.5:1 · focus ring 2px · `aria-label` cho nút icon · `prefers-reduced-motion` | Focus ring, reduced-motion và contrast màu hành động: đạt. Còn thiếu `aria-label` ở một số nút icon |
| Bàn phím | `⌘K` command palette | **Chưa có** |
| Bảng dữ liệu | Sticky header · aria-sort · ẩn/hiện cột · phân trang · thao tác hàng loạt · xuất CSV | **Chưa có** |
| Form | Label hiện · validate khi submit · lỗi ngay dưới trường · auto-focus lỗi đầu · auto-save nháp | Một phần: có label và toast lỗi, chưa có lỗi theo từng trường |
| Responsive | 375 / 768 / 1024 / 1440 · sidebar → drawer · bottom nav mobile | Có sidebar thu gọn và bottom nav; chưa rà đủ bốn mốc |
| Webapp | App shell cao cố định · cuộn nội bộ · `overscroll-none` · PWA standalone | Một phần |
| Dark mode | Bảng màu thứ hai trên `.dark` | **Chưa có** — xem §4 |

## 4. Những điểm lệch, và vì sao

**Màu hành động là XANH DƯƠNG, không phải cam.** Đây là điểm lệch lớn nhất và
là điểm cố ý: chủ dự án chốt giữ xanh để phân biệt hai hệ thống. Mọi thứ còn lại
— nền, bo góc, đổ bóng, mặt chữ, thang chữ, bề rộng khung — vẫn theo cots từng
con số.

Tiện thể nó gỡ luôn một mâu thuẫn: FPT Orange `#F26F21` với chữ trắng chỉ đạt
2.97:1, dưới ngưỡng 4.5 của WCAG AA mà chính chuẩn này đòi. `#0066CC` đạt
5.57:1. Nếu sau này quay lại màu cam, phải chấp nhận điểm lệch đó hoặc dùng bậc
tối hơn `#BC3D08` (5.51:1).

Ba bậc màu DÙNG LÀM CHỮ đã được đẩy tối hơn thang gốc để đạt AA, vì chúng không
được dùng làm nền ở đâu cả nên không mất gì: `amber-600` → `#B45309` (5.02:1),
`emerald-600` → `#1B7049` (6.07:1).

**Chưa có dark mode.** Không bật được chỉ bằng token: JSX rải `bg-white`,
`text-slate-900` dưới dạng class chết, nên chế độ tối phải rà từng màn. Bật nửa
vời ra một giao diện lỗ chỗ trắng đen.

**`text-xl` và `text-2xl` cùng 22px.** Thang chữ của cots có 8 bậc và không có
bậc nào giữa 16 với 22. Thà hai lớp trùng nhau còn hơn nhét một giá trị ngoài
thang vào giữa.

**Giữ tím cho "đề xuất tính năng".** cots không có sắc này. Ở tracker nó là thứ
duy nhất phân biệt phiếu đề xuất với phiếu báo lỗi trong danh sách.

## 5. Lịch sử

Trước 2026-09-11 tracker chạy một hệ riêng phỏng theo apple.com (Action Blue
`#0066cc`, SF Pro, bo góc 18). Bản phân tích đầy đủ của hệ đó nằm trong lịch sử
git của chính file này. Đổi sang chuẩn cots theo yêu cầu của chủ dự án, giữ lại
màu xanh để hai hệ thống vẫn phân biệt được.

Bản đầu của lần đổi này lấy luôn FPT Orange của cots và bó khung ở 1280px. Cả
hai đều đã sửa trong ngày: màu quay về xanh, khung nới lên 1440px theo đúng
app-shell của cots.
