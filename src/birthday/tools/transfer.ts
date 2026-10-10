/**
 * Tools for storage inspection and data transfer:
 *   - `birthday_db_info`  — is the database encrypted, where is it, how big.
 *   - `birthday_export`   — dump every record as the standard JSON envelope or CSV.
 *   - `birthday_import`   — load an envelope / array / CSV text back in.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { GregorianHub } from '../../calendar/hub.js';
import type { BirthdayService } from '../services/birthday-service.js';
import { inspectDatabase } from '../services/db-inspect.js';
import { buildExport, importBirthdays, parseImportText } from '../services/transfer.js';
import { jsonRender, presentCall } from './shared.js';

export interface TransferToolDeps {
  hub: GregorianHub;
  service: BirthdayService;
  storage: () => { path: string; engine: 'sqlite' | 'json' };
}

export function registerTransferTools(ctx: Context, deps: TransferToolDeps): void {
  const { hub, service, storage } = deps;

  ctx.tools.register(defineTool({
    name: 'birthday_db_info',
    description:
      '检查生日库的存储情况：文件路径、引擎（SQLite / JSON）、字节级格式、' +
      '是否加密、可读可写、记录条数。加密判定基于文件头：明文 SQLite 以 ' +
      '“SQLite format 3” 开头，JSON 以 { 开头；两者都不是则疑似已加密。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          exists: { type: 'boolean', required: true },
          engine: { type: 'string', required: true },
          format: { type: 'string', required: true },
          encryption: { type: 'string', required: true },
          sizeBytes: { type: 'integer', required: true },
          readable: { type: 'boolean', required: true },
          writable: { type: 'boolean', required: true },
          records: { type: 'integer', required: true },
          consistent: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: jsonRender,
    },
    async execute() {
      const target = storage();
      const report = inspectDatabase(target.path, target.engine, service.list().length);
      return { ...report, records: report.records ?? 0 };
    },
    presentCall: () => presentCall('检查数据库', 'read'),
  }));

  ctx.tools.register(defineTool({
    name: 'birthday_export',
    description:
      '导出全部生日记录为 JSON 文本。返回带 format/version 的标准交换信封，' +
      '含原始历法字段与出生时区；该文本可直接交给 birthday_import 再导入。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string', required: true },
          filename: { type: 'string', required: true },
          count: { type: 'integer', required: true },
          text: { type: 'string', required: true },
        },
      },
      render: jsonRender,
    },
    async execute() {
      const records = service.list();
      return {
        format: 'json',
        filename: 'dsh-birthday.json',
        count: records.length,
        text: JSON.stringify(buildExport(records), null, 2),
      };
    },
    presentCall: () => presentCall('导出数据', 'read'),
  }));

  ctx.tools.register(defineTool({
    name: 'birthday_import',
    description:
      '导入生日记录。输入为 JSON 文本：导出信封、记录数组或单条记录均可。' +
      'mode=merge（默认）跳过重复记录，mode=append 一律新增；dryRun=true 只校验不写入。' +
      '派生字段（星座、生肖、公历锚点）会在导入时重新计算，不采信文件里的值。',
    parameters: {
      text: { type: 'string', description: '要导入的 JSON 或 CSV 文本' },
      mode: { type: 'string', enum: ['merge', 'append'], description: '重复记录的处理方式' },
      dryRun: { type: 'boolean', description: '只校验不写入' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', required: true },
          mode: { type: 'string', required: true },
          total: { type: 'integer', required: true },
          imported: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          failed: { type: 'integer', required: true },
          failures: { type: 'string', required: true },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const text = String(args?.text ?? '');
      const entries = parseImportText(text);
      const outcome = await importBirthdays(hub, service, entries, {
        mode: args?.mode === 'append' ? 'append' : 'merge',
        dryRun: args?.dryRun === true,
      });
      const failures = outcome.results
        .filter((r) => r.status === 'failed')
        .map((r) => `#${r.index + 1} ${r.name}: ${r.reason ?? ''}`)
        .join('\n');
      return {
        dryRun: outcome.dryRun,
        mode: outcome.mode,
        total: outcome.total,
        imported: outcome.imported,
        skipped: outcome.skipped,
        failed: outcome.failed,
        failures,
      };
    },
    presentCall: () => presentCall('导入数据', 'other'),
  }));
}
