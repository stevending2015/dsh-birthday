/**
 * Reminder scheduling.
 *
 * We try to call `ctx.schedule` if DSH is running; otherwise we just record
 * the intent in memory and let the consumer flush it later. Either way, the
 * schedule surface is a single `sync(record)` that the service layer calls
 * after every add/update/delete.
 */

import type { BirthdayRecord } from '../models/birthday.js';

export interface ScheduleHandle {
  upsert(task: ScheduleTask): Promise<void>;
  remove(id: string): Promise<void>;
  list(): Promise<ScheduleTask[]>;
}

export interface ScheduleTask {
  id: string;
  runAtUtc: string;
  payload: Record<string, unknown>;
}

export interface ReminderDeps {
  schedule?: ScheduleHandle;
  reminderDaysBefore?: number[];
}

export class ReminderService {
  private tasks = new Map<string, ScheduleTask>();

  constructor(private readonly deps: ReminderDeps = {}) {}

  async sync(record: BirthdayRecord): Promise<void> {
    const days = this.deps.reminderDaysBefore ?? [3, 1];
    const baseMs = new Date(record.birthdayStartUtc).getTime();
    for (const d of days) {
      const taskId = `birthday:${record.id}:${d}`;
      const runAt = new Date(baseMs - d * 86_400_000).toISOString();
      const task: ScheduleTask = {
        id: taskId,
        runAtUtc: runAt,
        payload: { recordId: record.id, name: record.name, daysBefore: d },
      };
      this.tasks.set(taskId, task);
      if (this.deps.schedule) {
        await this.deps.schedule.upsert(task);
      }
    }
  }

  async cancel(recordId: number): Promise<void> {
    for (const id of [...this.tasks.keys()]) {
      if (id.startsWith(`birthday:${recordId}:`)) {
        this.tasks.delete(id);
        if (this.deps.schedule) {
          await this.deps.schedule.remove(id);
        }
      }
    }
  }

  pending(): ScheduleTask[] {
    return [...this.tasks.values()];
  }
}
