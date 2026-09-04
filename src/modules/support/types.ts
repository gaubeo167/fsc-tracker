import type { Timestamp } from 'firebase/firestore';

// ===========================================================================
// Module "Yêu cầu hỗ trợ Campus" — kiểu dữ liệu.
//
// Nguyên tắc: KHÔNG sửa src/types.ts và KHÔNG thêm field vào collection `users`.
// Việc gán campus + vai trò hỗ trợ nằm ở collection ánh xạ riêng
// `support_role_assignments/{uid}` (§3 spec).
// ===========================================================================

/** Đường dẫn Firestore, gom một chỗ để không gõ tay chuỗi rải rác khắp nơi. */
export const COL = {
  campuses: 'support_campuses',
  roleAssignments: 'support_role_assignments',
  modules: 'support_modules',
} as const;

/**
 * Năm phân hệ MẶC ĐỊNH theo §2 spec.
 *
 * Không còn là danh sách đóng: đây là giá trị seed và là bản dự phòng hiển thị
 * khi chưa tải xong Firestore. Danh sách thật nằm ở collection support_modules
 * và đọc qua hook useSupportModules().
 */
export const SUPPORT_MODULES = [
  { code: 'WEB_FSB', name: 'Web FSB' },
  { code: 'APP_MY_FPT_SCHOOL', name: 'App My FPT School' },
  { code: 'FINANCE', name: 'Tài chính' },
  { code: 'FEEN', name: 'FEEN' },
  { code: 'HEALTH_SYSTEM', name: 'Hệ thống Y tế' },
] as const;

/**
 * Mã phân hệ. Là `string` chứ KHÔNG phải union của 5 mã cố định.
 *
 * Admin tạo thêm phân hệ được, nên mọi mã hợp lệ đều là mã hợp lệ. Giữ union
 * đóng thì phân hệ thứ 6 không gán vào phiếu được mà tsc lại báo lỗi ở chỗ
 * chẳng liên quan gì.
 */
export type SupportModuleCode = string;

/**
 * Vai trò trong module hỗ trợ. Tách hoàn toàn khỏi `UserProfile.role`
 * (admin/director/manager/user) vốn phục vụ module quản lý task.
 */
export type SupportRole =
  | 'CAMPUS_REPORTER'
  | 'CAMPUS_FOCAL'
  | 'MODULE_OWNER'
  | 'DEVELOPER'
  | 'PTUD_MANAGER'
  | 'SYS_ADMIN';

export const SUPPORT_ROLES: SupportRole[] = [
  'CAMPUS_REPORTER',
  'CAMPUS_FOCAL',
  'MODULE_OWNER',
  'DEVELOPER',
  'PTUD_MANAGER',
  'SYS_ADMIN',
];

/** Vai trò nào bắt buộc phải gắn với một campus cụ thể. */
export const ROLES_REQUIRING_CAMPUS: SupportRole[] = ['CAMPUS_REPORTER', 'CAMPUS_FOCAL'];

/**
 * Vai trò phía trường: chỉ gửi và theo dõi yêu cầu hỗ trợ, KHÔNG làm task.
 *
 * Danh sách này là nguồn duy nhất cho hai việc: quyết định menu người đó thấy
 * (useSupportRole) và loại họ khỏi mọi ô chọn người khi giao việc bên module
 * Công việc (useCampusStaffUids). Để hai nơi tự chép lại danh sách thì thêm một
 * vai trò phía trường thứ ba là sót đúng một chỗ, và cán bộ trường lại hiện ra
 * trong danh sách người thực hiện.
 */
export const CAMPUS_SIDE_ROLES: SupportRole[] = ['CAMPUS_REPORTER', 'CAMPUS_FOCAL'];

/**
 * Campus. KHÔNG seed cứng 18 trường — đây là dữ liệu do SYS_ADMIN tự tạo
 * trong sản phẩm, vì danh sách và mã trường là thứ chỉ phía nghiệp vụ chốt được.
 */
export interface Campus {
  id: string;
  /** Mã ngắn, viết hoa, duy nhất. Dùng làm doc id luôn. */
  code: string;
  name: string;
  region: string;
  isActive: boolean;

  /**
   * Địa chỉ cơ sở. Không bắt buộc vì các trường tạo trước khi có ô này vẫn
   * phải đọc được — thiếu địa chỉ thì hiện gạch ngang, không phải vỡ màn hình.
   *
   * Dùng để kỹ thuật viên biết phiếu đến từ đâu khi phải xuống tận nơi, và để
   * phân biệt hai cơ sở cùng tên ở cùng một thành phố.
   */
  address?: string;
  /** Tỉnh/thành sau sáp nhập đơn vị hành chính 2025. */
  province?: string;
  /** Cấp học: "TH", "THCS", "THPT" hoặc tổ hợp. */
  levels?: string;
  /**
   * Mã cơ sở theo Quyết định của Công ty TNHH Giáo dục FPT.
   *
   * Tách khỏi `code` vì có mã được cấp CHUNG cho hai cơ sở (FHH cho cả Đà Nẵng
   * 1-2 và Đà Nẵng 3), trong khi `code` là doc id nên buộc phải duy nhất.
   */
  officialCode?: string;
  note?: string;

