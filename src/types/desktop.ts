import type {
  IniExportResult,
  MisterIniBackupListResult,
  MisterIniBackupPreviewResult,
  MisterIniDeleteBackupRequest,
  MisterIniDeleteTrashRequest,
  MisterIniIndex,
  MisterIniLocalImportResult,
  MisterIniMetadataStore,
  MisterIniOperationResult,
  MisterIniReadResult,
  MisterIniRestoreRequest,
  MisterIniRestoreTrashRequest,
  MisterIniTrashListResult,
  MisterIniTrashRequest,
  MisterIniWriteCapabilityResult,
  MisterIniWriteRequest,
} from './ini';
import type {
  ScriptFsBackupListResult,
  ScriptFsBackupPreviewResult,
  ScriptFsCapabilityResult,
  ScriptFsListResult,
  ScriptFsOperationResult,
  ScriptFsReadResult,
  ScriptFsRunLogResult,
  ScriptFsRunResult,
  ScriptFsTrashListResult,
  ScriptRunChunk,
  ScriptRunDone,
  ScriptRunMode,
} from './script';
import type {
  ControllerAutoMapResult,
  ControllerBackupListResult,
  ControllerBackupPreviewResult,
  ControllerBackupRequest,
  ControllerCloneResult,
  ControllerArcadeButtonsResult,
  ControllerArcadeIndexResult,
  ControllerConnectedDevicesResult,
  ControllerInputCapsResult,
  ControllerInputEvent,
  ControllerInventoryResult,
  ControllerListMapsResult,
  ControllerMonitorResult,
  ControllerOperationResult,
  ControllerReadAllMapsResult,
  ControllerReadFileResult,
  ControllerReadMapResult,
  ControllerRestoreRequest,
  ControllerWriteMapResult,
  ControllerWriteMapsItem,
  ControllerWriteMapsResult,
} from './controllers';
import type {
  DiagnosticPackage,
  ActiveMisterProfile,
  MisterDeviceProfile,
  MisterDiscoveryOptions,
  MisterDiscoveryReport,
  MisterProfileSummary,
  MisterRemoteFingerprint,
  MisterRemoteGameFolder,
  MisterRemoteIniSnapshot,
  MisterRemoteScriptFile,
  SshHostKeyCheckResult,
  SshKnownHostHistoryEntry,
  SshKnownHostEntry,
  NetworkInterfaceInfo,
  RemoteReadResult,
  SshCredentialInput,
  SshSessionState,
} from './mister';
import type { SafeTask } from './tasks';
import type {
  LocalImageHashResult,
  MrFusionDownloadProgress,
  MrFusionDownloadResult,
  MrFusionImage,
  MrFusionVariant,
  SdCardDrive,
  SdEjectRequest,
  SdEjectResult,
  SdFlashProgress,
  SdFlashRequest,
  SdFlashResult,
  SdStructureCheckResult,
  SdWifiStageRequest,
  SdWifiStageResult,
  SdWriteIniRequest,
  SdWriteIniResult,
} from './sd';
import type {
  LocalRomScanOptions,
  LocalRomScanResult,
  RemoteRomFileEntry,
  RomFsCapabilityCheckRequest,
  RomFsCapabilityResult,
  RomFsCopyLocalToMisterRequest,
  RomFsCopyMisterToLocalRequest,
  RomFsCopyMisterToMisterRequest,
  RomFsCreateLocalFolderRequest,
  RomFsCreateRemoteFolderRequest,
  RomFsListLocalTreeFolderRequest,
  RomFsListLocalTreeFolderResult,
  RomFsLocalTreeRootsResult,
  RomFsListLocalFolderRequest,
  RomFsListLocalFolderResult,
  RomFsListRemoteRequest,
  RomFsListRemoteResult,
  RomFsMoveRemoteRequest,
  RomFsOperationResult,
  RomFsRenameRemoteRequest,
  RomFsDeleteRemoteRequest,
  RomFsRestoreRemoteRequest,
  RomFsStatRemoteResult,
  RomFsTrashRemoteRequest,
  SavedRomPlan,
} from './rom';
import type {
  StickerCardStore,
  StickerImageLibraryStore,
  StickerImageScanOptions,
  StickerImageScanResult,
  StickerSheetStore,
  StickerTemplateStore,
} from './stickers';
import type {
  ZaparooApiResult,
  ZaparooAllowedIpsRecommendationMode,
  ZaparooConfigApplyResult,
  ZaparooApiTarget,
  ZaparooConfigDiagnostics,
  ZaparooConfigPatchPlan,
  ZaparooMediaBrowseResult,
  ZaparooMediaLookupResult,
  ZaparooMediaSearchResult,
  ZaparooReadersResult,
  ZaparooReaderWriteResult,
  ZaparooRunResult,
  ZaparooStatusResult,
  ZaparooTokenReadRequest,
  ZaparooTokenReadResult,
} from './zaparoo';

