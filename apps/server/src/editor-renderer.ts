import Konva from 'konva';
import { createCanvas, Image, loadImage, DOMMatrix, Path2D, type Canvas } from '@napi-rs/canvas';
import { createEditorNode } from '@photo-studio/editor/render';
import { validateEditorContent, type EditorContent } from '@photo-studio/shared';

/* 为 Konva 提供本地 CPU Canvas，后台导出不依赖浏览器窗口或 GPU。 */
globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;
Konva.Util.createCanvasElement = () => Object.assign(createCanvas(300, 300), { style: {} }) as unknown as HTMLCanvasElement;
Konva.Util.createImageElement = () => new Image() as unknown as HTMLImageElement;

/* 只读取文档明确引用的本地结果与素材；节点规则与前端相同，不近似还原为 SVG。 */
export function renderEditorContent(content: EditorContent, file: (kind: 'image' | 'asset-image', id: string) => string): Promise<Buffer> {
  validateEditorContent(content);
  const layer = new Konva.Layer();
  const images = new Map<string, HTMLImageElement>();
  const required = new Map(content.layers.flatMap<[string, { kind: 'image' | 'asset-image'; id: string }]>(item => item.type === 'image' ? [[`image:${item.resultId}`, { kind: 'image', id: item.resultId }]] : item.type === 'asset-image' ? [[`asset-image:${item.assetId}`, { kind: 'asset-image', id: item.assetId }]] : []));
  return Promise.all([...required].map(([key, value]) => loadImage(file(value.kind, value.id)).then(image => { images.set(key, image as unknown as HTMLImageElement); }))).then(() => {
    layer.add(new Konva.Rect({ width: content.width, height: content.height, fill: content.background }));
    for (const item of content.layers) {
      const image = item.type === 'image' ? images.get(`image:${item.resultId}`) : item.type === 'asset-image' ? images.get(`asset-image:${item.assetId}`) : undefined;
      layer.add(createEditorNode(item, image));
    }
    const canvas = layer.toCanvas({ width: content.width, height: content.height, pixelRatio: 1 }) as unknown as Canvas;
    return canvas.encode('png');
  }).finally(() => layer.destroy());
}
