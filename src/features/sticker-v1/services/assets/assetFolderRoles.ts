import type { AssetKind } from '@sticker-v1/types';
import { splitPathParts } from '@sticker-v1/utils/pathParts';
import type { AssetSourceGroupSettings } from './assetSourceGroups';

export type AssetFolderRole = 'front' | 'logo' | 'background';

export interface AssetFolderRule {
  folderName: string;
  role: AssetFolderRole;
  kind: AssetKind;
}

export const assetFolderRoleRules: AssetFolderRule[] = [
  { folderName: 'Fanart - Front', role: 'front', kind: 'fanart-box-front' },
  { folderName: 'Box - Front', role: 'front', kind: 'box-front' },
  { folderName: 'Clear Logo', role: 'logo', kind: 'clear-logo' },
  { folderName: 'Background', role: 'background', kind: 'background' },
];

export const ignoredAutoRoleFolderNames = ['Fanart - Background', 'Screenshot - Gameplay'];
const launchBoxOptimizedFolderNames = ['Box - Front', 'Fanart - Front', 'Clear Logo'];

function normalizeFolderName(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

export function findAssetFolderRuleByName(folderName: string | undefined) {
  const normalized = normalizeFolderName(folderName);
  return assetFolderRoleRules.find((rule) => normalizeFolderName(rule.folderName) === normalized);
}

export function launchBoxAutoScanFolderNames(settings?: AssetSourceGroupSettings) {
  return launchBoxOptimizedFolderNames.filter((folderName) => {
    const rule = findAssetFolderRuleByName(folderName);
    if (!rule || !settings) return true;
    return settings[rule.role] !== false;
  });
}

export function isIgnoredAutoRoleFolderName(folderName: string | undefined) {
  const normalized = normalizeFolderName(folderName);
  return ignoredAutoRoleFolderNames.some((ignored) => normalizeFolderName(ignored) === normalized);
}

export function findAssetFolderRuleInPath(path: string | null | undefined) {
  const parts = splitPathParts(path);
  return parts.map(findAssetFolderRuleByName).find((rule): rule is AssetFolderRule => Boolean(rule));
}

export function findKnownAssetFolderIndex(parts: string[]) {
  return parts.findIndex((part) => Boolean(findAssetFolderRuleByName(part)) || isIgnoredAutoRoleFolderName(part));
}

export function autoRoleKindForPath(path: string | null | undefined) {
  return findAssetFolderRuleInPath(path)?.kind;
}

export function assetSourceRoleLabel(role: AssetKind | 'mixed' | undefined) {
  if (!role || role === 'mixed') return '자동';
  if (role === 'box-front' || role === 'fanart-box-front') return 'Front';
  if (role === 'clear-logo') return 'Logo';
  if (role === 'background') return 'Background';
  if (role === 'unknown') return 'Unknown';
  return role;
}

export const assetSourceRoleOptions: Array<{ value: AssetKind | 'mixed'; label: string; helper: string }> = [
  { value: 'mixed', label: '자동', helper: '폴더명으로 역할을 자동 판정합니다.' },
  { value: 'box-front', label: 'Front', helper: '카드 Main Image 후보로 사용합니다.' },
  { value: 'clear-logo', label: 'Logo', helper: 'Clear Logo / 제목 이미지 후보로 사용합니다.' },
  { value: 'background', label: 'Background', helper: '템플릿 배경 이미지 후보로 사용합니다.' },
  { value: 'unknown', label: 'Unknown', helper: '자동 매칭에 사용하지 않는 보관 그룹입니다.' },
];
