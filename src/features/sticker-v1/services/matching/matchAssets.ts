import type { AssetKind, AssetLibrary, AssetMatchCandidate, AssetMatchResult, Category, GameEntry, LocalAsset, MameCandidate, MameMappingDataset, MameMachine } from '@sticker-v1/types';
import { mameOverrideKey } from '@sticker-v1/services/mame/mameMapping';
import { normalizeName } from '@sticker-v1/utils/normalizeName';

const consoleHeroPriority: AssetKind[] = ['box-front', 'fanart-box-front'];
const arcadeHeroPriority: AssetKind[] = ['box-front', 'fanart-box-front'];
const titlePriority: AssetKind[] = ['clear-logo'];

type MatchLookupResult = { asset?: LocalAsset; candidates: AssetMatchCandidate[]; metadata?: AssetMatchResult['mameMatch'] };
type MameTargetReason = NonNullable<AssetMatchResult['mameMatch']>['reason'];

function isArcadeCategory(category?: Category) {
  const value = `${category?.name ?? ''} ${category?.displayName ?? ''}`.toLowerCase();
  return value.includes('arcade') || value.includes('mame');
}

function scoreAsset(asset: LocalAsset, target: string, reason = `${asset.kind} priority match`): AssetMatchCandidate & { asset: LocalAsset } {
  let score = 0;
  if (asset.normalizedName === target) score = 100;
  else if (asset.normalizedName.includes(target) || target.includes(asset.normalizedName)) score = 80;
  else {
    const targetTokens = new Set(target.split(' '));
    const assetTokens = asset.normalizedName.split(' ');
    const overlap = assetTokens.filter((token) => targetTokens.has(token)).length;
    score = overlap > 0 ? Math.round((overlap / targetTokens.size) * 60) : 0;
  }
  return {
    asset,
    assetId: asset.id,
    kind: asset.kind,
    normalizedName: asset.normalizedName,
    score,
    reason,
  };
}

function scoreGeneric(asset: LocalAsset, target: string): number {
  if (asset.normalizedName === target) return 100;
  if (asset.normalizedName.includes(target) || target.includes(asset.normalizedName)) return 80;
  const targetTokens = new Set(target.split(' '));
  const assetTokens = asset.normalizedName.split(' ');
  const overlap = assetTokens.filter((token) => targetTokens.has(token)).length;
  return overlap > 0 ? Math.round((overlap / targetTokens.size) * 60) : 0;
}

