import { useAuthStore } from './stores/auth';

export function request<T>(path: string, options?: RequestInit): Promise<T> {
  const publicRequest = path.startsWith('/auth/') || path === '/health';
  const access = publicRequest ? Promise.resolve() : useAuthStore().ensure();
  return access.then(() => fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options?.headers, 'X-Photo-Studio-Request': '1' },
    signal: options?.signal ?? AbortSignal.timeout(options?.body instanceof FormData ? 600000 : 10000)
  })).then((response) => {
    if (response.status === 401 && !publicRequest) useAuthStore().expire();
    if (!response.ok) {
      return response.json().then((body: { message: string | string[] }) => {
        throw new Error(Array.isArray(body.message) ? body.message.join('；') : body.message);
      });
    }
    return response.json() as Promise<T>;
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('请求超时，请稍后重试。');
    if (error instanceof TypeError || error instanceof SyntaxError) throw new Error('无法连接本地服务，请检查服务是否启动后重试。');
    throw error;
  });
}
