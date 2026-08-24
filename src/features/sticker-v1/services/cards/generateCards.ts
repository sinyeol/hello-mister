import type { AssetMatchResult, CardItem, Category, GameEntry } from '@sticker-v1/types';

export function generateCardsFromProject(
  games: GameEntry[],
  categories: Category[],
  matches: Record<string, AssetMatchResult>,
): CardItem[] {
  return games.map((game, index) => {
    const category = categories.find((candidate) => candidate.id === game.categoryId);
    const match = matches[game.id];
    const frontTemplateId = game.metadata?.templateId ?? category?.defaultFrontTemplateId;
    const backTemplateId = category?.defaultBackTemplateId;
    const coordinateLockKey = `card:${index}:${game.id}`;

    return {
      id: `card_${game.id}`,
      gameId: game.id,
      categoryId: game.categoryId,
      layoutMode: frontTemplateId ? 'CUSTOM' : 'UNASSIGNED',
      customTemplateId: frontTemplateId,
      printOrder: index,
      coordinateLockKey,
      front: {
        side: 'front',
        templateId: frontTemplateId,
        layoutMode: frontTemplateId ? 'CUSTOM' : 'UNASSIGNED',
        heroImageAssetId: match?.heroImageAssetId,
        titleImageAssetId: match?.titleImageAssetId,
        titleText: match?.fallbackTextTitle ?? game.title,
        categoryLabel: category?.displayName ?? '',
        platformLabel: category?.displayName ?? '',
      },
      back: {
        side: 'back',
        templateId: backTemplateId,
        categoryId: game.categoryId,
        backgroundImageAssetId: match?.backImageAssetId ?? category?.backImageFileId,
        generatedFallback: !match?.backImageAssetId && !category?.backImageFileId && !category?.backImagePath,
        categoryLabel: category?.displayName ?? '',
      },
    };
  });
}