function findBestByPriority(
  assets: LocalAsset[],
  targets: string[],
  priority: AssetKind[],
): { asset?: LocalAsset; candidates: AssetMatchCandidate[] } {
  const candidates = assets
    .filter((asset) => priority.includes(asset.kind))
    .map((asset) => {
      const scores = targets.map((target) => scoreGeneric(asset, target));
      return {
        asset,
        score: Math.max(...scores),
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      const priorityDelta = priority.indexOf(a.asset.kind) - priority.indexOf(b.asset.kind);
      return priorityDelta === 0 ? b.score - a.score : priorityDelta;
    });

  return {
    asset: candidates[0]?.asset,
    candidates: candidates.slice(0, 5).map((candidate) => ({
      assetId: candidate.asset.id,
      kind: candidate.asset.kind,
      normalizedName: candidate.asset.normalizedName,
      score: candidate.score,
      reason: `${candidate.asset.kind} priority match`,
    })),
  };
}

function machineCandidate(machine: MameMachine, score: number, reason: MameCandidate['reason']): MameCandidate {
  return {
    romName: machine.romName,
    displayTitle: machine.displayTitle,
    parentRom: machine.parentRom,
    category: machine.category,
    manufacturer: machine.manufacturer,
    year: machine.year,
    score,
    reason,
  };
}

function mameReasonFromCandidate(reason: MameCandidate['reason']): MameTargetReason {
  if (reason === 'rom_name match') return 'matched by rom_name';
  if (reason === 'parent_rom fallback') return 'matched by parent_rom';
  if (reason === 'display_title match') return 'matched by display_title';
  if (reason === 'alias match') return 'matched by alias';
  if (reason === 'user override') return 'matched by user override';
  return 'fell back to generic matching';
}

function findMachineCandidates(game: GameEntry, category: Category | undefined, mapping: MameMappingDataset) {
  const normalizedTitle = normalizeName(game.title);
  const override = mapping.userOverrides[mameOverrideKey(game.title, category?.id ?? game.categoryId)];
  if (override) {
    const machine = mapping.machines.find((candidate) => candidate.romName === override.romName);
    return {
      override,
      candidates: machine ? [machineCandidate(machine, 100, 'user override')] : [],
    };
  }
  const byRom = mapping.indexes.romName[normalizedTitle];
  if (byRom) {
    const machine = mapping.machines.find((candidate) => candidate.romName === byRom);
    return { candidates: machine ? [machineCandidate(machine, 100, 'rom_name match')] : [] };
  }
  const parentMatches = mapping.indexes.parentRom[normalizedTitle] ?? [];
  const displayMatches = mapping.indexes.displayTitle[normalizedTitle] ?? [];
  const aliasMatches = mapping.indexes.alias[normalizedTitle] ?? [];
  const fuzzyMatches = mapping.machines
    .filter((machine) => machine.normalizedDisplayTitle.includes(normalizedTitle) || normalizedTitle.includes(machine.normalizedDisplayTitle))
    .map((machine) => machine.romName);
  const candidates = [
    ...parentMatches.map((rom) => ({ rom, score: 92, reason: 'parent_rom fallback' as const })),
    ...displayMatches.map((rom) => ({ rom, score: 88, reason: 'display_title match' as const })),
    ...aliasMatches.map((rom) => ({ rom, score: 84, reason: 'alias match' as const })),
    ...fuzzyMatches.map((rom) => ({ rom, score: 72, reason: 'fuzzy similarity' as const })),
  ];
  const seen = new Set<string>();
  return {
    candidates: candidates
      .filter((candidate) => {
        if (seen.has(candidate.rom)) return false;
        seen.add(candidate.rom);
        return true;
      })
      .map((candidate) => {
        const machine = mapping.machines.find((entry) => entry.romName === candidate.rom);
        return machine ? machineCandidate(machine, candidate.score, candidate.reason) : undefined;
      })
      .filter((candidate): candidate is MameCandidate => Boolean(candidate))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  };
}

function findMameMasterForGame(game: GameEntry, category: Category | undefined, mapping: MameMappingDataset) {
  if (mapping.machines.length > 0) {
    const { candidates, override } = findMachineCandidates(game, category, mapping);
    const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < 15;
    const selectedCandidate = ambiguous ? undefined : candidates[0];
    return {
      machine: selectedCandidate ? mapping.machines.find((entry) => entry.romName === selectedCandidate.romName) : undefined,
      candidates,
      override,
      ambiguous,
    };
  }
  const normalizedTitle = normalizeName(game.title);
  const master = (
    mapping.masterRows.find((row) => row.normalizedRomName === normalizedTitle) ??
    mapping.masterRows.find((row) => row.normalizedDisplayTitle === normalizedTitle) ??
    mapping.masterRows.find((row) => row.normalizedDisplayTitle.includes(normalizedTitle) || normalizedTitle.includes(row.normalizedDisplayTitle)) ??
    mapping.masterRows.find((row) =>
      mapping.aliasRows.some(
        (alias) => alias.normalizedRomName === row.normalizedRomName && alias.aliasNormalized === normalizedTitle,
      ),
    )
  );
  return {
    machine: master
      ? {
          romName: master.romName,
          displayTitle: master.displayTitle,
          parentRom: master.parentRom || undefined,
          isClone: master.isClone,
          category: master.category || 'Arcade',
          normalizedRomName: master.normalizedRomName,
          normalizedDisplayTitle: master.normalizedDisplayTitle,
          normalizedParentRom: master.normalizedParentRom,
          normalizedAliases: [],
        }
      : undefined,
    candidates: master ? [machineCandidate({
      romName: master.romName,
      displayTitle: master.displayTitle,
      parentRom: master.parentRom || undefined,
      isClone: master.isClone,
      category: master.category || 'Arcade',
      normalizedRomName: master.normalizedRomName,
      normalizedDisplayTitle: master.normalizedDisplayTitle,
      normalizedParentRom: master.normalizedParentRom,
      normalizedAliases: [],
    }, 100, 'display_title match')] : [],
    ambiguous: false,
  };
}

function buildMameTargets(game: GameEntry, category: Category | undefined, mapping: MameMappingDataset) {
  const resolution = findMameMasterForGame(game, category, mapping);
  const entry = resolution.machine;
  const normalizedTitle = normalizeName(game.title);
  if (resolution.ambiguous) {
    return {
      targets: [{ value: normalizedTitle, reason: 'fell back to generic matching' as const }],
      entry: undefined,
      ambiguous: true,
      metadata: {
        used: true,
        state: 'ambiguous' as const,
        reason: 'fell back to generic matching' as const,
        candidates: resolution.candidates,
      },
    };
  }
  if (!entry) {
    return {
      targets: [{ value: normalizedTitle, reason: 'fell back to generic matching' as const }],
      entry: undefined,
      metadata: { used: false, state: 'unmatched' as const, reason: 'fell back to generic matching' as const, candidates: resolution.candidates },
    };
  }
  const aliases = mapping.machines.length > 0
    ? entry.normalizedAliases.map((alias) => ({ aliasNormalized: alias, alias }))
    : mapping.aliasRows.filter((alias) => alias.normalizedRomName === entry.normalizedRomName).sort((a, b) => b.priority - a.priority);
  const targets = [
    { value: entry.normalizedRomName, reason: 'matched by rom_name' as const },
    ...(entry.normalizedParentRom ? [{ value: entry.normalizedParentRom, reason: 'matched by parent_rom' as const }] : []),
    { value: entry.normalizedDisplayTitle, reason: 'matched by display_title' as const },
    ...aliases.map((alias) => ({ value: alias.aliasNormalized, reason: 'matched by alias' as const, alias: alias.alias })),
    { value: normalizedTitle, reason: 'fell back to generic matching' as const },
  ];
  return {
    targets,
    entry,
    metadata: {
      used: true,
      state: 'confirmed' as const,
      reason: resolution.override ? 'matched by user override' as const : mameReasonFromCandidate(resolution.candidates[0]?.reason ?? 'rom_name match'),
      romName: entry.romName,
      parentRom: entry.parentRom || undefined,
      displayTitle: entry.displayTitle,
      candidates: resolution.candidates,
    },
  };
}

function findBestMameByPriority(
  assets: LocalAsset[],
  game: GameEntry,
  category: Category | undefined,
  mapping: MameMappingDataset,
  priority: AssetKind[],
): MatchLookupResult {
  const { targets, entry, metadata } = buildMameTargets(game, category, mapping);
  const candidates = assets
    .filter((asset) => priority.includes(asset.kind))
    .flatMap((asset) =>
      targets.map((target, index) => {
        const candidate = scoreAsset(asset, target.value, target.reason);
        return {
          ...candidate,
          priorityIndex: index,
          alias: 'alias' in target ? target.alias : undefined,
        };
      }),
    )
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      if (a.priorityIndex !== b.priorityIndex) return a.priorityIndex - b.priorityIndex;
      const priorityDelta = priority.indexOf(a.asset.kind) - priority.indexOf(b.asset.kind);
      if (priorityDelta !== 0) return priorityDelta;
      return b.score - a.score;
    });
  const best = candidates[0];
  return {
    asset: best?.asset,
    candidates: candidates.slice(0, 5).map((candidate) => ({
      assetId: candidate.asset.id,
      kind: candidate.asset.kind,
      normalizedName: candidate.asset.normalizedName,
      score: candidate.score,
      reason: candidate.reason,
    })),
    metadata: best
      ? {
          ...metadata,
          used: true,
          state: 'confirmed',
          reason: best.reason as NonNullable<AssetMatchResult['mameMatch']>['reason'],
          romName: entry?.romName,
          parentRom: entry?.parentRom || undefined,
          displayTitle: entry?.displayTitle,
          alias: best.alias,
        }
      : metadata,
  };
}

