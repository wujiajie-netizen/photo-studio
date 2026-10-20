import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.projects.findOne(id);
  }

  @Post()
  create(@Body('name') name: unknown) {
    return this.projects.create(name);
  }

  @Post(':id/creation')
  creation(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body('resultId') resultId: unknown) {
    return this.projects.creation(id, resultId);
  }

  @Patch(':id')
  rename(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body('name') name: unknown) {
    return this.projects.rename(id, name);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.projects.remove(id);
  }

  @Delete(':id/results/:resultId')
  removeResult(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Param('resultId', new ParseUUIDPipe({ version: '4' })) resultId: string, @Body('deleteProjectWhenEmpty') deleteProjectWhenEmpty: unknown) {
    return this.projects.removeResult(id, resultId, deleteProjectWhenEmpty);
  }
}
