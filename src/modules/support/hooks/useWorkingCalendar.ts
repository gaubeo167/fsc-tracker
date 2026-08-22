import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../../firebase';
import { DEFAULT_CALENDAR, type WorkingCalendar } from '../services/workingTime';

// ===========================================================================
// Lịch làm việc THẬT, đọc từ support_config.
//
// workingTime.ts dựng sẵn cơ chế ngày nghỉ (`holidays`) và ngày làm bù
// (`overrides`) đúng cho bối cảnh Việt Nam — Tết, 30/4, và những thứ Bảy đi làm
// bù. Script seed cũng ghi sẵn hai document cấu hình. Nhưng KHÔNG CHỖ NÀO trong
// ứng dụng đọc chúng: mọi phép tính hạn đều truyền DEFAULT_CALENDAR, mà hằng số
// đó có holidays: [] và overrides: {}.
//
// Hậu quả: một phiếu P2 mở ra trước kỳ nghỉ bốn ngày nhận hạn rơi vào giữa kỳ
// nghỉ, rồi hệ thống báo quá hạn cho một ngày không ai đi làm.
//
// MỘT listener cho cả ứng dụng, giống useSupportModules — hạn xử lý được tính
// ở nhiều màn, mỗi màn một kết nối là lãng phí.
// ===========================================================================

let cache: WorkingCalendar = DEFAULT_CALENDAR;
let stop: (() => void) | null = null;
const subs = new Set<(v: WorkingCalendar) => void>();

/** Lịch mới nhất đã tải. Dùng cho code không phải React (repository). */
export function currentCalendar(): WorkingCalendar {
  return cache;
}

function phatLai() {
  subs.forEach((f) => f(cache));
}

function batDau() {
  if (stop) return;
  const stopWin = onSnapshot(
    doc(db, 'support_config', 'working_calendar'),
    (snap) => {
      const d = snap.data() as Record<string, unknown> | undefined;
      const windows = d?.windows as WorkingCalendar['windows'] | undefined;
      cache = { ...cache, windows: windows?.length ? windows : DEFAULT_CALENDAR.windows };
      phatLai();
    },
    // Đọc hỏng thì dùng lịch mặc định: tính hạn hơi rộng còn hơn không tính được.
    () => { cache = DEFAULT_CALENDAR; phatLai(); }
  );
  const stopHol = onSnapshot(
    doc(db, 'support_config', 'holidays'),
    (snap) => {
      const d = snap.data() as Record<string, unknown> | undefined;
      cache = {
        ...cache,
        holidays: (d?.dates as string[]) ?? [],
        overrides: (d?.overrides as WorkingCalendar['overrides']) ?? {},
      };
      phatLai();
    },
    () => {}
  );
  stop = () => { stopWin(); stopHol(); };
}

export function useWorkingCalendar(): WorkingCalendar {
  const [cal, setCal] = useState<WorkingCalendar>(cache);
  useEffect(() => {
    batDau();
    setCal(cache);
    subs.add(setCal);
    return () => { subs.delete(setCal); };
  }, []);
  return cal;
}
