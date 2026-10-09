<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ArrowUpRight, Sparkles, Image, Layers3, PanelsTopLeft, FolderOpen, Plus, ArrowRight, WandSparkles, LockKeyhole } from '@lucide/vue';
import AgentWorkspace from '../components/AgentWorkspace.vue';
import ProjectCards from '../components/ProjectCards.vue';
import { useProjectsStore } from '../stores/projects';

const prompt = ref('');
const route = useRoute();
const conversation = computed(() => typeof route.query.session === 'string');
const projects = useProjectsStore();
onMounted(() => { projects.load(); });
const suggestions = ['制作一张高级感商品图', '生成一套统一风格的套图', '把商品卖点变成详情页'];
const tools = [
  { path: '/product-image', title: 'AI 商品图', caption: '一张原图，无限种可能', icon: Image, label: 'AI PHOTOGRAPHY', style: 'image', image: '/images/studio-fashion.webp' },
  { path: '/product-kit', title: '商品套图', caption: '一套视觉，讲好品牌故事', icon: Layers3, label: 'BRAND COLLECTION', style: 'kit', image: '/images/studio-coffee.webp' },
  { path: '/detail-page', title: '商品详情页', caption: '让每个卖点，都有好表达', icon: PanelsTopLeft, label: 'PRODUCT STORY', style: 'detail', image: '/images/studio-travel.webp' }
];
const category = ref('全部');
const categories = ['全部', '品牌套图', '商品场景', '服饰穿搭', '数码科技'];
const inspirations = [
  { title: '咖啡日常 · 品牌的温度', category: '品牌套图', image: '/images/studio-coffee.webp', prompt: '为咖啡产品设计一套温暖自然的品牌商品图，使用奶油色与咖啡棕，包含包装、杯子与生活场景。' },
  { title: '光影之间 · 自然生活', category: '商品场景', image: '/images/studio-home.webp', prompt: '制作一张温暖自然的家居商品场景图，使用午后阳光、柔和阴影与舒适的室内氛围。' },
  { title: '柔软质感 · 简约穿搭', category: '服饰穿搭', image: '/images/studio-fashion.webp', prompt: '制作一套服饰商品展示图，突出丝绸面料的质感与简约穿搭，使用自然光和干净的构图。' },
  { title: '轻装出发 · 随行科技', category: '数码科技', image: '/images/studio-travel.webp', prompt: '为便携充电器制作商品展示图，突出轻巧与旅行场景，使用蓝白配色和清晰的卖点布局。' },
  { title: '户外时刻 · 自由充能', category: '商品场景', image: '/images/studio-outdoor.webp', prompt: '制作一张充电宝的户外露营商品场景图，使用自然光与山野背景，突出便携与生活方式。' },
  { title: '桌面美学 · 有序生活', category: '数码科技', image: '/images/studio-tech.webp', prompt: '制作一张无线充电支架的桌面商品图，使用明亮简约的工作空间，展示产品外观与使用场景。' }
];
const visibleInspirations = computed(() => inspirations.filter(item => category.value === '全部' || item.category === category.value));
function useInspiration(value: string) {
  prompt.value = value;
  const composer = document.getElementById('agent-prompt');
  composer?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  composer?.focus({ preventScroll: true });
}
</script>

