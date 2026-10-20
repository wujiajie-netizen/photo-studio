<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Clock3, ListChecks, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff, Search, Share, Trash2, X } from '@lucide/vue';
import type { AgentSession } from '@photo-studio/shared';
import { useAgentStore } from '../stores/agent';
import { useEditorStore } from '../stores/editor';

defineProps<{ standalone?: boolean }>();
const open = defineModel<boolean>({ required: true });
const agent = useAgentStore(); const route = useRoute(); const router = useRouter();
const editor = useEditorStore();
const query = ref(''); const loading = ref(false); const error = ref('');
const panel = ref<HTMLElement | null>(null); const search = ref<HTMLInputElement | null>(null);
const menuSession = ref<AgentSession | null>(null); const menuPosition = ref({ top: '0px', left: '0px' });
const multiple = ref(false); const selectedIds = ref<string[]>([]); const saving = ref(false); const actionError = ref('');
const dialog = ref<HTMLDialogElement | null>(null); const dialogAction = ref<'rename' | 'delete' | null>(null);
const renameSession = ref<AgentSession | null>(null); const name = ref(''); const deleteIds = ref<string[]>([]);
let menuTimer: ReturnType<typeof setTimeout> | undefined;
let version = 0; let previousFocus: HTMLElement | null = null; let previousOverflow = '';
const visibleSessions = computed(() => agent.sessions.filter(session => session.title.toLowerCase().includes(query.value.trim().toLowerCase())).sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '') || b.updatedAt.localeCompare(a.updatedAt)));
const allSelected = computed(() => visibleSessions.value.length > 0 && visibleSessions.value.every(session => selectedIds.value.includes(session.id)));
const allPinned = computed(() => selectedIds.value.length > 0 && selectedIds.value.every(id => agent.sessions.some(session => session.id === id && session.pinnedAt)));
const groups = computed(() => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const week = new Date(today); week.setDate(today.getDate() - 6);
  const sections: { label: string; sessions: AgentSession[] }[] = ['置顶', '今天', '昨天', '近 7 天', '更早'].map(label => ({ label, sessions: [] }));
  visibleSessions.value.forEach(session => {
    const updated = new Date(session.updatedAt);
    sections[session.pinnedAt ? 0 : updated >= today ? 1 : updated >= yesterday ? 2 : updated >= week ? 3 : 4].sessions.push(session);
  });
  return sections.filter(section => section.sessions.length);
});

