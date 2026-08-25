import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// §14 tiêu chí 8: "Campus A không truy vấn được ticket CAMPUS_LOCAL của campus B
// (có test tầng repository, không chỉ test UI)."
//
// Test này còn đi xa hơn yêu cầu: nó kiểm ở tầng RULES, không phải tầng
// repository. Test repository chỉ chứng minh code TypeScript lọc đúng — mà bộ
// lọc đó nằm trong trình duyệt và người dùng bỏ qua được bằng devtools.
// Chỉ rules mới là hàng rào thật.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-ticket-rules-test';
const ADMIN = 'admin-uid';
const USER_A = 'nguoi-truong-A';
const USER_B = 'nguoi-truong-B';
const DEV_PTUD = 'lap-trinh-vien';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, displayName: uid, email: `${uid}@fpt.edu.vn`,
    photoURL: '', role: 'user', status: 'active', ...over,
  };
}

function ticket(over: Record<string, unknown> = {}) {
  return {
    ticketNo: 'FSC-WEB_FSB-2608-0001',
    type: 'BUG',
    moduleId: 'WEB_FSB',
    campusId: 'HN01',
    reporterUserId: USER_A,
    title: 'Khong dang nhap duoc',
    status: 'TRIAGE',
    scope: 'CAMPUS_LOCAL',
    affectedCampusIds: ['HN01'],
    watcherUids: [USER_A],
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    await setDoc(doc(db, 'users', USER_A), profile(USER_A));
    await setDoc(doc(db, 'users', USER_B), profile(USER_B));
    await setDoc(doc(db, 'users', DEV_PTUD), profile(DEV_PTUD));

    await setDoc(doc(db, 'support_role_assignments', USER_A),
      { uid: USER_A, campusId: 'HN01', supportRole: 'CAMPUS_REPORTER', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', USER_B),
      { uid: USER_B, campusId: 'HCM01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', DEV_PTUD),
      { uid: DEV_PTUD, campusId: null, supportRole: 'DEVELOPER', assignedBy: ADMIN });

    // Ticket nội bộ của trường HN01
    await setDoc(doc(db, 'support_tickets', 't-hn01'), ticket());
    // Ticket nội bộ của trường HCM01
    await setDoc(doc(db, 'support_tickets', 't-hcm01'),
      ticket({ campusId: 'HCM01', reporterUserId: USER_B, affectedCampusIds: ['HCM01'] }));
    // Ticket toàn hệ thống, có ảnh hưởng HN01 nhưng KHÔNG ảnh hưởng HCM01
    await setDoc(doc(db, 'support_tickets', 't-system'),
      ticket({ scope: 'SYSTEM_WIDE', campusId: 'HN01', affectedCampusIds: ['HN01', 'DN01'] }));
  });
});

describe('§14 #8 — cách ly campus', () => {
  it('người trường A ĐỌC ĐƯỢC ticket của chính trường mình', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_tickets', 't-hn01')));
  });

  it('⭐ người trường A KHÔNG đọc được ticket CAMPUS_LOCAL của trường B', async () => {
    // Kể cả khi biết chính xác id document. Đây là tiêu chí nghiệm thu.
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(getDoc(doc(db, 'support_tickets', 't-hcm01')));
  });

  it('người trường A ĐỌC ĐƯỢC ticket SYSTEM_WIDE có ảnh hưởng trường mình', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_tickets', 't-system')));
  });

  it('người trường B KHÔNG đọc được ticket SYSTEM_WIDE không ảnh hưởng trường mình', async () => {
    // SYSTEM_WIDE không có nghĩa là ai cũng xem được — chỉ trường nằm trong
    // danh sách bị ảnh hưởng mới xem được (§3).
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(getDoc(doc(db, 'support_tickets', 't-system')));
  });

  it('người trường A KHÔNG liệt kê được toàn bộ ticket', async () => {
    // Firestore không lọc theo rules, nó TỪ CHỐI cả truy vấn. Truy vấn không
    // mang ràng buộc campus là bị chặn nguyên khối.
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(getDocs(collection(db, 'support_tickets')));
  });

  it('người trường A liệt kê được ticket có ràng buộc campus của mình', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, 'support_tickets'), where('campusId', '==', 'HN01')))
    );
  });

  it('người trường A KHÔNG lách được bằng cách hỏi campus của trường B', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      getDocs(query(collection(db, 'support_tickets'), where('campusId', '==', 'HCM01')))
    );
  });

  it('nhân sự PTUD đọc được toàn bộ ticket của mọi trường', async () => {
    const db = testEnv.authenticatedContext(DEV_PTUD).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_tickets', 't-hn01')));
    await assertSucceeds(getDoc(doc(db, 'support_tickets', 't-hcm01')));
    await assertSucceeds(getDocs(collection(db, 'support_tickets')));
  });
});

