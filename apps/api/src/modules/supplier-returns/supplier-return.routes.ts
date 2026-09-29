import { supplierReturnSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './supplier-return.service';

export const supplierReturnRouter = documentRouter(svc as never, supplierReturnSchema);
