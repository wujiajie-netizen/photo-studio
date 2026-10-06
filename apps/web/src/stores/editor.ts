import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { validateEditorContent, type EditorContent, type EditorDocument, type EditorLayer } from '@photo-studio/shared';
import { request } from '../api';

export const useEditorStore = defineStore('editor', () => {
  const document = ref<EditorDocument | null>(null);
  const content = ref<EditorContent | null>(null);
  const selected = ref<string | null>(null);
  const loading = ref(false); const saving = ref(false); const error = ref('');
  const changes = ref(0); const savedChanges = ref(0);
  const history = ref<EditorContent[]>([]); const position = ref(0);
  const dirty = computed(() => changes.value !== savedChanges.value);
  const layer = computed(() => content.value?.layers.find((item) => item.id === selected.value) ?? null);
  const canUndo = computed(() => position.value > 0); const canRedo = computed(() => position.value < history.value.length - 1);
  let version = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> = Promise.resolve();
  const copy = (value: EditorContent): EditorContent => JSON.parse(JSON.stringify(value));

  function load(resultId: string) {
    const current = ++version; if (timer) clearTimeout(timer);
    document.value = null; content.value = null; selected.value = null; history.value = []; changes.value = 0; savedChanges.value = 0; loading.value = true; error.value = '';
    return request<EditorDocument>('/editor/documents', { method: 'POST', body: JSON.stringify({ resultId }) }).then((value) => {
      if (current !== version) return;
      document.value = value; content.value = copy({ name: value.name, width: value.width, height: value.height, background: value.background, layers: value.layers });
      history.value = [copy(content.value)]; position.value = 0;
    }).catch((failure: Error) => { if (current === version) error.value = failure.message; })
      .finally(() => { if (current === version) loading.value = false; });
  }
  function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(() => { save().catch(() => {}); }, 500); }
  function commit() {
    if (!content.value) return;
    try { validateEditorContent(content.value); } catch (failure) { error.value = (failure as Error).message; return; }
    history.value = history.value.slice(0, position.value + 1); history.value.push(copy(content.value));
    if (history.value.length > 50) history.value.shift(); position.value = history.value.length - 1;
    ++changes.value; error.value = ''; schedule();
  }
  function updateLayer(id: string, values: Partial<EditorLayer>) {
    const value = content.value?.layers.find((item) => item.id === id); if (!value || value.locked) return;
    Object.assign(value, values); commit();
  }
  function undo() { if (!canUndo.value) return; content.value = copy(history.value[--position.value]); ++changes.value; error.value = ''; schedule(); }
  function redo() { if (!canRedo.value) return; content.value = copy(history.value[++position.value]); ++changes.value; error.value = ''; schedule(); }
  function save(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = null; }
    if (saving.value) return pending.then(() => save());
    if (!document.value || !content.value || !dirty.value) return Promise.resolve();
    try { validateEditorContent(content.value); } catch (failure) { error.value = (failure as Error).message; return Promise.reject(failure); }
    const current = version; const change = changes.value; const id = document.value.id;
    const snapshot = { ...copy(content.value), revision: document.value.revision };
    saving.value = true; error.value = '';
    /* 保存排队且按版本更新；保存期间发生的新修改继续保留，不能用旧服务器响应覆盖画布。 */
    pending = request<EditorDocument>(`/editor/documents/${id}`, { method: 'PATCH', body: JSON.stringify(snapshot) }).then((value) => {
      if (current !== version) return;
      document.value = value; savedChanges.value = change;
    }).catch((failure: Error) => { if (current === version) error.value = failure.message; throw failure; })
      .finally(() => { saving.value = false; if (current === version && dirty.value && !error.value) schedule(); });
    return pending;
  }
  function close() { ++version; if (timer) clearTimeout(timer); timer = null; }
  return { document, content, selected, layer, loading, saving, error, dirty, canUndo, canRedo, load, commit, updateLayer, undo, redo, save, close };
});
