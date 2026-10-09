import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { PRODUCT_UPLOAD_LIMIT, validateProductImageParameters, validateCommerceParameters, type CommerceParameters, type ProductImageParameters, type EditorLayer } from '@photo-studio/shared';

export interface CommerceRenderContext { parameters: CommerceParameters; sectionIndex: number }
export type CommerceImageRenderer = (input: Buffer | null, parameters: ProductImageParameters, index: number, signal: AbortSignal, context?: CommerceRenderContext) => Promise<{ data: Buffer; width: number; height: number }>;

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

export function renderCommerceImage(input: Buffer | null, parameters: CommerceParameters, index: number, signal: AbortSignal, render: CommerceImageRenderer, resultId: string): Promise<{ data: Buffer; width: number; height: number; background: string; layers: EditorLayer[] }> {
  validateCommerceParameters(parameters);
  if (!Number.isInteger(index) || index < 0 || index >= parameters.sections.length) return Promise.reject(new Error('图片模块序号无效。'));
  const section = parameters.sections[index];
  /* 图片引擎保留原始位图，程序排版保存为真实文字层；完整电商事实独立传递，避免描述长度截断。 */
  return render(input, { sourceAssetId: parameters.sourceAssetId, subject: parameters.subject, scene: parameters.scene, description: section.content, ratio: parameters.ratio, count: 1, quality: parameters.quality }, 0, signal, { parameters, sectionIndex: index }).then(({ data, width, height }) => {
    if (signal.aborted) throw new Error('任务已取消。');
    const titleLines = section.title.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / 22)), 0);
    const bodyLines = section.content ? section.content.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / 34)), 0) : 0;
    const fontSize = Math.max(14, Math.floor(Math.min(width * .038, height * .36 / (titleLines * 1.4 + bodyLines * .87 + 2))));
    const textHeight = Math.round((titleLines * 1.4 + bodyLines * 1.5 * .58 + 2) * fontSize);
    if (textHeight >= height) throw new Error('模块文字换行过多，请减少空行后重新生成。');
    const productHeight = height - textHeight; const scale = productHeight / height;
    const fontFamily = parameters.brand?.fontFamily ?? 'Microsoft YaHei'; const fill = parameters.brand?.textColor ?? '#202020';
    const base = { rotation: 0, opacity: 1, visible: true, locked: false };
    const layers: EditorLayer[] = [
      { ...base, id: randomUUID(), type: 'image', name: '商品原图', resultId, x: width * (1 - scale) / 2, y: 0, width: width * scale, height: productHeight },
      { ...base, id: randomUUID(), type: 'text', name: '模块标题', x: width * .06, y: productHeight + fontSize * .2, width: width * .88, height: fontSize * titleLines * 1.4, text: section.title, fontSize, fontFamily, fill: parameters.brand?.primaryColor ?? fill, align: 'left', fontStyle: 'bold', lineHeight: 1.4 },
      { ...base, id: randomUUID(), type: 'text', name: '模块文案', x: width * .06, y: productHeight + fontSize * (titleLines * 1.4 + .6), width: width * .88, height: Math.max(1, fontSize * Math.max(1, bodyLines) * .87), text: section.content, fontSize: Math.round(fontSize * .58), fontFamily, fill, align: 'left', lineHeight: 1.5 }
    ];
    return { data, width, height, background: parameters.brand?.backgroundColor ?? '#ffffff', layers };
  });
}
