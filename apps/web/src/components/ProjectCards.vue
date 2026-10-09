<script setup lang="ts">
import { ArrowUpRight, FolderOpen } from '@lucide/vue';
import type { Project } from '@photo-studio/shared';

defineProps<{ projects: Project[] }>();
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
</script>

<template>
  <ul class="project-grid">
    <li v-for="project in projects" :key="project.id">
      <RouterLink :to="`/projects/${project.id}`" :aria-label="`查看项目：${project.name}`">
        <div class="project-symbol" aria-hidden="true"><FolderOpen :size="26" :stroke-width="1.2" /></div>
        <h3 :title="project.name">{{ project.name }}</h3>
        <p>最近保存 <time :datetime="project.updatedAt">{{ dateFormatter.format(new Date(project.updatedAt)) }}</time></p>
        <ArrowUpRight :size="17" class="project-arrow" />
      </RouterLink>
    </li>
  </ul>
</template>

<style scoped lang="scss">
.project-grid {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none;
  li { background: linear-gradient(135deg, #fff, #fdfcff); border: 1px solid var(--border); border-radius: var(--radius); transition: border-color .2s, box-shadow .2s, transform .2s; &:hover { border-color: #d5c8f4; box-shadow: var(--shadow); transform: translateY(-4px); } }
  a { display: block; padding: 24px; position: relative; border-radius: inherit; }
  h3 { font-weight: 500; font-size: 15px; margin-top: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { font-size: 11px; color: var(--muted); margin-top: 6px; }
}
.project-symbol { width: 48px; height: 48px; border-radius: 14px; background: linear-gradient(135deg, #eee6ff, #f7f1ff); color: var(--accent); display: grid; place-items: center; }
.project-arrow { position: absolute; top: 26px; right: 24px; color: #ab98d2; }
@media (max-width: 1050px) { .project-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) { .project-grid { grid-template-columns: 1fr; } }
</style>
