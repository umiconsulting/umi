import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.types';
import { KdsRepository } from './kds.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class KdsLocationGuard implements CanActivate {
  constructor(private readonly repository: KdsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.authUser;
    const access = request.merchantAccess;
    if (!user || !access) throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    if (access.permissions.includes('kitchen.merchant.read')) return true;

    const resource = await this.repository.dashboardResourceLocation(access.merchantId, {
      stationId: request.params?.stationId,
      routeId: request.params?.routeId,
      deviceId: request.params?.deviceId,
      pairingId: request.params?.pairingId,
      ticketId: request.params?.ticketId,
    });

    const values = [
      request.params?.locationId,
      request.query?.locationId,
      request.body?.locationId,
    ];
    const requestedLocation = values.find(
      (value): value is string => typeof value === 'string' && UUID_RE.test(value),
    );
    const hasResourceId = Object.values(request.params ?? {}).some(
      (value) => typeof value === 'string' && value.length > 0,
    );
    if (hasResourceId && !resource.found) {
      throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    }
    if (resource.found && !resource.locationId) {
      throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    }
    if (resource.locationId && requestedLocation && resource.locationId !== requestedLocation) {
      throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    }
    const locationId = resource.locationId ?? requestedLocation;
    if (!locationId) throw new ForbiddenException({ error: 'kitchen_location_required' });
    if (!(await this.repository.dashboardLocationAllowed(user.id, access.merchantId, locationId))) {
      throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    }
    return true;
  }
}
