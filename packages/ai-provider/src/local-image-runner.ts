import { spawn } from 'node:child_process';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateEditorContent } from '@photo-studio/shared';
import type { LocalImageInput, LocalImageOutput } from './model-provider';

export class LayerSegmentationError extends Error {
  constructor(readonly layerName: string, message: string) { super(message); }
}

export class LocalImageRunner {
  constructor(private readonly runsDirectory: string) {}

  run(taskId: string, source: Buffer, input: LocalImageInput, signal: AbortSignal, progress: (value: number) => void): Promise<LocalImageOutput> {
    const runtime = resolve(process.env.PHOTO_STUDIO_IMAGE_TOOLS_DIR || resolve(__dirname, '../../../data/runtimes/image-tools'));
    const python = resolve(runtime, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const script = resolve(__dirname, '../python/image_tools.py');
    const directory = resolve(this.runsDirectory, `image-tool-${taskId}`, `local-${randomUUID()}`);
    const check = () => { if (signal.aborted) throw new Error('图片处理已停止。'); };
    /* 本地模型也经过统一提供者；只传本任务图片和受校验的操作，文件输出限定在独立目录。 */
    return Promise.resolve().then(() => {
      check();
      if (!/^[a-f\d-]{36}$/i.test(taskId) || !source.length || source.length > 20 * 1024 * 1024) throw new Error('本地图片处理输入无效。');
      if (!['recognize-text', 'prepare-layers', 'cutout', 'split-layers'].includes(input.operation)) throw new Error('本地图片处理操作无效。');
      return access(python).catch(() => { throw new Error('本地图片工具尚未安装，请先运行 scripts/setup-image-tools.ps1。'); });
    }).then(() => mkdir(directory, { recursive: true })).then(() => realpath(directory)).then(actual => {
      check(); if (actual.toLowerCase() !== directory.toLowerCase()) throw new Error('图片处理目录不能使用符号链接。');
      return Promise.all([writeFile(resolve(directory, 'source.png'), source), writeFile(resolve(directory, 'input.json'), JSON.stringify(input), 'utf8')]);
    }).then(() => new Promise<void>((done, reject) => {
      check();
      const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', OMP_NUM_THREADS: '4' };
      delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
      const child = spawn(python, ['-u', script, '--runtime', runtime, '--directory', directory], { cwd: directory, env, windowsHide: true, shell: false });
      let output = ''; let stderr = ''; let failure = ''; let total = 0;
      const cancel = () => { child.kill(); };
      const timer = setTimeout(() => { failure = '本地图片处理超时，请降低图片尺寸后重试。'; child.kill(); }, 15 * 60 * 1000);
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      child.stdin.end(); child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        total += Buffer.byteLength(chunk); if (total > 64 * 1024) { failure = '本地图片工具输出超过限制。'; child.kill(); return; }
        output += chunk;
        for (let index; (index = output.indexOf('\n')) >= 0;) {
          const line = output.slice(0, index); output = output.slice(index + 1);
          try {
            const event = JSON.parse(line) as { progress: number };
            if (Object.keys(event).length !== 1 || !Number.isInteger(event.progress) || event.progress < 0 || event.progress > 100) throw new Error();
            if (!signal.aborted && !failure) progress(event.progress);
          } catch { failure = '本地图片工具进度无效。'; child.kill(); }
        }
      });
      child.stderr.on('data', (chunk: string) => { if (stderr.length < 32 * 1024) stderr += chunk; });
      child.once('error', () => { failure = '无法启动本地图片工具，请重新安装运行环境。'; });
      child.once('close', code => {
        clearTimeout(timer); signal.removeEventListener('abort', cancel);
        writeFile(resolve(directory, 'stderr.log'), stderr, 'utf8').then(() => {
          if (signal.aborted) throw new Error('图片处理已停止。');
          if (failure || output.trim()) throw new Error(failure || '本地图片处理失败。');
          if (code !== 0) {
            /* 仅规范化明确的分割失败，业务不解析 Python 日志，也不重试环境或模型启动错误。 */
            return readFile(resolve(directory, 'failure.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }).then(raw => {
              if (raw !== null) {
                if (raw.length > 2048) throw new Error('本地图片工具失败信息无效。');
                const value = JSON.parse(raw) as { code: string; name: string; message: string };
                if (!value || Object.keys(value).length !== 3 || value.code !== 'unreliable-layer' || typeof value.name !== 'string' || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 300 || input.operation !== 'split-layers' || !input.objects.some(item => item.name === value.name)) throw new Error('本地图片工具失败信息无效。');
                throw new LayerSegmentationError(value.name, value.message);
              }
              throw new Error(stderr.trim().split('\n').at(-1)?.slice(0, 300) || '本地图片处理失败。');
            });
          }
        }).then(done, reject);
      });
    })).then(() => {
      check(); return readFile(resolve(directory, 'output.json'), 'utf8');
    }).then(raw => {
      if (raw.length > 128 * 1024) throw new Error('本地图片工具结果超过限制。');
      const value = JSON.parse(raw) as Omit<LocalImageOutput, 'images'> & { images: { name: string; width: number; height: number }[] };
      if (!value || Object.keys(value).length !== 2 || !Array.isArray(value.images) || !value.images.length || value.images.length > 9 || !Array.isArray(value.text) || value.text.length > 30) throw new Error('本地图片工具结果无效。');
      for (const image of value.images) if (!image || Object.keys(image).length !== 3 || typeof image.name !== 'string' || !image.name.trim() || image.name.length > 100 || ![image.width, image.height].every(Number.isInteger) || image.width < 1 || image.height < 1 || image.width * image.height > 16_000_000) throw new Error('本地图片工具图层无效。');
      const { width, height } = value.images[0];
      if (value.images.some(image => image.width !== width || image.height !== height)) throw new Error('拆分图层尺寸必须与底图一致。');
      const textKeys = ['text', 'x', 'y', 'width', 'height', 'rotation', 'fill', 'fillGradient', 'align', 'fontFamily', 'fontSize', 'fontStyle', 'letterSpacing', 'lineHeight'];
      for (const text of value.text) if (!text || Object.keys(text).some(key => !textKeys.includes(key)) || text.x < 0 || text.y < 0 || text.x + text.width > width || text.y + text.height > height) throw new Error('文字图层内容或位置无效。');
      validateEditorContent({ name: '本地图片处理', width, height, background: 'transparent', layers: value.text.map(text => ({ ...text, id: randomUUID(), type: 'text', name: text.text.slice(0, 40), opacity: 1, visible: true, locked: false })) });
      return Promise.all(value.images.map((image, index) => realpath(resolve(directory, `image-${index}.png`)).then(actual => {
        if (actual.toLowerCase() !== resolve(directory, `image-${index}.png`).toLowerCase()) throw new Error('图片工具输出不能使用符号链接。');
        return readFile(actual).then(data => ({ ...image, data }));
      }))).then(images => { check(); return { images, text: value.text }; });
    });
  }
}
