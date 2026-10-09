import Konva from 'konva';
import type { EditorLayer } from '@photo-studio/shared';

/* 浏览器画布和服务端整套导出共用节点规则，文字换行、形状路径与调色保持一致。 */
export function createEditorNode(item: EditorLayer, image?: HTMLImageElement, interactive = false): Konva.Shape {
  const config = { ...item, draggable: interactive && !item.locked, listening: interactive && item.visible, id: item.id };
  if (item.type === 'image' || item.type === 'asset-image') {
    const node = new Konva.Image({ ...config, image: image! });
    if (item.adjustments) {
      node.cache(); node.filters([Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL, Konva.Filters.Blur]);
      node.brightness(item.adjustments.brightness); node.contrast(item.adjustments.contrast); node.saturation(item.adjustments.saturation); node.blurRadius(item.adjustments.blur);
    }
    return node;
  }
  if (item.type === 'text') {
    const node = new Konva.Text({ ...config, text: item.text, fontSize: item.fontSize, fontFamily: item.fontFamily, fill: item.fill, align: item.align, wrap: 'word' });
    if (item.fillGradient) {
      const radians = item.fillGradient.angle * Math.PI / 180; const x = Math.cos(radians); const y = Math.sin(radians);
      const half = (Math.abs(item.width * x) + Math.abs(item.height * y)) / 2;
      node.fillPriority('linear-gradient'); node.fillLinearGradientStartPoint({ x: item.width / 2 - x * half, y: item.height / 2 - y * half }); node.fillLinearGradientEndPoint({ x: item.width / 2 + x * half, y: item.height / 2 + y * half });
      node.fillLinearGradientColorStops([0, item.fillGradient.colors[0], 1, item.fillGradient.colors[1]]);
    }
    return node;
  }
  if (item.type === 'path') {
    const wide = Math.max(1, ...item.points.filter((_, index) => index % 2 === 0)); const tall = Math.max(1, ...item.points.filter((_, index) => index % 2 === 1));
    return new Konva.Line({ ...config, points: item.points.map((point, index) => point * (index % 2 ? item.height / tall : item.width / wide)), stroke: item.stroke, strokeWidth: item.strokeWidth, lineCap: 'round', lineJoin: 'round', hitStrokeWidth: Math.max(12, item.strokeWidth) });
  }
  return new Konva.Shape({ ...config, fill: item.fill, stroke: item.stroke, strokeWidth: item.strokeWidth, sceneFunc(context, shape) {
    const width = shape.width(); const height = shape.height(); context.beginPath();
    if (item.shape === 'rectangle') context.rect(0, 0, width, height);
    else if (item.shape === 'ellipse') context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    else if (item.shape === 'triangle') { context.moveTo(width / 2, 0); context.lineTo(width, height); context.lineTo(0, height); context.closePath(); }
    else if (item.shape === 'star') { for (let index = 0; index < 10; index++) { const angle = index * Math.PI / 5 - Math.PI / 2; const radius = index % 2 ? .22 : .5; const x = width / 2 + Math.cos(angle) * width * radius; const y = height / 2 + Math.sin(angle) * height * radius; if (!index) context.moveTo(x, y); else context.lineTo(x, y); } context.closePath(); }
    else { context.moveTo(0, height / 2); context.lineTo(width, height / 2); if (item.shape === 'arrow') { context.moveTo(width * .8, height * .2); context.lineTo(width, height / 2); context.lineTo(width * .8, height * .8); } }
    context.fillStrokeShape(shape);
  } });
}
