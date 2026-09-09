import {
  AlertTriangle, CheckCircle2, ChevronDown, ClipboardCopy, Clock, Loader2, Mail, Send, ShieldCheck,
  StopCircle, Users,
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, StateBlock } from '../../../../components/ui';
import { useGmailAuth } from '../../hooks/useGmailAuth';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import {
  capNhatTienDo,
  createAnnouncement,
  fetchDeliveries,
  ghiTrangThaiGui,
  watchAnnouncements,
  watchEmailTemplates,
  watchNotifyGroups,
} from '../../repository/notifyRepository';
import { guiHangLoat, trangThaiSauKhiGui } from '../../services/announcementSender';
import { gopNguoiNhan } from '../../services/emailList';
import { dienMau } from '../../services/emailTemplate';
import { guiMotThu } from '../../services/gmailSend';
import { ICON } from '../../ui/tokens';
import {
  DomainError,
  type Announcement,
  type EmailTemplate,
  type NotifyGroup,
  type NotifyRecipient,
} from '../../types';

// ===========================================================================
// Soạn và gửi một thông báo, cộng lịch sử các lần đã gửi.
//
// Gộp hai thứ vào một màn là CỐ Ý: việc thường gặp nhất sau khi gửi hỏng giữa
// chừng là gửi tiếp cho những người chưa nhận, và nút đó phải nằm ngay cạnh chỗ
// vừa gửi chứ không phải trong một tab khác.
//
// Thư đi từ trình duyệt này, bằng hộp thư của chính người đang đăng nhập. Nghĩa
// là tab phải mở suốt lượt gửi — điều đó được nói thẳng trên màn hình, không
// giấu trong tài liệu. Đóng tab giữa chừng KHÔNG mất dữ liệu: ai đã nhận đã
// được ghi lại, và lượt sau chỉ gửi cho người còn PENDING.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

const O_NHAP =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

interface TienDo {
  announcementId: string;
  sent: number;
  failed: number;
  total: number;
  dangChay: boolean;
  lyDoDung: string | null;
}

