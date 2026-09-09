import { describe, expect, it } from 'vitest';
import { laUngDungManHinhChinh, nhanDienWebview } from '../inAppBrowser';

// User-Agent thật, chép từ máy thật. Đoán mò chuỗi UA là cách chắc chắn nhất để
// viết ra một bộ nhận diện chạy đúng trong test và sai ngoài đời.
const UA = {
  zaloIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Zalo',
  zaloAndroid:
    'Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Zalo',
  facebookIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.30.109]',
  webviewAndroid:
    'Mozilla/5.0 (Linux; Android 12; V2027 Build/RP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  webviewIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  safariIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIOS:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  chromeDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('nhanDienWebview — bắt được webview', () => {
  it('Zalo trên iOS, gọi đúng tên để hướng dẫn cho dễ hiểu', () => {
    expect(nhanDienWebview(UA.zaloIOS)).toEqual({ laWebview: true, ten: 'Zalo', laIOS: true });
  });

  it('Zalo trên Android', () => {
    expect(nhanDienWebview(UA.zaloAndroid)).toMatchObject({ laWebview: true, ten: 'Zalo', laIOS: false });
  });

  it('Facebook trên iOS', () => {
    expect(nhanDienWebview(UA.facebookIOS)).toMatchObject({ laWebview: true, ten: 'Facebook' });
  });

  it('webview Android không khai tên vẫn bắt được bằng cờ "; wv"', () => {
    expect(nhanDienWebview(UA.webviewAndroid)).toMatchObject({ laWebview: true, ten: '' });
  });

  it('webview iOS không khai tên: dấu hiệu là THIẾU chuỗi Safari', () => {
    expect(nhanDienWebview(UA.webviewIOS)).toMatchObject({ laWebview: true, laIOS: true });
  });
});

describe('nhanDienWebview — KHÔNG bắt nhầm trình duyệt thật', () => {
  // Bắt nhầm còn tệ hơn bỏ sót: người đang dùng Chrome mà bị bảo "hãy mở bằng
  // Chrome" thì họ mất niềm tin vào mọi thứ khác trên màn hình.
  it.each([
    ['Safari iOS', UA.safariIOS],
    ['Chrome iOS', UA.chromeIOS],
    ['Chrome Android', UA.chromeAndroid],
    ['Chrome máy tính', UA.chromeDesktop],
  ])('%s', (_ten, ua) => {
    expect(nhanDienWebview(ua).laWebview).toBe(false);
  });

  it('chuỗi rỗng thì coi như trình duyệt thường', () => {
    expect(nhanDienWebview('').laWebview).toBe(false);
  });
});

describe('laUngDungManHinhChinh', () => {
  it('iPhone thêm vào màn hình chính: navigator.standalone = true', () => {
    expect(laUngDungManHinhChinh({ standalone: true })).toBe(true);
  });

  it('Android/máy tính cài như ứng dụng: display-mode standalone', () => {
    expect(laUngDungManHinhChinh({ displayModeStandalone: true })).toBe(true);
  });

  it('mở trong tab trình duyệt bình thường thì không', () => {
    expect(laUngDungManHinhChinh({ standalone: false, displayModeStandalone: false })).toBe(false);
  });
});
