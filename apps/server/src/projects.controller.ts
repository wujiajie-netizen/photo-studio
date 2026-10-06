import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
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

  @Patch(':id')
  rename(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body('name') name: unknown) {
    return this.projects.rename(id, name);
  }
}
