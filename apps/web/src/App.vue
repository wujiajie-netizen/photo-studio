<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Home, Clock3, Image, Layers3, PanelsTopLeft, FolderOpen, Settings2, Aperture, ArrowUpRight, Sparkles, Plus } from '@lucide/vue';
import { useLocalStore } from './stores/local';
import ConversationHistory from './components/ConversationHistory.vue';
import LoginDialog from './components/LoginDialog.vue';
import AccountMenu from './components/AccountMenu.vue';
import { useAuthStore } from './stores/auth';

const route = useRoute();
const creating = computed(() => route.path === '/' && typeof route.query.session === 'string');
const activePath = computed(() => route.path.startsWith('/projects/') ? '/projects' : route.path);
const local = useLocalStore();
const auth = useAuthStore();
const publicHome = computed(() => route.path === '/' && !route.query.session);
let sessionCheck: ReturnType<typeof setInterval> | undefined;
const historyOpen = ref(false);
const navigation = [
  { path: '/product-image', label: '商品图', icon: Image },
  { path: '/product-kit', label: '商品套图', icon: Layers3 },
  { path: '/detail-page', label: '详情页', icon: PanelsTopLeft },
  { path: '/projects', label: '项目资产', icon: FolderOpen }
];

function history() { if (!auth.user) { auth.show(); return; } historyOpen.value = !historyOpen.value; }
onMounted(() => {
  local.refresh(); auth.refresh();
  sessionCheck = setInterval(() => { if (auth.user && document.visibilityState === 'visible') auth.refresh(); }, 60_000);
});
onUnmounted(() => { clearInterval(sessionCheck); });
watch(() => route.fullPath, () => { historyOpen.value = false; });
watch(() => auth.user?.id, id => { if (id) local.refresh(); });
watch(() => [auth.ready, route.fullPath], () => { if (auth.ready && !auth.user && !publicHome.value) auth.show(); });
</script>

<template>
  <div class="app-shell" :class="{ 'creation-shell': creating }">
    <aside v-if="!creating" class="sidebar">
      <RouterLink to="/" class="brand" aria-label="Photo Studio 工作台"><Aperture :size="27" /></RouterLink>
      <RouterLink to="/" class="create-link" aria-label="开始新的创作"><Plus :size="21" /><span>创作</span></RouterLink>
      <nav aria-label="主导航">
        <RouterLink to="/" class="navigation-item" :class="{ active: activePath === '/' && !historyOpen }" :aria-current="activePath === '/' ? 'page' : undefined"><Home :size="21" :stroke-width="1.6" /><span>工作台</span></RouterLink>
        <button type="button" class="navigation-item" :class="{ active: historyOpen }" :aria-expanded="historyOpen" aria-controls="conversation-history" @click="history"><Clock3 :size="21" :stroke-width="1.6" /><span>最近对话</span></button>
        <RouterLink v-for="item in navigation" :key="item.path" :to="item.path" class="navigation-item" :class="{ active: activePath === item.path }" :aria-current="activePath === item.path ? 'page' : undefined">
          <component :is="item.icon" :size="21" :stroke-width="1.6" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <RouterLink v-if="auth.user?.role === 'admin'" to="/settings" class="settings-link" :class="{ active: route.path === '/settings' }" aria-label="本地设置"><Settings2 :size="21" /><span>设置</span></RouterLink>
      <span class="sidebar-caption">本地版</span>
    </aside>
    <ConversationHistory v-if="!creating && auth.user" v-model="historyOpen" />
    <div class="workspace">
      <header v-if="!creating" class="topbar">
        <RouterLink to="/" class="wordmark">PHOTO <span>STUDIO</span><small>让商品，被看见。</small></RouterLink>
        <div class="topbar-actions"><span class="workspace-label"><Sparkles :size="13" /> {{ auth.user ? '我的创作空间' : '灵感，从这里开始' }}</span><RouterLink v-if="auth.user?.role === 'admin'" to="/settings" class="service-status"><i :class="{ ready: local.health }"></i>{{ local.loading ? '连接中' : local.health ? '本地服务已连接' : '本地服务未连接' }}<ArrowUpRight :size="13" /></RouterLink><AccountMenu /></div>
      </header>
      <div v-if="local.error" class="service-error" role="alert">{{ local.error }}<button type="button" :disabled="local.loading" @click="local.refresh()">{{ local.loading ? '重试中…' : '重试连接' }}</button></div>
      <main><RouterView v-if="auth.ready && (auth.user || auth.reauthenticating || publicHome) && (route.path !== '/settings' || auth.user?.role === 'admin')" /><section v-else-if="auth.ready" class="workspace-access"><Aperture :size="36" /><h1>{{ auth.user ? '此页面仅供管理员使用' : '登录，开启你的创作空间' }}</h1><p>{{ auth.user ? '你可以返回工作台继续创作。' : '项目、素材与对话会保存在你的账号中。' }}</p><RouterLink v-if="auth.user" to="/" class="button">返回工作台</RouterLink><button v-else type="button" class="button" @click="auth.show()">登录并继续</button></section><p v-else class="workspace-access" role="status">正在连接创作空间…</p></main>
    </div>
  </div>
  <LoginDialog v-if="auth.open" />
</template>

<style scoped lang="scss">
.workspace-access { display: flex; min-height: 55vh; padding: 40px; flex-direction: column; gap: 18px; align-items: center; justify-content: center; text-align: center; color: var(--muted); h1 { color: var(--text); font-size: 24px; } p { font-size: 13px; } > svg { color: var(--accent); } }
.creation-shell {
  --text: #2b2e38;
  --text-secondary: #606575;
  --muted: #707684;
  --border: #eceef3;
  --border-strong: #d9dce6;
  --accent: #7659d6;
  --accent-soft: #f2effb;
  --nav-hover: #f6f4fc;
  --accent-gradient: linear-gradient(120deg, #8063df, #9472e4);
  --error: #b55062;
  --shadow: 0 2px 8px rgb(35 40 60 / 2%), 0 10px 30px rgb(35 40 60 / 5%);
  color: var(--text);
  font-family: 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Segoe UI', sans-serif;
  font-weight: 400;
  text-rendering: optimizeLegibility;
  .workspace { margin-left: 0; }
}
</style>