  createdAt?: Timestamp;
  createdBy?: string;
}

/**
 * Cấu hình một phân hệ hỗ trợ.
 *
 * `projectId` nối phân hệ với một project trong module Công việc: phiếu được
 * tiếp nhận sẽ sinh task nằm trong project đó. Chưa gán thì không tiếp nhận
 * được — cố ý, vì task không có project để chui vào.
 */
export interface SupportModuleConfig {
  code: SupportModuleCode;
  name: string;
  ownerUserId: string | null;
  backupOwnerUserId: string | null;
  projectId: string | null;
  isActive: boolean;
}

/** Bản ghi gán quyền, doc id = uid của người dùng. */
export interface SupportRoleAssignment {
  uid: string;
  campusId: string | null;
  supportRole: SupportRole;
  assignedBy: string;
  assignedAt?: Timestamp;
}

/** Lỗi nghiệp vụ có mã, để một ảnh chụp màn hình là đủ làm bug report. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

// ===========================================================================
// TICKET
// ===========================================================================

export const TICKET_COL = {
  tickets: 'support_tickets',
  /** Bản gương mỏng chỉ chứa trường phục vụ quét trùng. Xem ghi chú bên dưới. */
  ticketIndex: 'support_ticket_index',
  counters: 'support_counters',
} as const;

/** Trạng thái theo máy trạng thái §5. */
export type TicketStatus =
  | 'NEW'
  | 'TRIAGE'
  | 'NEEDS_INFO'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'PENDING_VERIFICATION'
  | 'REOPENED'
  | 'ON_HOLD'
  | 'CLOSED'
  | 'DUPLICATE'
  | 'REJECTED';

/** Trạng thái kết thúc, không chuyển đi đâu được nữa. */
export const TERMINAL_STATUSES: TicketStatus[] = ['CLOSED', 'DUPLICATE', 'REJECTED'];

/** Trạng thái làm đồng hồ SLA TẠM DỪNG (§7). */
export const SLA_PAUSED_STATUSES: TicketStatus[] = [
  'NEEDS_INFO',
  'ON_HOLD',
  'PENDING_VERIFICATION',
];

export type TicketType = 'BUG' | 'FEATURE_REQUEST';
export type TicketScope = 'CAMPUS_LOCAL' | 'SYSTEM_WIDE';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type ImpactScale = 'LT_10' | 'FROM_10_TO_100' | 'GT_100';

export interface Ticket {
  id: string;
  /** Dạng FSC-<MODULE>-<YYMM>-<seq>, duy nhất. */
  ticketNo: string;
  type: TicketType;
  moduleId: SupportModuleCode;
  subFeature: string;

  campusId: string;
  reporterUserId: string;
  campusContactUserId: string | null;

  title: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  occurredAt: number | null;
  hasWorkaround: boolean;
  impactScale: ImpactScale | null;

  /** §12: CHỈ mã học sinh / mã nhân viên. Không họ tên, không SĐT, không địa chỉ. */
  affectedUserRef: string;
  affectedUserRole: string;

  deviceOs: string;
  deviceBrowser: string;
  appVersion: string;
  networkNote: string;
  errorCode: string;
  logExcerpt: string;

  status: TicketStatus;
  scope: TicketScope;
  priority: TicketPriority | null;

  assigneeUserId: string | null;
  triagedBy: string | null;
  triagedAt: number | null;

  /**
   * Hạn hoàn thành. null = đã tiếp nhận nhưng CHƯA chốt được hạn.
   *
   * Không phải phiếu nào cũng biết hạn ngay lúc tiếp nhận: nhiều yêu cầu phải
   * họp hoặc phải chờ phân hệ khác mới ước lượng được. Lúc đó đầu mối để trống
   * hạn và chỉ khai estimateDays; hạn thật hình thành khi người xử lý chọn ngày
   * bắt đầu bên module Công việc, rồi được đồng bộ ngược về đây.
   */
  dueAt: number | null;
  /**
   * Số ngày làm việc dự kiến, khai ở bước tiếp nhận khi chưa chốt được hạn.
   * 0 nghĩa là không dùng tới (phiếu đã có hạn cụ thể).
   */
  estimateDays: number;
  slaPolicyId: string | null;
  firstResponseAt: number | null;
  resolvedAt: number | null;
  closedAt: number | null;

  duplicateOfTicketId: string | null;
  reopenCount: number;

  /**
   * Task được sinh ra trong module Công việc khi phiếu được tiếp nhận.
   *
   * Tiến độ KHÔNG được sao chép sang phiếu — màn chi tiết đọc thẳng task này.
   * Sao chép thì phải đồng bộ hai chiều, và mọi lỗi đồng bộ đều biểu hiện thành
   * "campus thấy tiến độ sai" mà không ai phát hiện ra.
   */
  linkedProjectId: string | null;
  linkedTaskId: string | null;

