export interface LocalHealth {
  status: 'ready';
  storage: 'sqlite';
  dataDirectory: string;
}

export interface CodexStatus {
  status: 'ready' | 'missing' | 'not_logged_in' | 'unsupported' | 'error';
  version: string | null;
  message: string;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductAsset {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface ProductImageParameters {
  sourceAssetId: string | null;
  subject: 'keep' | 'trim';
  scene: 'white' | 'warm' | 'cool';
  description: string;
  ratio: '1:1' | '3:4' | '4:3' | '9:16';
  count: number;
  quality: 'standard' | 'high';
}

export interface ProductImageTask {
  id: string;
  parameters: ProductImageParameters;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface ProductImageResult {
  id: string;
  taskId: string;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  projectId: string | null;
}

export const PRODUCT_UPLOAD_LIMIT = 20 * 1024 * 1024;

export type TaskStatus = ProductImageTask['status'];
export type CommerceKind = 'product-kit' | 'detail-page';
export interface CommerceSection {
  type: 'hero' | 'features' | 'usage' | 'specification' | 'comparison';
  title: string;
  content: string;
}
export interface CommerceParameters {
  sourceAssetId: string | null;
  subject: ProductImageParameters['subject'];
  scene: ProductImageParameters['scene'];
  ratio: ProductImageParameters['ratio'];
  quality: ProductImageParameters['quality'];
  productName: string;
  platform: 'general' | 'taobao' | 'jd' | 'amazon' | 'shopify';
  region: 'CN' | 'US' | 'GB' | 'EU' | 'JP';
  language: 'zh-CN' | 'en-US' | 'ja-JP' | 'de-DE';
  sellingPoints: string[];
  sections: CommerceSection[];
  brand?: BrandStyle | null;
}
export interface CommerceItem {
  id: string;
  index: number;
  title: string;
  status: TaskStatus;
  error: string | null;
  resultId: string | null;
}
export interface CommerceTask {
  id: string;
  kind: CommerceKind;
  parameters: CommerceParameters;
  status: TaskStatus;
  progress: number;
  items: CommerceItem[];
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export function validateCommerceParameters(value: unknown): CommerceParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写商品和模块参数。');
  const parameters = value as CommerceParameters;
  if (Object.keys(parameters).length !== 11 + Number(Object.hasOwn(parameters, 'brand'))) throw new Error('商品和模块参数包含未知或缺少字段。');
  if (parameters.brand !== undefined && parameters.brand !== null) validateBrandStyle(parameters.brand);
  validateProductImageParameters({ sourceAssetId: parameters.sourceAssetId, subject: parameters.subject, scene: parameters.scene, ratio: parameters.ratio, quality: parameters.quality, description: '', count: 1 });
  if (typeof parameters.productName !== 'string' || !parameters.productName.trim() || [...parameters.productName].length > 80) throw new Error('商品名称为 1 到 80 个字符。');
  if (!['general', 'taobao', 'jd', 'amazon', 'shopify'].includes(parameters.platform) || !['CN', 'US', 'GB', 'EU', 'JP'].includes(parameters.region) || !['zh-CN', 'en-US', 'ja-JP', 'de-DE'].includes(parameters.language)) throw new Error('平台、地区或语言无效。');
  if (!Array.isArray(parameters.sellingPoints) || parameters.sellingPoints.length > 8 || !parameters.sellingPoints.every((point) => typeof point === 'string' && !!point.trim() && [...point].length <= 200)) throw new Error('最多填写 8 条卖点，每条不超过 200 个字符。');
  if (!Array.isArray(parameters.sections) || parameters.sections.length < 1 || parameters.sections.length > 8) throw new Error('请选择 1 到 8 个图片模块。');
  for (const section of parameters.sections) {
    if (!section || typeof section !== 'object' || Object.keys(section).length !== 3 || !['hero', 'features', 'usage', 'specification', 'comparison'].includes(section.type) || typeof section.title !== 'string' || !section.title.trim() || [...section.title].length > 80 || typeof section.content !== 'string' || [...section.content].length > 600) throw new Error('模块类型、标题或内容无效，内容最多 600 个字符。');
    if (['specification', 'comparison'].includes(section.type) && !section.content.trim()) throw new Error('规格和对比模块必须填写已知的商品事实。');
  }
  return parameters;
}

export interface CommerceCopy { sellingPoints: string[]; sections: CommerceSection[] }

interface EditorLayerBase {
  id: string;
  type: 'image' | 'asset-image' | 'text' | 'shape' | 'path';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
}
export interface EditorImageAdjustments { brightness: number; contrast: number; saturation: number; blur: number }
export interface EditorImageLayer extends EditorLayerBase { type: 'image'; resultId: string; adjustments?: EditorImageAdjustments }
export interface EditorAssetImageLayer extends EditorLayerBase { type: 'asset-image'; assetId: string; matteSourceAssetId?: string; adjustments?: EditorImageAdjustments }
export const EDITOR_FONT_FAMILIES = Object.freeze(['Microsoft YaHei', 'SimSun', 'SimHei', 'KaiTi', 'Arial', 'Georgia', 'Times New Roman']);
export interface BrandStyle {
  fontFamily: string;
  primaryColor: string;
  textColor: string;
  backgroundColor: string;
  styleDescription: string;
}
export interface BrandPreset extends BrandStyle { id: string; name: string; createdAt: string; updatedAt: string }
export type BrandPresetInput = BrandStyle & { name: string };
export type CreationPresetInput =
  | { name: string; kind: 'product-image'; parameters: ProductImageParameters }
  | { name: string; kind: CommerceKind; parameters: CommerceParameters };
export type CreationPreset = CreationPresetInput & { id: string; createdAt: string; updatedAt: string };
export interface LocalImageToolsStatus { status: 'ready' | 'missing' | 'error'; message: string }
export interface LocalTaskSummary { groups: { kind: 'agent' | 'execution' | 'product-image' | 'commerce' | 'image-tool'; counts: Record<TaskStatus, number> }[] }

export function validateBrandStyle(value: unknown): BrandStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('品牌样式无效。');
  const style = value as BrandStyle;
  if (Object.keys(style).sort().join(',') !== 'backgroundColor,fontFamily,primaryColor,styleDescription,textColor' || !EDITOR_FONT_FAMILIES.includes(style.fontFamily) || ![style.primaryColor, style.textColor, style.backgroundColor].every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) || typeof style.styleDescription !== 'string' || [...style.styleDescription].length > 1000) throw new Error('请选择支持的字体和有效的品牌颜色，风格描述最多 1000 个字符。');
  return style;
}

export function validateBrandPresetInput(value: unknown): BrandPresetInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('品牌预设无效。');
  const { name, ...style } = value as BrandPresetInput;
  const error = getProjectNameError(name);
  if (error) throw new Error(error);
  validateBrandStyle(style);
  return { name: name.trim(), ...style };
}

