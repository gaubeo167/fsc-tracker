import { GmailError } from './gmailSend';
import type { NotifyRecipient } from '../types';

// ===========================================================================
// Điều phối một lượt gửi hàng loạt.
//
// Tách khỏi cả Gmail lẫn Firestore để test được thứ đáng test: chuyện gì xảy ra
// khi thư thứ 47 hỏng. Ba cách hỏng khác nhau, ba cách xử KHÁC HẲN nhau:
//
//   Hỏng tạm (429, 503)      -> chờ rồi thử lại chính người đó
//   Hỏng riêng một người     -> đánh dấu FAILED, đi tiếp người sau
//   Hỏng cả hệ (hết phiên,   -> DỪNG TẤT CẢ, giữ nguyên PENDING cho người chưa
//   chưa bật API)               gửi, để lát nữa gửi tiếp chứ không gửi lại
//
// Nhánh thứ ba là nhánh dễ làm sai nhất. Cứ đi tiếp khi phiên đã hết hạn thì
// 300 người còn lại đều bị đánh dấu FAILED trong ba giây, và người dùng nhìn
// vào tưởng 300 địa chỉ đó sai.
// ===========================================================================

/** Lỗi ở tầng hệ thống: gửi tiếp người sau cũng hỏng y như vậy. */
const LOI_DUNG_HET = new Set(['GMAIL_TOKEN', 'GMAIL_API_TAT', 'GMAIL_TU_CHOI']);

export interface KetQuaGui {
  sent: number;
  failed: number;
  /** true khi dừng sớm: người dùng bấm dừng, hoặc lỗi cả hệ. */
  dungGiuaChung: boolean;
  /** Câu giải thích vì sao dừng, để hiện thẳng lên màn hình. */
  lyDoDung: string | null;
}

export interface ThamSoGui {
  recipients: NotifyRecipient[];
  /** Gửi đúng một thư. Ném GmailError khi hỏng. */
  gui: (r: NotifyRecipient) => Promise<void>;
  /** Ghi trạng thái theo lô. Được gọi nhiều lần trong một lượt gửi. */
  ghi: (ket: Array<{ email: string; status: 'SENT' | 'FAILED'; error?: string }>) => Promise<void>;
  onTien?: (daGui: number, daHong: number, tong: number) => void;
  /** Người dùng bấm dừng. Kiểm trước mỗi thư. */
  nenDung?: () => boolean;
  /** Tiêm được để test không phải chờ thật. */
  nghi?: (ms: number) => Promise<void>;
  /**
   * Nhịp giữa hai thư. Gmail tính messages.send là 100 đơn vị hạn ngạch trên
   * trần 250 mỗi giây, nên nhanh hơn ~2 thư/giây là ăn 429 rồi phải chờ lâu hơn.
   */
  nhipMs?: number;
  soLanThuLai?: number;
  /** Ghi trạng thái sau mỗi bao nhiêu thư. Gom lại để đỡ tốn lượt ghi. */
  loGhi?: number;
}

const nghiMacDinh = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function guiHangLoat(ts: ThamSoGui): Promise<KetQuaGui> {
  const {
    recipients, gui, ghi,
    onTien, nenDung,
    nghi = nghiMacDinh,
    nhipMs = 400,
    soLanThuLai = 2,
    loGhi = 20,
  } = ts;

  let sent = 0;
  let failed = 0;
  let dungGiuaChung = false;
  let lyDoDung: string | null = null;
  let cho: Array<{ email: string; status: 'SENT' | 'FAILED'; error?: string }> = [];

  async function xaCho() {
    if (cho.length === 0) return;
    const lo = cho;
    cho = [];
    await ghi(lo);
  }

  for (let i = 0; i < recipients.length; i++) {
    if (nenDung?.()) {
      dungGiuaChung = true;
      lyDoDung = 'Bạn đã dừng lượt gửi. Những người chưa nhận vẫn còn chờ, gửi tiếp được.';
      break;
    }

    const r = recipients[i];
    let loiCuoi: unknown = null;

    for (let lan = 0; lan <= soLanThuLai; lan++) {
      try {
        await gui(r);
        loiCuoi = null;
        break;
      } catch (err) {
        loiCuoi = err;
        const thuLaiDuoc = err instanceof GmailError && err.thuLaiDuoc;
        if (!thuLaiDuoc || lan === soLanThuLai) break;
        // Chờ tăng dần: 1s, 2s. Thử lại ngay lập tức khi Google vừa bảo chậm
        // lại là cách chắc chắn nhất để bị chặn lâu hơn.
        await nghi(1000 * (lan + 1));
      }
    }

    if (!loiCuoi) {
      sent++;
      cho.push({ email: r.email, status: 'SENT' });
    } else if (loiCuoi instanceof GmailError && LOI_DUNG_HET.has(loiCuoi.code)) {
      // KHÔNG đánh dấu người này FAILED: họ không có lỗi gì, hệ thống mới có.
      // Giữ PENDING để lượt "gửi tiếp" nhặt lại đúng họ.
      dungGiuaChung = true;
      lyDoDung = loiCuoi.message;
      break;
    } else {
      failed++;
      cho.push({
        email: r.email,
        status: 'FAILED',
        error: loiCuoi instanceof Error ? loiCuoi.message : String(loiCuoi),
      });
    }

    onTien?.(sent, failed, recipients.length);
    if (cho.length >= loGhi) await xaCho();
    if (i < recipients.length - 1) await nghi(nhipMs);
  }

  await xaCho();
  return { sent, failed, dungGiuaChung, lyDoDung };
}

/** Trạng thái cuối của một lần gửi, suy từ số đếm. Xem AnnouncementStatus. */
export function trangThaiSauKhiGui(input: {
  total: number;
  sent: number;
  failed: number;
  dungGiuaChung: boolean;
}): 'SENDING' | 'SENT' | 'PARTIAL' | 'FAILED' {
  // Dừng giữa chừng thì vẫn là SENDING: còn người chưa gửi, và nút "Gửi tiếp"
  // phải hiện ra. Đánh dấu SENT ở đây là nói dối, đánh dấu FAILED thì người
  // dùng gửi lại từ đầu và người đã nhận bị nhận hai lần.
  if (input.dungGiuaChung && input.sent + input.failed < input.total) return 'SENDING';
  if (input.failed === 0) return 'SENT';
  if (input.sent === 0) return 'FAILED';
  return 'PARTIAL';
}
