<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ArrowUpRight, FolderOpen, MoreHorizontal, Pencil, Trash2 } from '@lucide/vue';
import type { Project } from '@photo-studio/shared';

defineProps<{ projects: Project[]; manageable?: boolean }>();
const emit = defineEmits<{ rename: [project: Project]; delete: [project: Project] }>();
const menuId = ref<string | null>(null);
const root = ref<HTMLUListElement | null>(null);
function dismiss(event: PointerEvent) { if (!(event.target instanceof Element) || !root.value?.contains(event.target.closest('.project-menu'))) menuId.value = null; }
function select(action: 'rename' | 'delete', project: Project) { menuId.value = null; if (action === 'rename') emit('rename', project); else emit('delete', project); }
onMounted(() => { document.addEventListener('pointerdown', dismiss); });
onUnmounted(() => { document.removeEventListener('pointerdown', dismiss); });
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <ul ref="root" class="project-grid" @keydown.esc.stop="menuId = null">
    <li v-for="project in projects" :key="project.id">
      <RouterLink :to="`/projects/${project.id}`" :aria-label="`查看项目：${project.name}`">
        <div class="project-symbol" aria-hidden="true"><FolderOpen :size="26" :stroke-width="1.2" /></div>
        <h3 :title="project.name">{{ project.name }}</h3>
        <p>最近保存 <time :datetime="project.updatedAt">{{ dateFormatter.format(new Date(project.updatedAt)) }}</time></p>
        <ArrowUpRight v-if="!manageable" :size="17" class="project-arrow" />
      </RouterLink>
      <div v-if="manageable" class="project-menu" :class="{ open: menuId === project.id }">
        <button type="button" class="project-more" :aria-label="`项目操作：${project.name}`" :aria-expanded="menuId === project.id" @click="menuId = menuId === project.id ? null : project.id"><MoreHorizontal :size="19" /></button>
        <div v-if="menuId === project.id" class="project-actions">
          <button type="button" @click="select('rename', project)"><Pencil :size="15" />重命名</button>
          <button type="button" class="delete-action" @click="select('delete', project)"><Trash2 :size="15" />删除项目</button>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped lang="scss">
.project-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none;
  li { position: relative; background: linear-gradient(135deg, #fff, #fdfcff); border: 1px solid var(--border); border-radius: var(--radius); transition: border-color .2s, box-shadow .2s, transform .2s; &:hover { border-color: #d5c8f4; box-shadow: var(--shadow); transform: translateY(-4px); } &:has(.open) { z-index: 2; } }
  a { display: block; padding: 24px; position: relative; border-radius: inherit; }
  h3 { font-weight: 500; font-size: 15px; margin-top: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { font-size: 11px; color: var(--muted); margin-top: 6px; }
}
.project-symbol { width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #eee6ff, #f7f1ff); color: var(--accent); display: grid; place-items: center; }
.project-arrow { position: absolute; top: 26px; right: 24px; color: #ab98d2; }
.project-menu { position: absolute; top: 18px; right: 18px; }
.project-more { display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #f4f0fb; color: var(--muted); opacity: 0; &:focus-visible { opacity: 1; } }
li:hover .project-more, li:focus-within .project-more, .open .project-more { opacity: 1; }
.project-actions { position: absolute; top: 38px; right: 0; width: 150px; padding: 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px; background: transparent; border: 0; border-radius: 7px; color: var(--text); text-align: left; font-size: 13px; &:hover { background: #f6f3fb; } } .delete-action { color: var(--error); } }
@media (hover: none) { .project-more { opacity: 1; } }
@media (max-width: 1050px) { .project-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .project-grid { grid-template-columns: 1fr; } }
</style>
