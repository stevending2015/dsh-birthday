/**
 * Tool: birthday_add — record one birthday in any enabled calendar.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BirthdayService } from '../services/birthday-service.js';
import type { CalendarFields } from '../../calendar/types.js';
import { jsonRender, presentCall } from './shared.js';

export function registerAddTool(ctx: Context, service: BirthdayService): void {
  ctx.tools.register(defineTool({
    name: 'birthday_add',
    description:
      '新增一个生日记录，支持公历、中国农历、伊斯兰历、希伯来历。' +
      'fields 为对应历法的日期字段：公历 {year,month,day}；' +
      '农历 {year,month,day,isLeapMonth?}；伊斯兰历/希伯来历 {year,month,day,afterSunset?}。' +
      'birthTimezone 传出生地的 IANA 时区，它决定该生日的历法归属。',
    parameters: {
      name: { type: 'string', required: true, description: '姓名或称呼' },
      gender: {
        type: 'string',
        enum: ['male', 'female', 'other', 'unspecified'],
        description: '性别；决定关系候选集，例如 male 不会出现「妈妈」',
      },
      calendarSystem: {
        type: 'string',
        required: true,
        enum: ['gregorian', 'lunar', 'islamic', 'hebrew'],
        description: '历法标识',
      },
      fields: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: '历法日期字段，见工具描述',
      },
      birthTimezone: {
        type: 'string',
        required: true,
        description: '出生地 IANA 时区，例如 Asia/Shanghai',
      },
      relation: { type: 'string', description: '与本人的关系，例如 爸爸/朋友/同事' },
      note: { type: 'string', description: '备注' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'integer', required: true },
          name: { type: 'string', required: true },
          gender: { type: 'string', required: true },
          relation: { type: 'string', required: true },
          calendarSystem: { type: 'string', required: true },
          gregorianLocalDate: { type: 'string', required: true },
          birthdayStartUtc: { type: 'string', required: true },
          zodiacSign: { type: 'string', required: true },
          hasWarnings: { type: 'boolean', required: true },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const record = await service.add({
        name: String(args.name),
        gender: args.gender === undefined ? undefined : args.gender,
        calendarSystem: String(args.calendarSystem),
        fields: args.fields as CalendarFields,
        birthTimezone: String(args.birthTimezone),
        relation: args.relation === undefined ? undefined : String(args.relation),
        note: args.note === undefined ? undefined : String(args.note),
      });
      return {
        id: record.id,
        name: record.name,
        gender: record.gender ?? '',
        relation: record.relation ?? '',
        calendarSystem: record.calendarSystem,
        gregorianLocalDate: record.gregorianLocalDate,
        birthdayStartUtc: record.birthdayStartUtc,
        zodiacSign: record.zodiacSign ?? '',
        hasWarnings: Boolean(record.annualDegradation),
      };
    },
    presentCall: () => presentCall('新增生日', 'other'),
  }));
}
