import Konva from 'konva';
import type { EditorContent, EditorLayer } from '@photo-studio/shared';
import { createEditorNode } from './render.js';

export class ProductCanvas {
  private readonly stage: Konva.Stage;
  private readonly layer = new Konva.Layer();
  private readonly transformer = new Konva.Transformer({ flipEnabled: false, rotateEnabled: true, boundBoxFunc: (old, box) => Math.abs(box.width) < 8 || Math.abs(box.height) < 8 ? old : box });
  private content: EditorContent | null = null;
  private selected: string | null = null;
  private readonly images = new Map<string, HTMLImageElement>();
  private version = 0;
  private scale = 1;

  constructor(container: HTMLDivElement, private readonly onSelect: (id: string | null) => void, private readonly onChange: (id: string, values: Pick<EditorLayer, 'x' | 'y' | 'width' | 'height' | 'rotation'>) => void) {
    this.stage = new Konva.Stage({ container, width: 1, height: 1 }); this.stage.add(this.layer);
    this.stage.on('click tap', (event) => {
      if (event.target === this.stage || event.target.id() === 'canvas-background') { this.select(null); this.onSelect(null); return; }
      if (event.target.getParent() === this.transformer) return;
      const id = event.target.id(); if (!id) return; this.select(id); this.onSelect(id);
    });
  }
  render(content: EditorContent, availableWidth: number, availableHeight: number, previewScale?: number, interactive = true): Promise<void> {
    this.content = content; const current = ++this.version;
    const required = [...new Map(content.layers.flatMap<[string, string]>(item => item.type === 'image' ? [[`result:${item.resultId}`, `/api/product-image/results/${item.resultId}/file`]] : item.type === 'asset-image' ? [[`asset:${item.assetId}`, `/api/assets/${item.assetId}/file`]] : [])).entries()];
    /* 只加载文档引用的生成图片；异步加载结束后再次检查版本，切换文档不会渲染旧画布。 */
    return Promise.all(required.map(([id, url]) => {
      if (this.images.has(id)) return Promise.resolve();
      return new Promise<void>((resolveImage, reject) => {
        const image = new Image(); image.onload = () => { this.images.set(id, image); resolveImage(); };
        image.onerror = () => reject(new Error('图片图层无法读取，请重新打开作品。')); image.src = url;
      });
    })).then(() => {
      if (current !== this.version) return;
      this.scale = previewScale ?? Math.min((availableWidth - 48) / content.width, (availableHeight - 48) / content.height, 1);
      this.scale = Math.max(.03, this.scale);
      this.stage.size({ width: content.width * this.scale, height: content.height * this.scale }); this.stage.scale({ x: this.scale, y: this.scale });
      this.transformer.nodes([]); this.transformer.remove(); this.layer.destroyChildren();
      this.layer.add(new Konva.Rect({ id: 'canvas-background', width: content.width, height: content.height, fill: content.background }));
      for (const item of content.layers) {
        const image = item.type === 'image' ? this.images.get(`result:${item.resultId}`) : item.type === 'asset-image' ? this.images.get(`asset:${item.assetId}`) : undefined;
        const node = createEditorNode(item, image, interactive);
        node.on('dragend transformend', () => {
          const width = Math.max(1, node.width() * node.scaleX()); const height = Math.max(1, node.height() * node.scaleY());
          node.scale({ x: 1, y: 1 }); node.size({ width, height });
          this.onChange(item.id, { x: node.x(), y: node.y(), width, height, rotation: node.rotation() });
        });
        this.layer.add(node);
      }
      this.layer.add(this.transformer); if (interactive) this.select(this.selected); else this.transformer.nodes([]); this.layer.draw();
    });
  }
  select(id: string | null) {
    this.selected = id;
    const item = this.content?.layers.find((value) => value.id === id);
    const node = id ? this.layer.findOne(`#${id}`) : null;
    this.transformer.nodes(node && item?.visible && !item.locked ? [node] : []); this.layer.batchDraw();
  }
  export(format: 'png' | 'jpeg' = 'png', multiplier = 1, quality = .92): Promise<Blob> {
    const selected = this.selected; this.transformer.nodes([]); this.layer.draw();
    /* 按文档尺寸导出，避免预览缩放的浮点误差少一行像素；处理工具必须拿到完整原尺寸。 */
    let picture: HTMLCanvasElement;
    try {
      this.stage.scale({ x: 1, y: 1 });
      picture = this.stage.toCanvas({ width: this.content!.width, height: this.content!.height, pixelRatio: multiplier });
    } finally { this.stage.scale({ x: this.scale, y: this.scale }); this.select(selected); }
    /* JPEG 没有透明通道，导出时铺白底；画布文档与 PNG 的透明背景保持原样。 */
    if (format === 'jpeg') { const context = picture.getContext('2d')!; context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, picture.width, picture.height); }
    return new Promise<Blob | null>(resolve => picture.toBlob(resolve, `image/${format}`, quality)).then((blob) => {
      if (!blob) throw new Error('无法导出画布，请重试。'); return blob;
    });
  }
  destroy() { ++this.version; this.stage.destroy(); this.images.clear(); }
}
