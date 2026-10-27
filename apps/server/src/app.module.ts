import { Module, type DynamicModule } from '@nestjs/common';
import { AppController } from './app.controller';
import { StorageService } from './storage.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { CodexController } from './codex.controller';
import { CodexCliProvider } from '@photo-studio/ai-provider';
import { resolve } from 'node:path';
import { AgentController } from './agent.controller';
import { AGENT_MODEL_PROVIDER, AgentService } from './agent.service';
import { ProductImageController } from './product-image.controller';
import { PRODUCT_IMAGE_TOOL, ProductImageService } from './product-image.service';
import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';
import { EditorController } from './editor.controller';
import { EditorService } from './editor.service';
import { ImageEngineService } from './image-engine.service';
import { ImageEngineController } from './image-engine.controller';
import { AgentExecutionService } from './agent-execution.service';
import { AgentExecutionController } from './agent-execution.controller';
import { ImageToolService } from './image-tool.service';
import { ImageToolController } from './image-tool.controller';
import { PresetsController } from './presets.controller';
import { PresetsService } from './presets.service';
import { CodexCallQueue, QueuedModelProvider } from './codex-call-queue';
import { CodexModelService } from './codex-model.service';

@Module({
  controllers: [AppController, ProjectsController, CodexController, AgentController, ProductImageController, CommerceController, EditorController, ImageEngineController, AgentExecutionController, ImageToolController, PresetsController],
  providers: [StorageService, ProjectsService, AgentService, ProductImageService, CommerceService, EditorService, ImageEngineService, AgentExecutionService, ImageToolService, PresetsService, { provide: CodexModelService, useFactory: () => new CodexModelService() }, { provide: PRODUCT_IMAGE_TOOL, inject: [ImageEngineService], useFactory: (engine: ImageEngineService) => engine.render.bind(engine) }, {
    provide: AGENT_MODEL_PROVIDER,
    inject: [StorageService, CodexModelService],
    useFactory: (storage: StorageService, models: CodexModelService) => new CodexCliProvider(resolve(storage.dataDirectory, 'runs'), () => models.selected())
  }]
})
export class AppModule {
  static forWorkspace(directory: string, queue: CodexCallQueue, models: CodexModelService): DynamicModule {
    return {
      module: AppModule,
      providers: [
        { provide: 'PHOTO_STUDIO_DATA_DIRECTORY', useValue: directory },
        { provide: CodexModelService, useValue: models },
        { provide: AGENT_MODEL_PROVIDER, inject: [StorageService], useFactory: (storage: StorageService) => new QueuedModelProvider(new CodexCliProvider(resolve(storage.dataDirectory, 'runs'), () => models.selected()), queue) }
      ]
    };
  }
}
