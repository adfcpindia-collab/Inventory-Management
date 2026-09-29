import { stockAdjustmentSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './adjustment.service';

export const adjustmentRouter = documentRouter(svc as never, stockAdjustmentSchema);
