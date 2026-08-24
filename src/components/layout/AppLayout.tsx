import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Gamepad2, Palette, Settings } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { modeMeets, type AppMode, useAppViewMode } from '../../services/app/viewMode';
import { RomTransferIndicator } from '../rom/RomTransferIndicator';
import { ConnectionStatusBadge } from '../mister/ConnectionStatusBadge';

type SidebarGroupId = 'mister' | 'stickers' | 'settings';

type SidebarChildItem = {
  to: string;
  label: string;
  minimumMode: AppMode;
  // Optional sub-links rendered as an indented dropdown under this item (e.g. 게임 라이브러리 → 게임 목록/가져오기).
  children?: { to: string; label: string; end?: boolean }[];
};

type SidebarGroup = {
  id: SidebarGroupId;
  label: string;
  icon: typeof Palette;
  routePrefixes: string[];
  children: SidebarChildItem[];
};

const sidebarGroups: SidebarGroup[] = [
  {
    id: 'mister',
    label: 'MiSTer FPGA',
    icon: Gamepad2,
    routePrefixes: ['/mister', '/connection', '/games', '/sd-card', '/ini', '/scripts', '/controller-setup', '/stickers/nfc'],
    children: [
      { to: '/mister', label: 'MiSTer 연결', minimumMode: 'basic' },
      { to: '/games', label: 'MiSTer 게임 롬 관리', minimumMode: 'basic' },
      { to: '/stickers/nfc', label: 'NFC 관리', minimumMode: 'basic' },
      { to: '/sd-card', label: 'SD 카드 관리', minimumMode: 'advanced' },
      { to: '/ini', label: 'INI 설정', minimumMode: 'basic' },
      { to: '/scripts', label: '스크립트 관리', minimumMode: 'advanced' },
      { to: '/controller-setup', label: '컨트롤러 매핑', minimumMode: 'advanced' },
    ],
  },
  {
    id: 'stickers',
    label: '스티커 제작',
    icon: Palette,
    routePrefixes: ['/stickers'],
    children: [
      {
        to: '/stickers/mister',
        label: '게임 라이브러리',
        minimumMode: 'basic',
        children: [
          { to: '/stickers/mister', label: '게임 목록', end: true },
          { to: '/stickers/mister/import', label: '게임 가져오기' },
        ],
      },
      { to: '/stickers/templates', label: '템플릿', minimumMode: 'basic' },
      { to: '/stickers/editor', label: '카드편집', minimumMode: 'basic' },
      { to: '/stickers/images', label: '이미지/에셋', minimumMode: 'basic' },
      { to: '/stickers/album', label: '카드 앨범', minimumMode: 'basic' },
      { to: '/stickers/output', label: '출력/시트', minimumMode: 'basic' },
      { to: '/stickers/template-editor', label: '템플릿 편집', minimumMode: 'basic' },
    ],
  },
  {
    id: 'settings',
    label: '설정',
    icon: Settings,
    routePrefixes: ['/settings', '/backup'],
    children: [
      { to: '/settings', label: '앱 설정', minimumMode: 'basic' },
      { to: '/backup', label: '백업/복구', minimumMode: 'advanced' },
    ],
  },
] satisfies SidebarGroup[];

const SIDEBAR_GROUP_STORAGE_KEYS = {
  mister: 'hello-mister-v2-sidebar-mister-expanded',
  stickers: 'hello-mister-v2-sidebar-stickers-expanded',
  settings: 'hello-mister-v2-sidebar-settings-expanded',
} satisfies Record<SidebarGroupId, string>;

function isRouteInGroup(pathname: string, group: SidebarGroup) {
  return group.routePrefixes.some((routePrefix) => pathname === routePrefix || pathname.startsWith(`${routePrefix}/`));
}

function initialExpandedGroups() {
  return sidebarGroups.reduce<Record<SidebarGroupId, boolean>>((state, group) => {
    state[group.id] = typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_GROUP_STORAGE_KEYS[group.id]) === 'true';
    return state;
  }, { mister: false, stickers: false, settings: false });
}

export function AppLayout() {
  const [viewMode, setViewMode] = useAppViewMode();
  const location = useLocation();
  const [expandedGroups, setExpandedGroups] = useState<Record<SidebarGroupId, boolean>>(() => initialExpandedGroups());
  const routeClass = location.pathname === '/' ? 'route-stickers-mister' : `route-${location.pathname.replace(/^\//, '').replace(/[^a-z0-9-]/gi, '-')}`;

  useEffect(() => {
    const activeGroup = sidebarGroups.find((group) => isRouteInGroup(location.pathname, group));
    if (!activeGroup) return;
    setExpandedGroups((current) => (
      current[activeGroup.id] ? current : { ...current, [activeGroup.id]: true }
    ));
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sidebarGroups.forEach((group) => {
      window.localStorage.setItem(SIDEBAR_GROUP_STORAGE_KEYS[group.id], expandedGroups[group.id] ? 'true' : 'false');
    });
  }, [expandedGroups]);

  function toggleGroup(groupId: SidebarGroupId) {
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  return (
    <div className={`app-shell mode-${viewMode} view-${viewMode}`}>
      <aside className="sidebar">
        <div className="brand">
          <h1>Hello Mister</h1>
        </div>
        <ConnectionStatusBadge />
        <nav className="nav-list" aria-label="주요 메뉴">
          {sidebarGroups.map((group) => {
            const Icon = group.icon;
            const expanded = expandedGroups[group.id];
            const active = isRouteInGroup(location.pathname, group);
            const ToggleIcon = expanded ? ChevronDown : ChevronRight;
            const visibleChildren = group.children.filter((item) => modeMeets(viewMode, item.minimumMode));
            return (
              <div key={group.id} className="nav-group">
                <button
                  type="button"
                  className={`nav-item nav-toggle ${active ? 'active' : ''}`}
                  aria-expanded={expanded}
                  aria-controls={`sidebar-group-${group.id}`}
                  onClick={() => toggleGroup(group.id)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{group.label}</span>
                  <ToggleIcon size={16} aria-hidden="true" className="nav-chevron" />
                </button>
                {expanded && (
                  <div id={`sidebar-group-${group.id}`} className="nav-sub-list" aria-label={`${group.label} 하위 메뉴`}>
                    {visibleChildren.map((subItem) => (
                      subItem.children ? (
                        <div key={subItem.label} className="nav-sub-dropdown">
                          <span className="nav-sub-heading">{subItem.label}</span>
                          {subItem.children.map((leaf) => (
                            <NavLink
                              key={leaf.to}
                              to={leaf.to}
                              end={leaf.end}
                              className={({ isActive }) => `nav-sub-item nav-sub-nested ${isActive ? 'active' : ''}`}
                            >
                              {leaf.label}
                            </NavLink>
                          ))}
                        </div>
                      ) : (
                        <NavLink
                          key={subItem.to}
                          to={subItem.to}
                          className={({ isActive }) => `nav-sub-item ${isActive ? 'active' : ''}`}
                        >
                          {subItem.label}
                        </NavLink>
                      )
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="view-mode-toggle compact" aria-label="앱 모드">
          <div className="segmented-control two">
            <button type="button" className={viewMode === 'basic' ? 'active' : ''} onClick={() => setViewMode('basic')}>기본</button>
            <button type="button" className={viewMode === 'advanced' ? 'active' : ''} onClick={() => setViewMode('advanced')}>고급</button>
          </div>
        </div>
      </aside>
      <main className={`content ${routeClass}`}>
        <Outlet />
      </main>
      <RomTransferIndicator />
    </div>
  );
}