describe('tạo phiếu', () => {
  it('người dùng tạo được phiếu cho trường CỦA MÌNH', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(setDoc(doc(db, 'support_tickets', 'moi-1'), ticket()));
  });

  it('KHÔNG tạo được phiếu ma cho trường khác', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 'moi-2'), ticket({ campusId: 'HCM01' }))
    );
  });

  it('KHÔNG đứng tên người khác khi tạo phiếu', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 'moi-3'), ticket({ reporterUserId: USER_B }))
    );
  });

  it('KHÔNG tự đặt phiếu vào trạng thái đã duyệt để bỏ qua triage', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 'moi-4'), ticket({ status: 'ACCEPTED' }))
    );
  });

  it('KHÔNG tự khai số ngày dự kiến — đó là con số của bước tiếp nhận', async () => {
    // estimateDays là cam kết của đội kỹ thuật khi tiếp nhận mà chưa chốt được
    // hạn. Trường tự ghi được thì phiếu của họ hiện ra "dự kiến 1 ngày" như thể
    // đã có người hứa.
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 'moi-6'), ticket({ estimateDays: 1 }))
    );
  });

  it('KHÔNG tự đặt phiếu thành SYSTEM_WIDE để phát thông báo cho 18 trường', async () => {
    // Phạm vi do đầu mối phân hệ xác định ở bước triage (§2). Người báo lỗi tự
    // đặt được là tự bắn thông báo tới toàn hệ thống.
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 'moi-5'), ticket({ scope: 'SYSTEM_WIDE' }))
    );
  });
});

describe('sửa và xoá phiếu', () => {
  it('người báo lỗi KHÔNG tự sửa trạng thái phiếu của mình', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't-hn01'), { status: 'CLOSED' }));
  });

  it('người báo lỗi KHÔNG tự nâng độ ưu tiên', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't-hn01'), { priority: 'P1' }));
  });

  it('nhân sự PTUD triage được', async () => {
    const db = testEnv.authenticatedContext(DEV_PTUD).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), { status: 'ACCEPTED', priority: 'P2' })
    );
  });

  it('KHÔNG ai xoá được phiếu, kể cả admin', async () => {
    // Phiếu là bằng chứng vận hành. Đóng bằng trạng thái, không xoá.
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(deleteDoc(doc(db, 'support_tickets', 't-hn01')));
  });
});

describe('bản gương quét trùng', () => {
  it('đọc được XUYÊN TRƯỜNG — ngoại lệ có chủ đích của §6', async () => {
    // Nút "Trường tôi cũng gặp lỗi này" chỉ có nghĩa khi người dùng thấy được
    // phiếu của trường khác. Bản gương chỉ chứa tiêu đề đã chuẩn hoá và token,
    // không có mô tả, không có log, không có mã học sinh.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_ticket_index', 't-hcm01'), {
        ticketNo: 'FSC-WEB_FSB-2608-0002', moduleId: 'WEB_FSB', campusId: 'HCM01',
        status: 'TRIAGE', normalizedTitle: 'khong dang nhap duoc',
        titleTokens: ['dang', 'nhap', 'duoc'], bodyTokens: [], createdAt: 1_700_000_000_000,
      });
    });
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_ticket_index', 't-hcm01')));
  });

  it('client KHÔNG ghi được bản gương', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(setDoc(doc(db, 'support_ticket_index', 'gia-mao'), { ticketNo: 'x' }));
  });
});

describe('khoá mã phiếu', () => {
  it('tạo được mã mới', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'support_ticket_numbers', 'FSC-WEB_FSB-2608-0009'), { ticketId: 'x' })
    );
  });

  it('KHÔNG chiếm được mã của phiếu đã tồn tại', async () => {
    // Đây là thứ biến tính duy nhất của mã phiếu thành ràng buộc tầng dữ liệu.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_ticket_numbers', 'FSC-WEB_FSB-2608-0001'),
        { ticketId: 't-hn01' });
    });
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_ticket_numbers', 'FSC-WEB_FSB-2608-0001'), { ticketId: 'cuop' })
    );
  });
});

