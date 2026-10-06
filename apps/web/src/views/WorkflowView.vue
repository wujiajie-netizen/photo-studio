<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowLeft, Image, Layers3, PanelsTopLeft, CircleDashed } from '@lucide/vue';

const route = useRoute();
const workflows = {
  '/product-image': { title: 'AI 商品图', description: '从商品原图出发，制作白底图与场景图。', icon: Image, steps: ['上传商品', '处理主体', '配置场景', '生成与保存'] },
  '/product-kit': { title: '商品套图', description: '为一个商品，建立一套统一的上架视觉。', icon: Layers3, steps: ['上传素材', '设置平台与规格', '选择套图结构', '批量生成与导出'] },
  '/detail-page': { title: '商品详情页', description: '将商品卖点组织成清晰、连贯的详情模块。', icon: PanelsTopLeft, steps: ['上传素材', '整理商品卖点', '选择详情模块', '组合与导出'] }
};
const workflow = computed(() => workflows[route.path as keyof typeof workflows]);
</script>

<template>
  <div class="page workflow-page">
    <RouterLink to="/" class="back-link"><ArrowLeft :size="15" /> 返回工作台</RouterLink>
    <div class="page-title"><h1>{{ workflow.title }}</h1><p>{{ workflow.description }}</p></div>
    <ol class="workflow-steps"><li v-for="(step, index) in workflow.steps" :key="step"><span>{{ String(index + 1).padStart(2, '0') }}</span>{{ step }}</li></ol>
    <div class="workflow-placeholder"><component :is="workflow.icon" :size="44" :stroke-width="1" /><h2>创作流程准备中</h2><p>{{ workflow.title }}功能正在准备中，开放后可在这里完成整个创作流程。</p><span><CircleDashed :size="14" /> 功能尚未开放</span><RouterLink to="/" class="button secondary">回到工作台</RouterLink></div>
  </div>
</template>

<style scoped lang="scss">
.back-link { display: inline-flex; gap: 7px; align-items: center; color: var(--muted); font-size: 12px; margin-bottom: 28px; &:hover { color: var(--text); } }
.workflow-steps { list-style: none; padding: 20px 24px; margin: 0 0 24px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); li { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 12px; } span { color: var(--muted); font-size: 11px; } }
.workflow-placeholder { min-height: 420px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; color: var(--muted); h2 { font-size: 22px; font-weight: 500; color: var(--text); margin-top: 24px; } p { margin-top: 10px; font-size: 13px; } > span { display: flex; gap: 7px; align-items: center; font-size: 12px; margin-top: 20px; } .button { margin-top: 32px; } }
@media (max-width: 900px) { .workflow-steps { grid-template-columns: repeat(2, 1fr); } }
</style>
