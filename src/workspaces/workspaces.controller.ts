import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WorkspacesService } from './workspaces.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators';
import { WorkspaceType } from '@prisma/client';

@ApiTags('Workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @ApiOperation({ summary: 'Get user memberships and workspaces' })
  @Get()
  async getWorkspaces(@CurrentUser('id') userId: string) {
    return this.workspacesService.getUserWorkspaces(userId);
  }

  @ApiOperation({ summary: 'Create new workspace' })
  @Post()
  async createWorkspace(
    @CurrentUser('id') userId: string,
    @Body() body: { name: string; type: WorkspaceType },
  ) {
    return this.workspacesService.createWorkspace(userId, body);
  }

  @ApiOperation({ summary: 'Update workspace details' })
  @Patch(':id')
  async updateWorkspace(
    @CurrentUser('id') userId: string,
    @Param('id') workspaceId: string,
    @Body() body: { name?: string },
  ) {
    return this.workspacesService.updateWorkspace(userId, workspaceId, body);
  }
}