export function validateCreationPresetInput(value: unknown): CreationPresetInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('创作方案无效。');
  const preset = value as CreationPresetInput;
  const error = getProjectNameError(preset.name);
  if (error) throw new Error(error);
  if (Object.keys(preset).sort().join(',') !== 'kind,name,parameters') throw new Error('创作方案包含未知或缺少字段。');
  if (preset.kind === 'product-image') validateProductImageParameters(preset.parameters);
  else if (preset.kind === 'product-kit' || preset.kind === 'detail-page') validateCommerceParameters(preset.parameters);
  else throw new Error('创作方案类型无效。');
  return { ...preset, name: preset.name.trim() };
}

export interface EditorTextLayer extends EditorLayerBase { type: 'text'; text: string; fontSize: number; fontFamily: string; fill: string; align: 'left' | 'center' | 'right'; fontStyle?: 'normal' | 'bold' | 'italic' | 'bold italic'; textDecoration?: '' | 'underline' | 'line-through'; letterSpacing?: number; lineHeight?: number; fillGradient?: { colors: [string, string]; angle: number } }
export interface EditorShapeLayer extends EditorLayerBase { type: 'shape'; shape: 'rectangle' | 'ellipse' | 'triangle' | 'star' | 'line' | 'arrow'; fill: string; stroke: string; strokeWidth: number }
export interface EditorPathLayer extends EditorLayerBase { type: 'path'; points: number[]; stroke: string; strokeWidth: number }
export type EditorLayer = EditorImageLayer | EditorAssetImageLayer | EditorTextLayer | EditorShapeLayer | EditorPathLayer;
export interface CreationScene { boards: { resultId: string; x: number; y: number }[]; viewport: { x: number; y: number; zoom: number }; selectedId: string | null; revision: number }
export interface EditorDocument {
  id: string;
  resultId: string;
  projectId: string | null;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: EditorLayer[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export type EditorContent = Pick<EditorDocument, 'name' | 'width' | 'height' | 'background' | 'layers'>;

export type ImageToolInput =
  | { operation: 'edit'; sourceAssetId: string; maskAssetId: string | null; prompt: string }
  | { operation: 'erase'; sourceAssetId: string; maskAssetId: string }
  | { operation: 'replace-text'; sourceAssetId: string; maskAssetId: string; text: string }
  | { operation: 'cutout'; sourceAssetId: string }
  | { operation: 'upscale'; sourceAssetId: string; scale: 2 | 4 }
  | { operation: 'expand'; sourceAssetId: string; width: number; height: number; x: number; y: number; prompt: string }
  | { operation: 'split-layers' | 'recognize-text'; sourceAssetId: string };
export interface ImageToolTask {
  id: string; sessionId: string; resultId: string; input: ImageToolInput; status: TaskStatus; progress: number;
  outputResultIds: string[]; outputLayers: EditorLayer[]; error: string | null; createdAt: string; updatedAt: string;
}
export function validateImageToolInput(value: unknown): ImageToolInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('图片工具参数无效。');
  const input = value as ImageToolInput;
  const uuid = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const text = (content: unknown) => typeof content === 'string' && [...content].length <= 1000;
  if (!uuid(input.sourceAssetId)) throw new Error('请选择有效的处理图片。');
  const keys = Object.keys(input).sort().join(',');
  if (input.operation === 'edit') {
    if (keys !== 'maskAssetId,operation,prompt,sourceAssetId' || input.maskAssetId !== null && !uuid(input.maskAssetId) || !text(input.prompt) || !input.prompt.trim()) throw new Error('请填写改图要求，并选择有效的涂抹区域。');
  } else if (input.operation === 'erase' || input.operation === 'replace-text') {
    if (keys !== (input.operation === 'erase' ? 'maskAssetId,operation,sourceAssetId' : 'maskAssetId,operation,sourceAssetId,text') || !uuid(input.maskAssetId) || input.operation === 'replace-text' && (!text(input.text) || !input.text.trim())) throw new Error('请涂抹需要处理的区域，并填写有效的替换文字。');
  } else if (input.operation === 'upscale') {
    if (keys !== 'operation,scale,sourceAssetId' || ![2, 4].includes(input.scale)) throw new Error('请选择 2 倍或 4 倍超清。');
  } else if (input.operation === 'expand') {
    if (keys !== 'height,operation,prompt,sourceAssetId,width,x,y' || !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > 16384 || input.height > 16384 || input.width * input.height > 16_000_000 || !Number.isInteger(input.x) || !Number.isInteger(input.y) || input.x < 0 || input.y < 0 || !text(input.prompt)) throw new Error('扩图尺寸、图片位置或说明无效，最多 1600 万像素。');
  } else if (!['cutout', 'split-layers', 'recognize-text'].includes(input.operation) || keys !== 'operation,sourceAssetId') throw new Error('图片工具类型或字段无效。');
  return input;
}

export function validateEditorContent(value: unknown): EditorContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('编辑内容无效。');
  const content = value as EditorContent;
  const size = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && number >= 1 && number <= 16384;
  const color = (text: unknown) => typeof text === 'string' && /^#[0-9a-f]{6}$/i.test(text);
  if (Object.keys(content).length !== 5 || typeof content.name !== 'string' || !content.name.trim() || [...content.name].length > 200 || !Number.isInteger(content.width) || !Number.isInteger(content.height) || !size(content.width) || !size(content.height) || content.width * content.height > 16_000_000 || content.background !== 'transparent' && !color(content.background)) throw new Error('名称、背景或画布尺寸无效，画布最多 1600 万像素。');
  if (!Array.isArray(content.layers) || content.layers.length > 50) throw new Error('最多使用 50 个图层。');
  const ids = new Set<string>();
  for (const layer of content.layers) {
    if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(layer.id) || ids.has(layer.id) || typeof layer.name !== 'string' || !layer.name.trim() || [...layer.name].length > 200 || !Number.isFinite(layer.x) || !Number.isFinite(layer.y) || Math.abs(layer.x) > 100000 || Math.abs(layer.y) > 100000 || !size(layer.width) || !size(layer.height) || !Number.isFinite(layer.rotation) || Math.abs(layer.rotation) > 360 || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean') throw new Error('图层位置、大小或状态无效。');
    ids.add(layer.id);
    if ((layer.type === 'image' || layer.type === 'asset-image') && layer.adjustments !== undefined) {
      const adjustment = layer.adjustments;
      if (!adjustment || Array.isArray(adjustment) || Object.keys(adjustment).length !== 4 || ![adjustment.brightness, adjustment.contrast, adjustment.saturation, adjustment.blur].every(Number.isFinite) || Math.abs(adjustment.brightness) > 1 || Math.abs(adjustment.contrast) > 100 || Math.abs(adjustment.saturation) > 2 || adjustment.blur < 0 || adjustment.blur > 30) throw new Error('图片调色参数无效。');
    }
    if (layer.type === 'image') {
      if (Object.keys(layer).length !== 12 + Number(Object.hasOwn(layer, 'adjustments')) || typeof layer.resultId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(layer.resultId)) throw new Error('图片图层必须使用已生成的图片编号。');
    } else if (layer.type === 'asset-image') {
      if (Object.keys(layer).length !== 12 + Number(Object.hasOwn(layer, 'adjustments')) + Number(Object.hasOwn(layer, 'matteSourceAssetId')) || typeof layer.assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(layer.assetId)) throw new Error('素材图层必须使用已上传的素材编号。');
      if (Object.hasOwn(layer, 'matteSourceAssetId') && (typeof layer.matteSourceAssetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(layer.matteSourceAssetId))) throw new Error('抠图修整必须明确引用原素材。');
    } else if (layer.type === 'text') {
      const optional = ['fontStyle', 'textDecoration', 'letterSpacing', 'lineHeight', 'fillGradient'].filter(key => Object.hasOwn(layer, key));
      if (layer.fillGradient !== undefined && (!layer.fillGradient || Array.isArray(layer.fillGradient) || Object.keys(layer.fillGradient).length !== 2 || !Array.isArray(layer.fillGradient.colors) || layer.fillGradient.colors.length !== 2 || !layer.fillGradient.colors.every(color) || !Number.isFinite(layer.fillGradient.angle) || layer.fillGradient.angle < 0 || layer.fillGradient.angle > 360)) throw new Error('文字渐变颜色或角度无效。');
      if (Object.keys(layer).length !== 16 + optional.length || typeof layer.text !== 'string' || [...layer.text].length > 2000 || !Number.isFinite(layer.fontSize) || layer.fontSize < 8 || layer.fontSize > 300 || !EDITOR_FONT_FAMILIES.includes(layer.fontFamily) || !color(layer.fill) || !['left', 'center', 'right'].includes(layer.align) || layer.fontStyle !== undefined && !['normal', 'bold', 'italic', 'bold italic'].includes(layer.fontStyle) || layer.textDecoration !== undefined && !['', 'underline', 'line-through'].includes(layer.textDecoration) || layer.letterSpacing !== undefined && (!Number.isFinite(layer.letterSpacing) || layer.letterSpacing < -20 || layer.letterSpacing > 100) || layer.lineHeight !== undefined && (!Number.isFinite(layer.lineHeight) || layer.lineHeight < .5 || layer.lineHeight > 5)) throw new Error('文字图层内容或格式无效。');
    } else if (layer.type === 'shape') {
      if (Object.keys(layer).length !== 15 || !['rectangle', 'ellipse', 'triangle', 'star', 'line', 'arrow'].includes(layer.shape) || layer.fill !== 'transparent' && !color(layer.fill) || layer.stroke !== 'transparent' && !color(layer.stroke) || !Number.isFinite(layer.strokeWidth) || layer.strokeWidth < 0 || layer.strokeWidth > 300) throw new Error('形状、颜色或边框无效。');
    } else if (layer.type === 'path') {
      if (Object.keys(layer).length !== 14 || !Array.isArray(layer.points) || layer.points.length < 4 || layer.points.length > 20000 || layer.points.length % 2 || layer.points.some(point => !Number.isFinite(point) || point < 0 || point > 16384) || !color(layer.stroke) || !Number.isFinite(layer.strokeWidth) || layer.strokeWidth < 1 || layer.strokeWidth > 300) throw new Error('画笔路径或笔刷格式无效。');
    } else throw new Error('图层类型无效。');
  }
  return content;
}
export const COMMERCE_COPY_SCHEMA = {
  type: 'object', properties: {
    sellingPoints: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 200 } },
    sections: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: {
      type: { type: 'string', enum: ['hero', 'features', 'usage', 'specification', 'comparison'] },
      title: { type: 'string', minLength: 1, maxLength: 80 }, content: { type: 'string', maxLength: 600 }
    }, required: ['type', 'title', 'content'], additionalProperties: false } }
  }, required: ['sellingPoints', 'sections'], additionalProperties: false
};

