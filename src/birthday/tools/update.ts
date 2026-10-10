/**
 * Tool: birthday_update — patch one stored record by id.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BirthdayService } from '../services/birthday-service.js';
import type { CalendarFields } from '../../calendar/types.js';
import { jsonRender, presentCall } from './shared.js';

export function registerUpdateTool(ctx: Context, service: BirthdayService): void {
  ctx.tools.register(defineTool({
    name: 'birthday_update',
    description:
      '按 id 更新生日记录。只需给出要改的字段；改动日期字段后会重新计算公历锚点、星座、五行与提醒任务。',
    parameters: {
      id: { type: 'integer', required: true, description: '要更新的记录 id' },
      name: { type: 'string', description: '新的姓名' },
      gender: {
        type: 'string',
        enum: ['male', 'female', 'other', 'unspecified'],
        description: '新的性别',
      },
      fields: { type: 'object', additionalProperties: true, description: '新的历法日期字段' },
      calendarSystem: {
        type: 'string',
        enum: ['gregorian', 'lunar', 'islamic', 'hebrew'],
        description: '新的历法标识',
      },
      birthTimezone: { type: 'string', description: '新的出生地 IANA 时区' },
      relation: { type: 'string', description: '新的关系' },
      note: { type: 'string', description: '新的备注' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'integer', required: true },
          gregorianLocalDate: { type: 'string', required: true },
          zodiacSign: { type: 'string', required: true },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const id = Number(args.id);
      const patch: Record<string, unknown> = {};
      if (args.name !== undefined) patch.name = String(args.name);
      if (args.gender !== undefined) patch.gender = args.gender;
      if (args.fields !== undefined) patch.fields = args.fields as CalendarFields;
      if (args.calendarSystem !== undefined) patch.calendarSystem = String(args.calendarSystem);
      if (args.birthTimezone !== undefined) patch.birthTimezone = String(args.birthTimezone);
      if (args.relation !== undefined) patch.relation = String(args.relation);
      if (args.note !== undefined) patch.note = String(args.note);
      const updated = await service.update(id, patch);
      return {
        ok: updated !== undefined,
        id,
        gregorianLocalDate: updated?.gregorianLocalDate ?? '',
        zodiacSign: updated?.zodiacSign ?? '',
      };
    },
    presentCall: () => presentCall('更新生日', 'other'),
  }));
}