<template>
  <div class="page home-page" :class="{ 'conversation-page': conversation }">
    <section class="welcome" :aria-labelledby="conversation ? undefined : 'welcome-title'">
      <header v-if="!conversation" class="hero-heading">
        <div class="hero-copy"><span class="eyebrow"><Sparkles :size="13" /> 灵感就位，开始创作</span><h1 id="welcome-title">好商品，<br />值得<span>好设计。</span></h1><p>把你的想法交给 AI，让每一张商品图都更出彩。</p><span class="hero-note">YOUR NEXT GREAT IDEA STARTS HERE</span></div>
        <div class="hero-stage" aria-hidden="true"><span class="orbit"></span><span class="stage-spark">✳</span><div class="floating-poster poster-back"><img src="/images/studio-fashion.webp" alt="" /><span>LESS, BUT BETTER.</span></div><div class="floating-poster poster-front"><img src="/images/studio-coffee.webp" alt="" /><span>A LITTLE EVERYDAY MAGIC.</span></div><span class="stage-sticker"><WandSparkles :size="15" /> 让灵感成为作品</span></div>
      </header>
      <AgentWorkspace v-model="prompt" />
      <div v-if="!conversation" class="suggestions"><span>灵感起点</span><button v-for="suggestion in suggestions" :key="suggestion" type="button" @click="useInspiration(suggestion)">{{ suggestion }}<ArrowUpRight :size="12" /></button></div>
    </section>

    <section v-if="!conversation" class="tools-section" aria-labelledby="tools-title">
      <div class="section-heading"><div><h2 id="tools-title">你的创意，轻松实现<span class="heading-dot">.</span></h2><p>从一张好图，到一整套让人心动的商品视觉</p></div><span class="subtle-label"><Sparkles :size="12" /> 为电商而设计</span></div>
      <div class="tool-grid">
        <RouterLink v-for="tool in tools" :key="tool.path" :to="tool.path" :aria-label="tool.title" class="tool-card" :class="tool.style">
          <div class="tool-copy"><span class="tool-icon"><component :is="tool.icon" :size="20" :stroke-width="1.6" /></span><span class="tool-label">{{ tool.label }}</span><h3>{{ tool.title }}</h3><p>{{ tool.caption }}</p><span class="tool-action">开始创作 <ArrowUpRight :size="14" /></span></div>
          <div class="tool-art" aria-hidden="true"><img :src="tool.image" alt="" loading="lazy" /></div>
        </RouterLink>
      </div>
    </section>

    <section v-if="!conversation" class="inspiration-section" aria-labelledby="inspiration-title">
      <div class="section-heading"><div><h2 id="inspiration-title">发现下一份灵感<span class="heading-dot">.</span></h2><p>喜欢的风格，成为下一次创作的起点</p></div><span class="subtle-label">EXPLORE THE POSSIBILITIES <ArrowUpRight :size="14" /></span></div>
      <div class="category-tabs" role="group" aria-label="灵感分类"><button v-for="item in categories" :key="item" type="button" :class="{ selected: category === item }" :aria-pressed="category === item" @click="category = item">{{ item }}</button><span>{{ visibleInspirations.length }} 份灵感</span></div>
      <div class="inspiration-grid"><button v-for="item in visibleInspirations" :key="item.title" type="button" class="inspiration-card" :aria-label="`使用灵感：${item.title}`" @click="useInspiration(item.prompt)"><div class="inspiration-art"><img :src="item.image" :alt="item.title" loading="lazy" /><span class="inspiration-tag">{{ item.category }}</span><span class="inspiration-action"><WandSparkles :size="15" /> 用这个灵感创作 <ArrowUpRight :size="15" /></span></div><div class="inspiration-copy"><h3>{{ item.title }}</h3><ArrowUpRight :size="15" /></div></button></div>
      <p class="inspiration-note">参考图片用于风格启发，点击后填入创作描述，可按你的商品调整。</p>
    </section>

    <section v-if="!conversation" class="recent-section" aria-labelledby="recent-title">
      <div class="section-heading"><div><h2 id="recent-title">最近项目</h2><p>每一次创作，都可以从这里继续</p></div><RouterLink to="/projects">查看全部 <ArrowRight :size="14" /></RouterLink></div>
      <div v-if="projects.loading" class="empty-state" role="status"><p>正在读取最近项目…</p></div>
      <div v-else-if="projects.error" class="empty-state" role="alert"><h3>最近项目读取失败</h3><p>{{ projects.error }}</p><button type="button" class="button secondary" @click="projects.load()">重新读取</button></div>
      <ProjectCards v-else-if="projects.projects.length" :projects="projects.projects.slice(0, 3)" />
      <div v-else class="empty-state"><FolderOpen :size="29" :stroke-width="1.2" /><h3>第一份作品，从这里开始</h3><p>当前还没有项目。项目与素材会保存在本机，方便你继续创作。</p><RouterLink to="/projects" class="button secondary"><Plus :size="15" /> 创建第一个项目</RouterLink></div>
    </section>
    <footer v-if="!conversation" class="page-caption"><span>PHOTO STUDIO <span> / </span> MADE FOR YOUR IDEAS</span><span><LockKeyhole :size="12" /> 本地工作空间 · 素材与作品由你掌握</span></footer>
  </div>
</template>

