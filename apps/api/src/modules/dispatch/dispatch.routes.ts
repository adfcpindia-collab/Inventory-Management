import { dispatchSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './dispatch.service';

export const dispatchRouter = documentRouter(svc as never, dispatchSchema);
