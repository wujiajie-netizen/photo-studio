import Konva from 'konva';
import type { EditorContent, EditorLayer } from '@photo-studio/shared';

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
        const config = { ...item, draggable: interactive && !item.locked, listening: interactive && item.visible, id: item.id };
        let node: Konva.Shape;
        if (item.type === 'image' || item.type === 'asset-image') {
          node = new Konva.Image({ ...config, image: this.images.get(item.type === 'image' ? `result:${item.resultId}` : `asset:${item.assetId}`)! });
          if (item.adjustments) {
            node.cache(); node.filters([Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL, Konva.Filters.Blur]);
            node.brightness(item.adjustments.brightness); node.contrast(item.adjustments.contrast); node.saturation(item.adjustments.saturation); node.blurRadius(item.adjustments.blur);
          }
        }
        else if (item.type === 'text') node = new Konva.Text({ ...config, text: item.text, fontSize: item.fontSize, fontFamily: item.fontFamily, fill: item.fill, align: item.align, wrap: 'word' });
        else if (item.type === 'path') {
          const wide = Math.max(1, ...item.points.filter((_, index) => index % 2 === 0)); const tall = Math.max(1, ...item.points.filter((_, index) => index % 2 === 1));
          node = new Konva.Line({ ...config, points: item.points.map((point, index) => point * (index % 2 ? item.height / tall : item.width / wide)), stroke: item.stroke, strokeWidth: item.strokeWidth, lineCap: 'round', lineJoin: 'round', hitStrokeWidth: Math.max(12, item.strokeWidth) });
        } else {
          /* 用左上角和宽高绘制形状，沿用图片图层的变换、选择与持久化坐标。 */
          node = new Konva.Shape({ ...config, fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth, sceneFunc(context, shape) {
            const width = shape.width(); const height = shape.height(); context.beginPath();
            if (item.shape === 'rectangle') context.rect(0, 0, width, height);
            else if (item.shape === 'ellipse') context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
            else if (item.shape === 'triangle') { context.moveTo(width / 2, 0); context.lineTo(width, height); context.lineTo(0, height); context.closePath(); }
            else if (item.shape === 'star') { for (let index = 0; index < 10; index++) { const angle = index * Math.PI / 5 - Math.PI / 2; const radius = index % 2 ? .22 : .5; const x = width / 2 + Math.cos(angle) * width * radius; const y = height / 2 + Math.sin(angle) * height * radius; if (!index) context.moveTo(x, y); else context.lineTo(x, y); } context.closePath(); }
            else { context.moveTo(0, height / 2); context.lineTo(width, height / 2); if (item.shape === 'arrow') { context.moveTo(width * .8, height * .2); context.lineTo(width, height / 2); context.lineTo(width * .8, height * .8); } }
            context.fillStrokeShape(shape);
          } });
        }
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
  export(format: 'png' | 'jpeg' = 'png', multiplier = 1): Promise<Blob> {
    const selected = this.selected; this.transformer.nodes([]); this.layer.draw();
    const picture = this.stage.toCanvas({ pixelRatio: multiplier / this.scale });
    /* JPEG 没有透明通道，导出时铺白底；画布文档与 PNG 的透明背景保持原样。 */
    if (format === 'jpeg') { const context = picture.getContext('2d')!; context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff'; context.fillRect(0, 0, picture.width, picture.height); }
    return new Promise<Blob | null>(resolve => picture.toBlob(resolve, `image/${format}`, .92)).then((blob) => {
      this.select(selected); if (!blob) throw new Error('无法导出画布，请重试。'); return blob;
    }).catch((error) => { this.select(selected); throw error; });
  }
  destroy() { ++this.version; this.stage.destroy(); this.images.clear(); }
}
