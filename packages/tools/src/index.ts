import sharp from 'sharp';
import { PRODUCT_UPLOAD_LIMIT, validateProductImageParameters, validateCommerceParameters, type CommerceParameters, type ProductImageParameters } from '@photo-studio/shared';

export function prepareProductImage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  if (!input.length || input.length > PRODUCT_UPLOAD_LIMIT) return Promise.reject(new Error('图片大小必须在 20 MB 以内。'));
  /* 以实际解码格式校验图片，完整解码后转为 PNG；方向校正与尺寸来自处理结果，不信任上传后缀。 */
  return sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning' }).metadata()
    .then((metadata) => {
      if (!['jpeg', 'png', 'webp'].includes(metadata.format!) || (metadata.pages ?? 1) > 1) throw new Error('仅支持静态 PNG、JPG 和 WebP 图片。');
      return sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning' }).rotate().toColourspace('srgb').png().toBuffer({ resolveWithObject: true });
    }).then(({ data, info }) => ({ data, width: info.width, height: info.height }));
}

export function renderMockProductImage(input: Buffer | null, parameters: ProductImageParameters, index: number, signal: AbortSignal): Promise<{ data: Buffer; width: number; height: number }> {
  if (input === null) return Promise.reject(new Error('模拟工具不支持纯文字生图。'));
  validateProductImageParameters(parameters);
  if (!Number.isInteger(index) || index < 0 || index >= parameters.count) return Promise.reject(new Error('生成序号无效。'));
  if (signal.aborted) return Promise.reject(new Error('任务已取消。'));
  const edge = parameters.quality === 'high' ? 2048 : 1024;
  const [ratioWidth, ratioHeight] = parameters.ratio.split(':').map(Number);
  const width = Math.round(edge * ratioWidth / Math.max(ratioWidth, ratioHeight));
  const height = Math.round(edge * ratioHeight / Math.max(ratioWidth, ratioHeight));
  const background = { white: '#ffffff', warm: '#f5ebdd', cool: '#e9f0f5' }[parameters.scene];
  let subject = sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning' });
  if (parameters.subject === 'trim') subject = subject.trim();
  /* 模拟工具只排版原图与背景；每张调整位置形成构图版本，不进行智能抠图或语义重绘。 */
  return subject.resize({ width: Math.round(width * .76), height: Math.round(height * .76), fit: 'inside' }).png().toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => {
      if (signal.aborted) throw new Error('任务已取消。');
      const offset = [0, -.035, .035, 0][index];
      const canvas = sharp({ create: { width, height, channels: 4, background } });
      return canvas.composite([{
        input: data,
        left: Math.round((width - info.width) / 2 + width * offset),
        top: Math.round((height - info.height) / 2 + (index === 3 ? height * .035 : 0))
      }]).png().toBuffer();
    }).then((data) => {
      if (signal.aborted) throw new Error('任务已取消。');
      return { data, width, height };
    });
}

export function renderCommerceImage(input: Buffer | null, parameters: CommerceParameters, index: number, signal: AbortSignal, render: typeof renderMockProductImage): Promise<{ data: Buffer; width: number; height: number }> {
  validateCommerceParameters(parameters);
  if (!Number.isInteger(index) || index < 0 || index >= parameters.sections.length) return Promise.reject(new Error('图片模块序号无效。'));
  const section = parameters.sections[index];
  /* 每个模块使用用户确认的文案；文本转义后绘制到透明底，图片与文字区域分开，避免遮挡商品。 */
  return render(input, { sourceAssetId: parameters.sourceAssetId, subject: parameters.subject, scene: parameters.scene, description: section.content.slice(0, 1000), ratio: parameters.ratio, count: 1, quality: parameters.quality }, 0, signal).then(({ data, width, height }) => {
    if (signal.aborted) throw new Error('任务已取消。');
    const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
    const title = [...section.title];
    const titleLines = Array.from({ length: Math.ceil(title.length / 22) }, (_, line) => title.slice(line * 22, (line + 1) * 22).join(''));
    const characters = [...section.content];
    const lines = Array.from({ length: Math.ceil(characters.length / 34) }, (_, line) => characters.slice(line * 34, (line + 1) * 34).join(''));
    const fontSize = Math.max(10, Math.floor(Math.min(width * .038, height * .36 / (titleLines.length * 1.4 + lines.length * .87 + 2))));
    const textHeight = Math.round((titleLines.length * 1.4 + lines.length * 1.5 * .58 + 2) * fontSize);
    return sharp(data).resize({ width, height: height - textHeight, fit: 'contain', background: '#ffffff' }).png().toBuffer().then((product) => {
      const productHeight = height - textHeight;
      const outputHeight = height;
      const svg = `<svg width="${width}" height="${textHeight}"><rect width="100%" height="100%" fill="#ffffff"/><g font-family="Microsoft YaHei,Arial,sans-serif" fill="#202020"><text x="${width * .06}" y="${fontSize * 1.4}" font-size="${fontSize}" font-weight="bold">${titleLines.map((line, row) => `<tspan x="${width * .06}" dy="${row ? fontSize * 1.4 : 0}">${escape(line)}</tspan>`).join('')}</text><text x="${width * .06}" y="${fontSize * (titleLines.length * 1.4 + 1.2)}" font-size="${Math.round(fontSize * .58)}">${lines.map((line, row) => `<tspan x="${width * .06}" dy="${row ? fontSize * .87 : 0}">${escape(line)}</tspan>`).join('')}</text></g></svg>`;
      return sharp({ create: { width, height: outputHeight, channels: 4, background: '#ffffff' } }).composite([{ input: product, left: 0, top: 0 }, { input: Buffer.from(svg), left: 0, top: productHeight }]).png().toBuffer().then((output) => {
        if (signal.aborted) throw new Error('任务已取消。');
        return { data: output, width, height: outputHeight };
      });
    });
  });
}
