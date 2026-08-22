// ===========================================================================
// 18 điểm trường của Hệ thống Phổ thông FPT (FSchools).
//
// Nguồn: FSchools_Thong-ke-diem-truong_20260822.xlsx do chủ hệ thống cung cấp,
// tổng hợp từ ba Quyết định của Công ty TNHH Giáo dục FPT (QĐ 83/2023,
// QĐ 127/2025, QĐ 405/2026) và website chính thức.
//
// SINH RA TỪ FILE, KHÔNG GÕ TAY. Sửa dữ liệu thì sửa file nguồn rồi tạo lại,
// đừng sửa trực tiếp ở đây — sửa tay là hai bản lệch nhau ngay lần sau.
//
// MỘT SAI KHÁC CÓ CHỦ ĐÍCH so với file gốc:
//   Mã FHH được cấp CHUNG cho "Fschool ĐN 1-2" và "Fschool ĐN 3" (ghi rõ trong
//   file). Nhưng mã trường ở đây là doc id trong Firestore nên buộc phải duy
//   nhất. Nên ĐN 3 mang mã FHH3, và cả hai giữ mã chính thức FHH ở trường
//   officialCode. Nếu muốn gộp hai cơ sở này làm một thì xoá bớt một dòng.
//
// Hai cơ sở FBT (Tây Hà Nội) và FTH (Thanh Hóa) trong file có ghi chú
// "CẦN RÀ SOÁT: chưa thấy mã cơ sở trong 3 QĐ". Chủ hệ thống đã XÁC NHẬN
// (22/08/2026): hai mã này do chính họ bổ sung tay, lấy theo file là chuẩn.
// ===========================================================================

export interface CampusSeed {
  /** Mã trường, dùng làm doc id. Duy nhất. */
  code: string;
  /** Mã cơ sở theo Quyết định. FHH và FHH3 cùng mang giá trị 'FHH'. */
  officialCode: string;
  name: string;
  decisionName: string;
  levels: string;
  address: string;
  province: string;
  region: string;
  note: string;
}