<style scoped lang="scss">
.home-page { padding-top: 28px; }
.welcome { position: relative; padding: 30px 34px 22px; border: 1px solid #eeebf7; border-radius: 28px; background: radial-gradient(ellipse at 90% 10%, #e8dcff 0, transparent 50%), radial-gradient(ellipse at 10% 90%, #eaf5f4 0, transparent 50%), #f3f1fb; }
.hero-heading { display: grid; grid-template-columns: 1fr 390px; min-height: 225px; align-items: center; }
.hero-copy { position: relative; z-index: 1; h1 { font-size: clamp(32px, 3.5vw, 48px); font-weight: 750; line-height: 1.35; letter-spacing: -1.5px; margin-top: 16px; } h1 span { background: linear-gradient(110deg, #7554d9, #a973da, #cf84a1); background-clip: text; color: transparent; } p { color: var(--text-secondary); margin-top: 12px; font-size: 13px; } }
.eyebrow { display: inline-flex; gap: 7px; align-items: center; color: #7a5aa5; background: rgb(255 255 255 / 75%); border: 1px solid rgb(255 255 255 / 90%); padding: 5px 11px; border-radius: 30px; font-size: 11px; }
.hero-note { display: block; color: #a19aaf; font-size: 8px; letter-spacing: 2.6px; margin-top: 18px; }
.hero-stage { position: relative; height: 225px; isolation: isolate; }
.orbit { position: absolute; width: 340px; height: 195px; top: 5px; left: 5px; border: 1px solid rgb(157 119 224 / 19%); border-radius: 50%; transform: rotate(-22deg); }
.stage-spark { position: absolute; color: #9b79e1; left: 20px; top: 27px; font-size: 32px; }
.floating-poster { position: absolute; width: 140px; padding: 6px 6px 9px; background: white; border-radius: 10px; box-shadow: 0 14px 35px rgb(59 38 102 / 16%); img { display: block; width: 100%; height: 164px; object-fit: cover; border-radius: 6px; } > span { display: block; font-size: 6px; letter-spacing: 1px; margin-top: 7px; color: #615973; text-align: center; } }
.poster-back { top: 8px; left: 66px; transform: rotate(-12deg); animation: poster-drift 6s ease-in-out infinite; }
.poster-front { top: 25px; left: 207px; transform: rotate(10deg); animation: poster-drift 6s -3s ease-in-out infinite; }
.stage-sticker { position: absolute; bottom: 0; left: 119px; display: inline-flex; align-items: center; gap: 7px; padding: 9px 14px; border: 1px solid #fff; border-radius: 30px; color: #7755bc; background: rgb(255 255 255 / 90%); box-shadow: 0 6px 18px rgb(84 58 135 / 8%); font-size: 11px; transform: rotate(-4deg); }
.suggestions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; font-size: 11px; > span { color: var(--muted); margin-right: 2px; } button { display: inline-flex; gap: 6px; align-items: center; color: var(--text-secondary); border: 1px solid rgb(255 255 255 / 70%); background: rgb(255 255 255 / 60%); padding: 5px 10px; border-radius: 30px; &:hover { color: var(--accent); background: white; box-shadow: 0 3px 10px rgb(119 85 232 / 7%); } } }
.tools-section, .inspiration-section, .recent-section { margin-top: 36px; }
.heading-dot { color: var(--accent); margin-left: 3px; }
.subtle-label { display: inline-flex; gap: 7px; align-items: center; color: var(--muted); font-size: 10px; letter-spacing: .5px; }
.tool-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; }
.tool-card { position: relative; overflow: hidden; min-height: 204px; background: linear-gradient(120deg, #e8f3ee, #f2f9f5); border: 1px solid #dfeee5; border-radius: 18px; transition: transform .25s, box-shadow .25s; &:hover { transform: translateY(-5px); box-shadow: var(--shadow-hover); } &:hover img { transform: rotate(0) scale(1.04); } }
.tool-copy { position: relative; padding: 22px; z-index: 1; h3 { font-size: 19px; font-weight: 650; margin-top: 7px; } p { font-size: 11px; color: var(--text-secondary); margin-top: 4px; max-width: 56%; } }
.tool-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; color: #49866c; background: rgb(255 255 255 / 75%); margin-bottom: 13px; }
.tool-label { color: #7e9d8e; font-size: 7px; letter-spacing: 1.3px; }
.tool-action { display: inline-flex; align-items: center; gap: 12px; font-size: 11px; margin-top: 17px; }
.tool-art { position: absolute; right: -16px; top: 24px; width: 42%; height: 186px; img { width: 100%; height: 100%; object-fit: cover; border: 5px solid rgb(255 255 255 / 85%); border-radius: 10px; box-shadow: 0 8px 20px rgb(33 61 44 / 12%); transform: rotate(-12deg); transition: transform .35s; } }
.kit { background: linear-gradient(120deg, #eee8fa, #f6f0ff); border-color: #e9e0f7; .tool-icon { color: #9573c2; } .tool-label { color: #a08abb; } }
.detail { background: linear-gradient(120deg, #f9eee5, #fff5ed); border-color: #f4e7d9; .tool-icon { color: #c48c5f; } .tool-label { color: #bc9b7f; } }
.category-tabs { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; button { padding: 7px 16px; border: 1px solid transparent; border-radius: 30px; background: #efeff5; color: var(--text-secondary); font-size: 12px; &:hover { background: var(--accent-soft); color: var(--accent); } &.selected { background: var(--text); color: white; } } > span { margin-left: auto; color: var(--muted); font-size: 10px; } }
.inspiration-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: start; gap: 18px; }
.inspiration-card { min-width: 0; text-align: left; border: 0; background: transparent; padding: 0; border-radius: 16px; animation: page-appear .35s ease both; &:hover img { transform: scale(1.045); } &:hover .inspiration-action, &:focus-visible .inspiration-action { opacity: 1; transform: translateY(0); } &:hover .inspiration-copy { color: var(--accent); } }
.inspiration-art { position: relative; overflow: hidden; border-radius: 16px; background: #efedf4; aspect-ratio: 3 / 4; img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform .5s; } }
.inspiration-tag { position: absolute; top: 12px; left: 12px; padding: 4px 9px; border-radius: 6px; background: rgb(255 255 255 / 88%); font-size: 9px; color: var(--text-secondary); backdrop-filter: blur(8px); }
.inspiration-action { position: absolute; bottom: 12px; left: 12px; right: 12px; display: flex; justify-content: center; align-items: center; gap: 8px; border-radius: 10px; padding: 11px 6px; background: rgb(255 255 255 / 94%); color: var(--text); font-size: 11px; box-shadow: var(--shadow); opacity: 0; transform: translateY(6px); transition: opacity .2s, transform .2s; }
.inspiration-copy { display: flex; justify-content: space-between; gap: 6px; align-items: center; padding: 12px 2px; color: var(--text-secondary); h3 { font-size: 12px; font-weight: 500; } }
.inspiration-note { margin-top: 8px; font-size: 10px; color: var(--muted); }
.page-caption { margin-top: 36px; padding-top: 22px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 9px; > span { display: inline-flex; align-items: center; gap: 6px; } }
.conversation-page { max-width: none; padding: 0; animation: none; .welcome { padding: 0; border: 0; border-radius: 0; background: transparent; } }
@keyframes poster-drift { 50% { translate: 0 -7px; } }
@media (max-width: 1100px) { .welcome { padding: 24px; } .hero-heading { grid-template-columns: 1fr 310px; } .hero-stage { transform: scale(.85); transform-origin: right center; } .tool-copy { padding: 18px; h3 { font-size: 17px; } p { font-size: 10px; max-width: 64%; } } .tool-art { right: -26px; width: 41%; } .tool-label { font-size: 6px; letter-spacing: .6px; } .inspiration-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .hero-heading { grid-template-columns: 1fr; min-height: auto; } .hero-stage { display: none; } .hero-copy h1 { font-size: 34px; } .hero-note { display: none; } .tool-grid { grid-template-columns: 1fr; } .tool-card { min-height: 188px; } .tool-art { width: 35%; right: 12px; top: 18px; } .subtle-label { display: none; } .inspiration-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .page-caption { flex-wrap: wrap; } .category-tabs { gap: 6px; button { padding: 6px 11px; font-size: 11px; } > span { display: none; } } }
@media (max-width: 480px) { .welcome { padding: 20px 16px; border-radius: 20px; } .hero-copy h1 { font-size: 30px; } .hero-copy p { font-size: 12px; } .suggestions > span { width: 100%; } .inspiration-grid { grid-template-columns: 1fr; } .inspiration-action { opacity: 1; transform: none; } .tool-art { right: -12px; } }
</style>
