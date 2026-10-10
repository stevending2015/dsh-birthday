/**
 * Tool registration aggregator.
 */

import type { Context } from '@deepseek-ai/cordis';
import type { GregorianHub } from '../../calendar/hub.js';
import type { BirthdayService } from '../services/birthday-service.js';
import type { UpcomingService } from '../services/upcoming.js';
import { registerAddTool } from './add.js';
import { registerQueryTool } from './query.js';
import { registerUpdateTool } from './update.js';
import { registerDeleteTool } from './delete.js';
import { registerUpcomingTool } from './upcoming.js';
import { registerTransferTools } from './transfer.js';

export function registerBirthdayTools(
  ctx: Context,
  service: BirthdayService,
  upcoming: UpcomingService,
  storage?: { hub: GregorianHub; storage: () => { path: string; engine: 'sqlite' | 'json' } },
) {
  registerAddTool(ctx, service);
  registerQueryTool(ctx, service);
  registerUpdateTool(ctx, service);
  registerDeleteTool(ctx, service);
  registerUpcomingTool(ctx, service, upcoming);

  // Storage inspection and transfer need the store's location, which the
  // service does not own; they are registered when the host supplies it.
  if (storage !== undefined) {
    registerTransferTools(ctx, {
      hub: storage.hub,
      service,
      storage: storage.storage,
    });
  }
}
