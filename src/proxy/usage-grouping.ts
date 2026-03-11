import type { UsageSummary } from '../core/types';
import type { UsageLogEntry } from '../store/interface';

export function groupUsageByDimension(
  entries: UsageLogEntry[],
  pickKey: (entry: UsageLogEntry) => string,
  summarizeUsageEntries: (entries: UsageLogEntry[]) => UsageSummary
): Record<string, Record<string, UsageSummary>> {
  const grouped = new Map<string, UsageLogEntry[]>();

  for (const entry of entries) {
    const key = pickKey(entry);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(entry);
      continue;
    }

    grouped.set(key, [entry]);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([key, groupEntries]) => [
      key,
      groupUsageByModel(groupEntries, summarizeUsageEntries),
    ])
  );
}

export function groupUsageByModel(
  entries: UsageLogEntry[],
  summarizeUsageEntries: (entries: UsageLogEntry[]) => UsageSummary
): Record<string, UsageSummary> {
  const grouped = new Map<string, UsageLogEntry[]>();

  for (const entry of entries) {
    const bucket = grouped.get(entry.model);
    if (bucket) {
      bucket.push(entry);
      continue;
    }

    grouped.set(entry.model, [entry]);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([modelName, modelEntries]) => [
      modelName,
      summarizeUsageEntries(modelEntries),
    ])
  );
}
