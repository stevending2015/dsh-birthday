/**
 * Tool: birthday_upcoming — next occurrence plus the user-local action instant.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BirthdayService } from '../services/birthday-service.js';
import type { UpcomingService } from '../services/upcoming.js';
import { jsonRender, presentCall } from './shared.js';

export function registerUpcomingTool(
  ctx: Context,
  service: BirthdayService,
  upcoming: UpcomingService,
): void {
  ctx.tools.register(defineTool({
    name: 'birthday_upcoming',
    description:
      '查询即将到来的生日。返回每条记录在出生时区下的下一次公历日期、' +
      '用户时区下的提醒时刻、以及是否同处一个 UTC 偏移（sameOffset）。' +
      'sameOffset 为 false 表示跨时区，此时应按 userActionUtc 提醒用户。',
    parameters: {
      userTimezone: { type: 'string', required: true, description: '用户所在 IANA 时区' },
      userReminderHour: { type: 'integer', description: '希望提醒的本地小时 0-23，默认 9' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'integer', required: true },
                name: { type: 'string', required: true },
                gender: { type: 'string', required: true },
                relation: { type: 'string', required: true },
                calendarSystem: { type: 'string', required: true },
                nextLocalDate: { type: 'string', required: true },
                nextStartUtc: { type: 'string', required: true },
                userActionUtc: { type: 'string', required: true },
                sameOffset: { type: 'boolean', required: true },
                birthTimezone: { type: 'string', required: true },
                zodiacSign: { type: 'string', required: true },
                shengxiao: { type: 'string', required: true },
                shichen: { type: 'string', required: true },
                wuxingSummary: { type: 'string', required: true },
                note: { type: 'string', required: true },
                degraded: { type: 'boolean', required: true },
                degradationReason: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const entries = upcoming.resolveAll(service.list(), {
        userTimezone: String(args.userTimezone),
        userReminderHour: args.userReminderHour === undefined ? undefined : Number(args.userReminderHour),
      });
      return {
        count: entries.length,
        items: entries.map((e) => ({
          id: e.id ?? 0,
          name: e.name,
          gender: e.gender ?? '',
          relation: e.relation ?? '',
          calendarSystem: e.calendarSystem,
          nextLocalDate: e.nextLocalDate,
          nextStartUtc: e.nextStartUtc,
          userActionUtc: e.userActionUtc,
          sameOffset: e.sameOffset,
          birthTimezone: e.birthTimezone,
          zodiacSign: e.zodiacSign ?? '',
          shengxiao: e.shengxiao ?? '',
          shichen: e.shichen ?? '',
          wuxingSummary: e.wuxingSummary ?? '',
          note: e.note ?? '',
          degraded: e.degraded,
          degradationReason: e.degradationReason ?? '',
        })),
      };
    },
    presentCall: () => presentCall('即将到来的生日', 'read'),
  }));
}
