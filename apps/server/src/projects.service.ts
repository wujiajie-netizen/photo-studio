import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getProjectNameError, type Project } from '@photo-studio/shared';
import { StorageService } from './storage.service';

const columns = 'id, name, created_at AS createdAt, updated_at AS updatedAt';

@Injectable()
export class ProjectsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  list(): Project[] {
    return this.storage.database.prepare(`SELECT ${columns} FROM projects ORDER BY updated_at DESC, id ASC`).all() as unknown as Project[];
  }

  findOne(id: string): Project {
    const project = this.storage.database.prepare(`SELECT ${columns} FROM projects WHERE id = ?`).get(id);
    if (!project) throw new NotFoundException('项目不存在。');
    return project as unknown as Project;
  }

  create(input: unknown): Project {
    const name = this.normalizeName(input);
    const timestamp = new Date().toISOString();
    const project: Project = { id: randomUUID(), name, createdAt: timestamp, updatedAt: timestamp };
    this.storage.database.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.createdAt, project.updatedAt);
    return project;
  }

  rename(id: string, input: unknown): Project {
    const name = this.normalizeName(input);
    const project = this.findOne(id);
    const updatedAt = new Date().toISOString();
    this.storage.database.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, updatedAt, id);
    return { ...project, name, updatedAt };
  }

  private normalizeName(input: unknown): string {
    const error = getProjectNameError(input);
    if (error) throw new BadRequestException(error);
    return (input as string).trim();
  }
}
