import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@sticker-v1/components/common/PageHeader';
import { createCategory, toCategoryName, validateCategory } from '@sticker-v1/utils/category';
import { useProjectStore } from '@sticker-v1/store/projectStore';
import type { Category, CategoryColorPalette } from '@sticker-v1/types';

const paletteKeys: Array<keyof CategoryColorPalette> = ['primary', 'secondary', 'accent', 'neutral'];

export function CategoryManagementPage() {
  const { categories, templates, addCategory, updateCategory, deleteCategory } = useProjectStore();
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState(categories[0]?.id ?? '');

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedId) ?? categories[0],
    [categories, selectedId],
  );

  const frontTemplates = templates.filter((template) => template.type === 'front');
  const backTemplates = templates.filter((template) => template.type === 'back');
  const errors = selectedCategory ? validateCategory(selectedCategory) : [];

  function handleAddCategory() {
    const displayName = newName.trim();
    if (!displayName) return;
    const category = createCategory(displayName);
    addCategory(category);
    setSelectedId(category.id);
    setNewName('');
  }

  function patchSelected(patch: Partial<Category>) {
    if (!selectedCategory) return;
    updateCategory(selectedCategory.id, patch);
  }

  return (
    <>
      <PageHeader
        eyebrow="Category system"
        title="Category Management"
        description="카테고리 추가/수정/삭제, 팔레트, 기본 템플릿, 카테고리별 뒷면 이미지 reference를 관리합니다."
      />

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <section className="rounded-lg border border-line bg-white p-4 shadow-surface">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New category"
              className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          <div className="mt-4 max-h-[68vh] space-y-2 overflow-auto pr-1">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setSelectedId(category.id)}
                className={`w-full rounded-md border px-3 py-3 text-left text-sm ${
                  category.id === selectedCategory?.id ? 'border-ink bg-neutral-100' : 'border-line bg-white'
                }`}
              >
                <span className="block font-medium">{category.displayName}</span>
                <span className="mt-2 flex gap-1">
                  {paletteKeys.map((key) => (
                    <span
                      key={key}
                      className="h-4 w-4 rounded-sm border border-line"
                      style={{ backgroundColor: category.palette[key] }}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </section>

        {selectedCategory && (
          <section className="rounded-lg border border-line bg-white p-5 shadow-surface">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{selectedCategory.displayName}</h3>
                <p className="mt-1 text-sm text-neutral-500">{selectedCategory.name}</p>
              </div>
              <button
                type="button"
                onClick={() => deleteCategory(selectedCategory.id)}
                className="inline-flex items-center gap-2 rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>

            {errors.length > 0 && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errors.join(' ')}
              </div>
            )}

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Display name</span>
                <input
                  value={selectedCategory.displayName}
                  onChange={(event) =>
                    patchSelected({
                      displayName: event.target.value,
                      name: toCategoryName(event.target.value),
                    })
                  }
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium">Back image reference</span>
                <input
                  value={selectedCategory.backImagePath ?? ''}
                  onChange={(event) => patchSelected({ backImagePath: event.target.value })}
                  placeholder="card-back/neo-geo.png"
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium">Default front template</span>
                <select
                  value={selectedCategory.defaultFrontTemplateId ?? ''}
                  onChange={(event) => patchSelected({ defaultFrontTemplateId: event.target.value || undefined })}
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {frontTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium">Default back template</span>
                <select
                  value={selectedCategory.defaultBackTemplateId ?? ''}
                  onChange={(event) => patchSelected({ defaultBackTemplateId: event.target.value || undefined })}
                  className="mt-1 w-full rounded-md border border-line px-3 py-2 text-sm"
                >
                  <option value="">Unassigned</option>
                  {backTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-semibold">Palette</h4>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {paletteKeys.map((key) => (
                  <label key={key} className="block rounded-md border border-line p-3">
                    <span className="text-xs font-medium uppercase text-neutral-500">{key}</span>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedCategory.palette[key]}
                        onChange={(event) =>
                          patchSelected({
                            palette: { ...selectedCategory.palette, [key]: event.target.value },
                          })
                        }
                        className="h-9 w-12 rounded border border-line"
                      />
                      <input
                        value={selectedCategory.palette[key]}
                        onChange={(event) =>
                          patchSelected({
                            palette: { ...selectedCategory.palette, [key]: event.target.value as `#${string}` },
                          })
                        }
                        className="min-w-0 flex-1 rounded-md border border-line px-2 py-2 text-sm"
                      />
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