describe('"Trường tôi cũng gặp lỗi này" — ngoại lệ hẹp', () => {
  it('trường B thêm được CHÍNH trường mình vào phiếu của trường A', async () => {
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), {
        affectedCampusIds: ['HN01', 'HCM01'],
        watcherUids: [USER_A, USER_B],
        updatedAt: 1,
      })
    );
  });

  it('KHÔNG thêm được trường KHÁC vào danh sách', async () => {
    // Nếu lọt, một người có thể kéo trường bất kỳ vào phạm vi ảnh hưởng và
    // khiến họ nhận thông báo về sự cố không liên quan.
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), {
        affectedCampusIds: ['HN01', 'DN01'],
        watcherUids: [USER_A],
        updatedAt: 1,
      })
    );
  });

  it('KHÔNG xoá được trường đã có trong danh sách', async () => {
    // hasAll(cũ) chặn đúng chỗ này: nếu lọt thì một trường có thể tự gỡ trường
    // khác ra khỏi phạm vi ảnh hưởng và cắt thông báo của họ.
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), {
        affectedCampusIds: ['HCM01'],
        watcherUids: [USER_A, USER_B],
        updatedAt: 1,
      })
    );
  });

  it('KHÔNG lợi dụng đường này để đổi trạng thái phiếu', async () => {
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), {
        affectedCampusIds: ['HN01', 'HCM01'],
        watcherUids: [USER_A, USER_B],
        status: 'CLOSED',
        updatedAt: 1,
      })
    );
  });

  it('KHÔNG lợi dụng đường này để đổi phạm vi sang toàn hệ thống', async () => {
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), {
        affectedCampusIds: ['HN01', 'HCM01'],
        watcherUids: [USER_A, USER_B],
        scope: 'SYSTEM_WIDE',
        updatedAt: 1,
      })
    );
  });

  it('KHÔNG thêm người khác vào danh sách theo dõi', async () => {
    const db = testEnv.authenticatedContext(USER_B).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), {
        affectedCampusIds: ['HN01', 'HCM01'],
        watcherUids: [USER_A, DEV_PTUD],
        updatedAt: 1,
      })
    );
  });
});

describe('transaction tạo phiếu — TẤT CẢ lượt ghi phải qua được rules', () => {
  /**
   * Test này tồn tại vì một lỗi thật đã xảy ra.
   *
   * createTicket ghi vào BỐN collection trong một transaction:
   *   support_counters, support_ticket_numbers, support_tickets, support_ticket_index
   *
   * Rules cho support_ticket_index từng để `allow write: if false` vì tưởng bản
   * gương do máy chủ sinh. Ba lượt ghi kia đều hợp lệ, nên mọi test cũ vẫn xanh
   * — nhưng transaction là nguyên khối: một lượt bị từ chối là cả bốn hỏng.
   * Người dùng chỉ thấy "permission-denied" sau khi đã điền xong form, và không
   * có gì chỉ ra nguyên nhân nằm ở collection nào.
   *
   * Vì vậy test phải diễn ĐỦ BỐN lượt ghi trong một batch, không chỉ doc ticket.
   */
  it('người dùng trường ghi được đủ 4 document của một phiếu mới', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    const batch = writeBatch(db);
    const ticketNo = 'FSC-WEB_FSB-2608-0100';

    batch.set(doc(db, 'support_counters', 'WEB_FSB_2608'), { period: '2608', seq: 100 });
    batch.set(doc(db, 'support_ticket_numbers', ticketNo), { ticketId: 'moi-100', createdAt: 1 });
    batch.set(doc(db, 'support_tickets', 'moi-100'), ticket({ ticketNo }));
    batch.set(doc(db, 'support_ticket_index', 'moi-100'), {
      ticketNo, moduleId: 'WEB_FSB', campusId: 'HN01', status: 'TRIAGE',
      normalizedTitle: 'khong dang nhap duoc',
      titleTokens: ['dang', 'nhap', 'duoc'], bodyTokens: [], createdAt: 1,
    });

    await assertSucceeds(batch.commit());
  });

  it('KHÔNG ghi được bản gương mang mã trường khác', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      setDoc(doc(db, 'support_ticket_index', 'gia-mao'), {
        ticketNo: 'FSC-WEB_FSB-2608-0101', moduleId: 'WEB_FSB',
        campusId: 'HCM01', status: 'TRIAGE',
        normalizedTitle: 'x', titleTokens: [], bodyTokens: [], createdAt: 1,
      })
    );
  });

  it('KHÔNG sửa được bản gương đã tồn tại', async () => {
    // Đổi trạng thái trên bản gương là việc của phía PTUD khi triage.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_ticket_index', 'co-san'), {
        ticketNo: 'FSC-WEB_FSB-2608-0001', moduleId: 'WEB_FSB', campusId: 'HN01',
        status: 'TRIAGE', normalizedTitle: 'x', titleTokens: [], bodyTokens: [], createdAt: 1,
      });
    });
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(updateDoc(doc(db, 'support_ticket_index', 'co-san'), { status: 'CLOSED' }));
  });
});

