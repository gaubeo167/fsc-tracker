// ===========================================================================
// Nhận ra trình duyệt NẰM TRONG một ứng dụng khác (Zalo, Facebook, Messenger…).
//
// Vì sao cần: link hệ thống được gửi cho campus qua Zalo, và người ta bấm thẳng
// vào đó. Zalo mở link bằng webview riêng của nó, nơi `sessionStorage` bị phân
// vùng giữa origin app và authDomain của Firebase. Hậu quả là đăng nhập Google
// KHÔNG BAO GIỜ xong, kết thúc bằng một trang trắng của Firebase:
//
//   "Unable to process request due to missing initial state. This may happen if
//    browser sessionStorage is inaccessible or accidentally cleared."
//
// Đã thử thật trên máy 21/08/2026: cả signInWithPopup lẫn signInWithRedirect
// đều hỏng, nên phương án dự phòng thông thường (đổi sang redirect) vô dụng.
// Cách duy nhất chắc chắn chạy là NÓI CHO NGƯỜI DÙNG mở bằng trình duyệt thật.
//
// Trang lỗi kia là trang của Firebase, ta không sửa được chữ nào trên đó. Nên
// phải chặn TRƯỚC: nhận ra webview ngay ở màn đăng nhập và hướng dẫn tại chỗ.
// ===========================================================================

export interface WebviewInfo {
  laWebview: boolean;
  /** Tên ứng dụng để gọi đúng tên trong hướng dẫn. Rỗng nếu không đoán được. */
  ten: string;
  laIOS: boolean;
}

/** Ứng dụng nhận ra được qua dấu hiệu riêng trong chuỗi User-Agent. */
const NHAN_DIEN: Array<{ mau: RegExp; ten: string }> = [
  { mau: /\bZalo\b/i, ten: 'Zalo' },
  { mau: /FBAN|FBAV|FB_IAB|FBIOS/i, ten: 'Facebook' },
  { mau: /Messenger/i, ten: 'Messenger' },
  { mau: /Instagram/i, ten: 'Instagram' },
  { mau: /MicroMessenger/i, ten: 'WeChat' },
  { mau: /BytedanceWebview|musical_ly|TikTok/i, ten: 'TikTok' },
  { mau: /\bLine\//i, ten: 'LINE' },
];

export function nhanDienWebview(ua: string): WebviewInfo {
  const laIOS = /iPhone|iPad|iPod/i.test(ua);

  for (const { mau, ten } of NHAN_DIEN) {
    if (mau.test(ua)) return { laWebview: true, ten, laIOS };
  }

  // Webview Android không khai tên ứng dụng, nhưng luôn có cờ "; wv" trong UA.
  if (/;\s*wv\)/i.test(ua)) return { laWebview: true, ten: '', laIOS: false };

  // Webview iOS (WKWebView) thiếu hẳn chuỗi "Safari" ở cuối UA — đó là dấu hiệu
  // duy nhất phân biệt nó với Safari thật. Chrome và Firefox trên iOS vẫn giữ
  // chuỗi đó, nên chúng KHÔNG bị nhận nhầm.
  if (laIOS && /AppleWebKit/i.test(ua) && !/Safari/i.test(ua)) {
    return { laWebview: true, ten: '', laIOS: true };
  }

  return { laWebview: false, ten: '', laIOS };
}
