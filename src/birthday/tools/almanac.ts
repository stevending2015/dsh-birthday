/**
 * `birthday_almanac` — the 万年历 the UI window shows, exposed to the agent.
 *
 * Answers the questions a calendar window answers: what is the 农历 date, which
 * day is a given 节气 or festival, what is 宜/忌 on a date.
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { GregorianHub } from '../../calendar/hub.js';
import {
  ALMANAC_MAX_YEAR,
  ALMANAC_MIN_YEAR,
  buildAlmanacMonth,
  hasAlmanacLibrary,
} from '../services/almanac.js';
import { jsonRender, presentCall } from './shared.js';

export function registerAlmanacTool(ctx: Context, hub: GregorianHub): void {
  ctx.tools.register(defineTool({
    name: 'birthday_almanac',
    description:
      '万年历查询：给定公历年份与月份，返回该月每一天的农历日期、干支、生肖、节气、' +
      '节日与宜忌；也可指定具体某一天只取那一天。用于回答“某天是农历几月几”“今年立春' +
      '是哪天”“某日宜忌是什么”这类问题。',
    parameters: {
      year: { type: 'integer', description: `公历年（${ALMANAC_MIN_YEAR}-${ALMANAC_MAX_YEAR}）` },
      month: { type: 'integer', description: '公历月 1-12' },
      day: { type: 'integer', description: '可选的公历日；给了就只返回那一天的详情' },
      tz: { type: 'string', description: 'IANA 时区，决定“今天”的判定，默认 Asia/Shanghai' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          year: { type: 'integer', required: true },
          month: { type: 'integer', required: true },
          timezone: { type: 'string', required: true },
          today: { type: 'string', required: true },
          almanacAvailable: { type: 'boolean', required: true },
          note: { type: 'string', required: true },
          jieQi: { type: 'string', required: true },
          festivals: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: jsonRender,
    },
    async execute(args: any) {
      const tz = typeof args?.tz === 'string' && args.tz !== '' ? args.tz : 'Asia/Shanghai';
      const now = new Date();
      const today = hub.timezone.formatLocalDate(now, tz);
      const year = Number.isFinite(Number(args?.year)) ? Number(args.year) : Number(today.slice(0, 4));
      const monthNo = Number.isFinite(Number(args?.month)) ? Number(args.month) : Number(today.slice(5, 7));

      const built = buildAlmanacMonth(year, monthNo, tz, hub.timezone, now);
      const scope =
        args?.day !== undefined
          ? built.days.filter((d) => d.day === Number(args.day))
          : built.days;

      const lines = scope.map((d) =>
        [
          d.date,
          `星期${d.weekdayName}`,
          `农历${d.lunarMonthName}${d.lunarDayName}`,
          `${d.yearGanZhi}年`,
          `${d.zodiac}年`,
          d.dayGanZhi ? `${d.dayGanZhi}日` : '',
          d.jieQi !== '' ? `节气 ${d.jieQi}` : '',
          d.festivals.length > 0 ? `节日 ${d.festivals.join('/')}` : '',
          d.yi.length > 0 ? `宜 ${d.yi.join(' ')}` : '',
          d.ji.length > 0 ? `忌 ${d.ji.join(' ')}` : '',
          d.isToday ? '（今天）' : '',
        ]
          .filter((part) => part !== '')
          .join(' · '),
      );

      return {
        year: built.year,
        month: built.month,
        timezone: built.timezone,
        today: built.today,
        almanacAvailable: built.almanacAvailable,
        note: built.note ?? '',
        jieQi: built.jieQi.map((j) => `${j.date} ${j.name}`).join('；'),
        festivals: built.festivals.map((f) => `${f.date} ${f.name}`).join('；'),
        summary: lines.join('\n'),
      };
    },
    presentCall: () => presentCall('查询万年历', 'read'),
  }));
}

/** Exposed for tests: whether the almanac extras are installed. */
export { hasAlmanacLibrary };
