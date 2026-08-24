import { useEffect, useState } from 'react';
import { loadTemplateThumbnailBlob } from '@sticker-v1/services/templates/templateThumbnailCache';
import type { Template } from '@sticker-v1/types';

export interface TemplateThumbnailCacheState {
  thumbnailUrl?: string;
  thumbnailCacheKey?: string;
  loading: boolean;
  error?: string;
}

export function useTemplateThumbnail(template: Template | undefined, options: { disabled?: boolean; cacheKey?: string } = {}): TemplateThumbnailCacheState {
  const templateId = template?.id;
  const cacheKey = options.disabled ? undefined : options.cacheKey ?? template?.thumbnailCacheKey ?? template?.thumbnailStaleCacheKey;
  const [state, setState] = useState<TemplateThumbnailCacheState>({ loading: Boolean(cacheKey), thumbnailCacheKey: cacheKey });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    if (!templateId || !cacheKey) {
      setState({ loading: false, thumbnailCacheKey: cacheKey });
      return undefined;
    }

    setState({ loading: true, thumbnailCacheKey: cacheKey });
    void loadTemplateThumbnailBlob(templateId, cacheKey)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setState({ loading: false, thumbnailCacheKey: cacheKey });
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setState({ loading: false, thumbnailUrl: objectUrl, thumbnailCacheKey: cacheKey });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          loading: false,
          thumbnailCacheKey: cacheKey,
          error: error instanceof Error ? error.message : '템플릿 썸네일을 불러오지 못했습니다.',
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cacheKey, templateId]);

  return state;
}
