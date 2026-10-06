import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { EditorService } from './editor.service';
@Controller('editor')
export class EditorController {
  constructor(@Inject(EditorService) private readonly editor: EditorService) {}
  @Post('documents') open(@Body('resultId') resultId: unknown) { return this.editor.open(resultId); }
  @Get('documents/:id') document(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.editor.document(id); }
  @Patch('documents/:id') save(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() content: unknown) { return this.editor.save(id, content); }
  @Get('scenes/:sessionId') scene(@Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string) { return this.editor.scene(sessionId); }
  @Patch('scenes/:sessionId') saveScene(@Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string, @Body() content: unknown) { return this.editor.saveScene(sessionId, content); }
}
