// ===========================================================================
// Toàn bộ chuỗi hiển thị của module hỗ trợ.
// Tách ra file riêng theo §12 spec để sau này thêm tiếng Anh chỉ cần thêm en.ts.
// Đừng hardcode chuỗi tiếng Việt trong JSX của module này.
// ===========================================================================

export const vi = {
  common: {
    save: 'Lưu',
    cancel: 'Huỷ',
    add: 'Thêm',
    edit: 'Sửa',
    search: 'Tìm kiếm',
    active: 'Đang hoạt động',
    inactive: 'Đã tắt',
    loading: 'Đang tải…',
    required: 'Bắt buộc nhập',
  },

  campus: {
    title: 'Quản lý trường',
    subtitle: 'Danh sách các trường được phép gửi yêu cầu hỗ trợ',
    addNew: 'Thêm trường',
    code: 'Mã trường',
    codeHint: 'Viết hoa, không dấu, không khoảng trắng. Ví dụ: HN01',
    name: 'Tên trường',
    nameHint: 'Ví dụ: FPT Schools Hà Nội',
    region: 'Khu vực',
    status: 'Trạng thái',
    empty: 'Chưa có trường nào',
    emptyHint: 'Thêm trường đầu tiên để bắt đầu duyệt tài khoản và nhận yêu cầu hỗ trợ.',
    deactivate: 'Tắt trường',
    activate: 'Bật lại',
    deactivateHint: 'Trường đã tắt sẽ không nhận yêu cầu mới. Dữ liệu cũ giữ nguyên.',
    errors: {
      codeRequired: 'Chưa nhập mã trường',
      codeFormat: 'Mã trường chỉ gồm chữ in hoa, số và dấu gạch dưới',
      codeDuplicate: 'Mã trường này đã tồn tại',
      nameRequired: 'Chưa nhập tên trường',
    },
  },

  approval: {
    title: 'Duyệt tài khoản',
    subtitle: 'Tài khoản mới phải được duyệt và gán trường mới truy cập được hệ thống',
    pendingCount: (n: number) => `${n} tài khoản đang chờ duyệt`,
    empty: 'Không có tài khoản nào chờ duyệt',
    emptyHint: 'Tài khoản mới đăng nhập lần đầu sẽ xuất hiện ở đây.',
    assignCampus: 'Gán vào trường',
    assignRole: 'Vai trò trong hệ thống hỗ trợ',
    approve: 'Duyệt và cho truy cập',
    reject: 'Từ chối',
    approved: 'Đã duyệt',
    signedUpAt: 'Đăng nhập lần đầu',
    noCampusYet: 'Chưa có trường nào — tạo trường trước khi duyệt tài khoản',
    errors: {
      campusRequired: 'Vai trò này bắt buộc phải chọn trường',
      roleRequired: 'Chưa chọn vai trò',
    },
    confirmReject: (name: string) =>
      `Từ chối tài khoản "${name}"? Người này sẽ không truy cập được hệ thống.`,
  },

  gate: {
    title: 'Tài khoản đang chờ duyệt',
    body: 'Tài khoản của bạn đã đăng nhập thành công nhưng chưa được quản trị viên duyệt và gán vào trường. Trong lúc chờ, bạn chưa xem được dữ liệu nào.',
    whatNext: 'Việc cần làm',
    step1: 'Liên hệ quản trị viên hệ thống để được duyệt.',
    step2: 'Sau khi được duyệt, tải lại trang là vào được ngay.',
    reload: 'Tải lại trang',
    signOut: 'Đăng xuất',
    rejected: 'Tài khoản đã bị từ chối truy cập',
    rejectedBody: 'Quản trị viên đã từ chối tài khoản này. Nếu bạn cho rằng đây là nhầm lẫn, liên hệ quản trị viên hệ thống.',
  },

  roles: {
    CAMPUS_REPORTER: 'Người báo lỗi tại trường',
    CAMPUS_FOCAL: 'Đầu mối tiếp nhận tại trường',
    MODULE_OWNER: 'Đầu mối phân hệ',
    DEVELOPER: 'Lập trình viên',
    PTUD_MANAGER: 'Quản lý PTUD',
    SYS_ADMIN: 'Quản trị hệ thống',
  } satisfies Record<string, string>,

  roleHints: {
    CAMPUS_REPORTER: 'Gửi yêu cầu hỗ trợ cho trường mình, xem yêu cầu của trường mình',
    CAMPUS_FOCAL: 'Như trên, cộng thêm nhận thông báo tiến độ và xác nhận nghiệm thu',
    MODULE_OWNER: 'Phân loại yêu cầu thuộc phân hệ mình phụ trách, gán người xử lý',
    DEVELOPER: 'Cập nhật trạng thái các yêu cầu được giao',
    PTUD_MANAGER: 'Xem toàn bộ, điều chỉnh hạn xử lý, xem báo cáo tồn đọng',
    SYS_ADMIN: 'Cấu hình trường, phân hệ, đầu mối, ma trận SLA',
  } satisfies Record<string, string>,

  ticket: {
    newTitle: 'Báo lỗi / Đề xuất',
    newSubtitle: 'Điền 3 ô bắt buộc là gửi được. Phần còn lại giúp xử lý nhanh hơn.',
    module: 'Phân hệ gặp vấn đề',
    type: 'Loại yêu cầu',
    typeBug: 'Báo lỗi',
    typeFeature: 'Đề xuất tính năng',
    title: 'Chuyện gì xảy ra?',
    titlePlaceholder: 'Ví dụ: Không điểm danh được lớp 3A',
    titleHint: 'Viết như đang nhắn cho đồng nghiệp. Có dấu hay không dấu đều được.',
    moreDetails: 'Thêm chi tiết (không bắt buộc)',
    description: 'Mô tả kỹ hơn',
    steps: 'Bạn đã bấm những gì trước khi gặp lỗi',
    expected: 'Đáng lẽ phải ra gì',
    actual: 'Thực tế ra gì',
    impact: 'Bao nhiêu người bị ảnh hưởng',
    impactLt10: 'Dưới 10 người',
    impact10to100: '10 đến 100 người',
    impactGt100: 'Trên 100 người',
    workaround: 'Đã có cách làm tạm thay thế',
    affectedUserRef: 'Mã học sinh / mã nhân viên bị ảnh hưởng',
    affectedUserRefHint: 'CHỈ nhập mã. Không nhập họ tên, số điện thoại hay địa chỉ (Nghị định 13/2023).',
    errorCode: 'Mã lỗi hiện trên màn hình',
    deviceAuto: 'Thông tin thiết bị được điền tự động',
    submit: 'Gửi phiếu',
    submitting: 'Đang gửi…',
    draftRestored: 'Đã khôi phục nội dung bạn gõ dở lần trước',
    draftDiscard: 'Bỏ nháp',
    successTitle: 'Đã gửi phiếu',
    successNo: 'Mã phiếu của bạn',
    successRouted: 'Phiếu đã được chuyển tới đầu mối phân hệ',
    successLink: 'Sao chép link phiếu',
    successAnother: 'Gửi phiếu khác',
    meTooDone: 'Đã ghi nhận trường bạn cũng gặp lỗi này',
    errors: {
      moduleRequired: 'Chưa chọn phân hệ',
      titleTooShort: 'Tiêu đề cần ít nhất 10 ký tự',
      noCampus: 'Tài khoản của bạn chưa được gán vào trường nào',
    },
  },

  list: {
    title: 'Phiếu của trường',
    empty: 'Trường bạn chưa gửi phiếu nào',
    emptyHint: 'Bấm "Báo lỗi" để gửi phiếu đầu tiên.',
    systemWideBanner: (n: number) => `${n} sự cố toàn hệ thống đang ảnh hưởng trường bạn`,
    due: 'Hạn xử lý',
    overdue: 'Quá hạn',
    noDue: 'Chưa có hạn',
  },

  status: {
    NEW: 'Mới', TRIAGE: 'Chờ phân loại', NEEDS_INFO: 'Cần bổ sung thông tin',
    ACCEPTED: 'Đã tiếp nhận', IN_PROGRESS: 'Đang xử lý', RESOLVED: 'Đã khắc phục',
    PENDING_VERIFICATION: 'Chờ trường xác nhận', REOPENED: 'Mở lại', ON_HOLD: 'Tạm dừng',
    CLOSED: 'Đã đóng', DUPLICATE: 'Trùng phiếu khác', REJECTED: 'Từ chối',
  } satisfies Record<string, string>,

  errors: {
    permissionDenied: 'Bạn không có quyền xem dữ liệu này',
    // Không nhắc tới "trường": cán bộ PTUD không thuộc trường nào, và câu đó
    // khiến họ đi tìm sai chỗ khi gặp lỗi phân quyền.
    permissionDeniedHint:
      'Đây là lỗi phân quyền, không phải không có dữ liệu. Liên hệ quản trị viên nếu bạn cho rằng mình phải xem được.',
    loadFailed: 'Không tải được dữ liệu',
    saveFailed: 'Không lưu được. Thử lại sau ít phút.',
  },
} as const;
