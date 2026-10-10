/**
 * Tool: birthday_query — list stored birthdays, optionally filtered.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BirthdayService } from '../services/birthday-service.js';
import { jsonRender, presentCall } from './shared.js';

/** Canonical shape of one queried birthday. */
const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'integer', required: true },
    name: { type: 'string', required: true },
    gender: { type: 'string', required: true },
    relation: { type: 'string', required: true },
    calendarSystem: { type: 'string', required: true },
    gregorianLocalDate: { type: 'string', required: true },
    zodiacSign: { type: 'string', required: true },
    shengxiao: { type: 'string', required: true },
    shichen: { type: 'string', required: true },
    wuxingSummary: { type: 'string', required: true },
    birthTimezone: { type: 'string', required: true },
    note: { type: 'string', required: true },
    fields: { type: 'object', required: true, additionalProperties: true },
  },
} as const;

export function registerQueryTool(ctx: Context, service: BirthdayService): void {
  ctx.tools.register(defineTool({
    name: 'birthday_query',
    description:
      '查询已保存的生日记录。给 id 时返回单条；给 nameLike 时按姓名模糊过滤；都不给时返回全部。',
    parameters: {
      id: { type: 'integer', description: '精确查询某个记录 id' },
      nameLike: { type: 'string', description: '按姓名子串过滤' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          items: { type: 'array', required: true, items: ITEM_SCHEMA },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const rows = args.id !== undefined
        ? [service.get(Number(args.id))].filter(Boolean)
        : service.list();
      const filtered = args.nameLike
        ? rows.filter((r: any) => r.name.includes(String(args.nameLike)))
        : rows;
      return {
        count: filtered.length,
        items: filtered.map((r: any) => ({
          id: r.id,
          name: r.name,
          gender: r.gender ?? '',
          relation: r.relation ?? '',
          calendarSystem: r.calendarSystem,
          gregorianLocalDate: r.gregorianLocalDate,
          zodiacSign: r.zodiacSign ?? '',
          shengxiao: r.shengxiao ?? '',
          shichen: r.shichen ?? '',
          wuxingSummary: r.wuxingSummary ?? '',
          birthTimezone: r.birthTimezone ?? '',
          note: r.note ?? '',
          fields: r.fields,
        })),
      };
    },
    presentCall: () => presentCall('查询生日', 'read'),
  }));
}
