import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MerchantAccess } from '../auth/auth.types';
import { RolesRepository } from './roles.repository';

export interface RoleInput {
  name?: unknown;
  description?: unknown;
  permissionKeys?: unknown;
  expectedRevision?: unknown;
}

@Injectable()
export class RolesService {
  constructor(private readonly repo: RolesRepository) {}

  list(merchantId: string) {
    return this.repo.accessModel(merchantId);
  }

  async create(merchantId: string, actorUserId: string, body: RoleInput, access: MerchantAccess) {
    this.assertOwner(access);
    const input = await this.normalize(merchantId, body, access);
    const key = `custom-${slug(input.name)}-${cryptoSuffix()}`;
    try {
      const id = await this.repo.create(merchantId, actorUserId, { key, ...input });
      return this.repo.find(merchantId, id);
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async update(
    merchantId: string,
    roleId: string,
    actorUserId: string,
    body: RoleInput,
    access: MerchantAccess,
  ) {
    this.assertOwner(access);
    const current = await this.repo.find(merchantId, roleId);
    if (!current) throw new NotFoundException('Role not found');
    if (current.isSystem) throw new ForbiddenException('The Owner role is protected');
    const input = await this.normalize(merchantId, body, access);
    const expectedRevision = Number(body.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new BadRequestException('expectedRevision is required');
    }
    const updated = await this.repo.update(merchantId, roleId, actorUserId, {
      ...input,
      expectedRevision,
    });
    if (!updated) throw new ConflictException('The role changed. Reload it and try again');
    return this.repo.find(merchantId, roleId);
  }

  async archive(
    merchantId: string,
    roleId: string,
    actorUserId: string,
    expectedRevision: number,
    access: MerchantAccess,
  ): Promise<void> {
    this.assertOwner(access);
    const result = await this.repo.archive(merchantId, roleId, actorUserId, expectedRevision);
    if (result === 'assigned') throw new ConflictException('Reassign the active staff first');
    if (result === 'conflict') throw new ConflictException('The role changed. Reload it and try again');
  }

  private async normalize(merchantId: string, body: RoleInput, access: MerchantAccess) {
    const name = String(body.name ?? '').trim();
    const description = String(body.description ?? '').trim() || null;
    if (name.length < 2 || name.length > 80) {
      throw new BadRequestException('name must contain 2 to 80 characters');
    }
    if (description && description.length > 300) {
      throw new BadRequestException('description must contain at most 300 characters');
    }
    if (!Array.isArray(body.permissionKeys) || body.permissionKeys.some((key) => typeof key !== 'string')) {
      throw new BadRequestException('permissionKeys must be an array of strings');
    }
    const permissionKeys = [...new Set(body.permissionKeys as string[])];
    const model = await this.repo.accessModel(merchantId);
    const catalog = new Set(
      model.permissions.filter((permission) => permission.delegable).map((permission) => permission.key),
    );
    const unknown = permissionKeys.filter((key) => !catalog.has(key));
    if (unknown.length) throw new BadRequestException(`Unknown permission: ${unknown[0]}`);
    if (!access.permissions.includes('*')) {
      const actorPermissions = new Set(access.permissions);
      const excessive = permissionKeys.filter((key) => !actorPermissions.has(key));
      if (excessive.length) {
        throw new ForbiddenException(`You cannot grant permission: ${excessive[0]}`);
      }
    }
    return { name, description, permissionKeys };
  }

  private assertOwner(access: MerchantAccess): void {
    if (!access.roles.some((role) => role === 'owner' || role === 'super_admin')) {
      throw new ForbiddenException('Only an Owner can manage roles');
    }
  }
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'role';
}

function cryptoSuffix(): string {
  return globalThis.crypto.randomUUID().slice(0, 6);
}
