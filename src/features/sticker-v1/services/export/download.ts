export interface SaveBytesResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
  method?: 'electron' | 'file-picker' | 'anchor';
}

type WritableFileHandle = {
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void> | void;
    close: () => Promise<void> | void;
  }>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<WritableFileHandle>;
};

async function bytesToUint8Array(bytes: Uint8Array | ArrayBuffer | Blob) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(await bytes.arrayBuffer());
}

function extensionForFilename(filename: string) {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function filePickerTypes(filename: string, mimeType: string) {
  const extension = extensionForFilename(filename) || '.bin';
  return [
    {
      description: mimeType,
      accept: { [mimeType]: [extension] },
    },
  ];
}

function triggerAnchorDownload(bytes: Uint8Array, filename: string, mimeType: string) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveBytes(bytes: Uint8Array | ArrayBuffer | Blob, filename: string, mimeType: string): Promise<SaveBytesResult> {
  const data = await bytesToUint8Array(bytes);
  console.info('[ExportSave] save requested', { filename, mimeType, bytes: data.byteLength });

  if (window.zaparooDesktop?.saveFile) {
    console.info('[ExportSave] opening Electron save dialog', { filename, mimeType });
    const result = await window.zaparooDesktop.saveFile(data, filename, mimeType);
    if (result.canceled) {
      console.info('[ExportSave] save dialog cancelled', { filename });
      return { ok: false, canceled: true, method: 'electron' };
    }
    if (!result.ok) {
      console.error('[ExportSave] Electron file write failed', result);
      return { ok: false, error: result.error ?? 'File save failed.', method: 'electron' };
    }
    console.info('[ExportSave] file write success', { filename, path: result.path, size: result.size });
    return { ok: true, path: result.path, method: 'electron' };
  }

  const pickerWindow = window as SavePickerWindow;
  if (pickerWindow.showSaveFilePicker) {
    try {
      console.info('[ExportSave] opening browser save file picker', { filename, mimeType });
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: filename,
        types: filePickerTypes(filename, mimeType),
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([data], { type: mimeType }));
      await writable.close();
      console.info('[ExportSave] browser file write success', { filename });
      return { ok: true, method: 'file-picker' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.info('[ExportSave] browser save picker cancelled', { filename });
        return { ok: false, canceled: true, method: 'file-picker' };
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ExportSave] browser save picker failed', error);
      return { ok: false, error: message, method: 'file-picker' };
    }
  }

  console.info('[ExportSave] using anchor download fallback', { filename, mimeType });
  triggerAnchorDownload(data, filename, mimeType);
  return { ok: true, method: 'anchor' };
}

export function downloadBytes(bytes: Uint8Array, filename: string, mimeType: string) {
  void saveBytes(bytes, filename, mimeType);
}
