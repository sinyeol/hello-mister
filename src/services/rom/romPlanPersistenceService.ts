import type { RomDryRunResult, RomPlanExportOptions, SavedRomPlan } from '../../types/rom';
import { summarizeRomPlan } from './romPlanSummaryService';

const browserSavedPlansKey = 'hello-mister-v2-saved-rom-plans';
const secretPattern = /password|privateKey|passphrase|token|secret|credential|rawCommand/i;

function stripSecrets<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (key, innerValue) => (secretPattern.test(key) ? '[removed]' : innerValue)));
}

export function maskRomDryRunResult(result: RomDryRunResult, options: RomPlanExportOptions): RomDryRunResult {
  if (options.includeFullLocalPaths) return stripSecrets(result);
  const safe = stripSecrets(result);
  return {
    ...safe,
    plan: {
      ...safe.plan,
      sourceFiles: safe.plan.sourceFiles.map((file) => ({
        ...file,
        filePath: file.fileName,
        parentFolder: '[hidden]',
      })),
      perFilePlan: safe.plan.perFilePlan.map((item) => ({
        ...item,
        localPath: item.fileName,
      })),
    },
  };
}

export function createSavedRomPlan(result: RomDryRunResult, options: RomPlanExportOptions, title?: string): SavedRomPlan {
  const masked = maskRomDryRunResult(result, options);
  const now = new Date().toISOString();
  const summary = summarizeRomPlan(masked.plan);
  const remoteGamesSnapshotAt = masked.conflicts.find((conflict) => conflict.remoteFile?.modifiedAt)?.remoteFile?.modifiedAt;
  return {
    metadata: {
      id: masked.plan.planId,
      schemaVersion: 1,
      appVersion: '2.1.0',
      createdAt: masked.plan.createdAt,
      updatedAt: now,
      title: title || `ROM dry-run 계획 ${now.slice(0, 10)}`,
      targetAlias: masked.plan.targetAlias,
      targetHost: masked.plan.targetHost,
      fileCount: masked.plan.perFilePlan.length,
      totalSizeBytes: masked.plan.totalSizeBytes,
      remoteGamesSnapshotAt,
      includesFullLocalPaths: options.includeFullLocalPaths,
      conflictSummary: summary.conflictCounts,
      backupPlanSummary: masked.plan.backupPlan ? {
        itemCount: masked.plan.backupPlan.items.length,
        totalSizeBytes: masked.plan.backupPlan.totalSizeBytes,
      } : undefined,
      dryRun: true,
      readOnly: true,
    },
    dryRunResult: masked,
    folderPolicy: masked.plan.folderPolicy,
    backupPlan: masked.plan.backupPlan,
  };
}

export class RomPlanPersistenceService {
  async loadPlans(): Promise<SavedRomPlan[]> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.loadSavedRomPlans) return window.helloMisterDesktop.loadSavedRomPlans();
    if (typeof window === 'undefined') return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(browserSavedPlansKey) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async savePlan(plan: SavedRomPlan): Promise<SavedRomPlan[]> {
    const safePlan = stripSecrets(plan);
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.saveSavedRomPlan) return window.helloMisterDesktop.saveSavedRomPlan(safePlan);
    const plans = await this.loadPlans();
    const next = [safePlan, ...plans.filter((item) => item.metadata.id !== safePlan.metadata.id)].slice(0, 50);
    if (typeof window !== 'undefined') window.localStorage.setItem(browserSavedPlansKey, JSON.stringify(next));
    return next;
  }

  async deletePlan(planId: string): Promise<SavedRomPlan[]> {
    if (typeof window !== 'undefined' && window.helloMisterDesktop?.deleteSavedRomPlan) return window.helloMisterDesktop.deleteSavedRomPlan(planId);
    const plans = await this.loadPlans();
    const next = plans.filter((item) => item.metadata.id !== planId);
    if (typeof window !== 'undefined') window.localStorage.setItem(browserSavedPlansKey, JSON.stringify(next));
    return next;
  }
}
