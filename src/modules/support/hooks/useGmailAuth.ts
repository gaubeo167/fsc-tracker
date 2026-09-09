import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { useCallback, useState } from 'react';
import { auth } from '../../../firebase';
import { GMAIL_SEND_SCOPE } from '../services/gmailSend';

// ===========================================================================
// Xin quyền gửi thư thay người đang đăng nhập.
//
// Vì sao KHÔNG thêm scope này vào lần đăng nhập thường: mọi người dùng sẽ bị
// Google hỏi "cho phép ứng dụng gửi thư thay bạn" ngay lúc đăng nhập, kể cả
// giáo viên không bao giờ gửi thông báo nào. Một màn xin quyền không giải thích
// được là cách nhanh nhất để người ta bấm Huỷ rồi không đăng nhập được nữa.
//
// Nên quyền được xin ĐÚNG LÚC bấm nút gửi, và chỉ với admin.
//
// reauthenticateWithPopup chứ không phải signInWithPopup: hàm sau cho phép chọn
// một tài khoản Google KHÁC và như vậy là đổi luôn người đang đăng nhập giữa
// chừng. Hàm này ép đúng tài khoản hiện tại, chỉ xin thêm quyền.
// ===========================================================================

/**
 * Token của Google sống một giờ và Firebase KHÔNG trả về hạn dùng thật.
 * Lấy 55 phút cho có biên: hết hạn giữa lượt gửi thì phần còn lại đứng im, còn
 * xin lại sớm vài phút thì chẳng mất gì.
 */
const HAN_DUNG_MS = 55 * 60 * 1000;

export interface GmailAuthState {
  daKetNoi: boolean;
  dangKetNoi: boolean;
  loi: string | null;
  /** Hộp thư sẽ đứng tên gửi. Chính là tài khoản đang đăng nhập. */
  senderEmail: string;
  senderName: string;
  ketNoi: () => Promise<void>;
  /** null khi chưa kết nối hoặc đã hết hạn. */
  layToken: () => string | null;
}

export function useGmailAuth(): GmailAuthState {
  const [token, setToken] = useState<string | null>(null);
  const [hetHanLuc, setHetHanLuc] = useState(0);
  const [dangKetNoi, setDangKetNoi] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);

  const conHan = !!token && Date.now() < hetHanLuc;

  const ketNoi = useCallback(async () => {
    setLoi(null);
    const user = auth.currentUser;
    if (!user) {
      setLoi('Phiên đăng nhập đã mất. Tải lại trang rồi thử lại.');
      return;
    }
    setDangKetNoi(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope(GMAIL_SEND_SCOPE);
      // Ép hiện màn đồng ý: không có nó, lần thứ hai Google trả về token CŨ
      // không kèm scope gửi thư, và lỗi chỉ lộ ra ở thư đầu tiên.
      provider.setCustomParameters({ prompt: 'consent', login_hint: user.email ?? '' });

      const ket = await reauthenticateWithPopup(user, provider);
      const accessToken = GoogleAuthProvider.credentialFromResult(ket)?.accessToken ?? null;
      if (!accessToken) {
        setLoi('Google không trả về quyền gửi thư. Thử lại và bấm Cho phép ở màn hình của Google.');
        return;
      }
      setToken(accessToken);
      setHetHanLuc(Date.now() + HAN_DUNG_MS);
    } catch (err: any) {
      // Popup là chỗ hỏng thường gặp nhất, và mã lỗi của Firebase thì không nói
      // cho người dùng biết phải làm gì.
      const code = err?.code ?? '';
      if (code === 'auth/popup-blocked') {
        setLoi('Trình duyệt chặn cửa sổ của Google. Cho phép popup cho trang này rồi thử lại.');
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setLoi('Bạn đã đóng cửa sổ của Google trước khi cấp quyền.');
      } else if (code === 'auth/user-mismatch') {
        setLoi('Cửa sổ Google vừa chọn một tài khoản khác. Phải chọn đúng tài khoản đang đăng nhập.');
      } else {
        setLoi(`Không kết nối được Gmail (${code || 'lỗi không rõ'}).`);
      }
    } finally {
      setDangKetNoi(false);
    }
  }, []);

  return {
    daKetNoi: conHan,
    dangKetNoi,
    loi,
    senderEmail: auth.currentUser?.email ?? '',
    senderName: auth.currentUser?.displayName ?? '',
    ketNoi,
    layToken: () => (Date.now() < hetHanLuc ? token : null),
  };
}
