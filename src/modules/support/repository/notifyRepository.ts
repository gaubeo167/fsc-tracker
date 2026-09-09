import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import {
  DomainError,
  MAX_RECIPIENTS_PER_GROUP,
  NOTIFY_COL,
  type Announcement,
  type AnnouncementStatus,
  type Delivery,
  type EmailTemplate,
  type NotifyGroup,
  type NotifyRecipient,
} from '../types';
import { classifyError, type RepoError } from './campusRepository';

// ===========================================================================
// Nhóm nhận tin, mẫu email, và lịch sử các lần đã gửi.
//
// Một quy ước xuyên suốt file này: lần gửi CHÉP CỨNG mọi thứ nó cần (tiêu đề,
// nội dung, tên nhóm, danh sách người nhận). Không có tham chiếu sống nào từ
// lịch sử sang nhóm hay mẫu. Đổi tên nhóm sáu tháng sau không được phép làm đổi
// câu trả lời cho "hôm đó tôi đã gửi gì, cho ai".
// ===========================================================================

// ---------------------------------------------------------------- NHÓM

export function watchNotifyGroups(
  onData: (rows: NotifyGroup[]) => void,
  onError: (err: RepoError) => void
) {
  const q = query(collection(db, NOTIFY_COL.groups), orderBy('name'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as NotifyGroup)),
    (error) => onError(classifyError(error))
  );
}

function kiemNhom(input: { name: string; recipients: NotifyRecipient[] }) {
  if (!input.name.trim()) throw new DomainError('GROUP_NAME_REQUIRED', 'Chưa đặt tên nhóm');
  if (input.recipients.length > MAX_RECIPIENTS_PER_GROUP) {
    throw new DomainError(
      'GROUP_TOO_LARGE',
      `Một nhóm tối đa ${MAX_RECIPIENTS_PER_GROUP} người nhận`,
      { count: input.recipients.length }
    );
  }
}

export async function createNotifyGroup(
  input: { name: string; description: string; recipients: NotifyRecipient[] },
  actorUid: string
): Promise<string> {
  kiemNhom(input);
  const ref = await addDoc(collection(db, NOTIFY_COL.groups), {
    name: input.name.trim(),
    description: input.description.trim(),
    recipients: input.recipients,
    isActive: true,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
  return ref.id;
}

export async function updateNotifyGroup(
  id: string,
  patch: { name?: string; description?: string; recipients?: NotifyRecipient[]; isActive?: boolean },
  actorUid: string
): Promise<void> {
  if (patch.name !== undefined || patch.recipients !== undefined) {
    kiemNhom({
      name: patch.name ?? 'giữ nguyên',
      recipients: patch.recipients ?? [],
    });
  }
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp(), updatedBy: actorUid };
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.description !== undefined) clean.description = patch.description.trim();
  if (patch.recipients !== undefined) clean.recipients = patch.recipients;
  if (patch.isActive !== undefined) clean.isActive = patch.isActive;
  await updateDoc(doc(db, NOTIFY_COL.groups, id), clean);
}

/**
 * Xoá hẳn một nhóm.
 *
 * Xoá được (khác campus và phân hệ) vì lịch sử gửi đã chép cứng tên nhóm và
 * danh sách người nhận — xoá nhóm không để lại tham chiếu mồ côi ở đâu cả.
 */
export async function deleteNotifyGroup(id: string): Promise<void> {
  await deleteDoc(doc(db, NOTIFY_COL.groups, id));
}

// ---------------------------------------------------------------- MẪU

export function watchEmailTemplates(
  onData: (rows: EmailTemplate[]) => void,
  onError: (err: RepoError) => void
) {
  const q = query(collection(db, NOTIFY_COL.templates), orderBy('name'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as EmailTemplate)),
    (error) => onError(classifyError(error))
  );
}

function kiemMau(input: { name: string; subject: string; body: string }) {
  if (!input.name.trim()) throw new DomainError('TEMPLATE_NAME_REQUIRED', 'Chưa đặt tên mẫu');
  if (!input.subject.trim()) throw new DomainError('TEMPLATE_SUBJECT_REQUIRED', 'Chưa nhập tiêu đề thư');
  if (!input.body.trim()) throw new DomainError('TEMPLATE_BODY_REQUIRED', 'Chưa nhập nội dung thư');
}

