import { execFileSync } from 'node:child_process';

// ===========================================================================
// Lớp Firestore tối giản chạy trên REST API, dùng token của phiên gcloud.
//
// Vì sao cần: `gcloud auth login` và `gcloud auth application-default login` là
// HAI thứ khác nhau, và máy nào cũng có cái đầu còn cái sau thì hiếm. Firebase
// Admin SDK chỉ nhận service account hoặc ADC — token trần không đủ. Mà bắt
// người vận hành đi tạo ADC chỉ để chạy một script nhập dữ liệu là rào cản
// không cần thiết.
//
// CỐ Ý rất hẹp: chỉ đủ những thao tác hai script nhập/vá dữ liệu cần. Đây không
// phải một client Firestore, và đừng biến nó thành một cái. Mọi thứ phức tạp
// hơn (truy vấn, transaction, phân trang lớn) thì dùng Admin SDK với ADC.
// ===========================================================================

type Val = Record<string, unknown>;

function toValue(v: unknown): Val {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: v.length ? { values: v.map(toValue) } : {} };
  }
  if (typeof v === 'object') {
    return { mapValue: { fields: Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toValue(x)])
    ) } };
  }
  return { stringValue: String(v) };
}

function fromValue(v: Val): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(String(v.timestampValue));
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) {
    return ((v.arrayValue as any)?.values ?? []).map(fromValue);
  }
  if ('mapValue' in v) {
    const f = (v.mapValue as any)?.fields ?? {};
    return Object.fromEntries(Object.entries(f).map(([k, x]) => [k, fromValue(x as Val)]));
  }
  return null;
}

export interface RestDoc {
  id: string;
  data: () => Record<string, unknown>;
  ref: { update: (patch: Record<string, unknown>) => Promise<void> };
}

export function restDb(projectId: string, databaseId: string) {
  const base =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/${databaseId}/documents`;

  // Lấy lại token mỗi lượt gọi: token sống khoảng một giờ, còn script vá dữ
  // liệu có thể chạy lâu hơn thế. In-process cache không đáng cho vài chục lượt.
  const token = () =>
    execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();

  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(init.headers ?? {}),
      },
    });
    if (!r.ok) {
      throw new Error(`Firestore REST ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
    return r.json();
  };

  const docRef = (col: string, id: string) => ({
    set: async (payload: Record<string, unknown>, opts?: { merge?: boolean }) => {
      const fields = Object.keys(payload);
      // merge=false vẫn phải liệt kê mask: không có mask thì REST API xoá sạch
      // field nào không gửi lên, còn ở đây payload luôn là toàn bộ document.
      const mask = fields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
      await call(`/${col}/${id}?${mask}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fields: Object.fromEntries(fields.map((f) => [f, toValue(payload[f])])),
        }),
      });
      void opts;
    },
    update: async (patch: Record<string, unknown>) => {
      const fields = Object.keys(patch);
      const mask = fields.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
      await call(`/${col}/${id}?${mask}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fields: Object.fromEntries(fields.map((f) => [f, toValue(patch[f])])),
        }),
      });
    },
  });

  return {
    collection: (col: string) => ({
      doc: (id: string) => docRef(col, id),
      get: async (): Promise<{ docs: RestDoc[] }> => {
        const docs: RestDoc[] = [];
        let pageToken = '';
        // Phân trang tới hết. Bỏ qua vòng lặp là script báo "không đổi" cho
        // những document nó chưa từng nhìn thấy.
        do {
          const j: any = await call(
            `/${col}?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`
          );
          for (const d of j.documents ?? []) {
            const id = String(d.name).split('/').pop() as string;
            const fields = Object.fromEntries(
              Object.entries(d.fields ?? {}).map(([k, v]) => [k, fromValue(v as Val)])
            );
            docs.push({ id, data: () => fields, ref: docRef(col, id) });
          }
          pageToken = j.nextPageToken ?? '';
        } while (pageToken);
        return { docs };
      },
    }),
  };
}