  /**
   * Lý do từ chối. §5 spec: REJECTED là trạng thái kết thúc và BẮT BUỘC có lý do.
   *
   * Bắt buộc vì phiếu bị từ chối mà không nói vì sao là cách nhanh nhất để campus
   * mất niềm tin vào cả hệ thống — họ bỏ công điền form rồi nhận về im lặng.
   */
  rejectionReason: string;
  /** Đầu mối cần trường bổ sung gì. Hiện cho người báo lỗi khi status=NEEDS_INFO. */
  needsInfoRequest: string;
  /** Ai là người hỏi thêm — để báo lại cho đúng họ khi trường bổ sung xong. */
  needsInfoBy?: string | null;

  /**
   * Đầu mối hỗ trợ tại trường cho phiếu này — người kỹ thuật viên sẽ liên hệ.
   *
   * Cố ý CHỈ họ tên và email FPT, không số điện thoại. Nghị định 13/2023 coi số
   * điện thoại là dữ liệu cá nhân cần cơ sở pháp lý để thu thập; email công vụ
   * @fpt.edu.vn đủ để liên hệ và ít nhạy cảm hơn.
   */
  contactName: string;
  contactEmail: string;

  /** Ảnh chụp lỗi. File nằm ở Firebase Storage, đây chỉ là metadata. */
  attachments: TicketAttachment[];

  /**
   * Mảng thay cho bảng ticket_affected_campus. Firestore không join được, nên
   * quan hệ nhiều-nhiều phải nằm ngay trên document để `array-contains` dùng
   * được — đó là thứ duy nhất cho phép rules kiểm tra "campus của tôi có nằm
   * trong danh sách bị ảnh hưởng không" mà không tốn lượt get().
   */
  affectedCampusIds: string[];
  watcherUids: string[];

  normalizedTitle: string;
  titleTokens: string[];
  bodyTokens: string[];

  /** Đồng hồ SLA, xem services/slaCalculator.ts. */
  slaStartedAt: number | null;
  slaElapsedWorkingMs: number;
  slaLastResumedAt: number | null;
  slaBreachNotifiedAt: number | null;

  createdAt: number;
  updatedAt: number;
}

/**
 * Một mục đính kèm — có thể là FILE đã tải lên, hoặc LINK tới tài liệu bên ngoài.
 *
 * Vì sao có cả link: tài liệu đề xuất tính năng thường đã nằm sẵn ở Google Docs,
 * Drive, hay Figma. Bắt người ta tải xuống rồi tải lên lại là tạo ra một bản sao
 * chết ngay lúc sinh ra — bản gốc sửa tiếp, bản đính kèm thì không.
 *
 * Dùng một interface có cờ `kind` thay vì union: Firestore lưu union kiểu
 * TypeScript rất tệ, và mọi nơi đọc đều phải kiểm tra kiểu bằng tay.
 */
export interface TicketAttachment {
  kind: 'file' | 'link';
  /** kind='file': đường dẫn trong bucket. kind='link': chuỗi rỗng. */
  path: string;
  /** kind='link': URL đầy đủ. kind='file': chuỗi rỗng. */
  url: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
}

/** Giới hạn upload theo §10 spec. */
export const ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxBytes: 10 * 1024 * 1024,
} as const;

/** Ảnh — dùng cho phiếu báo lỗi. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'];

/**
 * Tài liệu — chỉ mở thêm cho đề xuất tính năng.
 * Cố ý KHÔNG có zip/rar: không quét được nội dung bên trong, và không ai cần
 * nộp một kho nén để mô tả một tính năng.
 */
export const DOCUMENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

/**
 * Bản gương mỏng phục vụ quét trùng.
 *
 * Vì sao tồn tại: quét trùng phải đọc tới 200 ticket ứng viên mỗi lần gõ. Web
 * SDK của Firestore KHÔNG hỗ trợ select() để lấy vài trường, nên đọc từ
 * support_tickets là kéo về cả document đầy đủ — 200 ticket × ~4KB ≈ 800KB mỗi
 * lần, không thể dưới 1 giây trên wifi campus.
 *
 * Bản gương này ~300 byte/document, giảm băng thông khoảng 20 lần.
 */
export interface TicketIndexDoc {
  ticketNo: string;
  moduleId: SupportModuleCode;
  campusId: string;
  status: TicketStatus;
  /**
   * Tiêu đề NGUYÊN VĂN, còn dấu.
   *
   * Cảnh báo trùng phải cho người ta ĐỌC được phiếu đã có thì họ mới phán được
   * là trùng hay không. Trước đây panel chỉ có normalizedTitle — "dang nhap
   * duoc vao he thong diem danh" — không ai đọc mà tự tin kết luận nổi.
   *
   * Không làm lộ thêm gì: normalizedTitle vốn đã là chính tiêu đề đó, chỉ bỏ
   * dấu. Mô tả chi tiết CỐ Ý không đưa vào đây — bản gương ai cũng đọc được,
   * còn mô tả là chỗ dễ lẫn thông tin cá nhân nhất (§12).
   */
  title: string;
  type: TicketType;
  normalizedTitle: string;
  titleTokens: string[];
  bodyTokens: string[];
  createdAt: number;
}
