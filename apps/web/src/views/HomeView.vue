<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowUpRight, Sparkles, Image, Layers3, PanelsTopLeft, FolderOpen, Plus, ArrowRight } from '@lucide/vue';
import AgentWorkspace from '../components/AgentWorkspace.vue';
import ProjectCards from '../components/ProjectCards.vue';
import { useProjectsStore } from '../stores/projects';

const prompt = ref('');
const route = useRoute();
const conversation = computed(() => typeof route.query.session === 'string');
const projects = useProjectsStore();
onMounted(() => { projects.load(); });
const suggestions = ['为我的商品制作一张白底主图', '制作一套统一风格的商品图片', '整理商品卖点，制作详情页'];
const tools = [
  { path: '/product-image', title: 'AI 商品图', caption: '从一张原图，开始新的商品表达', icon: Image, number: '01', style: 'image' },
  { path: '/product-kit', title: '商品套图', caption: '主图、卖点、场景，一套风格统一', icon: Layers3, number: '02', style: 'kit' },
  { path: '/detail-page', title: '商品详情页', caption: '让商品信息，成为清晰的购买理由', icon: PanelsTopLeft, number: '03', style: 'detail' }
];
</script>

<template>
  <div class="page home-page" :class="{ 'conversation-page': conversation }">
    <section class="welcome" :aria-labelledby="conversation ? undefined : 'welcome-title'">
      <span v-if="!conversation" class="eyebrow"><Sparkles :size="13" /> 从商品到作品</span>
      <h1 v-if="!conversation" id="welcome-title">想为商品做些什么？</h1>
      <p v-if="!conversation">说说你的想法，让助手为你安排创作方案。</p>
      <AgentWorkspace v-model="prompt" />
      <div v-if="!conversation" class="suggestions"><span>试试这样开始</span><button v-for="suggestion in suggestions" :key="suggestion" type="button" @click="prompt = suggestion">{{ suggestion }}<ArrowUpRight :size="12" /></button></div>
    </section>

    <section v-if="!conversation" class="tools-section" aria-labelledby="tools-title">
      <div class="section-heading"><div><h2 id="tools-title">为电商而设计</h2><p>从单张商品图，到完整的商品视觉</p></div><span class="subtle-label">三个入口 · 一条创作流程</span></div>
      <div class="tool-grid">
        <RouterLink v-for="tool in tools" :key="tool.path" :to="tool.path" :aria-label="tool.title" class="tool-card" :class="tool.style">
          <div class="tool-art" aria-hidden="true"><span class="tool-number">{{ tool.number }}</span><component :is="tool.icon" :size="54" :stroke-width=".8" /><span class="art-line"></span><span class="art-label">PHOTO / STUDIO</span></div>
          <div class="tool-copy"><div><h3>{{ tool.title }}</h3><p>{{ tool.caption }}</p></div><ArrowUpRight :size="20" /></div>
        </RouterLink>
      </div>
    </section>

    <section v-if="!conversation" class="recent-section" aria-labelledby="recent-title">
      <div class="section-heading"><div><h2 id="recent-title">最近项目</h2><p>每一次创作，都可以从这里继续</p></div><RouterLink to="/projects">查看全部 <ArrowRight :size="14" /></RouterLink></div>
      <div v-if="projects.loading" class="empty-state" role="status"><p>正在读取最近项目…</p></div>
      <div v-else-if="projects.error" class="empty-state" role="alert"><h3>最近项目读取失败</h3><p>{{ projects.error }}</p><button type="button" class="button secondary" @click="projects.load()">重新读取</button></div>
      <ProjectCards v-else-if="projects.projects.length" :projects="projects.projects.slice(0, 3)" />
      <div v-else class="empty-state"><FolderOpen :size="29" :stroke-width="1.2" /><h3>第一份作品，从这里开始</h3><p>当前还没有项目。项目与素材会保存在本机，方便你继续创作。</p><RouterLink to="/projects" class="button secondary"><Plus :size="15" /> 创建第一个项目</RouterLink></div>
    </section>
    <footer v-if="!conversation" class="page-caption">本地工作空间 <span>·</span> 素材与作品由你掌握</footer>
  </div>
</template>

<style scoped lang="scss">
.home-page { padding-top: 32px; }
.conversation-page { max-width: none; padding: 12px; .welcome { max-width: none; } }
.welcome { max-width: 1080px; margin: 0 auto; text-align: center; h1 { font-size: 34px; font-weight: 600; letter-spacing: 1px; margin-top: 16px; } > p { color: var(--muted); margin-top: 10px; font-size: 13px; } }
.eyebrow { display: inline-flex; gap: 7px; align-items: center; color: var(--text-secondary); border: 1px solid var(--border); background: var(--surface); padding: 5px 11px; border-radius: 7px; font-size: 11px; }
.suggestions { display: flex; justify-content: center; align-items: center; gap: 14px; flex-wrap: wrap; margin-top: 16px; font-size: 11px; > span { color: var(--muted); } button { display: inline-flex; gap: 6px; align-items: center; color: var(--text-secondary); border: 0; background: transparent; padding: 4px 0; &:hover { color: var(--text); text-decoration: underline; } } }
.tools-section { margin-top: 52px; }
.subtle-label { color: var(--muted); font-size: 11px; }
.tool-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.tool-card { overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); transition: transform .18s, box-shadow .18s; &:hover { transform: translateY(-3px); box-shadow: var(--shadow); } }
.tool-art { height: 148px; position: relative; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); overflow: hidden; background: linear-gradient(120deg, #edf4f4, #f7f9f9); > svg { position: relative; z-index: 1; transform: rotate(-8deg); } &::before { content: ''; position: absolute; width: 110px; height: 110px; border: 1px solid rgb(32 32 32 / 8%); border-radius: 50%; } }
.tool-number { position: absolute; top: 14px; left: 18px; color: var(--muted); font-size: 10px; }
.art-label { position: absolute; bottom: 12px; right: 18px; font-size: 8px; color: var(--muted); letter-spacing: 2px; }
.art-line { position: absolute; width: 180px; height: 1px; background: rgb(32 32 32 / 8%); transform: rotate(-35deg); }
.kit .tool-art { background: linear-gradient(120deg, #f3f1eb, #faf9f6); &::before { border-radius: 16px; transform: rotate(12deg); } }
.detail .tool-art { background: linear-gradient(120deg, #eef0f5, #f7f8fb); &::before { border-radius: 4px; width: 88px; height: 120px; transform: rotate(-5deg); } }
.tool-copy { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 20px; h3 { font-size: 16px; font-weight: 550; } p { font-size: 11px; color: var(--muted); margin-top: 5px; } > svg { color: var(--muted); } }
.recent-section { margin-top: 40px; }
.page-caption { margin-top: 28px; display: flex; justify-content: center; gap: 10px; font-size: 10px; color: var(--muted); letter-spacing: 1px; }
@media (max-width: 1100px) { .tool-copy { padding: 16px; p { font-size: 10px; } } .suggestions { gap: 10px; } }
@media (max-width: 760px) { .welcome h1 { font-size: 27px; } .tool-grid { grid-template-columns: 1fr; } .tool-art { height: 110px; } .subtle-label { display: none; } .composer footer > span { flex-wrap: wrap; } }
</style>
