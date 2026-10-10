/**
 * Tool: birthday_delete — remove one record and cancel its reminders.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { BirthdayService } from '../services/birthday-service.js';
import { jsonRender, presentCall } from './shared.js';

export function registerDeleteTool(ctx: Context, service: BirthdayService): void {
  ctx.tools.register(defineTool({
    name: 'birthday_delete',
    description: '按 id 删除生日记录，并取消关联的提醒任务。',
    parameters: {
      id: { type: 'integer', required: true, description: '要删除的记录 id' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'integer', required: true },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const id = Number(args.id);
      const ok = await service.remove(id);
      return { ok, id };
    },
    presentCall: () => presentCall('删除生日', 'other'),
  }));
}
