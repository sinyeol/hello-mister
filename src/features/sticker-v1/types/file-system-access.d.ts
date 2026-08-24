interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  readonly kind: 'file' | 'directory';
  readonly name: string;
  queryPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (descriptor?: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file';
  getFile: () => Promise<File>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory';
  values: () => AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface Window {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  zaparooDesktop?: {
    bridgeUrl?: string;
    saveAndOpenPdf?: (bytes: Uint8Array, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
    saveFile?: (bytes: Uint8Array, filename: string, mimeType: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; size?: number; error?: string }>;
    openFile?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
    captureHtmlAsPng?: (html: string, width: number, height: number) => Promise<{ ok: boolean; bytes?: Uint8Array; size?: number; error?: string }>;
    readFileAsDataUrl?: (filePath: string) => Promise<{ ok: boolean; dataUrl?: string; mimeType?: string; size?: number; error?: string }>;
    fetchImageAsDataUrl?: (url: string) => Promise<{ ok: boolean; dataUrl?: string; mimeType?: string; size?: number; error?: string }>;
    getPathForFile?: (file: File) => string | undefined;
  };
}