export function AnnouncementCenter({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  const gmail = useGmailAuth();

  const [groups, setGroups] = useState<NotifyGroup[] | null>(null);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [history, setHistory] = useState<Announcement[] | null>(null);
  const [loadError, setLoadError] = useState<RepoError | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [daChon, setDaChon] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [tienDo, setTienDo] = useState<TienDo | null>(null);
  const [moRong, setMoRong] = useState<string | null>(null);

  // Ref chứ không phải state: vòng gửi đọc giá trị này giữa hai thư, mà state
  // trong một closure đang chạy thì đứng yên ở giá trị lúc bắt đầu.
  const yeuCauDung = useRef(false);

  useEffect(() => {
    const stopG = watchNotifyGroups(
      (r) => { setGroups(r); setLoadError(null); },
      (e) => { setGroups([]); setLoadError(e); }
    );
    const stopT = watchEmailTemplates((r) => setTemplates(r), () => setTemplates([]));
    const stopH = watchAnnouncements((r) => setHistory(r), () => setHistory([]));
    return () => { stopG(); stopT(); stopH(); };
  }, []);

  const nhomDangBat = useMemo(() => (groups ?? []).filter((g) => g.isActive !== false), [groups]);

  /** Người nhận sau khi gộp mọi nhóm đã chọn và bỏ trùng. */
  const nguoiNhan: NotifyRecipient[] = useMemo(
    () =>
      gopNguoiNhan(
        daChon
          .map((id) => nhomDangBat.find((g) => g.id === id)?.recipients ?? [])
      ),
    [daChon, nhomDangBat]
  );

  function chonMau(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
    onToast(vi.notify.compose.templateApplied, 'info');
  }

  function doiNhom(id: string) {
    setDaChon((cu) => (cu.includes(id) ? cu.filter((x) => x !== id) : [...cu, id]));
    setFormError(null);
  }

  /**
   * Vòng gửi thật.
   *
   * `base` là số đã gửi/hỏng từ những lượt TRƯỚC của cùng thông báo này, để lần
   * gửi tiếp cộng dồn thay vì đếm lại từ 0 và làm lịch sử nói dối.
   */
  async function chay(
    ann: { id: string; subject: string; body: string; total: number },
    danhSach: NotifyRecipient[],
    base: { sent: number; failed: number }
  ) {
    const token = gmail.layToken();
    if (!token) {
      setFormError(vi.notify.compose.needGmail);
      return;
    }
    yeuCauDung.current = false;
    setTienDo({
      announcementId: ann.id,
      sent: base.sent,
      failed: base.failed,
      total: ann.total,
      dangChay: true,
      lyDoDung: null,
    });

    const ket = await guiHangLoat({
      recipients: danhSach,
      gui: (r) =>
        guiMotThu(token, {
          from: { email: gmail.senderEmail, name: gmail.senderName },
          to: r,
          subject: dienMau(ann.subject, { recipient: r, senderName: gmail.senderName || gmail.senderEmail }),
          body: dienMau(ann.body, { recipient: r, senderName: gmail.senderName || gmail.senderEmail }),
        }),
      ghi: (lo) => ghiTrangThaiGui(ann.id, lo),
      onTien: (s, f) =>
        setTienDo((t) => (t ? { ...t, sent: base.sent + s, failed: base.failed + f } : t)),
      nenDung: () => yeuCauDung.current,
    });

    const sent = base.sent + ket.sent;
    const failed = base.failed + ket.failed;
    const trangThai = trangThaiSauKhiGui({
      total: ann.total, sent, failed, dungGiuaChung: ket.dungGiuaChung,
    });
    await capNhatTienDo(ann.id, {
      sentCount: sent,
      failedCount: failed,
      status: trangThai,
      xong: trangThai !== 'SENDING',
    });
    setTienDo({
      announcementId: ann.id,
      sent, failed, total: ann.total,
      dangChay: false,
      lyDoDung: ket.lyDoDung,
    });
    onToast(vi.notify.compose.done(ket.sent, ket.failed), ket.failed > 0 ? 'info' : 'success');
  }

  async function batDauGui() {
    setFormError(null);
    if (!subject.trim()) return setFormError(vi.notify.compose.needSubject);
    if (!body.trim()) return setFormError(vi.notify.compose.needBody);
    if (daChon.length === 0) return setFormError(vi.notify.compose.needGroup);
    if (!gmail.daKetNoi) return setFormError(vi.notify.compose.needGmail);
    if (nguoiNhan.length === 0) return setFormError(vi.notify.compose.needGroup);

    // Hỏi lại bằng SỐ NGƯỜI và TÊN HỘP THƯ. Một hộp thoại "bạn có chắc không"
    // trống rỗng thì ai cũng bấm OK theo phản xạ.
    if (!window.confirm(vi.notify.compose.confirmSend(nguoiNhan.length, gmail.senderEmail))) return;

    try {
      const id = await createAnnouncement({
        subject, body,
        templateId: templateId || null,
        templateName: templates.find((t) => t.id === templateId)?.name ?? '',
        groupIds: daChon,
        groupNames: daChon.map((g) => nhomDangBat.find((x) => x.id === g)?.name ?? g),
        recipients: nguoiNhan,
        senderEmail: gmail.senderEmail,
        createdBy: actorUid,
        createdByName: gmail.senderName || gmail.senderEmail,
      });
      await chay({ id, subject, body, total: nguoiNhan.length }, nguoiNhan, { sent: 0, failed: 0 });
    } catch (err: any) {
      setFormError(
        err instanceof DomainError ? err.message : `${vi.errors.saveFailed} (${err?.code ?? 'lỗi'})`
      );
    }
  }

  /** Gửi tiếp cho những người còn PENDING của một lần gửi dở. */
  async function guiTiep(a: Announcement) {
    setFormError(null);
    if (!gmail.daKetNoi) return setFormError(vi.notify.compose.needGmail);
    try {
      const tatCa = await fetchDeliveries(a.id);
      const conLai = tatCa.filter((d) => d.status === 'PENDING');
      if (conLai.length === 0) {
        onToast('Không còn ai chưa nhận', 'info');
        return;
      }
      await chay(
        { id: a.id, subject: a.subject, body: a.body, total: a.total },
        conLai.map((d) => ({ email: d.email, name: d.name })),
        { sent: a.sentCount, failed: a.failedCount }
      );
    } catch (err: any) {
      setFormError(`${vi.errors.loadFailed} (${err?.code ?? 'lỗi'})`);
    }
  }

  const nguoiXemTruoc = nguoiNhan[0];
  const dangGui = !!tienDo?.dangChay;

  // Tên người gửi lùi về địa chỉ email khi tài khoản Google không có tên hiển
  // thị. Thiếu bước này thì mẫu kết bằng "{{nguoigui}}" gửi đi với một DÒNG KÝ
  // TÊN TRỐNG — thư trông như chưa soạn xong, và không ai thấy trước lúc gửi.
  const tenNguoiGui = gmail.senderName || gmail.senderEmail;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{vi.notify.compose.title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{vi.notify.compose.subtitle}</p>
      </div>

      <Card className="space-y-4 p-5">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">{vi.notify.compose.useTemplate}</span>
          <select
            value={templateId}
            onChange={(e) => chonMau(e.target.value)}
            disabled={dangGui}
            className={O_NHAP}
          >
            <option value="">{vi.notify.compose.noTemplate}</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">{vi.notify.template.subject}</span>
          <input value={subject} disabled={dangGui} onChange={(e) => setSubject(e.target.value)} className={O_NHAP} />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">{vi.notify.template.body}</span>
          <textarea
            value={body}
            disabled={dangGui}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            className={`${O_NHAP} text-[13px]`}
          />
        </label>

        <div>
          <span className="text-[11px] font-semibold text-slate-600">{vi.notify.compose.pickGroups}</span>
          {groups === null ? (
            <StateBlock kind="loading" />
          ) : loadError ? (
            <StateBlock
              kind={loadError.kind === 'denied' ? 'denied' : 'error'}
              description={loadError.kind === 'denied' ? vi.errors.permissionDeniedHint : loadError.message}
            />
          ) : nhomDangBat.length === 0 ? (
            <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {vi.notify.group.emptyHint}
            </p>
          ) : (
            <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
              {nhomDangBat.map((g) => (
                <label
                  key={g.id}
                  className={
                    daChon.includes(g.id)
                      ? 'flex cursor-pointer items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2'
                      : 'flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50'
                  }
                >
                  <input
                    type="checkbox"
                    checked={daChon.includes(g.id)}
                    disabled={dangGui}
                    onChange={() => doiNhom(g.id)}
                    className="h-4 w-4 shrink-0 accent-indigo-600"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{g.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{g.recipients?.length ?? 0}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <Users size={ICON.md} className="text-slate-400" />
            {daChon.length === 0
              ? vi.notify.compose.noGroupPicked
              : vi.notify.compose.totalRecipients(nguoiNhan.length)}
          </p>
        </div>

        {/* Xem trước THẬT: đúng nội dung người đầu tiên trong danh sách sẽ nhận,
            chỗ điền đã thay bằng giá trị của chính họ. */}
        {nguoiXemTruoc && (subject || body) && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {vi.notify.compose.previewFor(nguoiXemTruoc.email)}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {dienMau(subject, { recipient: nguoiXemTruoc, senderName: tenNguoiGui })}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-600">
              {dienMau(body, { recipient: nguoiXemTruoc, senderName: tenNguoiGui })}
            </p>
          </div>
        )}

        {/* Kết nối Gmail. Xin quyền đúng lúc cần, không phải lúc đăng nhập. */}
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck size={ICON.lg} className={gmail.daKetNoi ? 'text-emerald-500' : 'text-slate-300'} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800">
                {vi.notify.compose.sender}: {gmail.senderEmail || '—'}
              </p>
              <p className="text-xs text-slate-500">
                {gmail.daKetNoi ? vi.notify.compose.connected : vi.notify.compose.connectHint}
              </p>
            </div>
            {!gmail.daKetNoi && (
              <Button size="sm" variant="outline" disabled={gmail.dangKetNoi} onClick={() => void gmail.ketNoi()}>
                <Mail size={ICON.md} />
                {gmail.dangKetNoi ? vi.notify.compose.connecting : vi.notify.compose.connectGmail}
              </Button>
            )}
          </div>
          {gmail.loi && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{gmail.loi}</p>
          )}
        </div>

        {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>}

        {tienDo && (
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              {tienDo.dangChay ? (
                <Loader2 size={ICON.md} className="animate-spin text-indigo-500" />
              ) : tienDo.failed > 0 ? (
                <AlertTriangle size={ICON.md} className="text-amber-500" />
              ) : (
                <CheckCircle2 size={ICON.md} className="text-emerald-500" />
              )}
              <p className="text-sm font-semibold text-slate-800">
                {tienDo.dangChay
                  ? vi.notify.compose.sending(tienDo.sent + tienDo.failed, tienDo.total)
                  : vi.notify.compose.done(tienDo.sent, tienDo.failed)}
              </p>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-indigo-500 transition-all"
                style={{ width: `${Math.round(((tienDo.sent + tienDo.failed) / Math.max(tienDo.total, 1)) * 100)}%` }}
              />
            </div>
            {tienDo.dangChay && (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-xs text-amber-700">{vi.notify.compose.keepTabOpen}</p>
                <Button size="sm" variant="outline" onClick={() => { yeuCauDung.current = true; }}>
                  <StopCircle size={ICON.md} />
                  {vi.notify.compose.stop}
                </Button>
              </div>
            )}
            {tienDo.lyDoDung && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{tienDo.lyDoDung}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button disabled={dangGui || nguoiNhan.length === 0} onClick={() => void batDauGui()}>
            <Send size={ICON.md} />
            {vi.notify.compose.send(nguoiNhan.length)}
          </Button>
          {/* Đường lui luôn dùng được.
              Gmail API đòi bật trong Google Cloud và cấp scope gửi thư — việc
              đó có thể vướng chính sách của tổ chức, và không được phép để cả
              tính năng nằm chờ vì một ô cấu hình. Sao chép danh sách rồi dán
              vào BCC là cách người ta vẫn làm hôm nay, chỉ khác là không còn
              phải mở Excel dò từng dòng. */}
          <Button
            variant="outline"
            disabled={nguoiNhan.length === 0}
            onClick={() => {
              void navigator.clipboard.writeText(nguoiNhan.map((r) => r.email).join(', '));
              onToast(vi.notify.compose.copied(nguoiNhan.length), 'success');
            }}
          >
            <ClipboardCopy size={ICON.md} />
            {vi.notify.compose.copyList}
          </Button>
        </div>
      </Card>

      {/* ------------------------------------------------------ LỊCH SỬ */}
      <div>
        <h2 className="text-lg font-bold text-slate-900">{vi.notify.history.title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{vi.notify.history.subtitle}</p>
      </div>

      <Card>
        {history === null ? (
          <StateBlock kind="loading" />
        ) : history.length === 0 ? (
          <StateBlock
            kind="empty"
            title={vi.notify.history.empty}
            description={vi.notify.history.emptyHint}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((a) => (
              <li key={a.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{a.subject}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {vi.notify.history.groups}: {(a.groupNames ?? []).join(', ') || '—'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {vi.notify.history.sentBy}: {a.senderEmail}
                    </p>
                  </div>
                  <Badge
                    variant={
                      a.status === 'SENT' ? 'success'
                        : a.status === 'PARTIAL' ? 'warning'
                        : a.status === 'FAILED' ? 'danger'
                        : 'neutral'
                    }
                  >
                    {vi.notify.history.status[a.status] ?? a.status}
                  </Badge>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock size={ICON.xs} className="text-slate-300" />
                    {vi.notify.history.counts(a.sentCount, a.failedCount, a.total)}
                  </span>
                  {(a.status === 'SENDING' || a.status === 'PARTIAL' || a.status === 'FAILED') && (
                    <Button size="sm" variant="outline" disabled={dangGui} onClick={() => void guiTiep(a)}>
                      <Send size={ICON.sm} />
                      {vi.notify.history.resume}
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setMoRong(moRong === a.id ? null : a.id)}
                    className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                  >
                    <ChevronDown
                      size={ICON.sm}
                      className={moRong === a.id ? 'rotate-180 transition-transform' : 'transition-transform'}
                    />
                    {vi.notify.template.preview}
                  </button>
                </div>

                {moRong === a.id && (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3">
                    <p className="whitespace-pre-wrap text-[13px] text-slate-600">{a.body}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
