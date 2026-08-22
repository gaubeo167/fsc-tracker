import { useEffect, useRef } from 'react';
import { fetchTicketByNo } from '../repository/ticketRepository';
import type { Ticket } from '../types';

// ===========================================================================
// Nghe sự kiện "mở phiếu FSC-..." phát ra từ chuông thông báo hoặc từ nút quay
// về phiếu trong màn Công việc.
//
// Dùng sự kiện window thay vì đổi URL rồi tải lại trang: tải lại làm mất thứ
// người dùng đang gõ dở, mà cả hai lối vào này đều xảy ra giữa lúc họ đang làm
// việc khác.
// ===========================================================================

export function useOpenTicketEvent(onOpen: (t: Ticket) => void) {
  // Mã vừa xử lý, để bỏ qua lượt phát lại trùng.
  const vuaMo = useRef<string>('');

  useEffect(() => {
    const h = (e: Event) => {
      // Mã đến từ URL hoặc thông báo nên coi là dữ liệu người lạ nhập: cắt độ
      // dài trước khi gửi đi truy vấn.
      const no = String((e as CustomEvent).detail ?? '').slice(0, 64);
      if (!no) return;
      // Màn bọc ngoài phát lại sự kiện SAU khi đổi tab, nhưng khi tab đã đúng
      // sẵn thì màn này nghe được CẢ HAI lượt: hai lần đọc Firestore cho một cú
      // bấm, và nếu người dùng bấm Quay lại trước khi lượt thứ hai về thì màn
      // chi tiết tự mở lại. Bỏ qua lượt trùng trong cùng một nhịp.
      if (vuaMo.current === no) return;
      vuaMo.current = no;
      setTimeout(() => { vuaMo.current = ''; }, 0);
      void fetchTicketByNo(no).then(({ ticket }) => { if (ticket) onOpen(ticket); });
    };
    // Nghe cả hai: sự kiện gốc, và sự kiện phát lại sau khi màn bọc ngoài đã
    // chuyển sang đúng tab. Cần cái thứ hai vì lúc sự kiện gốc bắn ra thì màn
    // này còn chưa được dựng, nên nó không thể nghe thấy.
    window.addEventListener('fsc:open-ticket', h);
    window.addEventListener('fsc:open-ticket-relay', h);
    return () => {
      window.removeEventListener('fsc:open-ticket', h);
      window.removeEventListener('fsc:open-ticket-relay', h);
    };
  }, [onOpen]);
}
