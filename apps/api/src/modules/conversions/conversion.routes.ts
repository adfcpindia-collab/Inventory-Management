import { conversionSchema } from '@inventory/shared';
import { documentRouter } from '../documents/doc.routes';
import * as svc from './conversion.service';

export const conversionRouter = documentRouter(svc as never, conversionSchema);