function load() {
  const current = ++version; loading.value = true; error.value = '';
  /* 侧栏关闭或重新读取后，旧请求不再更新本次加载状态。 */
  agent.list().catch((reason: Error) => { if (current === version) error.value = reason.message; })
    .finally(() => { if (current === version) loading.value = false; });
}
function selectSession(id: string) {
  if (multiple.value) { selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id]; return; }
  router.replace({ path: '/', query: { session: id } }).then(() => { open.value = false; });
}
function showMenu(event: Event, session: AgentSession) {
  clearTimeout(menuTimer); if (saving.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  menuPosition.value = { left: `${Math.max(8, Math.min(rect.right - 156, window.innerWidth - 164))}px`, top: `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 250))}px` };
  menuSession.value = session;
  if (event instanceof KeyboardEvent) nextTick(() => panel.value?.parentElement?.querySelector<HTMLElement>('[role=menuitem]')?.focus());
}
function keepMenu() { clearTimeout(menuTimer); }
function hideMenu() { menuTimer = setTimeout(() => { menuSession.value = null; }, 160); }
function beginMultiple(session: AgentSession) { multiple.value = true; selectedIds.value = [session.id]; menuSession.value = null; actionError.value = ''; }
function selectAll() {
  const ids = visibleSessions.value.map(session => session.id);
  selectedIds.value = allSelected.value ? selectedIds.value.filter(id => !ids.includes(id)) : [...new Set([...selectedIds.value, ...ids])];
}
function showDialog(action: 'rename' | 'delete', session?: AgentSession) {
  dialogAction.value = action; renameSession.value = session ?? null; name.value = session?.title ?? '';
  deleteIds.value = session ? [session.id] : [...selectedIds.value]; menuSession.value = null; actionError.value = '';
  nextTick(() => { dialog.value?.showModal(); if (action === 'rename') dialog.value?.querySelector('input')?.select(); });
}
function manage(ids: string[], action: 'pin' | 'unpin' | 'delete') {
  if (saving.value || !ids.length) return;
  saving.value = true; actionError.value = ''; menuSession.value = null;
  /* 删除当前对话前保存作品编辑；整批成功后才清除选择并回到工作台，失败保留选择和错误。 */
  const save = action === 'delete' && route.path === '/' && ids.includes(route.query.session as string) ? editor.save() : Promise.resolve();
  save.then(() => agent.manageSessions(ids, action)).then(() => {
    dialog.value?.close(); selectedIds.value = []; multiple.value = false;
    if (action === 'delete' && route.path === '/' && ids.includes(route.query.session as string)) return router.replace({ path: '/', query: {} });
  }).catch((reason: Error) => { actionError.value = reason.message; }).finally(() => { saving.value = false; });
}
function saveDialog() {
  if (dialogAction.value === 'delete') { manage(deleteIds.value, 'delete'); return; }
  if (saving.value || !renameSession.value) return;
  if (!name.value.trim() || [...name.value.trim()].length > 80) { actionError.value = '请输入 1 到 80 个字符的对话名称。'; return; }
  saving.value = true; actionError.value = '';
  agent.renameSession(renameSession.value.id, name.value.trim()).then(() => { dialog.value?.close(); })
    .catch((reason: Error) => { actionError.value = reason.message; }).finally(() => { saving.value = false; });
}
function keydown(event: KeyboardEvent) {
  if (!open.value) return;
  if (dialog.value?.open) return;
  if (event.key === 'Escape') { event.preventDefault(); if (saving.value) return; if (menuSession.value) menuSession.value = null; else if (multiple.value) { multiple.value = false; selectedIds.value = []; } else open.value = false; return; }
  if (event.key !== 'Tab') return;
  const controls = panel.value?.parentElement?.querySelectorAll<HTMLElement>('button:not(:disabled), input');
  if (!controls?.length) return;
  const visible = [...controls].filter(control => control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden');
  const first = visible[0]; const last = visible[visible.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
watch(open, value => {
  if (value) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    query.value = ''; selectedIds.value = []; multiple.value = false; actionError.value = ''; menuSession.value = null;
    load(); window.addEventListener('keydown', keydown);
    nextTick(() => search.value?.focus());
  } else {
    ++version; clearTimeout(menuTimer); menuSession.value = null; document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', keydown);
    nextTick(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
  }
});
watch(() => route.fullPath, () => { open.value = false; });
onUnmounted(() => {
  ++version; clearTimeout(menuTimer); window.removeEventListener('keydown', keydown);
  if (open.value) document.body.style.overflow = previousOverflow;
});
</script>

<template>
  <div v-if="open" class="history-overlay" :class="{ standalone }" @keydown.esc.stop="keydown">
    <div class="history-backdrop" aria-hidden="true" @click="!saving && (open = false)" />
    <aside id="conversation-history" ref="panel" class="conversation-history" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <header><div><Clock3 :size="18" /><h2 id="history-title">最近对话</h2></div><button type="button" :disabled="saving" aria-label="收起最近对话" title="收起最近对话" @click="open = false"><X :size="18" /></button></header>
      <label class="history-search"><Search :size="15" /><input ref="search" v-model="query" placeholder="搜索对话" aria-label="搜索历史对话" /></label>
      <div v-if="multiple" class="selection-heading"><span>已选 {{ selectedIds.length }} 项</span><button type="button" :disabled="saving || !visibleSessions.length" @click="selectAll">{{ allSelected ? '取消全选' : '全选' }}</button><button type="button" :disabled="saving" @click="multiple = false; selectedIds = []; actionError = ''">取消</button></div>
      <div class="history-list" aria-live="polite" :aria-busy="loading" @scroll="menuSession = null">
        <p v-if="loading" class="history-notice" role="status">正在读取最近对话…</p>
        <div v-else-if="error" class="history-notice" role="alert"><p>最近对话读取失败</p><p>{{ error }}</p><button type="button" class="button secondary" @click="load">重新读取</button></div>
        <template v-else-if="groups.length">
          <section v-for="group in groups" :key="group.label" class="history-group">
            <h3>{{ group.label }}</h3>
            <div v-for="session in group.sessions" :key="session.id" class="history-entry" :class="{ selected: multiple ? selectedIds.includes(session.id) : route.path === '/' && route.query.session === session.id }">
              <input v-if="multiple" v-model="selectedIds" type="checkbox" :value="session.id" :disabled="saving" :aria-label="`选择对话：${session.title}`" />
              <button type="button" class="history-session" :aria-current="!multiple && route.path === '/' && route.query.session === session.id ? 'page' : undefined" :disabled="agent.submitting || saving" :title="session.title" @click="selectSession(session.id)"><MessageSquare v-if="!multiple" :size="15" /><span>{{ session.title }}</span><Pin v-if="session.pinnedAt && !multiple" :size="12" /></button>
              <button v-if="!multiple" type="button" class="history-more" :class="{ visible: menuSession?.id === session.id }" :disabled="saving" :aria-label="`更多操作：${session.title}`" aria-haspopup="menu" :aria-expanded="menuSession?.id === session.id" @pointerenter="showMenu($event, session)" @pointerleave="hideMenu" @click="showMenu($event, session)" @keydown.down.prevent="showMenu($event, session)"><MoreHorizontal :size="17" /></button>
            </div>
          </section>
        </template>
        <div v-else class="history-notice"><MessageSquare :size="25" /><p>{{ query.trim() ? '没有找到相关对话' : '还没有对话记录' }}</p><p>{{ query.trim() ? '试试其他关键词' : '从工作台开始你的第一次创作' }}</p></div>
      </div>
      <p v-if="actionError && !dialogAction" class="action-error" role="alert">{{ actionError }}</p>
      <footer v-if="multiple" class="selection-actions"><button type="button" :disabled="saving || !selectedIds.length" @click="manage([...selectedIds], allPinned ? 'unpin' : 'pin')"><component :is="allPinned ? PinOff : Pin" :size="18" />{{ allPinned ? '取消置顶' : '置顶' }}</button><button type="button" class="danger" :disabled="saving || !selectedIds.length" @click="showDialog('delete')"><Trash2 :size="18" />删除</button></footer>
      <footer v-else>对话和作品保存在本机</footer>
      <div v-if="menuSession" class="history-menu" role="menu" aria-label="对话操作" :style="menuPosition" @pointerenter="keepMenu" @pointerleave="hideMenu">
        <button type="button" role="menuitem" @click="showDialog('rename', menuSession)"><Pencil :size="17" />重命名</button>
        <button type="button" role="menuitem" @click="manage([menuSession.id], menuSession.pinnedAt ? 'unpin' : 'pin')"><component :is="menuSession.pinnedAt ? PinOff : Pin" :size="17" />{{ menuSession.pinnedAt ? '取消置顶' : '置顶' }}</button>
        <button type="button" role="menuitem" disabled title="分享暂未开放"><Share :size="17" />分享</button>
        <button type="button" role="menuitem" @click="beginMultiple(menuSession)"><ListChecks :size="17" />多选</button>
        <button type="button" role="menuitem" class="danger" @click="showDialog('delete', menuSession)"><Trash2 :size="17" />删除</button>
      </div>
    </aside>
    <dialog v-if="dialogAction" ref="dialog" class="history-dialog" :aria-label="dialogAction === 'rename' ? '重命名对话' : '删除对话'" @close="dialogAction = null; actionError = ''" @cancel="saving && $event.preventDefault()">
      <h2>{{ dialogAction === 'rename' ? '重命名对话' : '删除对话' }}</h2>
      <form @submit.prevent="saveDialog">
        <template v-if="dialogAction === 'rename'"><label for="history-name">对话名称</label><input id="history-name" v-model="name" autofocus autocomplete="off" :disabled="saving" @input="actionError = ''" /><p>最多 80 个字符</p></template>
        <p v-else>确定删除{{ deleteIds.length > 1 ? `选中的 ${deleteIds.length} 条` : '这条' }}对话？删除后无法从列表打开，已保存的项目和作品会保留。</p>
        <p v-if="actionError" class="action-error" role="alert">{{ actionError }}</p>
        <div class="dialog-actions"><button type="button" class="button secondary" :disabled="saving" @click="dialog?.close()">取消</button><button type="submit" class="button" :class="{ 'delete-button': dialogAction === 'delete' }" :disabled="saving">{{ saving ? '处理中…' : dialogAction === 'rename' ? '保存名称' : '确认删除' }}</button></div>
      </form>
    </dialog>
  </div>
</template>

<style scoped lang="scss">
.history-overlay { position: fixed; z-index: 20; inset: 0 0 0 88px; }
.history-backdrop { position: absolute; inset: 0; background: rgb(37 31 57 / 8%); }
.conversation-history { position: absolute; inset: 0 auto 0 0; display: flex; flex-direction: column; width: min(280px, 100%); padding: 24px 16px 18px; background: var(--surface); border-right: 1px solid var(--border); box-shadow: 12px 0 36px rgb(40 29 70 / 8%); header { display: flex; align-items: center; justify-content: space-between; gap: 12px; } header > div { display: flex; align-items: center; gap: 9px; } h2 { font-size: 15px; font-weight: 600; } header button { display: grid; place-items: center; padding: 6px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); } header button:hover { background: var(--nav-hover); color: var(--accent); } footer { padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 11px; } }
.history-search { display: flex; align-items: center; gap: 8px; margin: 22px 0 18px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); background: var(--page); &:focus-within { border-color: var(--accent); } input { min-width: 0; width: 100%; padding: 0; border: 0; outline: none; background: transparent; color: var(--text); font-size: 12px; box-shadow: none; } }
.history-list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 16px; }
.history-group { margin-bottom: 20px; h3 { margin: 0 10px 8px; color: var(--muted); font-size: 11px; font-weight: 400; } }
.history-entry { display: flex; align-items: center; gap: 8px; width: 100%; padding: 0 6px 0 10px; border-radius: 9px; color: var(--text-secondary); &:hover, &:focus-within { background: var(--nav-hover); color: var(--accent); } &.selected { background: var(--accent-soft); color: var(--accent); } &:hover .history-more, &:focus-within .history-more { visibility: visible; } input { flex-shrink: 0; width: 14px; height: 14px; margin: 0; } }
.history-session { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; padding: 11px 0; border: 0; color: inherit; background: transparent; text-align: left; font-size: 12px; span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.history-more { display: grid; place-items: center; width: 26px; height: 28px; flex-shrink: 0; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; visibility: hidden; &:hover { color: var(--accent); background: var(--accent-soft); } &.visible, &:focus-visible { visibility: visible; } }
.history-menu { position: fixed; z-index: 22; display: grid; width: 156px; padding: 6px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 8px 30px rgb(40 29 70 / 13%); button { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border: 0; border-radius: 8px; color: var(--text); background: transparent; text-align: left; font-size: 13px; } button:hover:not(:disabled) { background: var(--nav-hover); } }
.history-menu .danger, .selection-actions .danger { color: #e54e59; }
.selection-heading { display: flex; align-items: center; gap: 12px; margin: -4px 0 16px; font-size: 11px; color: var(--muted); span { margin-right: auto; } button { padding: 0; border: 0; color: var(--text-secondary); background: transparent; } }
.conversation-history .selection-actions { padding-top: 14px; }
.selection-actions { display: flex; button { display: flex; flex: 1; justify-content: center; align-items: center; gap: 8px; padding: 5px 0; border: 0; color: var(--text); background: transparent; font-size: 13px; } button + button { border-left: 1px solid var(--border); } }
.action-error { padding: 8px 0; font-size: 12px; color: var(--error); overflow-wrap: anywhere; }
.history-dialog { width: min(420px, calc(100vw - 32px)); padding: 26px; border: 1px solid var(--border); border-radius: 18px; color: var(--text); background: var(--surface); box-shadow: 0 24px 80px rgb(0 0 0 / 15%); &::backdrop { background: rgb(37 31 57 / 25%); } h2 { margin-bottom: 20px; font-size: 18px; font-weight: 600; } label { display: block; margin-bottom: 8px; font-size: 13px; } input { width: 100%; padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 8px; color: var(--text); background: var(--surface); } p { margin-top: 8px; font-size: 12px; color: var(--text-secondary); } .action-error { color: var(--error); } }
.dialog-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; .button { padding: 8px 14px; font-size: 12px; } .delete-button { background: #e54e59; } }
.history-notice { display: grid; justify-items: center; gap: 10px; padding: 28px 8px; color: var(--muted); text-align: center; font-size: 12px; overflow-wrap: anywhere; p + p { font-size: 11px; } .button { margin-top: 6px; padding: 7px 12px; font-size: 12px; } }
.standalone { left: 0; .conversation-history { inset: 12px auto 12px 12px; width: min(280px, calc(100% - 24px)); border: 1px solid var(--border); border-radius: 18px; } }
@media (max-width: 480px) { .history-overlay { left: 68px; } .standalone { left: 0; } }
</style>
