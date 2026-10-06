export function request<T>(path: string, options?: RequestInit): Promise<T> {
  return fetch(`/api${path}`, {
    ...options,
    headers: { ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(10000)
  }).then((response) => {
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
