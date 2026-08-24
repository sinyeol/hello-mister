import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, HelpCircle, RefreshCw, RotateCcw, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/cards/PageHeader';
import { SectionCard } from '../components/cards/SectionCard';
import { StatusBadge } from '../components/status/StatusBadge';
import { isAdvancedMode, useAppViewMode } from '../services/app/viewMode';
import { MisterIniDesktopService } from '../services/ini/iniDesktopService';
import { canTrashIniFile, isAllowedIniFileName, suggestedRemoteIniFileName } from '../services/ini/iniFileNameService';
import {
  changedIniSettings,
  formatBackupRestoreWarning,
  parseIniDocument,
  serializeIniDocument,
  updateIniSetting,
} from '../services/ini/iniParser';
import { useActiveMisterProfile } from '../services/mister/activeProfile';
import { misterDisplayName } from '../services/mister/misterName';
import { SafeMisterProfileStore } from '../services/mister/profileStore';
import type { MisterDeviceProfile } from '../types/mister';
import type {
  MisterIniBackupEntry,
  MisterIniBackupPreviewResult,
  MisterIniDocument,
  MisterIniFileKind,
  MisterIniFileSource,
  MisterIniIndex,
  MisterIniMetadataStore,
  MisterIniRemoteFile,
  MisterIniSetting,
  MisterIniTrashEntry,
  MisterIniWriteCapabilityResult,
} from '../types/ini';

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function summarizeIniContent(content: string) {
  const document = parseIniDocument(content || '', 'backup-preview.ini');
  const settingCount = document.sections.reduce((sum, section) => sum + section.settings.length, 0);
  return {
    sectionCount: document.sections.length,
    settingCount,
    warningCount: document.parseWarnings.length,
  };
}

function presetSlotLabel(slot?: MisterIniFileKind) {
  if (slot === 'main') return '메인';
  if (slot === 'alt1') return 'Alt 1';
  if (slot === 'alt2') return 'Alt 2';
  if (slot === 'alt3') return 'Alt 3';
  if (slot === 'alt') return 'Alt';
  return '사용자';
}

function sourceLabel(source?: MisterIniFileSource) {
  if (source === 'remote') return '원격';
  if (source === 'local-import') return '로컬';
  if (source === 'upload-ready') return '업로드 준비';
  if (source === 'missing-remote') return '원격 없음';
  return '캐시';
}

function sourceTone(source?: MisterIniFileSource): 'safe' | 'warning' | 'danger' | 'dry' {
  if (source === 'remote') return 'safe';
  if (source === 'upload-ready') return 'warning';
  if (source === 'missing-remote') return 'danger';
  return 'dry';
}

function iniSourceDisplayLabel(source?: MisterIniFileSource) {
  if (source === 'remote') return 'MiSTer에서 읽음';
  if (source === 'local-import') return '로컬';
  if (source === 'upload-ready') return '업로드 준비';
  if (source === 'missing-remote') return '원격 없음';
  if (source === 'cache' || !source) return '캐시';
  return sourceLabel(source);
}

function normalizedIniSource(source?: MisterIniFileSource, hasLocalContent = false): MisterIniFileSource {
  if (source === 'remote' || source === 'local-import' || source === 'upload-ready' || source === 'cache' || source === 'missing-remote') return source;
  return hasLocalContent ? 'local-import' : 'cache';
}

function isRemoteIniSource(source?: MisterIniFileSource) {
  return source === 'remote';
}

function isLocalIniListSource(source?: MisterIniFileSource) {
  return source === 'local-import' || source === 'upload-ready' || source === 'cache' || source === 'missing-remote';
}

function iniDeleteActionLabel(file: MisterIniRemoteFile) {
  return isRemoteIniSource(file.source) ? '휴지통' : '목록에서 제거';
}

function iniDeleteDisabledReason(file: MisterIniRemoteFile) {
  if (isRemoteIniSource(file.source)) {
    if (!canTrashIniFile(file.fileName)) return '기본 INI 파일은 삭제할 수 없습니다.';
  }
  return undefined;
}

function metadataEntryMatchesFile(item: { fileName: string; source?: MisterIniFileSource; localContent?: string }, file: MisterIniRemoteFile) {
  const itemSource = normalizedIniSource(item.source, Boolean(item.localContent));
  return item.fileName.toLowerCase() === file.fileName.toLowerCase() && itemSource === file.source;
}

function localIniRemoveSuccessMessage(source?: MisterIniFileSource) {
  if (source === 'upload-ready') return '업로드 준비 항목을 목록에서 제거했습니다.';
  if (source === 'local-import') return '로컬 INI 항목을 목록에서 제거했습니다.';
  return 'INI 항목을 목록에서 제거했습니다.';
}

function capabilityLabel(capability?: MisterIniWriteCapabilityResult) {
  if (!capability || capability.state === 'disconnected') return 'MiSTer 연결 필요';
  if (capability.state === 'connectedWritable') return 'INI 편집 가능';
  if (capability.state === 'connectedReadOnly') return '읽기만 가능';
  return 'INI 쓰기 확인 실패';
}

function capabilityTone(capability?: MisterIniWriteCapabilityResult): 'safe' | 'warning' | 'danger' | 'dry' {
  if (!capability || capability.state === 'disconnected') return 'warning';
  if (capability.state === 'connectedWritable') return 'safe';
  if (capability.state === 'connectedReadOnly') return 'warning';
  return 'danger';
}

function capabilityMessage(capability?: MisterIniWriteCapabilityResult) {
  if (!capability || capability.state === 'disconnected') return 'MiSTer 연결이 필요합니다.';
  if (capability.state === 'connectedWritable') return '연결됨 · INI 편집 가능';
  if (capability.state === 'connectedReadOnly') return '연결됨 · 읽기만 가능';
  return capability.message || '연결됨 · INI 쓰기 확인 실패';
}

function settingValueForToggle(setting: MisterIniSetting, checked: boolean) {
  const lower = setting.originalValue.toLowerCase();
  if (['true', 'false'].includes(lower)) return checked ? 'true' : 'false';
  if (['yes', 'no'].includes(lower)) return checked ? 'yes' : 'no';
  if (['on', 'off'].includes(lower)) return checked ? 'on' : 'off';
  return checked ? '1' : '0';
}

function settingMatches(setting: MisterIniSetting, query: string, filter: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = !normalizedQuery
    || setting.key.toLowerCase().includes(normalizedQuery)
    || setting.value.toLowerCase().includes(normalizedQuery)
    || setting.label?.toLowerCase().includes(normalizedQuery)
    || setting.labelEn?.toLowerCase().includes(normalizedQuery)
    || setting.labelKo?.toLowerCase().includes(normalizedQuery)
    || setting.help?.toLowerCase().includes(normalizedQuery)
    || setting.inlineComment?.toLowerCase().includes(normalizedQuery)
    || setting.catalogHelp?.toLowerCase().includes(normalizedQuery)
    || setting.descriptionKo?.toLowerCase().includes(normalizedQuery)
    || setting.valueGuideKo?.toLowerCase().includes(normalizedQuery)
    || setting.recommendedKo?.toLowerCase().includes(normalizedQuery)
    || setting.warningKo?.toLowerCase().includes(normalizedQuery);
  const matchesFilter = filter === 'all'
    || (filter === 'changed' && setting.changed)
    || setting.category === filter;
  return matchesQuery && matchesFilter;
}

