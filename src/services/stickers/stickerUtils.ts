import type {
  StickerCard,
  StickerCardSizePreset,
  StickerImageAssetType,
  StickerImageItem,
  StickerSheet,
  StickerSheetLayout,
  StickerTemplate,
} from '../../types/stickers';

export const STICKER_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

export function nowIso() {
  return new Date().toISOString();
}

export function createStickerId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function basenameOnly(pathValue: string) {
  return pathValue.split(/[\\/]/).filter(Boolean).pop() || pathValue;
}

export function maskStickerLocalPath(pathValue?: string, includeFullLocalPaths = false) {
  if (!pathValue) return pathValue;
  if (includeFullLocalPaths) return pathValue;
  return basenameOnly(pathValue);
}

export function stickerImageSrc(localPath?: string) {
  if (!localPath) return undefined;
  if (/^(file|https?|data):/i.test(localPath)) return localPath;
  if (/^[a-zA-Z]:[\\/]/.test(localPath)) return `file:///${localPath.replace(/\\/g, '/')}`;
  return localPath;
}

export function normalizeStickerGameName(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return withoutExtension
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isStickerImageExtension(extension: string) {
  return STICKER_IMAGE_EXTENSIONS.includes(extension.toLowerCase());
}

export function recommendStickerAssetType(filePath: string): StickerImageAssetType {
  const lower = filePath.toLowerCase();
  if (/(^|[\\/])(?:covers?|box|boxart|front)([\\/]|$)/.test(lower) || /(?:cover|box|boxart|front)/.test(lower)) return 'cover';
  if (/(^|[\\/])(?:titles?|title-screen)([\\/]|$)/.test(lower) || /(?:title|title-screen)/.test(lower)) return 'title';
  if (/(^|[\\/])(?:logos?|wheel|clear logo|clearlogo)([\\/]|$)/.test(lower) || /(?:logo|wheel|clearlogo|clear logo)/.test(lower)) return 'logo';
  if (/(^|[\\/])(?:marquees?)([\\/]|$)/.test(lower) || /marquee/.test(lower)) return 'marquee';
  if (/(^|[\\/])(?:snaps?|screenshots?|screen)([\\/]|$)/.test(lower) || /(?:snap|screenshot|screen)/.test(lower)) return 'screenshot';
  if (/(^|[\\/])(?:backgrounds?|bg)([\\/]|$)/.test(lower) || /(?:background|wallpaper|\bbg\b)/.test(lower)) return 'background';
  if (/(?:template|overlay|frame)/.test(lower)) return 'templateAsset';
  return 'unknown';
}

export function guessPlatformFromName(name: string) {
  const lower = name.toLowerCase();
  if (/(nes|famicom)/.test(lower)) return 'NES';
  if (/(snes|super famicom|sfc)/.test(lower)) return 'SNES';
  if (/(mega drive|megadrive|genesis)/.test(lower)) return 'Genesis';
  if (/(game boy advance|gba)/.test(lower)) return 'GBA';
  if (/(game boy color|gbc)/.test(lower)) return 'GBC';
  if (/(game boy|gb)/.test(lower)) return 'Game Boy';
  if (/(pc engine|pce|turbografx|tgfx)/.test(lower)) return 'PC Engine';
  if (/(neo geo|neogeo)/.test(lower)) return 'NeoGeo';
  if (/(arcade|mame|fbneo)/.test(lower)) return 'Arcade';
  return undefined;
}

export function createStickerImageItem(filePath: string, metadata: {
  sizeBytes: number;
  modifiedAt?: string;
  sourceId?: string;
  width?: number;
  height?: number;
}): StickerImageItem {
  const fileName = basenameOnly(filePath);
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop() || ''}`.toLowerCase() : '';
  const normalizedName = normalizeStickerGameName(fileName);
  const timestamp = nowIso();
  return {
    imageId: `image-${hashText(filePath).slice(0, 16)}`,
    sourceId: metadata.sourceId || `source-${hashText(filePath.split(/[\\/]/).slice(0, -1).join('/')).slice(0, 12)}`,
    fileName,
    basename: fileName.replace(/\.[^.]+$/, ''),
    extension,
    sizeBytes: metadata.sizeBytes,
    modifiedAt: metadata.modifiedAt,
    localPath: filePath,
    maskedPath: maskStickerLocalPath(filePath) || fileName,
    width: metadata.width,
    height: metadata.height,
    assetType: recommendStickerAssetType(filePath),
    normalizedName,
    possibleGameTitle: normalizedName || undefined,
    possiblePlatform: guessPlatformFromName(filePath),
    importedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function formatBytes(bytes?: number) {
  if (!Number.isFinite(bytes || 0)) return '-';
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

export function builtInStickerTemplates(now = nowIso()): StickerTemplate[] {
  const base = {
    version: '1.0.0',
    size: { width: 86, height: 54, unit: 'mm' as const },
    bleed: 2,
    printSafeArea: { x: 5, y: 5, width: 76, height: 44 },
    createdAt: now,
    updatedAt: now,
    isBuiltIn: true,
  };
  return [
    {
      ...base,
      templateId: 'builtin-basic-card',
      name: '기본 카드형',
      description: 'NFC 카드 스티커에 맞춘 가장 단순한 기본 템플릿입니다.',
      background: { color: '#f8fafc', accentColor: '#0891b2' },
      imageSlots: [{ id: 'main', label: '메인 이미지', x: 6, y: 6, width: 74, height: 30, radius: 4 }],
      textSlots: [
        { id: 'title', label: '제목', x: 7, y: 39, width: 72, fontSize: 4.2, color: '#111827', weight: 'bold' },
        { id: 'subtitle', label: '부제', x: 7, y: 45, width: 72, fontSize: 2.8, color: '#475569' },
      ],
      nfcPathSlot: 'subtitle',
      isFavorite: true,
      isDefault: true,
    },
    {
      ...base,
      templateId: 'builtin-neogeo-style',
      name: '네오지오 스타일',
      description: '굵은 컬러 바와 로고 영역을 둔 아케이드풍 카드입니다.',
      background: { color: '#111827', accentColor: '#dc2626' },
      imageSlots: [{ id: 'main', label: '메인 이미지', x: 8, y: 8, width: 70, height: 28, radius: 2 }],
      textSlots: [
        { id: 'title', label: '제목', x: 8, y: 39, width: 70, fontSize: 4, color: '#ffffff', weight: 'bold' },
        { id: 'platform', label: '플랫폼', x: 8, y: 45, width: 70, fontSize: 2.8, color: '#fecaca' },
      ],
    },
    {
      ...base,
      templateId: 'builtin-cd-cover',
      name: 'CD 커버 스타일',
      description: '정사각형 커버 이미지를 크게 보여주는 디스크 기반 게임용 템플릿입니다.',
      background: { color: '#eef2ff', accentColor: '#4338ca' },
      imageSlots: [{ id: 'main', label: '커버 이미지', x: 5, y: 5, width: 38, height: 38, radius: 3 }],
      textSlots: [
        { id: 'title', label: '제목', x: 47, y: 14, width: 33, fontSize: 4, color: '#1e1b4b', weight: 'bold' },
        { id: 'subtitle', label: '부제', x: 47, y: 31, width: 33, fontSize: 2.8, color: '#3730a3' },
      ],
    },
    {
      ...base,
      templateId: 'builtin-minimal-label',
      name: '미니멀 라벨',
      description: '텍스트와 작은 이미지 중심의 차분한 라벨 템플릿입니다.',
      background: { color: '#ffffff', accentColor: '#0f766e' },
      imageSlots: [{ id: 'main', label: '작은 이미지', x: 8, y: 9, width: 24, height: 24, radius: 4 }],
      textSlots: [
        { id: 'title', label: '제목', x: 36, y: 16, width: 42, fontSize: 4.2, color: '#0f172a', weight: 'bold' },
        { id: 'platform', label: '플랫폼', x: 36, y: 27, width: 42, fontSize: 2.8, color: '#64748b' },
      ],
    },
    {
      ...base,
      templateId: 'builtin-arcade-label',
      name: '아케이드 라벨',
      description: '마키와 스냅샷 느낌을 섞은 아케이드 캐비넷용 템플릿입니다.',
      background: { color: '#fff7ed', accentColor: '#ea580c' },
      imageSlots: [{ id: 'main', label: '스냅샷', x: 6, y: 11, width: 74, height: 26, radius: 2 }],
      textSlots: [
        { id: 'title', label: '제목', x: 7, y: 40, width: 72, fontSize: 4, color: '#7c2d12', weight: 'bold' },
        { id: 'platform', label: '코어', x: 7, y: 46, width: 72, fontSize: 2.6, color: '#9a3412' },
      ],
    },
    {
      ...base,
      templateId: 'builtin-tapto-nfc',
      name: 'TapTo/NFC 카드형',
      description: 'NFC 실행 경로를 작은 텍스트로 함께 기록할 수 있는 템플릿입니다.',
      background: { color: '#ecfeff', accentColor: '#0e7490' },
      imageSlots: [{ id: 'main', label: '메인 이미지', x: 7, y: 7, width: 72, height: 27, radius: 5 }],
      textSlots: [
        { id: 'title', label: '제목', x: 7, y: 38, width: 72, fontSize: 3.8, color: '#164e63', weight: 'bold' },
        { id: 'path', label: 'NFC 경로', x: 7, y: 45, width: 72, fontSize: 2.3, color: '#0e7490' },
      ],
      nfcPathSlot: 'path',
    },
  ];
}

export function canDeleteStickerTemplate(template: StickerTemplate) {
  return !template.isBuiltIn;
}

export function createEmptyStickerCard(templateId = 'builtin-basic-card'): StickerCard {
  const timestamp = nowIso();
  return {
    cardId: createStickerId('card'),
    title: '',
    subtitle: '',
    platform: '',
    gameTitle: '',
    templateId,
    imageId: undefined,
    imagePath: undefined,
    launchPathCandidate: '',
    nfcPathCandidate: '',
    notes: '',
    tags: [],
    status: 'draft',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createDefaultStickerSheet(selectedCardIds: string[] = []): StickerSheet {
  const timestamp = nowIso();
  return {
    sheetId: createStickerId('sheet'),
    name: `스티커 시트 ${timestamp.slice(0, 10)}`,
    paperPreset: 'A4',
    cardSizePreset: 'nfc-card',
    rows: 5,
    columns: 2,
    gapMm: 4,
    marginMm: 10,
    selectedCardIds,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function cardSizeForPreset(preset: StickerCardSizePreset, customWidth?: number, customHeight?: number) {
  if (preset === 'sticker-label') return { widthMm: 70, heightMm: 45 };
  if (preset === 'custom') return { widthMm: customWidth || 86, heightMm: customHeight || 54 };
  return { widthMm: 86, heightMm: 54 };
}

export function calculateStickerSheetLayout(sheet: StickerSheet): StickerSheetLayout {
  const paper = sheet.paperPreset === 'Letter' ? { widthMm: 215.9, heightMm: 279.4 } : { widthMm: 210, heightMm: 297 };
  const card = cardSizeForPreset(sheet.cardSizePreset, sheet.customCardWidthMm, sheet.customCardHeightMm);
  const items = sheet.selectedCardIds.slice(0, sheet.rows * sheet.columns).map((cardId, index) => {
    const row = Math.floor(index / sheet.columns);
    const column = index % sheet.columns;
    return {
      cardId,
      row,
      column,
      xMm: sheet.marginMm + column * (card.widthMm + sheet.gapMm),
      yMm: sheet.marginMm + row * (card.heightMm + sheet.gapMm),
      widthMm: card.widthMm,
      heightMm: card.heightMm,
    };
  });
  const requiredWidth = sheet.marginMm * 2 + sheet.columns * card.widthMm + Math.max(0, sheet.columns - 1) * sheet.gapMm;
  const requiredHeight = sheet.marginMm * 2 + sheet.rows * card.heightMm + Math.max(0, sheet.rows - 1) * sheet.gapMm;
  const warnings = [];
  if (requiredWidth > paper.widthMm) warnings.push('가로 배치가 용지 폭을 넘습니다.');
  if (requiredHeight > paper.heightMm) warnings.push('세로 배치가 용지 높이를 넘습니다.');
  return {
    paperWidthMm: paper.widthMm,
    paperHeightMm: paper.heightMm,
    cardWidthMm: card.widthMm,
    cardHeightMm: card.heightMm,
    items,
    warnings,
  };
}

export function mergeUniqueById<T extends object>(items: T[], idKey: keyof T) {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(String(item[idKey]), item);
  return Array.from(byId.values());
}
