import { Module } from '@nestjs/common';
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

@Module({
  controllers: [AppController, ProjectsController, CodexController, AgentController, ProductImageController, CommerceController, EditorController, ImageEngineController, AgentExecutionController, ImageToolController],
  providers: [StorageService, ProjectsService, AgentService, ProductImageService, CommerceService, EditorService, ImageEngineService, AgentExecutionService, ImageToolService, { provide: PRODUCT_IMAGE_TOOL, inject: [ImageEngineService], useFactory: (engine: ImageEngineService) => engine.render.bind(engine) }, {
    provide: AGENT_MODEL_PROVIDER,
    inject: [StorageService],
    useFactory: (storage: StorageService) => new CodexCliProvider(resolve(storage.dataDirectory, 'runs'))
  }]
})
export class AppModule {}
