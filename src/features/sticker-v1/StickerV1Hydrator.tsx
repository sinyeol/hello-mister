import { useEffect, useState, type ReactNode } from 'react';
import { useActiveMisterProfile } from '../../services/mister/activeProfile';
import { getSavedAssetSourceMetadata } from '@sticker-v1/services/assets/assetSources';
import {
  loadCardAlbumIndexFromIndexedDb,
  loadPrintQueueIdsFromIndexedDb,
  migrateLegacySavedCardsToSplitStores,
} from '@sticker-v1/services/cards/savedCardsPersistence';
import { loadMiSTerStateFromIndexedDb } from '@sticker-v1/services/mister/misterPersistence';
import { loadPersistedTemplatesFromIndexedDb } from '@sticker-v1/services/templates/templatePersistence';
import { loadZaparooLibraryStateFromIndexedDb } from '@sticker-v1/services/zaparoo/zaparooLibrary';
import { useProjectStore } from '@sticker-v1/store/projectStore';

let hydratedOnce = false;

interface StickerV1HydratorProps {
  children: ReactNode;
}

export function StickerV1Hydrator({ children }: StickerV1HydratorProps) {
  const [activeMister] = useActiveMisterProfile();
  const [startupStep, setStartupStep] = useState(hydratedOnce ? '완료' : 'v1 스티커 데이터를 불러오는 중');
  const [startupComplete, setStartupComplete] = useState(hydratedOnce);
  const hydrateSavedCardIndex = useProjectStore((state) => state.hydrateSavedCardIndex);
  const hydrateTemplates = useProjectStore((state) => state.hydrateTemplates);
  const setMiSTerState = useProjectStore((state) => state.setMiSTerState);
  const setMiSTerConnection = useProjectStore((state) => state.setMiSTerConnection);
  const currentConnectionId = useProjectStore((state) => state.mister.connection.connectionId);
  const setZaparooLibrary = useProjectStore((state) => state.setZaparooLibrary);

  useEffect(() => {
    if (hydratedOnce) {
      setStartupComplete(true);
      return;
    }

    let mounted = true;
    void (async () => {
      try {
        setStartupStep('카드 앨범 색인을 불러오는 중');
        const [cardMeta, printQueueIds] = await Promise.all([loadCardAlbumIndexFromIndexedDb(), loadPrintQueueIdsFromIndexedDb()]);
        if (!mounted) return;
        hydrateSavedCardIndex(cardMeta, printQueueIds);

        setStartupStep('템플릿을 불러오는 중');
        const templates = await loadPersistedTemplatesFromIndexedDb();
        if (!mounted) return;
        hydrateTemplates(templates);

        setStartupStep('MiSTer profile을 불러오는 중');
        const mister = await loadMiSTerStateFromIndexedDb();
        if (!mounted) return;
        setMiSTerState(mister);

        setStartupStep('미스터 게임 리스트를 불러오는 중');
        const zaparooLibrary = await loadZaparooLibraryStateFromIndexedDb();
        if (!mounted) return;
        setZaparooLibrary(zaparooLibrary);

        setStartupStep(`이미지 소스 ${getSavedAssetSourceMetadata().length}개 확인 완료`);
        hydratedOnce = true;

        if (cardMeta.length === 0) {
          window.setTimeout(() => {
            void migrateLegacySavedCardsToSplitStores()
              .then(async (legacyMeta) => {
                if (!mounted || legacyMeta.length === 0) return;
                const legacyPrintQueueIds = await loadPrintQueueIdsFromIndexedDb();
                if (!mounted) return;
                hydrateSavedCardIndex(legacyMeta, legacyPrintQueueIds);
              })
              .catch(() => undefined);
          }, 0);
        }
      } catch (error) {
        console.warn('[StickerV1] 일부 v1 데이터를 불러오지 못했지만 화면을 계속 엽니다.', error);
        setStartupStep('일부 데이터를 불러오지 못했지만 계속 진행합니다.');
      } finally {
        if (mounted) setStartupComplete(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [hydrateSavedCardIndex, hydrateTemplates, setMiSTerState, setZaparooLibrary]);

  useEffect(() => {
    if (!startupComplete) return;
    if (!activeMister) {
      if (!currentConnectionId) return;
      setMiSTerConnection({
        status: 'idle',
        connectionId: undefined,
        message: 'v2 MiSTer 연결 메뉴의 활성 연결이 해제되었습니다.',
      });
      return;
    }

    setMiSTerConnection({
      status: activeMister.sessionId ? 'connected' : 'failed',
      connectionId: activeMister.sessionId,
      config: {
        host: activeMister.ipAddress,
        port: activeMister.port,
        username: activeMister.username || 'root',
        protocol: 'ssh-sftp',
        authMethod: 'password',
      },
      requiredPaths: {
        '/media/fat': activeMister.mediaFatOk ? 'exists' : 'unknown',
        '/media/fat/games': activeMister.gamesOk ? 'exists' : 'unknown',
        '/media/fat/_Arcade': 'unknown',
        '/media/fat/zaparoo/config.toml': 'unknown',
      },
      lastTestedAt: activeMister.connectedAt,
      message: activeMister.sessionId
        ? 'v2 MiSTer 연결 메뉴에서 연결된 장치를 v1 스티커 기능과 공유합니다.'
        : activeMister.lastErrorCode || 'v2 MiSTer 연결 상태를 확인해야 합니다.',
    });
  }, [
    activeMister?.connectedAt,
    activeMister?.gamesOk,
    activeMister?.ipAddress,
    activeMister?.lastErrorCode,
    activeMister?.mediaFatOk,
    activeMister?.port,
    activeMister?.sessionId,
    activeMister?.username,
    activeMister,
    currentConnectionId,
    setMiSTerConnection,
    startupComplete,
  ]);

  return (
    <div className="sticker-v1-scope">
      {!startupComplete && (
        <div className="mb-4 rounded-lg border border-line bg-white p-4 text-sm shadow-surface">
          <p className="font-semibold text-neutral-900">v1 스티커 앱 데이터를 준비하고 있습니다.</p>
          <p className="mt-1 text-neutral-600">{startupStep}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      )}
      {startupComplete ? children : null}
    </div>
  );
}