describe('sửa phiếu khi CHƯA được tiếp nhận', () => {
  const CONTENT = {
    title: 'Khong dang nhap duoc - da bo sung them',
    description: 'Them chi tiet',
    normalizedTitle: 'khong dang nhap duoc da bo sung them',
    titleTokens: ['dang', 'nhap', 'duoc'],
    bodyTokens: ['chi', 'tiet'],
    updatedAt: 2,
  };

  it('trường sửa được nội dung phiếu TRIAGE của mình', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(updateDoc(doc(db, 'support_tickets', 't-hn01'), CONTENT));
  });

  it('trường sửa được cả phiếu NEEDS_INFO — đó là lúc họ ĐƯỢC yêu cầu bổ sung', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_tickets', 't-need'),
        ticket({ status: 'NEEDS_INFO' }));
    });
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(updateDoc(doc(db, 'support_tickets', 't-need'), CONTENT));
  });

  it('⭐ KHÔNG sửa được sau khi phiếu ĐÃ TIẾP NHẬN', async () => {
    // Từ ACCEPTED trở đi, kỹ thuật viên đã đọc và làm theo nội dung cũ.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_tickets', 't-accepted'),
        ticket({ status: 'ACCEPTED', priority: 'P2' }));
    });
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't-accepted'), CONTENT));
  });

  it('KHÔNG sửa được phiếu đang xử lý hay đã đóng', async () => {
    for (const [id, status] of [['t-prog', 'IN_PROGRESS'], ['t-closed', 'CLOSED']]) {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), 'support_tickets', id), ticket({ status }));
      });
      const db = testEnv.authenticatedContext(USER_A).firestore();
      await assertFails(updateDoc(doc(db, 'support_tickets', id), CONTENT));
    }
  });

  it('KHÔNG sửa được phiếu của trường KHÁC dù nó đang TRIAGE', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't-hcm01'), CONTENT));
  });

  it('KHÔNG lợi dụng đường sửa để đổi trạng thái', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), { ...CONTENT, status: 'CLOSED' })
    );
  });

  it('KHÔNG lợi dụng đường sửa để tự nâng độ ưu tiên hay tự gán người xử lý', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), { ...CONTENT, priority: 'P1' })
    );
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), { ...CONTENT, assigneeUserId: USER_A })
    );
  });

  it('KHÔNG lợi dụng đường sửa để đổi hạn xử lý', async () => {
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_tickets', 't-hn01'), { ...CONTENT, dueAt: 9_999_999_999_999 })
    );
  });

  it('bản gương được đồng bộ token cùng lúc sửa nội dung', async () => {
    // Không mở rule này thì sửa tiêu đề xong, quét trùng vẫn so theo tiêu đề CŨ.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_ticket_index', 't-hn01'), {
        ticketNo: 'FSC-WEB_FSB-2608-0001', moduleId: 'WEB_FSB', campusId: 'HN01',
        status: 'TRIAGE', normalizedTitle: 'cu', titleTokens: [], bodyTokens: [], createdAt: 1,
      });
    });
    const db = testEnv.authenticatedContext(USER_A).firestore();
    await assertSucceeds(updateDoc(doc(db, 'support_ticket_index', 't-hn01'), {
      normalizedTitle: 'moi', titleTokens: ['moi'], bodyTokens: [],
    }));
  });
});
