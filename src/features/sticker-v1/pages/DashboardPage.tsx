import { useState } from 'react';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { PlaceholderPanel } from '@sticker-v1/components/common/PlaceholderPanel';
import { buildFullBackup, parseFullBackup } from '@sticker-v1/services/backup/fullBackup';
import { getManyCardFullData } from '@sticker-v1/services/cards/savedCardsPersistence';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import type { SavedCardRecord, Template, ZaparooLibraryState } from '@sticker-v1/types';

function mergeZaparooLibrary(current: ZaparooLibraryState, incoming: ZaparooLibraryState): ZaparooLibraryState {
  const entries = new Map(current.entries.map((entry) => [entry.id, entry]));
  incoming.entries.forEach((entry) => entries.set(entry.id, entry));
  const profiles = new Map(current.profiles.map((profile) => [profile.deviceId, profile]));
  incoming.profiles.forEach((profile) => profiles.set(profile.deviceId, profile));
  return {
    ...current,
    entries: Array.from(entries.values()).sort((a, b) => a.title.localeCompare(b.title)),
    profiles: Array.from(profiles.values()).sort((a, b) => b.lastSyncAt.localeCompare(a.lastSyncAt)),
    hiddenPlatformKeys: Array.from(new Set([...(current.hiddenPlatformKeys ?? []), ...(incoming.hiddenPlatformKeys ?? [])])),
    backups: [...(current.backups ?? []), ...(incoming.backups ?? [])],
    updatedAt: new Date().toISOString(),
  };
}

function uniqueTemplate(template: Template, existingIds: Set<string>, suffix: string): Template {
  if (!existingIds.has(template.id)) {
    existingIds.add(template.id);
    return template;
  }
  const id = `${template.id}_backup_${suffix}`;
  existingIds.add(id);
  return { ...template, id, name: `${template.name} (backup)` };
}

function uniqueSavedCard(record: SavedCardRecord, existingIds: Set<string>, suffix: string): SavedCardRecord {
  if (!existingIds.has(record.id)) {
    existingIds.add(record.id);
    return record;
  }
  const id = `${record.id}_backup_${suffix}`;
  existingIds.add(id);
  return {
    ...record,
    id,
    title: `${record.title} (backup)`,
    card: {
      ...record.card,
      id: `${record.card.id}_backup_${suffix}`,
      coordinateLockKey: `card:backup:${suffix}:${record.id}`,
    },
  };
}

export function DashboardPage() {
  const {
    name,
    games,
    templates,
    cards,
    savedCardIndex,
    zaparooLibrary,
    mister,
    assetLibrary,
    addTemplate,
    importSavedCards,
    setMiSTerState,
    setZaparooLibrary,
    setAssetLibrary,
  } = useProjectStore();
  const [backupMessage, setBackupMessage] = useState('');
  const activeSavedCards = savedCardIndex.filter((record) => !record.deletedAt);
  const deletedSavedCards = savedCardIndex.length - activeSavedCards.length;

  async function exportFullBackup() {
    const savedCards = await getManyCardFullData(savedCardIndex.map((record) => record.id));
    const { blob, manifest } = await buildFullBackup({
      zaparooLibrary,
      mister,
      templates,
      savedCards,
      assetLibrary,
      settings: { projectName: name },
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `hello-mister-full-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage(
      manifest.warnings.length
        ? `전체 백업을 만들었지만 일부 이미지가 누락되었습니다. ${manifest.warnings.join(' / ')}`
        : '전체 백업 ZIP을 만들었습니다.',
    );
  }

  async function importFullBackup(file: File) {
    const ok = window.confirm('전체 백업을 가져올까요?\n\n기본 동작은 병합이며, 기존 데이터는 삭제하지 않습니다.');
    if (!ok) return;
    const parsed = await parseFullBackup(file);
    const suffix = String(Date.now());
    const templateIds = new Set(templates.map((template) => template.id));
    parsed.templates.map((template) => uniqueTemplate(template, templateIds, suffix)).forEach(addTemplate);
    const cardIds = new Set(savedCardIndex.map((record) => record.id));
    importSavedCards(parsed.savedCards.map((record) => uniqueSavedCard(record, cardIds, suffix)));
    setMiSTerState(parsed.mister);
    setZaparooLibrary(mergeZaparooLibrary(zaparooLibrary, parsed.zaparooLibrary));
    if (parsed.assetLibrary) setAssetLibrary(parsed.assetLibrary);
    setBackupMessage(
      `전체 백업을 병합했습니다. 카드 ${parsed.savedCards.length}개, 템플릿 ${parsed.templates.length}개, 라이브러리 항목 ${parsed.zaparooLibrary.entries.length}개를 가져왔습니다.`,
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="프로젝트"
        title="대시보드"
        description={`${name}의 Hello Mister 카드 제작 상태를 요약합니다.`}
      />
      <section className="mb-5 rounded-lg border border-line bg-white p-5 shadow-surface">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">전체 백업 / 복원</h2>
            <p className="mt-1 text-sm text-neutral-600">
              미스터 게임 리스트, MiSTer profile, 템플릿, 저장 카드, used image cache 기반 이미지를 ZIP으로 내보내거나 병합 가져오기합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void exportFullBackup()}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              전체 백업 내보내기
            </button>
            <label className="cursor-pointer rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-neutral-50">
              전체 백업 가져오기
              <input
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void importFullBackup(file);
                  event.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </div>
        {backupMessage && <p className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">{backupMessage}</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <PlaceholderPanel title="미스터 게임 리스트">{zaparooLibrary.entries.length}개의 병합된 항목이 있습니다.</PlaceholderPanel>
        <PlaceholderPanel title="프로젝트 게임">{games.length}개의 게임 레코드가 로드되어 있습니다.</PlaceholderPanel>
        <PlaceholderPanel title="템플릿">{templates.length}개의 사용 가능한 템플릿이 있습니다.</PlaceholderPanel>
        <PlaceholderPanel title="카드편집">{cards.length}개의 카드가 편집 대기열에 있습니다.</PlaceholderPanel>
        <PlaceholderPanel title="저장 카드">{activeSavedCards.length}개의 저장된 카드 버전이 있습니다.</PlaceholderPanel>
        <PlaceholderPanel title="삭제된 카드">{deletedSavedCards}개의 카드가 휴지통에 있습니다.</PlaceholderPanel>
      </div>
    </>
  );
}