export const FSCHOOLS_CAMPUSES: CampusSeed[] = [
  {
    code: "FHL",
    officialCode: "FHL",
    name: "Trường THPT FPT Hà Nội (Hòa Lạc)",
    decisionName: "Fschool Hòa Lạc",
    levels: "THPT",
    address: "Khuôn viên Trường Đại học FPT, Khu CNC Hòa Lạc, Km29 Đại lộ Thăng Long, Xã Hòa Lạc",
    province: "Hà Nội",
    region: "Miền Bắc",
    note: "Trụ sở chính FPT Schools",
  },
  {
    code: "FCG",
    officialCode: "FCG",
    name: "Trường Tiểu học và THCS FPT Cầu Giấy",
    decisionName: "Fschool Cầu Giấy",
    levels: "TH, THCS",
    address: "Số 15 Đông Quan, Phường Nghĩa Đô",
    province: "Hà Nội",
    region: "Miền Bắc",
    note: "",
  },
  {
    code: "FHP",
    officialCode: "FHP",
    name: "Trường THCS và THPT FPT Hải Phòng",
    decisionName: "Fschool Hải Phòng",
    levels: "THCS, THPT",
    address: "Khu tái định cư Đằng Lâm 1, Phường Hải An",
    province: "Hải Phòng",
    region: "Miền Bắc",
    note: "",
  },
  {
    code: "FBN",
    officialCode: "FBN",
    name: "Trường Tiểu học, THCS và THPT FPT Bắc Ninh",
    decisionName: "Fschool Bắc Ninh",
    levels: "TH, THCS, THPT",
    address: "Lô CC1, Đường Nguyễn Thị Minh Khai, Phường Kinh Bắc",
    province: "Bắc Ninh",
    region: "Miền Bắc",
    note: "",
  },
  {
    code: "FHN",
    officialCode: "FHN",
    name: "Trường Tiểu học, THCS và THPT FPT Hà Nam",
    decisionName: "Fschool Hà Nam",
    levels: "TH, THCS, THPT",
    address: "Khu Đại học Nam Cao, Phường Hà Nam",
    province: "Ninh Bình",
    region: "Miền Bắc",
    note: "Hà Nam sáp nhập vào Ninh Bình (2025)",
  },
  {
    code: "FBG",
    officialCode: "FBG",
    name: "Trường Tiểu học, THCS và THPT FPT Bắc Giang",
    decisionName: "Fschool Bắc Giang",
    levels: "TH, THCS, THPT",
    address: "Đường Nguyễn Văn Linh, Khu đô thị phía Nam, Phường Bắc Giang",
    province: "Bắc Ninh",
    region: "Miền Bắc",
    note: "Bắc Giang sáp nhập vào Bắc Ninh (2025)",
  },
  {
    code: "FHH",
    officialCode: "FHH",
    name: "Trường Tiểu học và THCS FPT Đà Nẵng",
    decisionName: "Fschool ĐN 1-2",
    levels: "TH, THCS",
    address: "Tòa nhà Epsilon, Khu đất A3-1, Khu đô thị FPT, Phường Ngũ Hành Sơn",
    province: "Đà Nẵng",
    region: "Miền Trung",
    note: "Dùng chung mã FHH với ĐN 3",
  },
  {
    code: "FHH3",
    officialCode: "FHH",
    name: "Trường THPT FPT Đà Nẵng",
    decisionName: "Fschool ĐN 3",
    levels: "THPT",
    address: "Khu đô thị FPT, Phường Ngũ Hành Sơn",
    province: "Đà Nẵng",
    region: "Miền Trung",
    note: "Dùng chung mã FHH với ĐN 1-2",
  },
  {
    code: "FVI",
    officialCode: "FVI",
    name: "Trường Tiểu học, THCS và THPT FPT Vinh",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Vinh",
    levels: "TH, THCS, THPT",
    address: "Phân khu The Garden, Khu đô thị Eco Central Park, Phường Trường Vinh",
    province: "Nghệ An",
    region: "Miền Trung",
    note: "",
  },
  {
    code: "FHU",
    officialCode: "FHU",
    name: "Trường Tiểu học, THCS và THPT FPT Huế",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Huế",
    levels: "TH, THCS, THPT",
    address: "Lô TH 12, Khu đô thị mới An Vân Dương, Phường Thanh Thủy",
    province: "Huế",
    region: "Miền Trung",
    note: "",
  },
  {
    code: "FLV",
    officialCode: "FLV",
    name: "Trường Tiểu học, THCS và THPT FPT Long Vân",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Long Vân",
    levels: "TH, THCS, THPT",
    address: "Trung tâm Trí tuệ nhân tạo – Đô thị Phụ trợ, Phường Quy Nhơn Tây",
    province: "Gia Lai",
    region: "Miền Nam",
    note: "Bình Định sáp nhập vào Gia Lai (2025). Website xếp Miền Nam",
  },
  {
    code: "FQN",
    officialCode: "FQN",
    name: "Trường THPT FPT Quy Nhơn (Quy Nhơn 3)",
    decisionName: "Fschool Quy Nhơn",
    levels: "THPT",
    address: "Khu đô thị An Phú Thịnh, Phường Quy Nhơn Đông",
    province: "Gia Lai",
    region: "Miền Nam",
    note: "Bình Định sáp nhập vào Gia Lai (2025). Website xếp Miền Nam",
  },
  {
    code: "FCT",
    officialCode: "FCT",
    name: "Trường THPT FPT Cần Thơ",
    decisionName: "Fschool Cần Thơ",
    levels: "THPT",
    address: "Số 600 Nguyễn Văn Cừ, Phường An Bình",
    province: "Cần Thơ",
    region: "Miền Nam",
    note: "",
  },
  {
    code: "FHG",
    officialCode: "FHG",
    name: "Trường Tiểu học, THCS và THPT FPT Hậu Giang",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Hậu Giang",
    levels: "TH, THCS, THPT",
    address: "QL61A, ấp 7A, Xã Vị Thủy",
    province: "Cần Thơ",
    region: "Miền Nam",
    note: "Hậu Giang sáp nhập vào Cần Thơ (2025)",
  },
  {
    code: "FST",
    officialCode: "FST",
    name: "Trường Tiểu học, THCS và THPT FPT Sóc Trăng",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Sóc Trăng",
    levels: "TH, THCS, THPT",
    address: "Đường số 6, KĐT 5A, Phường Phú Lợi",
    province: "Cần Thơ",
    region: "Miền Nam",
    note: "Sóc Trăng sáp nhập vào Cần Thơ (2025)",
  },
  {
    code: "FLA",
    officialCode: "FLA",
    name: "Trường TH, THCS và THPT FPT Long An (Millennia Nam Sài Gòn)",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Long An",
    levels: "TH, THCS, THPT",
    address: "Đường Thái Sơn 1, Khu đô thị T&T City Millennia, Phường Long Hậu",
    province: "Tây Ninh",
    region: "Miền Nam",
    note: "Long An sáp nhập vào Tây Ninh (2025). Cơ sở thứ 18",
  },
  {
    code: "FBT",
    officialCode: "FBT",
    name: "Trường THPT FPT Tây Hà Nội",
    decisionName: "Trường THPT FPT Tây Hà Nội",
    levels: "THPT",
    address: "Tổ dân phố 12, Phố Kiều Mai, Phường Xuân Phương",
    province: "Hà Nội",
    region: "Miền Bắc",
    note: "CẦN RÀ SOÁT: chưa thấy mã cơ sở trong 3 QĐ",
  },
  {
    code: "FTH",
    officialCode: "FTH",
    name: "Trường Tiểu học, THCS và THPT FPT Thanh Hóa",
    decisionName: "Trường Tiểu học, THCS và THPT FPT Thanh Hóa",
    levels: "TH, THCS, THPT",
    address: "Đường Trịnh Kiểm, Phường Hạc Thành",
    province: "Thanh Hóa",
    region: "Miền Trung",
    note: "CẦN RÀ SOÁT: chưa thấy mã cơ sở trong 3 QĐ",
  },
];
