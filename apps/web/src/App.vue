<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Home, Image, Layers3, PanelsTopLeft, FolderOpen, Settings2, Aperture, ArrowUpRight } from '@lucide/vue';
import { useLocalStore } from './stores/local';

const route = useRoute();
const creating = computed(() => route.path === '/' && typeof route.query.session === 'string');
const activePath = computed(() => route.path.startsWith('/projects/') ? '/projects' : route.path);
const local = useLocalStore();
const navigation = [
  { path: '/', label: '工作台', icon: Home },
  { path: '/product-image', label: '商品图', icon: Image },
  { path: '/product-kit', label: '商品套图', icon: Layers3 },
  { path: '/detail-page', label: '详情页', icon: PanelsTopLeft },
  { path: '/projects', label: '项目资产', icon: FolderOpen }
];

onMounted(() => { local.refresh(); });
</script>

<template>
  <div class="app-shell" :class="{ 'creation-shell': creating }">
    <aside v-if="!creating" class="sidebar">
      <RouterLink to="/" class="brand" aria-label="Photo Studio 工作台"><Aperture :size="27" /></RouterLink>
      <nav aria-label="主导航">
        <RouterLink v-for="item in navigation" :key="item.path" :to="item.path" :class="{ active: activePath === item.path }" :aria-current="activePath === item.path ? 'page' : undefined">
          <component :is="item.icon" :size="21" :stroke-width="1.6" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <RouterLink to="/settings" class="settings-link" :class="{ active: route.path === '/settings' }" aria-label="本地设置"><Settings2 :size="21" /><span>设置</span></RouterLink>
      <span class="sidebar-caption">本地版</span>
    </aside>
    <div class="workspace">
      <header v-if="!creating" class="topbar">
        <RouterLink to="/" class="wordmark">PHOTO <span>STUDIO</span><small>电商视觉工作台</small></RouterLink>
        <RouterLink to="/settings" class="service-status"><i :class="{ ready: local.health }"></i>{{ local.loading ? '连接中' : local.health ? '本地服务已连接' : '本地服务未连接' }}<ArrowUpRight :size="13" /></RouterLink>
      </header>
      <div v-if="local.error" class="service-error" role="alert">{{ local.error }}<button type="button" :disabled="local.loading" @click="local.refresh()">{{ local.loading ? '重试中…' : '重试连接' }}</button></div>
      <main><RouterView /></main>
    </div>
  </div>
</template>

<style scoped lang="scss">
.creation-shell { .workspace { margin-left: 0; } }
</style>
