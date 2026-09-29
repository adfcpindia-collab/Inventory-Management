import { stockActionSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './stock-action.service';

export const stockActionRouter = documentRouter(svc as never, stockActionSchema);