export type DesktopRuntimeMode = 'electron' | 'browser-fallback';

export interface DesktopRuntimeEnvironment {
  mode: DesktopRuntimeMode;
  appName: string;
  appVersion: string;
  appDataPath?: string;
  electronApiAvailable: boolean;
  readOnlyIpcAvailable: boolean;
  romTransferLocked: boolean;
  unsafeCommandIpcExposed: boolean;
  safetyMode: 'dry-run';
  checkedAt: string;
}

export type AppDataSecretSanitizeStatus = 'ok' | 'needs-review' | 'missing' | 'not-readable' | 'browser-fallback';

export interface AppDataFileStatus {
  id: string;
  label: string;
  category: 'profiles' | 'ssh' | 'logs' | 'rom' | 'diagnostics' | 'review' | 'stickers';
  relativePath: string;
  exists: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  secretSanitizeStatus: AppDataSecretSanitizeStatus;
  message: string;
}

export interface AppDataStorageStatus {
  appDataPath?: string;
  checkedAt: string;
  files: AppDataFileStatus[];
  message: string;
}

export interface OpenFolderResult {
  ok: boolean;
  path?: string;
  message: string;
}

export interface ZaparooDesktopApi {
  bridgeUrl?: string;
  saveAndOpenPdf?: (bytes: Uint8Array, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  saveFile?: (bytes: Uint8Array, filename: string, mimeType: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; size?: number; error?: string }>;
  openFile?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  captureHtmlAsPng?: (html: string, width: number, height: number) => Promise<{ ok: boolean; bytes?: Uint8Array; size?: number; error?: string }>;
  readFileAsDataUrl?: (filePath: string) => Promise<{ ok: boolean; dataUrl?: string; mimeType?: string; size?: number; error?: string }>;
  fetchImageAsDataUrl?: (url: string) => Promise<{ ok: boolean; dataUrl?: string; mimeType?: string; size?: number; error?: string }>;
  getPathForFile?: (file: File) => string | undefined;
}

export interface HelloMisterDesktopApi {
  appName: string;
  safetyMode: 'dry-run';
  getRuntimeEnvironment?: () => Promise<DesktopRuntimeEnvironment>;
  getAppDataStorageStatus?: () => Promise<AppDataStorageStatus>;
  openAppDataFolder?: () => Promise<OpenFolderResult>;
  openExternalUrl?: (url: string) => Promise<{ ok: boolean; url?: string; message?: string }>;
  saveCardImage?: (payload: { fileName: string; baseName?: string; bytes: Uint8Array }) => Promise<{ ok: boolean; path?: string; folder?: string; fileName?: string; message?: string }>;
  listNetworkInterfaces?: () => Promise<NetworkInterfaceInfo[]>;
  scanMisterCandidates?: (options: MisterDiscoveryOptions) => Promise<MisterDiscoveryReport>;
  probeMisterReachable?: (host: string, port?: number, timeoutMs?: number) => Promise<{ ok: boolean; open: boolean; latencyMs?: number }>;
  loadMisterProfiles?: () => Promise<MisterDeviceProfile[]>;
  saveMisterProfile?: (profile: MisterDeviceProfile) => Promise<MisterDeviceProfile[]>;
  getActiveMisterProfile?: () => Promise<ActiveMisterProfile | undefined>;
  setActiveMisterProfile?: (profile: ActiveMisterProfile) => Promise<ActiveMisterProfile | undefined>;
  clearActiveMisterProfile?: (profileId?: string) => Promise<{ ok: boolean; cleared: boolean; profile?: ActiveMisterProfile; message: string }>;
  saveMisterProfilePassword?: (profileId: string, password: string) => Promise<{ ok: boolean; saved: boolean; storageAvailable: boolean; message: string }>;
  getMisterProfilePasswordStatus?: (profileId: string) => Promise<{ ok: boolean; saved: boolean; storageAvailable: boolean; message: string }>;
  deleteMisterProfilePassword?: (profileId: string) => Promise<{ ok: boolean; message: string }>;
  setDefaultMisterProfile?: (profileId: string) => Promise<MisterDeviceProfile[]>;
  deleteMisterProfile?: (profileId: string, options?: { removeKnownHost?: boolean }) => Promise<MisterDeviceProfile[]>;
  loadMisterProfileSummaries?: () => Promise<MisterProfileSummary[]>;
  saveMisterProfileSummary?: (summary: MisterProfileSummary) => Promise<MisterProfileSummary[]>;
  clearMisterProfileSummary?: (profileId: string) => Promise<MisterProfileSummary[]>;
  zaparooGetStatus?: (target?: ZaparooApiTarget) => Promise<ZaparooStatusResult>;
  zaparooGetVersion?: (target?: ZaparooApiTarget) => Promise<ZaparooApiResult>;
  zaparooHealth?: (target?: ZaparooApiTarget) => Promise<ZaparooApiResult>;
  zaparooSearchMedia?: (request: { target?: ZaparooApiTarget; query: string }) => Promise<ZaparooMediaSearchResult>;
  zaparooBrowseMedia?: (request: { target?: ZaparooApiTarget; path?: string }) => Promise<ZaparooMediaBrowseResult>;
  zaparooLookupMedia?: (request: { target?: ZaparooApiTarget; system: string; name: string }) => Promise<ZaparooMediaLookupResult>;
  zaparooRun?: (request: { target?: ZaparooApiTarget; zapScript: string; allowFallbackRun?: boolean }) => Promise<ZaparooRunResult>;
  zaparooListReaders?: (target?: ZaparooApiTarget) => Promise<ZaparooReadersResult>;
  zaparooWriteReader?: (request: { target?: ZaparooApiTarget; text: string }) => Promise<ZaparooReaderWriteResult>;
  zaparooReadTokenOnce?: (request: ZaparooTokenReadRequest) => Promise<ZaparooTokenReadResult>;
  zaparooCancelTokenRead?: (requestId: string) => Promise<{ ok: boolean; message: string }>;
  zaparooReadConfigDiagnostics?: (sessionId?: string) => Promise<ZaparooConfigDiagnostics>;
  zaparooPreviewConfigApply?: (request: { sessionId?: string; mode?: ZaparooAllowedIpsRecommendationMode }) => Promise<ZaparooConfigPatchPlan>;
  zaparooApplyConfigRecommendation?: (request: { sessionId?: string; mode?: ZaparooAllowedIpsRecommendationMode; confirmed: boolean; allowLocalBackupOnly?: boolean }) => Promise<ZaparooConfigApplyResult>;
  inspectSshHostKey?: (request: { host: string; port: number; profileId?: string; alias?: string }) => Promise<SshHostKeyCheckResult>;
  trustSshHostKey?: (request: { host: string; port: number; fingerprint: string; keyType: string; profileId?: string; alias?: string }) => Promise<SshHostKeyCheckResult>;
  removeSshKnownHost?: (host: string, port: number) => Promise<{ ok: boolean; message: string; entries: SshKnownHostEntry[] }>;
  listSshKnownHosts?: () => Promise<SshKnownHostEntry[]>;
  listSshKnownHostHistory?: () => Promise<SshKnownHostHistoryEntry[]>;
  fingerprintMister?: (credential: SshCredentialInput) => Promise<MisterRemoteFingerprint>;
  fingerprintSavedMisterProfile?: (request: { profileId: string; passwordOverride?: string }) => Promise<MisterRemoteFingerprint>;
  fingerprintMisterSession?: (sessionId: string) => Promise<MisterRemoteFingerprint>;
  clearSshSession?: (sessionId: string) => Promise<{ ok: boolean; message: string }>;
  listSshSessions?: () => Promise<SshSessionState[]>;
  readRemoteMisterIni?: (sessionId: string) => Promise<MisterRemoteIniSnapshot>;
  iniFsCheckWriteCapability?: (request?: { profileId?: string }) => Promise<MisterIniWriteCapabilityResult>;
  iniFsListRemoteIni?: (request?: { profileId?: string }) => Promise<MisterIniIndex>;
  iniFsReadRemoteIni?: (request: { profileId?: string; fileName: string }) => Promise<MisterIniReadResult>;
  iniFsWriteRemoteIniWithBackup?: (request: MisterIniWriteRequest) => Promise<MisterIniOperationResult>;
  iniFsCreateBackup?: (request: { profileId?: string; fileName: string }) => Promise<MisterIniBackupListResult>;
  iniFsListBackups?: (request: { profileId?: string; fileName: string }) => Promise<MisterIniBackupListResult>;
  iniFsPreviewBackup?: (request: { profileId?: string; fileName: string; backupPath: string }) => Promise<MisterIniBackupPreviewResult>;
  iniFsDeleteBackup?: (request: MisterIniDeleteBackupRequest) => Promise<MisterIniOperationResult>;
  iniFsRestoreBackup?: (request: MisterIniRestoreRequest) => Promise<MisterIniOperationResult>;
  iniFsTrashIni?: (request: MisterIniTrashRequest) => Promise<MisterIniOperationResult>;
  iniFsListTrash?: (request?: { profileId?: string }) => Promise<MisterIniTrashListResult>;
  iniFsRestoreTrashedIni?: (request: MisterIniRestoreTrashRequest) => Promise<MisterIniOperationResult>;
  iniFsDeleteTrashedIni?: (request: MisterIniDeleteTrashRequest) => Promise<MisterIniOperationResult>;
  iniFsEmptyTrash?: (request: { profileId?: string; confirmed: boolean }) => Promise<MisterIniOperationResult>;
  iniFsExportIniLocal?: (request: { profileId?: string; fileName: string }) => Promise<MisterIniOperationResult>;
  iniFsImportIniLocal?: (request: { profileId?: string; targetFileName?: string }) => Promise<MisterIniLocalImportResult>;
  iniFsLoadMetadata?: (request?: { profileId?: string }) => Promise<MisterIniMetadataStore>;
  iniFsSaveMetadata?: (store: MisterIniMetadataStore) => Promise<MisterIniMetadataStore>;
  scriptFsCheckCapability?: (request: { profileId?: string }) => Promise<ScriptFsCapabilityResult>;
  scriptFsListRemote?: (request: { profileId?: string }) => Promise<ScriptFsListResult>;
  scriptFsReadRemote?: (request: { profileId?: string; fileName: string }) => Promise<ScriptFsReadResult>;
  scriptFsWriteRemote?: (request: { profileId?: string; fileName: string; content: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsCreateBackup?: (request: { profileId?: string; fileName: string }) => Promise<ScriptFsBackupListResult>;
  scriptFsListBackups?: (request: { profileId?: string; fileName: string }) => Promise<ScriptFsBackupListResult>;
  scriptFsPreviewBackup?: (request: { profileId?: string; fileName: string; backupPath: string }) => Promise<ScriptFsBackupPreviewResult>;
  scriptFsRestoreBackup?: (request: { profileId?: string; fileName: string; backupPath: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsDeleteBackup?: (request: { profileId?: string; fileName: string; backupPath: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsTrash?: (request: { profileId?: string; fileName: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsListTrash?: (request: { profileId?: string }) => Promise<ScriptFsTrashListResult>;
  scriptFsRestoreTrashed?: (request: { profileId?: string; trashPath: string; targetFileName: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsDeleteTrashed?: (request: { profileId?: string; trashPath: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsEmptyTrash?: (request: { profileId?: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsExportLocal?: (request: { profileId?: string; fileName: string }) => Promise<ScriptFsOperationResult>;
  scriptFsImportLocal?: (request: { profileId?: string; targetFileName?: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsRun?: (request: { profileId?: string; fileName: string; runId: string; confirmed: boolean; mode?: ScriptRunMode }) => Promise<ScriptFsRunResult>;
  scriptFsReadRunLog?: (request: { profileId?: string; logPath: string }) => Promise<ScriptFsRunLogResult>;
  scriptFsCopyToDevice?: (request: { profileId?: string; targetProfileId: string; fileName: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  scriptFsInstallFromUrl?: (request: { profileId?: string; fileName: string; url: string; confirmed: boolean }) => Promise<ScriptFsOperationResult>;
  onScriptRunChunk?: (callback: (payload: ScriptRunChunk) => void) => () => void;
  onScriptRunDone?: (callback: (payload: ScriptRunDone) => void) => () => void;
  controllerFsScanInventory?: (request?: { profileId?: string }) => Promise<ControllerInventoryResult>;
  controllerFsReadFile?: (request: { profileId?: string; path: string }) => Promise<ControllerReadFileResult>;
  controllerFsReadControllerFile?: (request: { profileId?: string; path: string }) => Promise<ControllerReadFileResult>;
  controllerFsCreateBackup?: (request: ControllerBackupRequest) => Promise<ControllerOperationResult>;
  controllerFsListBackups?: (request: { profileId?: string; sourcePath: string }) => Promise<ControllerBackupListResult>;
  controllerFsReadBackup?: (request: { profileId?: string; sourcePath: string; backupPath: string }) => Promise<ControllerBackupPreviewResult>;
  controllerFsRestoreBackup?: (request: ControllerRestoreRequest) => Promise<ControllerOperationResult>;
  controllerFsListConnectedDevices?: (request?: { profileId?: string }) => Promise<ControllerConnectedDevicesResult>;
  controllerFsReadInputCaps?: (request: { profileId?: string; vid: string; pid: string }) => Promise<ControllerInputCapsResult>;
  controllerFsCloneMappings?: (request: { profileId?: string; source: { vid: string; pid: string; version: string }; target: { vid: string; pid: string }; dryRun?: boolean; confirmed?: boolean }) => Promise<ControllerCloneResult>;
  controllerFsAutoMap?: (request: { profileId?: string; source: { vid: string; pid: string; version: string }; target: { vid: string; pid: string }; onlyGames?: string[]; dryRun?: boolean; confirmed?: boolean }) => Promise<ControllerAutoMapResult>;
  controllerFsStartInputMonitor?: (request: { profileId?: string; eventPath: string; monitorId: string }) => Promise<ControllerMonitorResult>;
  controllerFsStopInputMonitor?: (request: { monitorId: string }) => Promise<{ ok: boolean }>;
  controllerFsListMaps?: (request: { profileId?: string; vid: string; pid: string }) => Promise<ControllerListMapsResult>;
  controllerFsReadMap?: (request: { profileId?: string; path: string }) => Promise<ControllerReadMapResult>;
  controllerFsReadAllMaps?: (request: { profileId?: string; vid: string; pid: string }) => Promise<ControllerReadAllMapsResult>;
  controllerFsWriteMap?: (request: { profileId?: string; path?: string; game?: string; vid?: string; pid?: string; version?: string; codes: number[] }) => Promise<ControllerWriteMapResult>;
  controllerFsWriteMaps?: (request: { profileId?: string; vid?: string; pid?: string; version?: string; items: ControllerWriteMapsItem[] }) => Promise<ControllerWriteMapsResult>;
  controllerFsReadArcadeButtons?: (request: { profileId?: string; game: string }) => Promise<ControllerArcadeButtonsResult>;
  controllerFsReadArcadeIndex?: (request: { profileId?: string }) => Promise<ControllerArcadeIndexResult>;
  onControllerInputEvent?: (callback: (payload: ControllerInputEvent) => void) => () => void;
  listRemoteGames?: (sessionId: string, options?: { countFiles?: boolean }) => Promise<RemoteReadResult<MisterRemoteGameFolder[]>>;
  listRemoteGameFolderFiles?: (
    sessionId: string,
    folderPath: string,
    options?: { scanDepth?: number; recursive?: boolean; maxFiles?: number },
  ) => Promise<RemoteReadResult<RemoteRomFileEntry[]> & {
    foldersScanned?: number;
    failedFolders?: number;
    excludedFiles?: number;
    depthLimitedFolders?: number;
    scanDepth?: number;
    recursive?: boolean;
    truncated?: boolean;
  }>;
  // Fast library scan: a single read-only SSH `find` over the game roots returns every file path at once.
  listRemoteGameFilesFast?: (sessionId: string) => Promise<{
    ok: boolean;
    sessionId?: string;
    paths: string[];
    readAt?: string;
    durationMs?: number;
    message?: string;
    errorCode?: string;
  }>;
  // Arcade hardware classification: map each _Arcade/*.mra path to its <rbf> core/hardware name.
  listRemoteArcadeCores?: (sessionId: string) => Promise<{
    ok: boolean;
    sessionId?: string;
    cores: Record<string, string>;
    readAt?: string;
    durationMs?: number;
    message?: string;
    errorCode?: string;
  }>;
  listRemoteScripts?: (sessionId: string) => Promise<RemoteReadResult<MisterRemoteScriptFile[]>>;
  readRemoteScript?: (sessionId: string, path: string) => Promise<RemoteReadResult<MisterRemoteScriptFile>>;
  saveDiagnosticPackage?: (diagnostic: DiagnosticPackage) => Promise<IniExportResult>;
  listWindowsDrives?: () => Promise<SdCardDrive[]>;
  inspectSdStructure?: (mountPoint: string, driveId: string) => Promise<SdStructureCheckResult>;
  selectMrFusionImage?: () => Promise<{ cancelled: boolean; filePath?: string; fileName?: string }>;
  resolveMrFusionImage?: (options?: { variant?: MrFusionVariant }) => Promise<{
    ok: boolean;
    status: 'local-verified' | 'changed' | 'none' | 'error';
    variant?: MrFusionVariant;
    tag?: string;
    image?: MrFusionImage;
    assetName?: string;
    assetSize?: number;
    message?: string;
  }>;
  downloadMrFusionImage?: (options?: { variant?: MrFusionVariant; force?: boolean }) => Promise<MrFusionDownloadResult>;
  onSdDownloadProgress?: (callback: (payload: MrFusionDownloadProgress) => void) => () => void;
  flashSdImage?: (request: SdFlashRequest) => Promise<SdFlashResult>;
  onSdFlashProgress?: (callback: (payload: SdFlashProgress) => void) => () => void;
  writeWpaSupplicant?: (request: SdWifiStageRequest) => Promise<SdWifiStageResult>;
  writeMisterIni?: (request: SdWriteIniRequest) => Promise<SdWriteIniResult>;
  installMisterScriptToCard?: (request: { mountPoint: string; fileName: string; url: string }) => Promise<{ ok: boolean; message: string; filePath?: string }>;
  installZaparooToCard?: (request: { mountPoint: string }) => Promise<{ ok: boolean; message: string; filePath?: string }>;
  onSdScriptProgress?: (callback: (payload: { task: string; phase: string; message: string; receivedBytes?: number; totalBytes?: number; percent?: number }) => void) => () => void;
  ejectSdDrive?: (request: SdEjectRequest) => Promise<SdEjectResult>;
  scanWifiNetworks?: () => Promise<{ ok: boolean; networks: string[]; message: string }>;
  selectLocalRomFiles?: () => Promise<LocalRomScanResult>;
  selectLocalRomFolder?: (options: LocalRomScanOptions) => Promise<LocalRomScanResult>;
  selectRomBackupFolder?: () => Promise<{ ok: boolean; cancelled?: boolean; folderPath?: string; message: string }>;
  romFsListRemote?: (request: RomFsListRemoteRequest) => Promise<RomFsListRemoteResult>;
  romFsStatRemote?: (request: RomFsListRemoteRequest) => Promise<RomFsStatRemoteResult>;
  romFsCheckCapability?: (request?: RomFsCapabilityCheckRequest) => Promise<RomFsCapabilityResult>;
  romFsSelectLocalFolder?: () => Promise<{ ok: boolean; cancelled?: boolean; folderPath?: string; message: string }>;
  romFsListLocalFolder?: (request: RomFsListLocalFolderRequest) => Promise<RomFsListLocalFolderResult>;
  romFsListLocalTreeRoots?: () => Promise<RomFsLocalTreeRootsResult>;
  romFsListLocalTreeFolder?: (request: RomFsListLocalTreeFolderRequest) => Promise<RomFsListLocalTreeFolderResult>;
  romFsCopyLocalToMister?: (request: RomFsCopyLocalToMisterRequest) => Promise<RomFsOperationResult>;
  romFsCopyMisterToLocal?: (request: RomFsCopyMisterToLocalRequest) => Promise<RomFsOperationResult>;
  romFsCopyMisterToMister?: (request: RomFsCopyMisterToMisterRequest) => Promise<RomFsOperationResult>;
  romFsMoveRemote?: (request: RomFsMoveRemoteRequest) => Promise<RomFsOperationResult>;
  romFsRenameRemote?: (request: RomFsRenameRemoteRequest) => Promise<RomFsOperationResult>;
  romFsTrashRemote?: (request: RomFsTrashRemoteRequest) => Promise<RomFsOperationResult>;
  romFsDeleteRemote?: (request: RomFsDeleteRemoteRequest) => Promise<RomFsOperationResult>;
  romFsRestoreRemote?: (request: RomFsRestoreRemoteRequest) => Promise<RomFsOperationResult>;
  romFsCreateRemoteFolder?: (request: RomFsCreateRemoteFolderRequest) => Promise<RomFsOperationResult>;
  romFsCreateLocalFolder?: (request: RomFsCreateLocalFolderRequest) => Promise<RomFsOperationResult>;
  selectStickerImageFiles?: () => Promise<StickerImageScanResult>;
  selectStickerImageFolder?: (options: StickerImageScanOptions) => Promise<StickerImageScanResult>;
  loadStickerImageLibrary?: () => Promise<StickerImageLibraryStore>;
  saveStickerImageLibrary?: (store: StickerImageLibraryStore) => Promise<StickerImageLibraryStore>;
  loadStickerTemplates?: () => Promise<StickerTemplateStore>;
  saveStickerTemplates?: (store: StickerTemplateStore) => Promise<StickerTemplateStore>;
  loadStickerCards?: () => Promise<StickerCardStore>;
  saveStickerCards?: (store: StickerCardStore) => Promise<StickerCardStore>;
  loadStickerSheets?: () => Promise<StickerSheetStore>;
  saveStickerSheets?: (store: StickerSheetStore) => Promise<StickerSheetStore>;
  loadSavedRomPlans?: () => Promise<SavedRomPlan[]>;
  saveSavedRomPlan?: (plan: SavedRomPlan) => Promise<SavedRomPlan[]>;
  deleteSavedRomPlan?: (planId: string) => Promise<SavedRomPlan[]>;
  calculateFileSha256?: (filePath: string) => Promise<LocalImageHashResult>;
  saveTextFile?: (options: { defaultPath: string; content: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<IniExportResult>;
  loadTaskLogs?: () => Promise<SafeTask[]>;
  saveTaskLogs?: (tasks: SafeTask[]) => Promise<SafeTask[]>;
  clearTaskLogs?: () => Promise<{ ok: boolean; message: string }>;
  exportTaskLogs?: (tasks: SafeTask[]) => Promise<IniExportResult>;
}

declare global {
  interface Window {
    helloMisterDesktop?: HelloMisterDesktopApi;
    zaparooDesktop?: ZaparooDesktopApi;
  }
}

export {};
