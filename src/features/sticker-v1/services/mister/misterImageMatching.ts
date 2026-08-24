import type { AssetLibrary, LocalAsset, MiSTerImageMatchResult, MiSTerMappingState, MiSTerScanEntry } from '@sticker-v1/types';
import { normalizeName } from '@sticker-v1/utils/normalizeName';
import { filterAssetsByEnabledGroups } from '@sticker-v1/services/assets/assetSourceGroups';

const priority = ['clear-logo', 'box-front', 'fanart-box-front'];
const launchBoxFolders = [
  { label: 'Clear Logo', score: 50 },
  { label: 'Box - Front', score: 40 },
  { label: 'Fanart - Front', score: 38 },
];

function launchBoxPriorityScore(asset: LocalAsset) {
  const haystack = `${asset.path ?? ''} ${asset.sourceLabel ?? ''} ${asset.name}`.toLowerCase();
  const match = launchBoxFolders.find((folder) => haystack.includes(folder.label.toLowerCase()));
  return match?.score ?? 0;
}

function applyAliases(value: string, mapping: MiSTerMappingState) {
  const normalized = normalizeName(value);
  const alias = mapping.aliases.find((rule) => normalizeName(rule.from) === normalized || normalized.includes(normalizeName(rule.from)));
  return { value: alias ? normalizeName(alias.to) : normalized, aliasApplied: Boolean(alias) };
}

function scoreAsset(asset: LocalAsset, targets: string[]) {
  const basePriority = priority.indexOf(asset.kind);
  const priorityScore = basePriority === -1 ? 0 : (priority.length - basePriority) * 10;
  const launchBoxScore = launchBoxPriorityScore(asset);
  const name = asset.normalizedName;
  const bestTargetScore = Math.max(
    ...targets.map((target) => {
      if (name === target) return 100;
      if (name.includes(target) || target.includes(name)) return 82;
      const targetTokens = new Set(target.split(' '));
      const overlap = name.split(' ').filter((token) => targetTokens.has(token)).length;
      return overlap > 0 ? Math.round((overlap / Math.max(1, targetTokens.size)) * 60) : 0;
    }),
  );
  return bestTargetScore + priorityScore + launchBoxScore;
}

export function matchMiSTerEntryImages(
  entries: MiSTerScanEntry[],
  assetLibrary: AssetLibrary | undefined,
  mapping: MiSTerMappingState,
): MiSTerScanEntry[] {
  const assets = filterAssetsByEnabledGroups(Object.values(assetLibrary?.assetsById ?? {})).filter((asset) => asset.kind !== 'card-back');
  if (assets.length === 0) {
    return entries.map((entry) => ({
      ...entry,
      imageMatch: { state: 'unmatched', candidates: [], reason: 'No image assets are loaded.' },
      imageMatched: false,
    }));
  }

  return entries.map((entry) => {
    const override = mapping.overrides.find((candidate) => candidate.imageMatchKey === entry.imageMatchKey);
    if (override) {
      const asset = assetLibrary?.assetsById[override.assetId];
      const result: MiSTerImageMatchResult = {
        state: asset ? 'matched' : 'unmatched',
        assetId: asset?.id,
        candidates: asset
          ? [{ assetId: asset.id, name: asset.name, kind: asset.kind, sourcePath: asset.path, sourceLabel: asset.sourceLabel, score: 120, reason: 'user override' }]
          : [],
        reason: asset ? 'matched by user override' : 'saved override asset is missing',
        aliasApplied: true,
      };
      return { ...entry, imageMatch: result, imageMatched: Boolean(asset), aliasApplied: true };
    }

    const titleTarget = applyAliases(entry.title, mapping);
    const romTarget = applyAliases(entry.romName.replace(/\.[^.]+$/, ''), mapping);
    const targets = Array.from(new Set([titleTarget.value, romTarget.value, entry.imageMatchKey].filter(Boolean)));
    const candidates = assets
      .map((asset) => ({
        asset,
        score: scoreAsset(asset, targets),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < 10;
    const result: MiSTerImageMatchResult = {
      state: candidates.length === 0 ? 'unmatched' : ambiguous ? 'ambiguous' : 'matched',
      assetId: !ambiguous ? candidates[0]?.asset.id : undefined,
      candidates: candidates.map((candidate) => ({
        assetId: candidate.asset.id,
        name: candidate.asset.name,
        kind: candidate.asset.kind,
        sourcePath: candidate.asset.path,
        sourceLabel: candidate.asset.sourceLabel,
        score: candidate.score,
        reason: `${candidate.asset.kind} priority match`,
      })),
      reason: candidates.length === 0 ? 'no image candidate found' : ambiguous ? 'multiple similar image candidates' : 'automatic image match',
      aliasApplied: titleTarget.aliasApplied || romTarget.aliasApplied,
    };
    return { ...entry, imageMatch: result, imageMatched: result.state === 'matched', aliasApplied: result.aliasApplied };
  });
}