export function validateProductImageParameters(value: unknown): ProductImageParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写商品图参数。');
  const parameters = value as Record<string, unknown>;
  if (Object.keys(parameters).length !== 7 || parameters.sourceAssetId !== null && (typeof parameters.sourceAssetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parameters.sourceAssetId))) throw new Error('商品素材编号无效；纯文字创作请使用 null。');
  if (!['keep', 'trim'].includes(parameters.subject as string) || !['white', 'warm', 'cool'].includes(parameters.scene as string) || !['1:1', '3:4', '4:3', '9:16'].includes(parameters.ratio as string) || !['standard', 'high'].includes(parameters.quality as string)) throw new Error('主体处理、场景、比例或质量参数无效。');
  if (!Number.isInteger(parameters.count) || (parameters.count as number) < 1 || (parameters.count as number) > 4) throw new Error('每次生成数量为 1 到 4 张。');
  if (typeof parameters.description !== 'string' || [...parameters.description].length > 1000) throw new Error('创作描述最多 1000 个字符。');
  return value as ProductImageParameters;
}

export interface AgentSession {
  id: string;
  title: string;
  projectId: string | null;
  pinnedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCreationContext {
  sessionId: string;
  projectId: string;
  resultId: string | null;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  sessionId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export interface AgentResult {
  summary: string;
  questions: string[];
  plan: { title: string; description: string; tool: 'product-image' | 'product-kit' | 'detail-page' | null }[];
}

export const AGENT_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    questions: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } },
    plan: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 80 },
          description: { type: 'string', minLength: 1, maxLength: 1000 },
          tool: { type: ['string', 'null'], enum: ['product-image', 'product-kit', 'detail-page', null] }
        },
        required: ['title', 'description', 'tool'], additionalProperties: false
      }
    }
  },
  required: ['summary', 'questions', 'plan'], additionalProperties: false
};

