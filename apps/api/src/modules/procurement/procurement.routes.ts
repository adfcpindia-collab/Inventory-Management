import { procurementSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './procurement.service';

export const procurementRouter = documentRouter(svc as never, procurementSchema);
