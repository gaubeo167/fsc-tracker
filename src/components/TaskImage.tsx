import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { peekTaskImage, resolveTaskImage } from '../services/taskImages';

// ============================================================================
// Hiển thị một ảnh của task.
//
// Ảnh giờ nằm trên Storage nên không gắn thẳng vào src được nữa: phải lấy blob
// qua storage.rules bằng danh tính người đang xem rồi mới dựng object URL.
// Component này bọc trọn phần đó, kể cả nhánh ảnh cũ còn lưu base64 trong
// Firestore (resolveTaskImage trả về ngay, không đi mạng).
// ============================================================================

type TrangThai = { src: string | null; loi: boolean };

/** Lấy src dùng được cho <img> từ giá trị lưu trong Firestore. */
export function useTaskImage(value: string | null | undefined): TrangThai {
  // Khởi tạo bằng bản đã có sẵn (ảnh cũ dạng data:, hoặc ảnh đã xem trong phiên)
  // để không chớp một khung xám trước mỗi lần hiện lại cùng một ảnh.
  const [trangThai, setTrangThai] = useState<TrangThai>(() => ({
    src: peekTaskImage(value), loi: false,
  }));

  useEffect(() => {
    if (!value) {
      setTrangThai({ src: null, loi: false });
      return;
    }
    const coSan = peekTaskImage(value);
    if (coSan) {
      setTrangThai({ src: coSan, loi: false });
      return;
    }
    let conSong = true;
    setTrangThai({ src: null, loi: false });
    resolveTaskImage(value)
      .then((src) => { if (conSong) setTrangThai({ src, loi: false }); })
      .catch((err) => {
        console.error('[TaskImage] Không tải được ảnh:', value, err);
        if (conSong) setTrangThai({ src: null, loi: true });
      });
    return () => { conSong = false; };
  }, [value]);

  return trangThai;
}

export function TaskImage({
  value,
  className = '',
  alt = 'Ảnh đính kèm',
  onClick,
}: {
  value: string;
  className?: string;
  alt?: string;
  onClick?: () => void;
}) {
  const { src, loi } = useTaskImage(value);

  // Ô chờ và ô lỗi giữ đúng khung của ảnh: thiếu nó thì lưới ảnh nhảy vị trí
  // khi từng ảnh tải xong.
  if (loi) {
    return (
      <div
        className={`${className} flex items-center justify-center bg-slate-100 text-slate-400`}
        title="Không tải được ảnh"
      >
        <ImageOff size={16} />
      </div>
    );
  }
  if (!src) {
    return (
      <div className={`${className} flex items-center justify-center bg-slate-100 text-slate-300`}>
        <Loader2 size={16} className="animate-spin" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onClick={onClick}
      referrerPolicy="no-referrer"
    />
  );
}