export function validateAgentResult(value: unknown): AgentResult {
  const text = (item: unknown, limit: number) => typeof item === 'string' && !!item.trim() && [...item].length <= limit;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent 返回了无效的结构化结果。');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== 3 || !text(result.summary, 2000) || !Array.isArray(result.questions) || result.questions.length > 8 || !result.questions.every((question) => text(question, 500)) || !Array.isArray(result.plan) || result.plan.length > 12) throw new Error('Agent 返回了无效的结构化结果。');
  for (const step of result.plan) {
    if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).length !== 3 || !text(step.title, 80) || !text(step.description, 1000) || !['product-image', 'product-kit', 'detail-page', null].includes(step.tool)) throw new Error('Agent 返回了未通过校验的计划步骤。');
  }
  return value as AgentResult;
}

export const PROJECT_NAME_LIMIT = 80;

export type AgentTool = 'product-image' | CommerceKind;
export type AgentStepInput = { title: string; tool: 'product-image'; parameters: ProductImageParameters } | { title: string; tool: CommerceKind; parameters: CommerceParameters };
export interface AgentParameters { steps: AgentStepInput[] }
export const AGENT_PARAMETERS_SCHEMA = {
  type: 'object', properties: { steps: { type: 'array', minItems: 1, maxItems: 12, items: { anyOf: [
    { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, tool: { type: 'string', enum: ['product-image'] }, parameters: {
      type: 'object', properties: {
        sourceAssetId: { type: ['string', 'null'] }, subject: { type: 'string', enum: ['keep', 'trim'] }, scene: { type: 'string', enum: ['white', 'warm', 'cool'] },
        description: { type: 'string', maxLength: 1000 }, ratio: { type: 'string', enum: ['1:1', '3:4', '4:3', '9:16'] }, count: { type: 'integer', minimum: 1, maximum: 4 }, quality: { type: 'string', enum: ['standard', 'high'] }
      }, required: ['sourceAssetId', 'subject', 'scene', 'description', 'ratio', 'count', 'quality'], additionalProperties: false
    } }, required: ['title', 'tool', 'parameters'], additionalProperties: false },
    { type: 'object', properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, tool: { type: 'string', enum: ['product-kit', 'detail-page'] }, parameters: {
      type: 'object', properties: {
        sourceAssetId: { type: ['string', 'null'] }, subject: { type: 'string', enum: ['keep', 'trim'] }, scene: { type: 'string', enum: ['white', 'warm', 'cool'] },
        ratio: { type: 'string', enum: ['1:1', '3:4', '4:3', '9:16'] }, quality: { type: 'string', enum: ['standard', 'high'] }, productName: { type: 'string', minLength: 1, maxLength: 80 },
        platform: { type: 'string', enum: ['general', 'taobao', 'jd', 'amazon', 'shopify'] }, region: { type: 'string', enum: ['CN', 'US', 'GB', 'EU', 'JP'] }, language: { type: 'string', enum: ['zh-CN', 'en-US', 'ja-JP', 'de-DE'] },
        ...COMMERCE_COPY_SCHEMA.properties
      }, required: ['sourceAssetId', 'subject', 'scene', 'ratio', 'quality', 'productName', 'platform', 'region', 'language', 'sellingPoints', 'sections'], additionalProperties: false
    } }, required: ['title', 'tool', 'parameters'], additionalProperties: false }
  ] } } }, required: ['steps'], additionalProperties: false
};
export type AgentExecutionStep = AgentStepInput & { id: string; taskId: string | null; status: TaskStatus; observation: string; retryCount: number };
export interface AgentExecution {
  id: string;
  sessionId: string;
  planTaskId: string;
  projectId: string;
  status: TaskStatus;
  progress: number;
  steps: AgentExecutionStep[];
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

export function validateAgentStep(value: unknown): AgentStepInput {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3) throw new Error('执行步骤字段无效。');
  const step = value as AgentStepInput;
  if (typeof step.title !== 'string' || !step.title.trim() || [...step.title].length > 80) throw new Error('步骤标题无效。');
  if (step.tool === 'product-image') validateProductImageParameters(step.parameters);
  else if (step.tool === 'product-kit' || step.tool === 'detail-page') validateCommerceParameters(step.parameters);
  else throw new Error('执行步骤只能使用电商作图工具。');
  return step;
}

export function getProjectNameError(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) return '请输入项目名称。';
  if ([...name.trim()].length > PROJECT_NAME_LIMIT) return `项目名称最多 ${PROJECT_NAME_LIMIT} 个字符。`;
  return '';
}

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'member';
}

export interface AuthState {
  user: AuthUser | null;
  setupRequired: boolean;
}
