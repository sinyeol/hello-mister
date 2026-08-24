export function isEditorInteractiveTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest('[data-editor-interactive="true"]') ||
      target.closest('[data-selectable-layer="true"]') ||
      target.closest('[data-transform-handle="true"]') ||
      target.closest('[data-editor-ui="true"]') ||
      target.closest('input, textarea, select, button, [contenteditable="true"]'),
  );
}