export async function createEmailTemplate(
  input: { name: string; subject: string; body: string },
  actorUid: string
): Promise<string> {
  kiemMau(input);
  const ref = await addDoc(collection(db, NOTIFY_COL.templates), {
    name: input.name.trim(),
    subject: input.subject.trim(),
    body: input.body,
    isActive: true,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
  return ref.id;
}

export async function updateEmailTemplate(
  id: string,
  patch: { name: string; subject: string; body: string; isActive?: boolean },
  actorUid: string
): Promise<void> {
  kiemMau(patch);
  await updateDoc(doc(db, NOTIFY_COL.templates, id), {
    name: patch.name.trim(),
    subject: patch.subject.trim(),
    body: patch.body,
    ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

export async function deleteEmailTemplate(id: string): Promise<void> {
  await deleteDoc(doc(db, NOTIFY_COL.templates, id));
}

// ---------------------------------------------------------------- LẦN GỬI

/**
 * Địa chỉ email làm doc id.
 *
 * Email không chứa được dấu `/` nên dùng thẳng là an toàn cho đường dẫn. Lợi
 * ích thật sự: doc id LÀ khoá khử trùng, nên chạy lại lượt tạo không bao giờ
 * sinh ra hai bản ghi cho cùng một người — thứ mà id ngẫu nhiên không đảm bảo.
 */
export function docIdCuaEmail(email: string): string {
  return email.toLowerCase();
}

/**
 * Tạo một lần gửi: document tổng + một bản ghi cho MỖI người nhận.
 *
 * Vì sao ghi sẵn toàn bộ người nhận ở trạng thái PENDING trước khi gửi cái đầu
 * tiên: trình duyệt là thứ thực hiện việc gửi, mà tab thì đóng được, máy thì
 * sập được. Có danh sách nằm sẵn trên Firestore thì lần sau mở lại còn biết ai
 * đã nhận và ai chưa. Không có nó, cách duy nhất để tiếp tục là gửi lại từ đầu
 * cho tất cả mọi người.
 */
export async function createAnnouncement(input: {
  subject: string;
  body: string;
  templateId: string | null;
  templateName: string;
  groupIds: string[];
  groupNames: string[];
  recipients: NotifyRecipient[];
  senderEmail: string;
  createdBy: string;
  createdByName: string;
}): Promise<string> {
  if (input.recipients.length === 0) {
    throw new DomainError('NO_RECIPIENT', 'Chưa có người nhận nào');
  }
  const ref = doc(collection(db, NOTIFY_COL.announcements));
  await setDoc(ref, {
    subject: input.subject,
    body: input.body,
    templateId: input.templateId,
    templateName: input.templateName,
    groupIds: input.groupIds,
    groupNames: input.groupNames,
    total: input.recipients.length,
    sentCount: 0,
    failedCount: 0,
    status: 'SENDING' satisfies AnnouncementStatus,
    senderEmail: input.senderEmail,
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp(),
  });

  // Firestore cho tối đa 500 thao tác mỗi batch. Chia 400 để còn chỗ thở.
  for (let i = 0; i < input.recipients.length; i += 400) {
    const batch = writeBatch(db);
    for (const r of input.recipients.slice(i, i + 400)) {
      batch.set(doc(db, NOTIFY_COL.announcements, ref.id, NOTIFY_COL.deliveries, docIdCuaEmail(r.email)), {
        email: r.email,
        name: r.name,
        status: 'PENDING',
      } satisfies Delivery);
    }
    await batch.commit();
  }
  return ref.id;
}

export function watchAnnouncements(
  onData: (rows: Announcement[]) => void,
  onError: (err: RepoError) => void
) {
  const q = query(collection(db, NOTIFY_COL.announcements), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Announcement)),
    (error) => onError(classifyError(error))
  );
}

export async function fetchDeliveries(announcementId: string): Promise<Delivery[]> {
  const snap = await getDocs(
    collection(db, NOTIFY_COL.announcements, announcementId, NOTIFY_COL.deliveries)
  );
  return snap.docs.map((d) => d.data() as Delivery);
}

/** Ghi trạng thái nhiều lượt gửi một lần, để không tốn một lượt ghi mỗi thư. */
export async function ghiTrangThaiGui(
  announcementId: string,
  ket: Array<{ email: string; status: 'SENT' | 'FAILED'; error?: string }>
): Promise<void> {
  for (let i = 0; i < ket.length; i += 400) {
    const batch = writeBatch(db);
    for (const k of ket.slice(i, i + 400)) {
      batch.update(
        doc(db, NOTIFY_COL.announcements, announcementId, NOTIFY_COL.deliveries, docIdCuaEmail(k.email)),
        {
          status: k.status,
          ...(k.error ? { error: k.error.slice(0, 300) } : {}),
          sentAt: serverTimestamp(),
        }
      );
    }
    await batch.commit();
  }
}

export async function capNhatTienDo(
  announcementId: string,
  patch: { sentCount: number; failedCount: number; status: AnnouncementStatus; xong?: boolean }
): Promise<void> {
  await updateDoc(doc(db, NOTIFY_COL.announcements, announcementId), {
    sentCount: patch.sentCount,
    failedCount: patch.failedCount,
    status: patch.status,
    ...(patch.xong ? { finishedAt: serverTimestamp() } : {}),
  });
}
