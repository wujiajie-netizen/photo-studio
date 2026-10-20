import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AuthState, AuthUser } from '@photo-studio/shared';
import { request } from '../api';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const ready = ref(false); const loading = ref(false); const open = ref(false);
  const setupRequired = ref(false); const error = ref('');
  const reauthenticating = ref(false);
  let previousUserId: string | null = null;
  let pending: { resolve: () => void; reject: (error: Error) => void }[] = [];

  function refresh(): Promise<void> {
    return request<AuthState>('/auth/session').then(state => {
      if (previousUserId && state.user && previousUserId !== state.user.id) { window.location.assign('/'); return; }
      setupRequired.value = state.setupRequired;
      if (user.value && !state.user) expire();
      user.value = state.user;
      if (state.user) previousUserId = state.user.id;
      error.value = '';
    }).catch((reason: Error) => { error.value = reason.message; })
      .finally(() => { ready.value = true; });
  }
  function show() { open.value = true; }
  function ensure(): Promise<void> {
    if (user.value) return Promise.resolve();
    show();
    return new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }); });
  }
  function dismiss() {
    if (loading.value) return;
    open.value = false;
    const waiting = pending; pending = [];
    waiting.forEach(item => item.reject(new Error('请登录后继续使用。')));
  }
  function expire() { reauthenticating.value = Boolean(previousUserId); user.value = null; open.value = true; }
  function login(username: string, password: string): Promise<void> {
    if (loading.value) return Promise.resolve();
    loading.value = true; error.value = '';
    /* 登录成功才继续原操作；切换为其他账号时重新加载，清除旧缓存、画布和订阅。 */
    return request<AuthState>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      .then(state => {
        if (!state.user) throw new Error('登录未完成，请重试。');
        if (previousUserId && previousUserId !== state.user.id) { window.location.assign('/'); return; }
        user.value = state.user; previousUserId = state.user.id; reauthenticating.value = false; setupRequired.value = false; open.value = false;
        const waiting = pending; pending = []; waiting.forEach(item => item.resolve());
      }).catch((reason: Error) => { error.value = reason.message; throw reason; })
      .finally(() => { loading.value = false; });
  }
  function logout(): Promise<void> {
    return request<AuthState>('/auth/logout', { method: 'POST' }).then(() => { window.location.assign('/'); });
  }
  return { user, ready, loading, open, setupRequired, error, reauthenticating, refresh, show, ensure, dismiss, expire, login, logout };
});
