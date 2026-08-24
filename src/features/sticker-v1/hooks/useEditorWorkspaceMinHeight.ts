import { useCallback, useEffect, useState, type RefObject } from 'react';

type EditorWorkspaceMinHeightOptions = {
  bottomPadding?: number;
  headerOffset?: number;
  minHeight?: number;
};

export function useEditorWorkspaceMinHeight(
  sidebarRef: RefObject<HTMLElement | null>,
  { bottomPadding = 240, headerOffset = 140, minHeight = 720 }: EditorWorkspaceMinHeightOptions = {},
) {
  const [workspaceMinHeight, setWorkspaceMinHeight] = useState(minHeight);

  const measureWorkspaceHeight = useCallback(() => {
    const sidebar = sidebarRef.current;
    const viewportHeight = typeof window === 'undefined' ? minHeight : window.innerHeight;
    const sidebarContentHeight = sidebar
      ? Math.max(sidebar.scrollHeight, sidebar.getBoundingClientRect().height)
      : 0;
    const nextHeight = Math.ceil(
      Math.max(
        minHeight,
        viewportHeight - headerOffset,
        sidebarContentHeight,
        sidebarContentHeight + bottomPadding,
      ),
    );
    setWorkspaceMinHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
  }, [bottomPadding, headerOffset, minHeight, sidebarRef]);

  useEffect(() => {
    let frame = window.requestAnimationFrame(measureWorkspaceHeight);
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measureWorkspaceHeight);
    };

    const sidebar = sidebarRef.current;
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    const mutationObserver = new MutationObserver(scheduleMeasure);

    if (sidebar) {
      resizeObserver.observe(sidebar);
      mutationObserver.observe(sidebar, { attributes: true, childList: true, subtree: true });
    }

    window.addEventListener('resize', scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [measureWorkspaceHeight, sidebarRef]);

  return workspaceMinHeight;
}