function isLowResolutionTitle(asset?: LocalAsset) {
  if (!asset?.width || !asset.height) return false;
  return asset.width < 180 || asset.height < 60;
}

export function matchAssetsForGames(
  games: GameEntry[],
  categories: Category[],
  library: AssetLibrary,
  mameMapping: MameMappingDataset = {
    machines: [],
    indexes: { romName: {}, parentRom: {}, displayTitle: {}, alias: {} },
    userOverrides: {},
    masterRows: [],
    aliasRows: [],
  },
): Record<string, AssetMatchResult> {
  const assets = Object.values(library.assetsById);
  const results: Record<string, AssetMatchResult> = {};

  games.forEach((game) => {
    const category = categories.find((candidate) => candidate.id === game.categoryId);
    const useMame = isArcadeCategory(category) && (mameMapping.machines.length > 0 || mameMapping.masterRows.length > 0);
    const normalizedTargets = [normalizeName(game.title)];
    const heroPriority = isArcadeCategory(category) ? arcadeHeroPriority : consoleHeroPriority;
    const hero: MatchLookupResult = useMame
      ? findBestMameByPriority(assets, game, category, mameMapping, heroPriority)
      : findBestByPriority(assets, normalizedTargets, heroPriority);
    const title: MatchLookupResult = useMame
      ? findBestMameByPriority(assets, game, category, mameMapping, titlePriority)
      : findBestByPriority(assets, normalizedTargets, titlePriority);
    const mameMatch = useMame ? hero.metadata ?? title.metadata : undefined;
    const normalizedCategory = normalizeName(category?.displayName ?? category?.name ?? '');
    const back = findBestByPriority(assets.filter((asset) => asset.kind === 'card-back'), [normalizedCategory], ['card-back']);
    const titleIsLowResolution = isLowResolutionTitle(title.asset);
    const warnings: AssetMatchResult['warnings'] = [];

    if (!hero.asset) warnings.push('NO_HERO');
    if (!title.asset) warnings.push('NO_TITLE_IMAGE');
    if (titleIsLowResolution) warnings.push('LOW_RES_TITLE');
    if (!back.asset) warnings.push('NO_BACK_IMAGE');

    results[game.id] = {
      gameId: game.id,
      categoryId: game.categoryId,
      heroImageAssetId: hero.asset?.id,
      titleImageAssetId: titleIsLowResolution ? undefined : title.asset?.id,
      backImageAssetId: back.asset?.id,
      fallbackTextTitle: game.title,
      sourceAssetIds: [hero.asset?.id, title.asset?.id, back.asset?.id].filter(Boolean) as string[],
      candidates: [...hero.candidates, ...title.candidates, ...back.candidates],
      mameMatch,
      matchConfidence: Math.max(hero.candidates[0]?.score ?? 0, title.candidates[0]?.score ?? 0),
      titleMode: title.asset && !titleIsLowResolution ? 'IMAGE' : 'TEXT',
      warnings,
    };
  });

  return results;
}
