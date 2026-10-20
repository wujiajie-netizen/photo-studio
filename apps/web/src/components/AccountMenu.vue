<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { isNavigationFailure, NavigationFailureType, useRouter } from 'vue-router';
import { LogOut } from '@lucide/vue';
import { useAuthStore } from '../stores/auth';
import { useEditorStore } from '../stores/editor';

const auth = useAuthStore(); const editor = useEditorStore(); const router = useRouter();
const menu = ref<HTMLElement | null>(null); const open = ref(false);
const error = ref(''); const leaving = ref(false);
function outside(event: PointerEvent) { if (!menu.value?.contains(event.target as Node)) open.value = false; }
function logout() {
  if (leaving.value) return;
  leaving.value = true; error.value = '';
  /* 先保存作品并通过页面离开守卫保存画板布局，再撤销会话和清空页面缓存。 */
  editor.save().then(() => router.replace('/')).then(failure => {
    if (isNavigationFailure(failure, NavigationFailureType.aborted | NavigationFailureType.cancelled)) throw new Error('作品尚未保存，请完成保存后再退出。');
    return auth.logout();
  }).catch((reason: Error) => { error.value = reason.message; }).finally(() => { leaving.value = false; });
}
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div v-if="auth.user" ref="menu" class="account-menu" @keydown.esc="open = false">
    <button type="button" class="account-avatar" :aria-label="`账号：${auth.user.username}`" :aria-expanded="open" @click="open = !open">{{ auth.user.username[0].toUpperCase() }}</button>
    <div v-if="open" class="account-panel"><strong>{{ auth.user.username }}</strong><span>{{ auth.user.role === 'admin' ? '管理员' : '我的创作空间' }}</span><button type="button" :disabled="leaving" @click="logout"><LogOut :size="14" />{{ leaving ? '正在退出…' : '退出登录' }}</button><p v-if="error" role="alert">{{ error }}</p></div>
  </div>
  <button v-else type="button" class="account-login" :disabled="!auth.ready" @click="auth.show()">登录</button>
</template>

<style scoped lang="scss">
.account-menu { position: relative; flex-shrink: 0; }
.account-avatar { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid #e9e1f6; border-radius: 50%; background: #f0eafa; color: #8c6bb8; font-size: 12px; }
.account-login { padding: 8px 22px; border: 0; border-radius: 24px; background: var(--accent-gradient); color: #fff; font-size: 12px; }
.account-panel { position: absolute; right: 0; top: 42px; z-index: 30; min-width: 200px; padding: 18px; border: 1px solid var(--border); border-radius: 14px; background: #fff; box-shadow: var(--shadow); strong, > span { display: block; } > span { margin-top: 5px; color: var(--muted); font-size: 11px; } button { display: flex; align-items: center; gap: 8px; margin-top: 18px; padding: 0; border: 0; background: transparent; color: var(--text-secondary); font-size: 12px; } p { margin-top: 10px; font-size: 11px; color: var(--error); } }
</style>
