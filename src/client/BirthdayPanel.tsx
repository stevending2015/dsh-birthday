/**
 * BirthdayPanel — the central panel body (registered into the `main` slot
 * under the key `dsh-birthday`). Self-contained: it fetches everything it
 * needs from the plugin's own HTTP API, so it depends on no standard props.
 *
 * Layout: a 4-up responsive card grid. Every card exposes 查看 / 编辑 / 删除,
 * all served by one dialog component driven by `mode`.
 *
 * The view and edit dialogs are populated from the upcoming item directly —
 * no extra round-trip — so they always show what the card already shows.
 */

import * as React from 'react';
import { BirthdayCard } from './BirthdayCard.js';
import { BirthdayDialog, ConfirmDialog } from './BirthdayDialog.js';
import { AlmanacDialog, type AlmanacMonth } from './AlmanacDialog.js';
import type { BirthdayDraft, CalendarDescriptor, FormMode } from './BirthdayForm.js';
import { buildPayload, diffAfterSave } from './formState.js';
import { computeAge, datePartsIn } from './age.js';
import { downloadText, readFileText } from './transfer.js';
import { injectStylesForNode } from './styles.js';

interface UpcomingItem {
  id?: number;
  name: string;
  relation?: string;
  gender?: string;
  note?: string;
  calendarSystem: string;
  fields: Record<string, unknown>;
  nextLocalDate: string;
  /** Original birth date resolved in the Gregorian calendar. */
  gregorianLocalDate: string;
  nextStartUtc: string;
  userActionUtc: string;
  sameOffset: boolean;
  birthTimezone?: string;
  zodiacSign?: string;
  /** Chinese zodiac animal (生肖), derived from the lunar year. */
  shengxiao?: string;
  /** 时辰 of birth, when the calendar defines one. */
  shichen?: string;
  wuxingSummary?: string;
  degraded: boolean;
  degradationReason?: string;
}

/** Per-record outcome of an import. */
interface ImportOutcome {
  dryRun: boolean;
  mode: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  results: Array<{ index: number; name: string; status: string; reason?: string }>;
}