function titleFromIniKey(key: string) {
  return String(key || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function cleanIniComment(comment?: string) {
  return String(comment || '')
    .replace(/^\s*[#;]\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function translatedIniComment(comment?: string) {
  const original = cleanIniComment(comment);
  if (!original) return undefined;
  const lower = original.toLowerCase();

  if (lower.includes('set to 1 to run scandoubler on vga output always')) {
    return 'VGA 출력에서 스캔더블러를 항상 켤지 정하는 설정입니다. ON으로 두면 VGA 출력에서 스캔더블러가 강제로 활성화될 수 있습니다.';
  }

  const replacements: Array<[RegExp, string]> = [
    [/\bset to 1\b/gi, '1로 설정하면'],
    [/\bset to 0\b/gi, '0으로 설정하면'],
    [/\benable\b/gi, '활성화'],
    [/\bdisable\b/gi, '비활성화'],
    [/\benabled\b/gi, '활성화된 상태'],
    [/\bdisabled\b/gi, '비활성화된 상태'],
    [/\balways\b/gi, '항상'],
    [/\buse\b/gi, '사용'],
    [/\bvideo\b/gi, '비디오'],
    [/\baudio\b/gi, '오디오'],
    [/\boutput\b/gi, '출력'],
    [/\binput\b/gi, '입력'],
    [/\bscandoubler\b/gi, '스캔더블러'],
    [/\bmenu\b/gi, '메뉴'],
    [/\bcore\b/gi, '코어'],
    [/\bboot\b/gi, '부팅'],
    [/\bdefault\b/gi, '기본값'],
    [/\brange\b/gi, '범위'],
    [/\bvalue\b/gi, '값'],
  ];

  let translated = original;
  for (const [pattern, replacement] of replacements) {
    translated = translated.replace(pattern, replacement);
  }
  translated = translated.replace(/\s+/g, ' ').trim();
  if (translated && translated !== original) return `${translated} 설정입니다.`;
  return `원본 주석은 이 설정에 대해 "${original}"라고 설명합니다.`;
}

function fallbackIniHelpProfile(setting: MisterIniSetting) {
  const originalComments = settingOriginalComments(setting);
  const hasOriginalComments = originalComments !== '원본 INI 주석 없음';
  const translatedComment = hasOriginalComments ? translatedIniComment(originalComments) : undefined;
  return {
    fallbackKoName: 'INI 설정 항목',
    descriptionKo: translatedComment || '이 항목은 현재 INI 파일에 포함된 설정입니다. 의미가 확실하지 않으면 기존 값을 유지하세요.',
    recommendedKo: '특별한 목적이 없다면 현재 값을 유지하는 것이 안전합니다.',
    warningKo: '설정 변경 전 백업이 생성되는지 확인하세요.',
  };
}

function settingOriginalComments(setting: MisterIniSetting) {
  const comments = [setting.help, setting.inlineComment].filter(Boolean).map(cleanIniComment).filter(Boolean);
  return comments.length ? comments.join('\n') : '원본 INI 주석 없음';
}

function hasOfficialIniHelp(setting: MisterIniSetting) {
  return setting.helpSource !== 'unknown' && Boolean(setting.descriptionKo || setting.catalogHelp || setting.label);
}

function savedValueFormat(setting: MisterIniSetting) {
  if (setting.controlKind === 'boolean') return 'OFF=0, ON=1로 저장됩니다.';
  if (setting.range?.min !== undefined || setting.range?.max !== undefined) {
    const min = setting.range.min ?? '제한 없음';
    const max = setting.range.max ?? '제한 없음';
    return `허용 범위: ${min}-${max}${setting.range.unit ? ` ${setting.range.unit}` : ''}`;
  }
  const allowedValues = settingAllowedValuesText(setting);
  if (allowedValues) return `가능한 값:\n${allowedValues}`;
  if (setting.controlKind === 'number' || setting.valueType === 'number') {
    return '숫자 값으로 저장됩니다. 정확한 범위가 확실하지 않으면 기존 값 근처에서만 조정하세요.';
  }
  if (/^[01]$/.test(setting.value.trim())) return 'OFF=0, ON=1로 저장됩니다.';
  return '문자열 값으로 저장됩니다. 기존 형식을 유지해서 수정하세요.';
}
function settingDisplayLabel(setting: MisterIniSetting) {
  if (setting.label) return setting.label;
  return titleFromIniKey(setting.key);
}

function settingAllowedValuesText(setting: MisterIniSetting) {
  if (setting.allowedValues?.length) {
    return setting.allowedValues
      .map((item) => `${item.labelKo}=${item.value}${item.descriptionKo ? `: ${item.descriptionKo}` : ''}`)
      .join('\n');
  }
  if (setting.options?.length) {
    return setting.options
      .map((option) => `${setting.optionLabels?.[option] || `값 ${option}`}=${option}`)
      .join('\n');
  }
  return undefined;
}

function settingValueGuide(setting: MisterIniSetting) {
  if (setting.valueGuideKo) return setting.valueGuideKo;
  if (setting.controlKind === 'boolean') return 'OFF=0, ON=1로 저장됩니다.';
  if (setting.range?.min !== undefined || setting.range?.max !== undefined) {
    const min = setting.range.min ?? '제한 없음';
    const max = setting.range.max ?? '제한 없음';
    return `허용 범위: ${min}-${max}${setting.range.unit ? ` ${setting.range.unit}` : ''}`;
  }
  const allowedValues = settingAllowedValuesText(setting);
  if (allowedValues) return `가능한 값:\n${allowedValues}`;
  if (setting.examples?.length) return `예시: ${setting.examples.join(', ')}`;
  return undefined;
}

function settingPlaceholder(setting: MisterIniSetting) {
  if (setting.placeholder) return setting.placeholder;
  if (setting.range?.min !== undefined || setting.range?.max !== undefined) {
    const min = setting.range.min ?? '';
    const max = setting.range.max ?? '';
    return `${min}-${max}`.replace(/^-|-$/g, '');
  }
  if (setting.examples?.length) return `예: ${setting.examples[0]}`;
  if (setting.valueType === 'hex') return '예: 0x18d80002';
  if (setting.valueType === 'videoMode') return '0-14 또는 custom modeline';
  return undefined;
}

function settingInputHint(setting: MisterIniSetting) {
  const allowedValues = settingAllowedValuesText(setting);
  if (setting.controlKind === 'boolean') return 'OFF=0, ON=1로 저장됩니다.';
  if (setting.valueGuideKo) return setting.valueGuideKo;
  if (setting.range?.min !== undefined || setting.range?.max !== undefined) return settingValueGuide(setting);
  if (allowedValues) return `가능한 값: ${allowedValues.replace(/\n/g, ' · ')}`;
  if (setting.examples?.length) return `예: ${setting.examples.join(', ')}`;
  return undefined;
}

function officialSettingDescription(setting: MisterIniSetting) {
  if (!hasOfficialIniHelp(setting)) return fallbackIniHelpProfile(setting).descriptionKo;
  return setting.descriptionKo || setting.catalogHelp;
}

function officialValueGuide(setting: MisterIniSetting) {
  if (!hasOfficialIniHelp(setting)) return savedValueFormat(setting);
  return settingValueGuide(setting) || savedValueFormat(setting);
}

function officialRecommendation(setting: MisterIniSetting) {
  if (!hasOfficialIniHelp(setting)) return fallbackIniHelpProfile(setting).recommendedKo;
  return setting.recommendedKo;
}

function officialWarning(setting: MisterIniSetting) {
  if (!hasOfficialIniHelp(setting)) return fallbackIniHelpProfile(setting).warningKo;
  return setting.warningKo;
}

function riskLabel(setting: MisterIniSetting) {
  if (setting.riskLevel === 'danger') return '위험';
  if (setting.riskLevel === 'caution') return '주의';
  return undefined;
}

function riskTone(setting: MisterIniSetting): 'safe' | 'warning' | 'danger' | 'dry' {
  if (setting.riskLevel === 'danger') return 'danger';
  if (setting.riskLevel === 'caution') return 'warning';
  return 'dry';
}

function settingHelpSections(setting: MisterIniSetting, _developerMode = false) {
  if (!hasOfficialIniHelp(setting)) {
    const profile = fallbackIniHelpProfile(setting);
    const sections = [
      { label: '설명', body: profile.descriptionKo },
      { label: '값 안내', body: savedValueFormat(setting) },
      { label: '추천', body: profile.recommendedKo },
      { label: '주의', body: profile.warningKo },
      { label: '원본 주석', body: settingOriginalComments(setting) },
    ].filter((section): section is { label: string; body: string } => Boolean(section?.body));
    return sections;
  }

  const sections = [
    { label: '설명', body: officialSettingDescription(setting) },
    { label: '값 안내', body: officialValueGuide(setting) },
    { label: '권장', body: officialRecommendation(setting) },
    { label: '주의', body: officialWarning(setting) },
    { label: '원본 주석', body: settingOriginalComments(setting) },
  ].filter((section): section is { label: string; body: string } => Boolean(section?.body));
  return sections;
}
function IniHelpPopover({ setting, developerMode, onClose }: { setting: MisterIniSetting; developerMode: boolean; onClose: () => void }) {
  return (
    <div className={`ini-help-popover ${setting.riskLevel || 'normal'}`} role="tooltip">
      <div className="ini-help-popover-header">
        <strong>{settingDisplayLabel(setting)}</strong>
        <button type="button" className="icon-button subtle" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="도움말 닫기"><X size={14} /></button>
      </div>
      <small className="ini-help-key">{setting.key}</small>
      {riskLabel(setting) && <StatusBadge label={riskLabel(setting)!} tone={riskTone(setting)} />}
      {settingHelpSections(setting, developerMode).map((section) => (
        <div key={section.label} className="ini-help-popover-section">
          <span>{section.label}</span>
          <p>{section.body}</p>
        </div>
      ))}
    </div>
  );
}

function IniSettingControl({ setting, developerMode, onChange }: { setting: MisterIniSetting; developerMode: boolean; onChange: (value: string) => void }) {
  if (setting.controlKind === 'boolean') {
    const checked = ['1', 'true', 'yes', 'on'].includes(setting.value.toLowerCase());
    const inputId = `ini-toggle-${setting.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    return (
      <div className="ini-switch" data-toggle-safety="control-only" aria-label="클릭하면 값을 변경합니다. OFF=0, ON=1로 저장됩니다." onClick={(event) => event.stopPropagation()}>
        <input id={inputId} type="checkbox" checked={checked} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(settingValueForToggle(setting, event.target.checked))} />
        <label htmlFor={inputId} onClick={(event) => event.stopPropagation()}>{checked ? 'ON' : 'OFF'}</label>
        {developerMode && <small>저장값 {setting.value}</small>}
      </div>
    );
  }
  if (setting.controlKind === 'select' && setting.options?.length) {
    return (
      <div className="ini-control-stack" data-toggle-safety="control-only" onClick={(event) => event.stopPropagation()}>
        <select value={setting.value} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value)}>
          {setting.options.map((option) => {
            const allowed = setting.allowedValues?.find((item) => item.value === option);
            const label = allowed?.labelKo || setting.optionLabels?.[option] || `값 ${option}`;
            return (
              <option key={option} value={option} title={allowed?.descriptionKo}>{label} ({option})</option>
            );
          })}
        </select>
        {settingInputHint(setting) && <small className="ini-input-hint">{settingInputHint(setting)}</small>}
      </div>
    );
  }
  if (setting.controlKind === 'number') {
    return (
      <div className="ini-control-stack" data-toggle-safety="control-only" onClick={(event) => event.stopPropagation()}>
        <input
          type="number"
          value={setting.value}
          min={setting.range?.min}
          max={setting.range?.max}
          placeholder={settingPlaceholder(setting)}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onChange(event.target.value)}
        />
        {settingInputHint(setting) && <small className="ini-input-hint">{settingInputHint(setting)}</small>}
      </div>
    );
  }
  return (
    <div className="ini-control-stack" data-toggle-safety="control-only" onClick={(event) => event.stopPropagation()}>
      <input type="text" value={setting.value} placeholder={settingPlaceholder(setting)} onClick={(event) => event.stopPropagation()} onChange={(event) => onChange(event.target.value)} />
      {settingInputHint(setting) && <small className="ini-input-hint">{settingInputHint(setting)}</small>}
    </div>
  );
}

function buildLocalDocument(file: MisterIniRemoteFile | undefined) {
  if (!file?.metadata?.localContent) return undefined;
  return parseIniDocument(file.metadata.localContent, file.fileName);
}

function iniFileListKey(file: MisterIniRemoteFile) {
  return file.listId || `${file.source}:${file.fileName}`;
}

// Synthetic entry for an INI whose original is gone but still has backups (kept on the local PC and the MiSTer).
function isBackupOnlyFile(file: MisterIniRemoteFile) {
  return Boolean(file.listId?.startsWith('backup-only:'));
}

const iniTargetProfileKey = 'hello-mister-v2:ini-target-profile';

interface IniDeviceStatus {
  reachable: boolean;
  connected: boolean;
}

export function IniSettingsRealPage() {
  const [defaultActive] = useActiveMisterProfile();
  const profileStore = useMemo(() => new SafeMisterProfileStore(), []);
  const [savedProfiles, setSavedProfiles] = useState<MisterDeviceProfile[]>([]);
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState<string | undefined>(() => {
    try { return window.localStorage.getItem(iniTargetProfileKey) ?? undefined; } catch { return undefined; }
  });
  const [iniDeviceStatus, setIniDeviceStatus] = useState<Record<string, IniDeviceStatus>>({});
  const [appMode] = useAppViewMode();
  const developerMode = isAdvancedMode(appMode);
  const [index, setIndex] = useState<MisterIniIndex>();
  const [selectedFileKey, setSelectedFileKey] = useState<string>();
  const [document, setDocument] = useState<MisterIniDocument>();
  const [backups, setBackups] = useState<MisterIniBackupEntry[]>([]);
  const [backupPreview, setBackupPreview] = useState<MisterIniBackupPreviewResult>();
  const [backupPreviewEntry, setBackupPreviewEntry] = useState<MisterIniBackupEntry>();
  const [trashEntries, setTrashEntries] = useState<MisterIniTrashEntry[]>([]);
  const [metadata, setMetadata] = useState<MisterIniMetadataStore>();
  const [writeCapability, setWriteCapability] = useState<MisterIniWriteCapabilityResult>();
  const [notes, setNotes] = useState('');
  const [remoteTargetFileName, setRemoteTargetFileName] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [pinnedHelpId, setPinnedHelpId] = useState<string>();
  const [message, setMessage] = useState('연결된 MiSTer의 실제 INI 파일을 선택하세요.');
  const [loading, setLoading] = useState(false);
  const [trashActionPendingKey, setTrashActionPendingKey] = useState<string>();
  const layoutRef = useRef<HTMLDivElement>(null);
  const [listPaneWidth, setListPaneWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem('hello-mister-ini-list-width'));
    return Number.isFinite(saved) && saved >= 280 ? saved : 360;
  });
  const [backupPanelOpen, setBackupPanelOpen] = useState(false);
  const [trashPanelOpen, setTrashPanelOpen] = useState(false);

  // Saved MiSTer profiles so INI editing can target any MiSTer when several are connected. The INI backend
  // connects on demand by profileId (same as the file manager), so a pre-established session is not required.
  useEffect(() => {
    void profileStore.loadProfiles().then(setSavedProfiles).catch(() => undefined);
  }, [profileStore, defaultActive?.profileId]);

  // Live connected/reachable status per saved profile (TCP probe + active SSH session list).
  useEffect(() => {
    const api = window.helloMisterDesktop;
    if (!api?.probeMisterReachable || savedProfiles.length === 0) {
      setIniDeviceStatus({});
      return;
    }
    let cancelled = false;
    const check = async () => {
      let sessions: Awaited<ReturnType<NonNullable<typeof api.listSshSessions>>> = [];
      try { sessions = (await api.listSshSessions?.()) ?? []; } catch { sessions = []; }
      const results = await Promise.all(savedProfiles.map(async (profile) => {
        const probe = await api.probeMisterReachable!(profile.ipAddress, profile.port || 22, 2500).catch(() => ({ open: false }));
        const reachable = Boolean(probe?.open);
        // "연결됨"은 세션이 있으면서 지금 실제로 응답할 때만. 전원이 꺼진 stale 풀 세션을 연결됨으로 보지 않는다.
        const hasSession = sessions.some((session) =>
          session.sessionId === profile.id
          || (session.host === profile.ipAddress && Number(session.port) === Number(profile.port || 22)));
        return [profile.id, { reachable, connected: reachable && hasSession }] as const;
      }));
      if (!cancelled) setIniDeviceStatus(Object.fromEntries(results));
    };
    void check();
    const interval = window.setInterval(() => void check(), 10000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [savedProfiles]);

  // Effective INI target: explicit selection -> active profile -> first saved. Rebound as `activeMister` so every
  // INI operation below routes to the selected target without touching the global active profile.
  const targetProfile = useMemo(
    () => savedProfiles.find((profile) => profile.id === selectedTargetProfileId)
      ?? savedProfiles.find((profile) => profile.id === defaultActive?.profileId)
      ?? savedProfiles[0],
    [savedProfiles, selectedTargetProfileId, defaultActive?.profileId],
  );
  const activeMister = useMemo(() => {
    if (targetProfile) {
      return { profileId: targetProfile.id, alias: targetProfile.alias, hostname: targetProfile.hostname, ipAddress: targetProfile.ipAddress };
    }
    if (defaultActive) {
      return { profileId: defaultActive.profileId, alias: defaultActive.alias, hostname: defaultActive.hostname, ipAddress: defaultActive.ipAddress };
    }
    return undefined;
  }, [targetProfile, defaultActive]);

  const iniDeviceStatusLabel = useCallback((profile: MisterDeviceProfile) => {
    const status = iniDeviceStatus[profile.id];
    if (status?.connected) return '● 연결됨';
    if (status?.reachable) return '○ 켜짐';
    return '· 오프라인';
  }, [iniDeviceStatus]);

  const selectTargetProfile = useCallback((nextProfileId: string) => {
    setSelectedTargetProfileId(nextProfileId);
    try { window.localStorage.setItem(iniTargetProfileKey, nextProfileId); } catch { /* ignore */ }
    // Switching MiSTer: drop the previous device's INI selection/preview so we never show or save stale content.
    setSelectedFileKey(undefined);
    setDocument(undefined);
    setBackups([]);
    setBackupPreview(undefined);
    setBackupPreviewEntry(undefined);
    setTrashEntries([]);
    setIndex(undefined);
    setWriteCapability(undefined);
  }, []);

  const profileId = activeMister?.profileId;
  const misterLabel = activeMister ? `${(activeMister.hostname && activeMister.hostname !== 'MiSTer') ? activeMister.hostname : (activeMister.alias || 'MiSTer')} @ ${activeMister.ipAddress}` : '';
  const targetStatus = activeMister?.profileId ? iniDeviceStatus[activeMister.profileId] : undefined;
  const targetStatusLabel = !targetStatus
    ? 'MiSTer 상태 확인 중'
    : targetStatus.connected ? 'MiSTer 연결됨'
      : targetStatus.reachable ? 'MiSTer 켜짐(미연결)'
        : 'MiSTer 오프라인';
  const targetStatusTone: 'neutral' | 'safe' | 'warning' = !targetStatus
    ? 'neutral'
    : targetStatus.connected ? 'safe' : 'warning';
  const selectedFile = useMemo(() => index?.files.find((file) => iniFileListKey(file) === selectedFileKey), [index, selectedFileKey]);
  const selectedFileName = selectedFile?.fileName;
  const changedSettings = useMemo(() => (document ? changedIniSettings(document) : []), [document]);
  const iniWritable = Boolean(writeCapability?.state === 'connectedWritable' && writeCapability.canWrite);
  const backupPreviewSummary = useMemo(
    () => (backupPreview?.ok ? summarizeIniContent(backupPreview.content) : undefined),
    [backupPreview],
  );

  const startPaneResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = layoutRef.current?.getBoundingClientRect();
    if (!rect) return;
    const minList = 280;
    const minEditor = 520;
    const maxList = Math.max(minList, rect.width - minEditor - 12);
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.min(maxList, Math.max(minList, moveEvent.clientX - rect.left));
      setListPaneWidth(next);
      window.localStorage.setItem('hello-mister-ini-list-width', String(Math.round(next)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  useEffect(() => {
    if (!pinnedHelpId) return undefined;
    const closePinnedHelp = () => setPinnedHelpId(undefined);
    window.addEventListener('pointerdown', closePinnedHelp);
    return () => window.removeEventListener('pointerdown', closePinnedHelp);
  }, [pinnedHelpId]);

  useEffect(() => {
    setPinnedHelpId(undefined);
    setBackupPreview(undefined);
    setBackupPreviewEntry(undefined);
  }, [selectedFileKey, query, filter]);

  const refreshWriteCapability = useCallback(async () => {
    if (!profileId) {
      setWriteCapability(undefined);
      return undefined;
    }
    const capability = await MisterIniDesktopService.checkWriteCapability(profileId);
    setWriteCapability(capability);
    return capability;
  }, [profileId]);

  const refreshIndex = useCallback(async (nextSelectedFile?: string) => {
    if (!profileId) return;
    setLoading(true);
    try {
      const [nextIndex, nextMetadata] = await Promise.all([
        MisterIniDesktopService.listRemoteIni(profileId),
        MisterIniDesktopService.loadMetadata(profileId),
      ]);
      const trash = await MisterIniDesktopService.listTrash(profileId);
      setIndex(nextIndex);
      setMetadata(nextMetadata);
      setTrashEntries(trash.entries);
      const firstFile = nextIndex.files.find((file) => file.fileName === nextSelectedFile)
        || nextIndex.files.find((file) => file.source === 'remote')
        || nextIndex.files[0];
      if (firstFile) setSelectedFileKey(iniFileListKey(firstFile));
      else setSelectedFileKey(undefined);
      setMessage(nextIndex.message);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  const refreshTrashEntries = useCallback(async (nextProfileId = profileId) => {
    if (!nextProfileId) return undefined;
    const trash = await MisterIniDesktopService.listTrash(nextProfileId);
    if (trash.ok) {
      setTrashEntries(trash.entries);
      return trash;
    }
    setMessage(trash.message || 'INI 휴지통 목록을 다시 읽지 못했습니다.');
    return trash;
  }, [profileId]);

  useEffect(() => {
    if (profileId) void refreshWriteCapability();
    else setWriteCapability(undefined);
  }, [profileId, refreshWriteCapability]);

  const readSelectedFile = useCallback(async (fileKeyOrFileName?: string) => {
    if (!profileId || !fileKeyOrFileName) return;
    setLoading(true);
    try {
      const file = index?.files.find((item) => iniFileListKey(item) === fileKeyOrFileName)
        || index?.files.find((item) => item.fileName === fileKeyOrFileName);
      const fileName = file?.fileName || fileKeyOrFileName;
      const localDocument = buildLocalDocument(file);
      if (localDocument && file?.source !== 'remote') {
        setDocument(localDocument);
        setBackups([]);
        setMessage('PC에서 가져온 INI를 열었습니다. 아직 MiSTer에는 저장하지 않았습니다.');
      } else {
        const result = await MisterIniDesktopService.readRemoteIni(profileId, fileName);
        // Load backups regardless of read success so an INI whose original was deleted still exposes its backups
        // (the user can then restore one, which recreates the original file).
        const list = await MisterIniDesktopService.listBackups(profileId, fileName);
        setBackups(list.backups);
        if (!result.ok) {
          setDocument(localDocument);
          setBackupPanelOpen(list.backups.length > 0);
          setMessage(list.backups.length > 0
            ? `${result.message} 백업 ${list.backups.length}개에서 ‘복원’으로 원본을 되살릴 수 있습니다.`
            : result.message);
          return;
        }
        setDocument(parseIniDocument(result.content, result.fileName));
        setMessage(result.message);
      }
      const metadataEntry = metadata?.files.find((item) => item.fileName === fileName) || file?.metadata;
      setNotes(metadataEntry?.notes || '');
      setRemoteTargetFileName(isAllowedIniFileName(fileName) ? fileName : suggestedRemoteIniFileName(fileName));
    } finally {
      setLoading(false);
    }
  }, [index?.files, metadata?.files, profileId]);

  useEffect(() => {
    if (profileId) void refreshIndex();
  }, [profileId, refreshIndex]);

  useEffect(() => {
    if (selectedFileKey) void readSelectedFile(selectedFileKey);
  }, [readSelectedFile, selectedFileKey]);

  async function saveNotesMetadata(extra?: Partial<MisterIniMetadataStore['files'][number]>) {
    if (!profileId || !selectedFileName || !metadata) return;
    const now = new Date().toISOString();
    const existing = metadata.files.find((item) => item.fileName === selectedFileName) || selectedFile?.metadata;
    const nextEntry: MisterIniMetadataStore['files'][number] = {
      ...existing,
      profileId,
      fileName: selectedFileName,
      notes: notes.trim() || undefined,
      source: selectedFile?.source || 'remote',
      updatedAt: now,
      ...extra,
    };
    const next: MisterIniMetadataStore = {
      ...metadata,
      updatedAt: now,
      files: [
        ...metadata.files.filter((item) => item.fileName !== selectedFileName),
        nextEntry,
      ],
    };
    const saved = await MisterIniDesktopService.saveMetadata(next);
    setMetadata(saved);
    setMessage('INI 메모를 저장했습니다. 원격 INI 파일은 변경하지 않았습니다.');
    await refreshIndex(selectedFileName);
  }

  async function importLocalIni() {
    if (!profileId || !metadata) return;
    const imported = await MisterIniDesktopService.importIniLocal(profileId, remoteTargetFileName || selectedFileName);
    if (!imported.ok || !imported.content || !imported.fileName) {
      setMessage(imported.message);
      return;
    }
    const uploadReady = window.confirm('현재 MiSTer에 저장할 INI로 준비할까요?\n\n확인: 업로드 준비로 표시\n취소: 로컬로만 보관');
    const now = new Date().toISOString();
    const source = uploadReady ? 'upload-ready' : 'local-import';
    const next: MisterIniMetadataStore = {
      ...metadata,
      updatedAt: now,
      files: [
        ...metadata.files.filter((item) => item.fileName !== imported.fileName),
        {
          profileId,
          fileName: imported.fileName,
          displayName: imported.originalFileName || imported.fileName,
          presetSlot: 'custom',
          source,
          localContent: imported.content,
          localSizeBytes: imported.sizeBytes,
          localImportedAt: now,
          notes: uploadReady ? `원격 저장 후보: ${imported.suggestedRemoteFileName}` : 'PC에서 가져온 로컬 INI',
          updatedAt: now,
        },
      ],
    };
    await MisterIniDesktopService.saveMetadata(next);
    setRemoteTargetFileName(imported.suggestedRemoteFileName || suggestedRemoteIniFileName(imported.fileName));
    await refreshIndex(imported.fileName);
    setMessage(`${imported.fileName} 파일을 ${iniSourceDisplayLabel(source)} 항목으로 추가했습니다.`);
  }

  async function saveIni() {
    if (!document || !selectedFileName || !profileId) return;
    if (!iniWritable) {
      setMessage('INI 저장 권한을 확인하지 못했습니다. 권한 다시 확인을 누른 뒤 다시 시도하세요.');
      return;
    }
    const targetFileName = selectedFile?.source === 'remote' ? selectedFileName : remoteTargetFileName;
    if (!targetFileName || !isAllowedIniFileName(targetFileName)) {
      setMessage('MiSTer에 저장할 파일명은 MiSTer.ini, MiSTer_alt_*.ini, MiSTer_이름.ini 형식의 안전한 파일명이어야 합니다.');
      return;
    }
    const nextContent = serializeIniDocument(document);
    const changedPreview = changedSettings.slice(0, 8).map((setting) => `${setting.key}: ${setting.originalValue} -> ${setting.value}`).join('\n');
    const confirmed = window.confirm(`대상 MiSTer: ${misterLabel}\n대상 INI: ${targetFileName}\n변경 항목: ${changedSettings.length}개\n자동 백업은 만들지 않습니다. 필요하면 먼저 ‘백업 만들기’로 백업하세요.\n\n${changedPreview || '변경 항목 없음'}`);
    if (!confirmed) return;
    setLoading(true);
    setMessage(`${targetFileName} INI 저장을 시작했습니다. (자동 백업 없음)`);
    try {
      const result = await MisterIniDesktopService.writeRemoteIniWithBackup({ profileId, fileName: targetFileName, content: nextContent, confirmed: true });
      setMessage(result.message);
      if (!result.ok) return;
      if (selectedFile?.source !== 'remote' && metadata) {
        const nextMetadata = {
          ...metadata,
          updatedAt: new Date().toISOString(),
          files: metadata.files.filter((item) => item.fileName !== selectedFileName),
        };
        await MisterIniDesktopService.saveMetadata(nextMetadata);
        setMetadata(nextMetadata);
      }
      await refreshIndex(targetFileName);
      const verification = await MisterIniDesktopService.readRemoteIni(profileId, targetFileName);
      if (verification.ok) {
        setDocument(parseIniDocument(verification.content, verification.fileName));
        setSelectedFileKey(`remote:${targetFileName}`);
        setRemoteTargetFileName(targetFileName);
        const list = await MisterIniDesktopService.listBackups(profileId, targetFileName);
        setBackups(list.backups);
        setMessage(`${result.message} 저장된 원격 INI를 다시 읽었습니다.`);
      } else {
        setMessage(`${result.message} 다만 저장 후 다시 읽기에 실패했습니다: ${verification.message}`);
      }
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      setMessage(`${targetFileName} INI 저장에 실패했습니다.${detail}`);
    } finally {
      setLoading(false);
    }
  }

  function removeIniFileFromList(file: MisterIniRemoteFile) {
    const key = iniFileListKey(file);
    setIndex((current) => current
      ? {
          ...current,
          files: current.files.filter((item) => iniFileListKey(item) !== key),
          debug: current.debug ? { ...current.debug, finalListCount: Math.max(0, current.debug.finalListCount - 1) } : current.debug,
        }
      : current);
    if (selectedFileKey === key) {
      setDocument(undefined);
      setSelectedFileKey(undefined);
    }
  }

  async function removeLocalIniEntry(file: MisterIniRemoteFile) {
    if (!profileId || !isLocalIniListSource(file.source)) return;
    const confirmed = window.confirm(`${file.fileName} 항목은 아직 MiSTer에 저장되지 않은 로컬/캐시 항목입니다. 앱 목록에서 제거합니다.`);
    if (!confirmed) return;
    try {
      const currentMetadata = metadata || await MisterIniDesktopService.loadMetadata(profileId);
      const now = new Date().toISOString();
      const nextMetadata: MisterIniMetadataStore = {
        ...currentMetadata,
        updatedAt: now,
        files: currentMetadata.files.filter((item) => !metadataEntryMatchesFile(item, file)),
      };
      await MisterIniDesktopService.saveMetadata(nextMetadata);
      setMetadata(nextMetadata);
      removeIniFileFromList(file);
      setMessage(localIniRemoveSuccessMessage(file.source));
    } catch {
      setMessage('로컬 INI 항목을 제거하지 못했습니다.');
    }
  }

  async function trashRemoteIni(file: MisterIniRemoteFile) {
    if (!profileId || !isRemoteIniSource(file.source)) return;
    const targetFileName = file.fileName;
    const targetKey = iniFileListKey(file);
    if (!canTrashIniFile(targetFileName)) {
      setMessage('기본 INI 파일은 삭제할 수 없습니다.');
      return;
    }
    const confirmed = window.confirm(`${targetFileName} 파일을 휴지통으로 이동합니다. 원격 파일은 /media/fat/.hello-mister-trash/ini 아래로만 이동됩니다.`);
    if (!confirmed) return;
    setTrashActionPendingKey(targetKey);
    setMessage(`${targetFileName} 파일의 휴지통 이동을 시작했습니다. 휴지통 폴더 생성 후 SFTP rename을 실행합니다.`);
    try {
      const result = await MisterIniDesktopService.trashIni({ profileId, fileName: targetFileName, confirmed: true });
      if (!result.ok) {
        setMessage(result.message || `${targetFileName} 파일을 휴지통으로 이동하지 못했습니다.`);
        return;
      }
      let nextMessage = result.message || `${targetFileName} 파일을 휴지통으로 이동했습니다.`;
      if (metadata) {
        const now = new Date().toISOString();
        const nextMetadata: MisterIniMetadataStore = {
          ...metadata,
          updatedAt: now,
          files: metadata.files.filter((item) => item.fileName.toLowerCase() !== targetFileName.toLowerCase() || isLocalIniListSource(normalizedIniSource(item.source, Boolean(item.localContent)))),
        };
        try {
          await MisterIniDesktopService.saveMetadata(nextMetadata);
          setMetadata(nextMetadata);
        } catch {
          nextMessage = `${nextMessage} 단, 앱 목록 캐시 정리는 다음 새로고침 때 다시 확인하세요.`;
        }
      }
      removeIniFileFromList(file);
      setDocument(undefined);
      setSelectedFileKey(undefined);
      setTrashPanelOpen(true);
      const trashRefresh = await refreshTrashEntries(profileId);
      if (trashRefresh && !trashRefresh.ok) {
        nextMessage = `${nextMessage} 휴지통 목록 새로고침은 실패했습니다: ${trashRefresh.message}`;
      }
      setMessage(nextMessage);
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      setMessage(`${targetFileName} 파일을 휴지통으로 이동하지 못했습니다.${detail}`);
    } finally {
      setTrashActionPendingKey(undefined);
    }
  }

  async function deleteIniBySource(file: MisterIniRemoteFile) {
    if (isRemoteIniSource(file.source)) {
      await trashRemoteIni(file);
      return;
    }
    await removeLocalIniEntry(file);
  }

  async function previewBackup(backup: MisterIniBackupEntry) {
    if (!selectedFileName || !profileId) return;
    setLoading(true);
    try {
      const result = await MisterIniDesktopService.previewBackup(profileId, selectedFileName, backup.path);
      setMessage(result.message);
      if (result.ok) {
        setBackupPreview(result);
        setBackupPreviewEntry(backup);
      } else {
        setBackupPreview(undefined);
        setBackupPreviewEntry(undefined);
      }
    } finally {
      setLoading(false);
    }
  }

  async function restoreBackup(backup: MisterIniBackupEntry) {
    if (!selectedFileName || !profileId) return;
    if (!iniWritable) {
      setMessage('INI 백업 복원 권한을 확인하지 못했습니다.');
      return;
    }
    const confirmed = selectedFile?.source !== 'remote'
      ? window.confirm(`원본 INI가 없어 이 백업으로 ${selectedFileName} 원본을 새로 만듭니다.\n\n선택한 백업: ${backup.fileName}`)
      : window.confirm(`${formatBackupRestoreWarning(selectedFileName)}\n\n선택한 백업: ${backup.fileName}\n현재 INI는 백업 내용으로 덮어씌워집니다. 적용 전 현재 파일을 다시 백업합니다.`);
    if (!confirmed) return;
    const result = await MisterIniDesktopService.restoreBackup({ profileId, fileName: selectedFileName, backupPath: backup.path, confirmed: true });
    setMessage(result.message);
    if (result.ok) {
      setBackupPreview(undefined);
      setBackupPreviewEntry(undefined);
      await refreshIndex(selectedFileName);
      await readSelectedFile(selectedFileName);
    }
  }

  async function createBackup() {
    if (!selectedFileName || !profileId) {
      setMessage('백업할 INI 파일을 먼저 선택하세요.');
      return;
    }
    if (!iniWritable) {
      setMessage('INI 백업 생성 권한을 확인하지 못했습니다.');
      return;
    }
    const result = await MisterIniDesktopService.createBackup(profileId, selectedFileName);
    setMessage(result.message);
    if (result.ok) {
      setBackups(result.backups || backups);
      setBackupPanelOpen(true);
    }
  }

  async function deleteBackup(backup: MisterIniBackupEntry) {
    if (!selectedFileName || !profileId) return;
    if (!iniWritable) {
      setMessage('INI 백업 삭제 권한을 확인하지 못했습니다.');
      return;
    }
    const confirmed = window.confirm(`${backup.fileName} 백업을 휴지통으로 이동합니다. 영구 삭제가 아니라 INI 휴지통으로 옮겨 휴지통 목록에서 복원하거나 영구 삭제할 수 있습니다.`);
    if (!confirmed) return;
    const result = await MisterIniDesktopService.deleteBackup({ profileId, fileName: selectedFileName, backupPath: backup.path, confirmed: true });
    setMessage(result.message);
    if (result.ok) {
      setBackups(result.backups || backups.filter((item) => item.path !== backup.path));
      if (backupPreviewEntry?.path === backup.path) {
        setBackupPreview(undefined);
        setBackupPreviewEntry(undefined);
      }
      await refreshIndex(selectedFileName);
    }
  }

  async function restoreTrash(entry: MisterIniTrashEntry) {
    if (!profileId) return;
    const confirmed = entry.kind === 'backup'
      ? window.confirm(`${entry.originalFileName} 백업을 복원합니다. 원본 INI가 있으면 백업 목록으로 되돌리고, 원본이 없으면 ${entry.originalFileName} 원본 파일로 복원합니다.`)
      : window.confirm(`${entry.originalFileName} 파일을 휴지통에서 복구합니다. 같은 이름의 현재 파일이 있으면 먼저 백업합니다.`);
    if (!confirmed) return;
    const result = await MisterIniDesktopService.restoreTrashedIni({ profileId, trashPath: entry.path, targetFileName: entry.originalFileName, confirmed: true });
    setMessage(result.message);
    if (result.ok) await refreshIndex(entry.originalFileName);
  }

  async function emptyTrash() {
    if (!profileId) return;
    if (trashEntries.length === 0) {
      setMessage('휴지통이 이미 비어 있습니다.');
      return;
    }
    const confirmed = window.confirm(`휴지통의 ${trashEntries.length}개 항목을 모두 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.`);
    if (!confirmed) return;
    const result = await MisterIniDesktopService.emptyTrash(profileId);
    setMessage(result.message);
    if (result.ok) await refreshIndex(selectedFileName);
  }

  async function deleteTrash(entry: MisterIniTrashEntry) {
    if (!profileId) return;
    const confirmed = window.confirm(`${entry.originalFileName} 휴지통 파일을 영구 삭제합니다. 이 작업은 /media/fat/.hello-mister-trash/ini 안의 선택한 파일에만 적용됩니다.`);
    if (!confirmed) return;
    const result = await MisterIniDesktopService.deleteTrashedIni({ profileId, trashPath: entry.path, confirmed: true });
    setMessage(result.message);
    if (result.ok) {
      setTrashEntries((current) => current.filter((item) => item.path !== entry.path));
      await refreshIndex(selectedFileName);
    }
  }

  if (!activeMister) {
    return (
      <>
        <PageHeader eyebrow="INI 설정" title="연결된 MiSTer의 실제 INI 관리" description="INI 설정은 active MiSTer 기준으로만 동작합니다." />
        <SectionCard title="MiSTer 연결이 필요합니다" tone="warning">
          <p className="muted">먼저 MiSTer 연결 메뉴에서 저장된 MiSTer에 연결하세요. 앱 시작 자동연결은 하지 않습니다.</p>
          <Link className="button primary" to="/mister">MiSTer 연결로 이동</Link>
        </SectionCard>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="INI 설정"
        title="연결된 MiSTer INI 편집"
        description="실제 /media/fat의 MiSTer.ini와 MiSTer_*.ini를 읽고 저장합니다. 백업은 자동이 아니라 ‘백업 만들기’로 직접 만듭니다."
      />

      <SectionCard title="작업 대상">
        <div className="ini-target-bar ini-target-summary" data-ini-target-status="clean">
          <div className="ini-target-identity">
            <span>대상 MiSTer</span>
            {savedProfiles.length > 1 ? (
              <select
                className="ini-target-select"
                value={activeMister?.profileId ?? ''}
                onChange={(event) => selectTargetProfile(event.target.value)}
                title="INI 편집 대상 MiSTer"
                aria-label="INI 편집 대상 MiSTer"
              >
                {savedProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {misterDisplayName(profile)} · {iniDeviceStatusLabel(profile)}
                  </option>
                ))}
              </select>
            ) : (
              <strong title={misterLabel}>{misterLabel}</strong>
            )}
          </div>
          <div className="ini-target-status">
            <StatusBadge label={targetStatusLabel} tone={targetStatusTone} />
            <StatusBadge label={capabilityLabel(writeCapability)} tone={capabilityTone(writeCapability)} />
          </div>
          <div className="inline-actions">
            <button className="button compact" type="button" onClick={() => void refreshIndex(selectedFileName)} disabled={loading}>
              <RefreshCw size={14} /> INI 목록 새로고침
            </button>
            <button className="button compact secondary" type="button" onClick={() => void refreshWriteCapability()} disabled={loading}>
              권한 다시 확인
            </button>
          </div>
        </div>
        <p className="muted">{capabilityMessage(writeCapability)}</p>
        <p className="muted">{message}</p>
        {developerMode && writeCapability?.detail && (
          <details className="ini-inline-panel">
            <summary><strong>INI 권한 확인 상세</strong><span>{writeCapability.errorCode || writeCapability.state}</span></summary>
            <pre className="log-box developer-log">{JSON.stringify(writeCapability, null, 2)}</pre>
          </details>
        )}
      </SectionCard>

      <div
        ref={layoutRef}
        className="ini-manager-layout two-pane"
        style={{ gridTemplateColumns: `${Math.round(listPaneWidth)}px 12px minmax(520px, 1fr)` }}
      >
        <SectionCard title="INI 파일">
          <div className="ini-list-toolbar">
            <button className="button compact" type="button" onClick={() => void importLocalIni()}>
              <Upload size={14} /> PC INI 가져오기
            </button>
            <button className="button compact" type="button" onClick={() => selectedFileName && void MisterIniDesktopService.exportIniLocal(profileId, selectedFileName).then((result) => setMessage(result.message))} disabled={!selectedFileName || selectedFile?.source !== 'remote'}>
              <Download size={14} /> PC로 내보내기
            </button>
          </div>
          <div className="ini-file-list">
            {(index?.files || []).map((file: MisterIniRemoteFile) => {
              const fileKey = iniFileListKey(file);
              const deleteDisabledReason = iniDeleteDisabledReason(file);
              const deletePending = trashActionPendingKey === fileKey;
              const backupOnly = isBackupOnlyFile(file);
              return (
              <div
                key={fileKey}
                className={`ini-file-row ${fileKey === selectedFileKey ? 'selected' : ''} ${backupOnly ? 'backup-only' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedFileKey(fileKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedFileKey(fileKey);
                  }
                }}
                title={backupOnly
                  ? `${file.fileName}\n원본 INI 없음 · 로컬 PC 백업 ${file.backupCount}개 보관 (선택 후 ‘복원’으로 되살리기)`
                  : `${file.fileName}\n출처: ${iniSourceDisplayLabel(file.source)}\nMiSTer: ${file.targetAlias || index?.profileAlias || 'MiSTer'} @ ${file.targetHost || index?.host || ''}\n${file.path || '원격 파일 없음'}`}
              >
                <div className="ini-file-main">
                  <strong>{file.fileName}</strong>
                  {file.displayName && file.displayName !== file.fileName && <span className="ini-file-secondary">가칭: {file.displayName}</span>}
                  <span>{file.fileName}</span>
                  <small>{presetSlotLabel(file.kind)} · {formatBytes(file.sizeBytes)} · 백업 {file.backupCount}개</small>
                  <div className="ini-file-badges">
                    <StatusBadge label={backupOnly ? '로컬 PC 백업' : iniSourceDisplayLabel(file.source)} tone={backupOnly ? 'dry' : sourceTone(file.source)} />
                    <StatusBadge label={file.targetHost || index?.host || '대상 미확인'} tone="dry" />
                    {fileKey === selectedFileKey && changedSettings.length > 0 && <StatusBadge label={`수정 ${changedSettings.length}개`} tone="warning" />}
                  </div>
                </div>
                {fileKey === selectedFileKey && (
                  <div className="ini-file-inline-editor" onClick={(event) => event.stopPropagation()}>
                    <label className="ini-inline-field full">
                      <span>메모</span>
                      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={() => void saveNotesMetadata()} placeholder="이 INI를 언제 쓰는지 메모" />
                    </label>
                    <div className="ini-file-actions">
                      <button className="button compact" type="button" onClick={() => void saveNotesMetadata()}><Save size={14} /> 메모 저장</button>
                      <button className="button compact secondary" type="button" onClick={() => void readSelectedFile(selectedFileKey || selectedFileName)}><FolderOpen size={14} /> 다시 읽기</button>
                      <button className="button compact secondary" type="button" disabled title="이번 단계에서는 원격 파일명 변경을 열지 않습니다. 가칭 이름만 수정할 수 있습니다.">파일명 변경</button>
                      <button className="button compact secondary" type="button" onClick={() => setBackupPanelOpen((current) => !current)}>백업 {backups.length}개</button>
                      <button className="button danger compact" type="button" onClick={() => void deleteIniBySource(file)} disabled={Boolean(deleteDisabledReason) || deletePending} title={deleteDisabledReason}>
                        <Trash2 size={14} /> {deletePending ? '이동 중' : iniDeleteActionLabel(file)}
                      </button>
                    </div>
                    {!iniWritable && file.source === 'remote' && canTrashIniFile(file.fileName) && <p className="muted">권한 사전 확인이 끝나지 않아도 휴지통 이동을 시도할 수 있습니다. 실패하면 이유를 표시합니다.</p>}
                    {!canTrashIniFile(file.fileName) && <p className="muted">기본 MiSTer.ini는 삭제할 수 없습니다.</p>}
                    {file.source !== 'remote' && <p className="muted">로컬/업로드 준비/cache 항목은 MiSTer가 아니라 앱 목록에서 제거됩니다.</p>}
                  </div>
                )}
              </div>
              );
            })}
            {index?.files.length === 0 && (
              <p className="muted">
                현재 MiSTer의 /media/fat에서 MiSTer*.ini 파일을 찾지 못했습니다. 고급 모드의 내부 진단에서 원격 listing 결과를 확인할 수 있습니다.
              </p>
            )}
          </div>
          <details className="ini-inline-panel" open={backupPanelOpen} onToggle={(event) => setBackupPanelOpen(event.currentTarget.open)}>
            <summary><strong>선택한 INI 백업</strong><span>{backups.length}개</span></summary>
            <div className="ini-backup-list">
              <button className="button compact primary" type="button" onClick={() => void createBackup()} disabled={!iniWritable || !selectedFileName} title="현재 선택한 INI의 백업을 새 번호(.bak)로 만듭니다."><Save size={14} /> 백업 만들기</button>
              {backups.slice(0, 30).map((backup) => (
                <div key={backup.path} className="ini-backup-row">
                  <span>{backup.fileName}</span>
                  <small>{formatBytes(backup.sizeBytes)} · {formatDate(backup.createdAt)}</small>
                  <div className="inline-actions">
                    <button className="button compact secondary" type="button" onClick={() => void previewBackup(backup)}>미리보기</button>
                    <button className="button compact" type="button" onClick={() => void restoreBackup(backup)} disabled={!iniWritable}><RotateCcw size={14} /> 복원</button>
                    <button className="button compact" type="button" onClick={() => void deleteBackup(backup)} disabled={!iniWritable} title="이 백업을 INI 휴지통으로 이동합니다."><Trash2 size={14} /> 휴지통</button>
                  </div>
                </div>
              ))}
              {backups.length === 0 && <p className="muted">선택한 INI의 백업이 없습니다. 저장 시 자동 생성되지 않으며 ‘백업 만들기’로 직접 만듭니다.</p>}
            </div>
          </details>
          <details className="ini-inline-panel" open={trashPanelOpen} onToggle={(event) => setTrashPanelOpen(event.currentTarget.open)}>
            <summary><strong>휴지통</strong><span>{trashEntries.length}개</span></summary>
            <div className="ini-backup-list">
              <div className="inline-actions">
                <button className="button compact secondary" type="button" onClick={() => void refreshIndex(selectedFileName)}>새로고침</button>
                <button className="button compact danger" type="button" onClick={() => void emptyTrash()} disabled={trashEntries.length === 0}><Trash2 size={14} /> 휴지통 비우기</button>
              </div>
              {trashEntries.slice(0, 10).map((entry) => (
                <div key={entry.path} className="ini-backup-row">
                  <span>{entry.originalFileName}{entry.kind === 'backup' ? ' · 백업' : ''}</span>
                  <small>{formatBytes(entry.sizeBytes)} · {formatDate(entry.movedAt)}</small>
                  <div className="inline-actions">
                    <button className="button compact" type="button" onClick={() => void restoreTrash(entry)} title={entry.kind === 'backup' ? '이 백업을 백업 목록으로 되돌립니다.' : '이 INI를 원래 위치로 복구합니다.'}><RotateCcw size={14} /> 복구</button>
                    <button className="button danger compact" type="button" onClick={() => void deleteTrash(entry)}>영구 삭제</button>
                  </div>
                </div>
              ))}
              {trashEntries.length === 0 && <p className="muted">휴지통 항목이 없습니다.</p>}
            </div>
          </details>
          {developerMode && index?.debug && (
            <pre className="log-box developer-log">{JSON.stringify(index.debug, null, 2)}</pre>
          )}
        </SectionCard>

        <div
          className="ini-pane-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="INI 목록과 편집기 크기 조정"
          onPointerDown={startPaneResize}
        />

        <SectionCard title={selectedFileName ? `${selectedFileName} GUI 편집` : 'INI를 선택하세요'}>
          {selectedFile && (
            <div className="ini-selected-summary">
              <strong>현재 보고 있는 파일: {selectedFile.fileName}</strong>
              {selectedFile.displayName && <span>가칭 이름: {selectedFile.displayName}</span>}
              <span>출처: {iniSourceDisplayLabel(selectedFile.source)}</span>
              <span>MiSTer: {misterLabel}</span>
              <span>변경 {changedSettings.length}개</span>
              {selectedFile.source !== 'remote' && (
                <label className="field compact-field">
                  <span>MiSTer에 저장할 파일명</span>
                  <input value={remoteTargetFileName} onChange={(event) => setRemoteTargetFileName(event.target.value)} placeholder="MiSTer_Custom.ini" />
                </label>
              )}
            </div>
          )}
          {document && (
            <>
              <div className="ini-editor-toolbar">
                <label className="field">
                  <span>검색</span>
                  <span className="ini-search-input"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="key, 값, 도움말 검색" /></span>
                </label>
                <label className="field">
                  <span>필터</span>
                  <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                    <option value="all">전체</option>
                    <option value="changed">변경된 항목</option>
                    <option value="video">영상</option>
                    <option value="audio">오디오</option>
                    <option value="controller">컨트롤러</option>
                    <option value="network-system">네트워크/시스템</option>
                    <option value="other">기타</option>
                  </select>
                </label>
                <button className="button primary compact" type="button" onClick={() => void saveIni()} disabled={!iniWritable || (changedSettings.length === 0 && selectedFile?.source === 'remote') || loading} title={!iniWritable ? 'INI 편집 권한 확인 후 저장할 수 있습니다.' : undefined}>
                  <Save size={14} /> 저장
                </button>
              </div>
              <p className="muted">변경 {changedSettings.length}개 · 저장 버튼을 누르기 전까지 원격 INI는 수정되지 않습니다.</p>
              <div className="ini-section-list">
                {document.sections.map((section) => {
                  const visibleSettings = section.settings.filter((setting) => settingMatches(setting, query, filter));
                  if (visibleSettings.length === 0) return null;
                  return (
                    <details key={section.id} className="ini-section" open>
                      <summary>{section.name} <span>{visibleSettings.length}개</span></summary>
                      <div className="ini-setting-list">
                        {visibleSettings.map((setting) => (
                          <div key={setting.id} className={`ini-setting-row ${setting.changed ? 'changed' : ''}`} data-toggle-safety="row-passive">
                            <div className="ini-setting-key">
                              <div className="ini-setting-title-line">
                                <strong>{settingDisplayLabel(setting)}</strong>
                                {riskLabel(setting) && <StatusBadge label={riskLabel(setting)!} tone={riskTone(setting)} />}
                              </div>
                              <small>{setting.key}{developerMode ? ` · line ${setting.lineNumber}` : ''}</small>
                            </div>
                            <IniSettingControl setting={setting} developerMode={developerMode} onChange={(value) => setDocument((current) => current ? updateIniSetting(current, setting.id, value) : current)} />
                            <div
                              className={`ini-help-wrapper ${pinnedHelpId ? 'help-mode-click' : ''} ${pinnedHelpId === setting.id ? 'open' : ''}`}
                              onPointerDown={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                className="ini-help-tooltip"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setPinnedHelpId((current) => (current === setting.id ? undefined : setting.id));
                                }}
                                aria-label={`${settingDisplayLabel(setting)} 도움말`}
                                aria-expanded={pinnedHelpId === setting.id}
                              >
                                <HelpCircle size={14} />
                              </button>
                              <IniHelpPopover setting={setting} developerMode={developerMode} onClose={() => setPinnedHelpId(undefined)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
              {developerMode && <pre className="log-box developer-log">{serializeIniDocument(document)}</pre>}
            </>
          )}
          {!document && <p className="muted">왼쪽 목록에서 INI 파일을 선택하면 섹션별 GUI 편집기가 표시됩니다.</p>}
        </SectionCard>

      </div>
      {backupPreview?.ok && backupPreviewEntry && (
        <div className="modal-backdrop" role="presentation" onClick={() => {
          setBackupPreview(undefined);
          setBackupPreviewEntry(undefined);
        }}>
          <div className="compare-modal ini-backup-preview-modal" role="dialog" aria-modal="true" aria-label="INI 백업 미리보기" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <span className="badge badge-dry">백업 미리보기</span>
                <h3>{backupPreview.fileName} 백업</h3>
                <p className="muted">복원하면 현재 원격 INI가 백업 내용으로 덮어씌워집니다. 적용 전 현재 파일은 다시 백업됩니다.</p>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => {
                setBackupPreview(undefined);
                setBackupPreviewEntry(undefined);
              }}>
                <X size={18} />
              </button>
            </div>
            <div className="ini-backup-preview-grid">
              <div><strong>대상 INI</strong><span>{backupPreview.fileName}</span></div>
              <div><strong>백업 파일</strong><span>{backupPreviewEntry.fileName}</span></div>
              <div><strong>크기</strong><span>{formatBytes(backupPreview.sizeBytes)}</span></div>
              <div><strong>읽은 시간</strong><span>{formatDate(backupPreview.readAt)}</span></div>
              <div><strong>섹션</strong><span>{backupPreviewSummary?.sectionCount ?? 0}개</span></div>
              <div><strong>설정</strong><span>{backupPreviewSummary?.settingCount ?? 0}개</span></div>
            </div>
            <pre className="ini-backup-preview-body">{backupPreview.content}</pre>
            <div className="modal-actions">
              <button className="button compact secondary" type="button" onClick={() => {
                setBackupPreview(undefined);
                setBackupPreviewEntry(undefined);
              }}>닫기</button>
              <button className="button compact" type="button" onClick={() => void restoreBackup(backupPreviewEntry)}>
                <RotateCcw size={14} /> 이 백업으로 복원
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
