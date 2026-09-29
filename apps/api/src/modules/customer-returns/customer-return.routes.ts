import { customerReturnSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './customer-return.service';

export const customerReturnRouter = documentRouter(svc as never, customerReturnSchema);