/** Resolve the browser's IANA zone, falling back to UTC. */
function userTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Format a UTC instant as `YYYY-MM-DD HH:mm` in the given zone. */
function formatInZone(utcIso: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(utcIso));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const hour = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}`;
  } catch {
    return utcIso;
  }
}

/** The stored birth date, phrased in its own calendar's field names. */
function birthDateText(item: UpcomingItem): string {
  const f = item.fields ?? {};
  const parts: string[] = [];
  if (f.year !== undefined) parts.push(`${f.year}年`);
  if (f.month !== undefined) parts.push(`${f.isLeapMonth === true ? '闰' : ''}${f.month}月`);
  if (f.day !== undefined) parts.push(`${f.day}日`);
  if (f.afterSunset === true) parts.push('（日落後）');
  return parts.length > 0 ? parts.join('') : '—';
}

/**
 * JSON request with a uniform error shape.
 * Errors are also logged to the console with the URL + status so failures
 * surface in the browser DevTools even when the UI catches them.
 */
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload as { error?: string }).error) {
    const message = (payload as { error?: string }).error ?? `HTTP ${response.status}`;
    // eslint-disable-next-line no-console
    console.error(`[dsh-birthday] ${init?.method ?? 'GET'} ${url} → ${response.status}: ${message}`);
    throw new Error(message);
  }
  return payload as T;
}

/** Convert an upcoming item into the form's draft. */
function draftFromItem(item: UpcomingItem | null, tz: string): Partial<BirthdayDraft> {
  if (item === null) return {};
  return {
    name: item.name,
    gender: item.gender ?? 'unspecified',
    relation: item.relation ?? '',
    note: item.note ?? '',
    calendarSystem: item.calendarSystem,
    fields: item.fields ?? {},
    birthTimezone: item.birthTimezone ?? tz,
  };
}

export function BirthdayPanel(): React.ReactElement {
  const tz = React.useMemo(userTimezone, []);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [items, setItems] = React.useState<UpcomingItem[]>([]);
  const [calendars, setCalendars] = React.useState<CalendarDescriptor[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [dialogMode, setDialogMode] = React.useState<FormMode | null>(null);
  const [selected, setSelected] = React.useState<UpcomingItem | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<UpcomingItem | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [almanacOpen, setAlmanacOpen] = React.useState(false);

  /**
   * Load one month of 万年历 data. Returns undefined on failure so the dialog
   * can show its own message instead of throwing into an unhandled rejection.
   */
  const loadAlmanacMonth = React.useCallback(
    async (year: number, month: number): Promise<AlmanacMonth | undefined> => {
      try {
        return await requestJson<AlmanacMonth>(
          `/api/birthday/almanac?year=${year}&month=${month}&tz=${encodeURIComponent(tz)}`,
        );
      } catch {
        return undefined;
      }
    },
    [tz],
  );

  // Style the panel where it actually lives: a sheet in document.head does not
  // reach a subtree mounted inside a shadow root.
  React.useEffect(() => {
    injectStylesForNode(rootRef.current);
  }, []);

  const load = React.useCallback(async () => {
    try {
      const data = await requestJson<{ items: UpcomingItem[] }>(
        `/api/birthday/upcoming?tz=${encodeURIComponent(tz)}&hour=9`,
      );
      setItems(data.items ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tz]);

  React.useEffect(() => {
    let alive = true;
    requestJson<{ items: CalendarDescriptor[] }>('/api/birthday/calendars')
      .then((data) => {
        if (alive) setCalendars(data.items ?? []);
      })
      .catch(() => {
        /* the list still renders with raw calendar ids */
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    load();
    const timer = setInterval(load, 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const calendarName = React.useCallback(
    (id: string) => calendars.find((c) => c.id === id)?.name ?? id,
    [calendars],
  );

  /**
   * Open the dialog synchronously from the data the card already carries.
   * The previous version re-fetched /api/birthday/list here, which meant any
   * auth/CSRF hiccup on that route left the dialog blank and the user
   * thought the buttons were dead. View and edit do not need a round-trip.
   */
  const openDialog = React.useCallback((mode: FormMode, item?: UpcomingItem) => {
    setDialogError(null);
    setSelected(item ?? null);
    setDialogMode(mode);
    // eslint-disable-next-line no-console
    console.log('[dsh-birthday] openDialog', { mode, itemId: item?.id, itemName: item?.name });
  }, []);

  /**
   * Mirror of the latest dialog state read by submit/remove. Using a ref
   * guarantees the handler closes over the *current* values, which kills the
   * "edit becomes add" / "delete does nothing" classes of stale-closure bugs
   * without relying on `useCallback` re-creating at exactly the right time.
   */
  const latestRef = React.useRef({ dialogMode: null as FormMode | null, selected: null as UpcomingItem | null });
  latestRef.current = { dialogMode, selected };

  /** Completed years for one record, using today's date in the user's zone. */
  const ageOf = React.useCallback(
    (item: UpcomingItem): number | undefined =>
      computeAge(item.gregorianLocalDate, datePartsIn(new Date(), tz)),
    [tz],
  );

  /** Download the whole library as JSON — the one round-trip format. */
  const doExport = React.useCallback(async () => {
    setNotice(null);
    try {
      const result = await requestJson<{ filename: string; text: string }>('/api/birthday/export');
      downloadText(result.filename, result.text, 'application/json');
      setNotice(`已导出 ${items.length} 条记录（JSON）`);
    } catch (e) {
      setNotice(`导出失败：${(e as Error).message}`);
    }
  }, [items.length]);

  /**
   * Import a chosen JSON file. The server reports per-record outcomes, so a
   * partly-bad file imports what it can and says what it rejected.
   */
  const doImport = React.useCallback(
    async (file: File) => {
      setNotice(null);
      try {
        const text = await readFileText(file);
        const outcome = await requestJson<ImportOutcome>('/api/birthday/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, mode: 'merge' }),
        });
        const summary = `共 ${outcome.total} 条，导入 ${outcome.imported}，跳过 ${outcome.skipped}，失败 ${outcome.failed}`;
        const failures = outcome.results
          .filter((r) => r.status === 'failed')
          .slice(0, 3)
          .map((r) => `#${r.index + 1} ${r.name}：${r.reason ?? ''}`)
          .join('；');
        setNotice(failures === '' ? summary : `${summary}。${failures}`);
        await load();
      } catch (e) {
        setNotice(`导入失败：${(e as Error).message}`);
      }
    },
    [load],
  );

  /**
   * Calendar year facts for the form (e.g. the Chinese leap month). Returns
   * undefined on failure so a missing hint never blocks data entry.
   */
  const loadYearInfo = React.useCallback(async (calendarSystem: string, year: number) => {
    try {
      return await requestJson<{ leapMonth?: number | null; note?: string }>(
        `/api/birthday/year-info?calendar=${encodeURIComponent(calendarSystem)}&year=${year}`,
      );
    } catch {
      return undefined;
    }
  }, []);

  const submit = React.useCallback(
    async (draft: BirthdayDraft) => {
      setDialogError(null);
      const { dialogMode: liveMode, selected: liveSelected } = latestRef.current;
      const payload = buildPayload(draft);
      // eslint-disable-next-line no-console
      console.log('[dsh-birthday] submit', {
        dialogMode: liveMode,
        selectedId: liveSelected?.id,
        payload,
      });

      const isUpdate = liveMode === 'edit' && liveSelected?.id !== undefined;
      try {
        if (liveMode === 'edit' && !isUpdate) {
          // Edit mode with no addressable record would silently create a
          // duplicate, which is exactly how the old recordId/id mismatch
          // presented. Fail loudly instead.
          throw new Error('编辑模式缺少记录 id，无法更新（请重新打开该卡片）');
        }
        const result: { ok?: boolean; record?: unknown } = isUpdate
          ? await requestJson<{ ok?: boolean; record?: unknown }>('/api/birthday/update', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ id: liveSelected!.id, ...payload }),
            })
          : await requestJson<{ ok?: boolean; record?: unknown }>('/api/birthday/add', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
        // The route reports a missing record as `ok: false` rather than an
        // error status; surface it instead of closing as if it had saved.
        if (isUpdate && result.ok === false) {
          throw new Error(`未找到要更新的记录（id=${liveSelected!.id}），可能已被删除`);
        }

        // Read the record back and compare. A silent revert must never look
        // like a successful save.
        if (isUpdate) {
          const stored = await requestJson<{ items: Array<Record<string, unknown>> }>(
            '/api/birthday/list',
          );
          const mine = stored.items?.find((r) => Number(r.id) === liveSelected!.id);
          const mismatched = diffAfterSave(payload, mine);
          if (mismatched.length > 0) {
            // eslint-disable-next-line no-console
            console.error('[dsh-birthday] save did not stick', { mismatched, payload, stored: mine });
            throw new Error(`保存未生效：${mismatched.join('、')} 仍是原值（详见控制台）`);
          }
        }

        setDialogMode(null);
        setSelected(null);
        await load();
      } catch (e) {
        // Keep the dialog open so the user sees the failure in the form.
        setDialogError((e as Error).message);
      }
    },
    // `submit` is recreated only on mount; it reads live state from `latestRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [load],
  );

  /**
   * Keep the confirm dialog open on failure so the user can retry or
   * cancel after seeing the error.
   */
  const removePending = React.useCallback(async () => {
    const target = latestRef.current.selected ?? pendingDelete;
    // eslint-disable-next-line no-console
    console.log('[dsh-birthday] remove', { targetId: target?.id, name: target?.name });
    if (target === null || target?.id === undefined) {
      setPendingDelete(null);
      return;
    }
    try {
      await requestJson('/api/birthday/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: target.id }),
      });
      setError(null);
      setPendingDelete(null);
      await load();
    } catch (e) {
      setDialogError((e as Error).message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDelete, load]);

  const dialogTitle =
    dialogMode === 'create' ? '添加生日' : dialogMode === 'edit' ? '编辑生日' : '生日详情';

  return (
    <div className="dsh-birthday-page" ref={rootRef}>
      <header className="dsh-birthday-page__header">
        <h2>🎉 生日</h2>
        <div className="dsh-birthday-page__actions">
          <button type="button" className="dsh-btn dsh-btn--sm" onClick={load}>刷新</button>
          <button
            type="button"
            className="dsh-btn dsh-btn--sm"
            onClick={() => setAlmanacOpen(true)}
            title="打开万年历查询日期"
          >
            📅 万年历
          </button>
          <button type="button" className="dsh-btn dsh-btn--sm" onClick={() => { void doExport(); }}>
            导出
          </button>
          <button
            type="button"
            className="dsh-btn dsh-btn--sm"
            onClick={() => fileInputRef.current?.click()}
          >
            导入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so choosing the same file twice fires again.
              e.target.value = '';
              if (file !== undefined) void doImport(file);
            }}
          />
          <button
            type="button"
            className="dsh-btn dsh-btn--sm dsh-btn--primary"
            onClick={() => openDialog('create')}
          >
            ＋ 添加
          </button>
        </div>
      </header>

      <div className="dsh-birthday-page__zone">
        你的时区：{tz} · 共 {items.length} 条
      </div>

      {notice !== null && <div className="dsh-birthday-page__notice">ℹ {notice}</div>}
      {error !== null && <div className="dsh-birthday-page__error">⚠ {error}</div>}

      {loading && items.length === 0 && <div className="dsh-birthday-page__empty">加载中…</div>}
      {!loading && items.length === 0 && error === null && (
        <div className="dsh-birthday-page__empty">
          还没有生日记录，点「＋ 添加」记下第一个吧 🎂
        </div>
      )}

      <div className="dsh-birthday-page__grid">
        {items.map((item) => (
          <BirthdayCard
            key={`${item.id ?? item.name}`}
            name={item.name}
            relation={item.relation}
            gender={item.gender}
            note={item.note}
            calendarName={calendarName(item.calendarSystem)}
            birthDateText={birthDateText(item)}
            nextLocalDate={item.nextLocalDate}
            targetUtc={item.sameOffset ? item.nextStartUtc : item.userActionUtc}
            userActionLocal={formatInZone(item.userActionUtc, tz)}
            sameOffset={item.sameOffset}
            birthTimezone={item.birthTimezone ?? tz}
            zodiacSign={item.zodiacSign}
            shengxiao={item.shengxiao}
            shichen={item.shichen}
            age={ageOf(item)}
            wuxingSummary={item.wuxingSummary}
            degraded={item.degraded}
            degradationReason={item.degradationReason}
            onView={() => openDialog('view', item)}
            onEdit={() => openDialog('edit', item)}
            onDelete={() => setPendingDelete(item)}
          />
        ))}
      </div>

      <BirthdayDialog
        open={dialogMode !== null}
        mode={dialogMode ?? 'create'}
        title={dialogTitle}
        calendars={calendars}
        recordId={selected?.id}
        initial={draftFromItem(selected, tz)}
        zodiacSign={selected?.zodiacSign}
        gregorianLocalDate={selected?.gregorianLocalDate}
        birthDateText={selected ? birthDateText(selected) : undefined}
        age={selected ? ageOf(selected) : undefined}
        loadYearInfo={loadYearInfo}
        submitError={dialogError}
        onSubmit={submit}
        onClose={() => {
          setDialogMode(null);
          setSelected(null);
          setDialogError(null);
        }}
        onRequestEdit={dialogMode === 'view' ? () => { setDialogError(null); setDialogMode('edit'); } : undefined}
      />

      <AlmanacDialog
        open={almanacOpen}
        today={formatInZone(new Date().toISOString(), tz)}
        loadMonth={loadAlmanacMonth}
        calendarName={calendarName}
        onClose={() => setAlmanacOpen(false)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除生日"
        message={`确定删除「${pendingDelete?.name ?? ''}」吗？关联的提醒任务也会一并取消。`}
        errorMessage={dialogError}
        onConfirm={() => { void removePending(); }}
        onCancel={() => { setPendingDelete(null); setDialogError(null); }}
      />
    </div>
  );
}
