import type { SettingsInput } from '@inventory/shared';
import { writeAudit } from '../../lib/audit';
import { prisma, type Tx } from '../../lib/prisma';

const KEY_CONVERSION_THRESHOLD = 'conversionApprovalThreshold';

export async function getConversionThreshold(
  client: Tx | typeof prisma = prisma,
): Promise<number | null> {
  const row = await client.setting.findUnique({ where: { key: KEY_CONVERSION_THRESHOLD } });
  return typeof row?.value === 'number' ? row.value : null;
}

export async function getSettings() {
  return { conversionApprovalThreshold: await getConversionThreshold() };
}

export async function updateSettings(input: SettingsInput, userId: string) {
  return prisma.$transaction(async (tx) => {
    const old = await getConversionThreshold(tx);
    await tx.setting.upsert({
      where: { key: KEY_CONVERSION_THRESHOLD },
      update: { value: input.conversionApprovalThreshold as never },
      create: { key: KEY_CONVERSION_THRESHOLD, value: input.conversionApprovalThreshold as never },
    });
    await writeAudit(tx, {
      userId,
      action: 'UPDATE',
      entity: 'Setting',
      entityId: KEY_CONVERSION_THRESHOLD,
      oldValue: { conversionApprovalThreshold: old },
      newValue: input,
    });
    return { conversionApprovalThreshold: input.conversionApprovalThreshold };
  });
}
