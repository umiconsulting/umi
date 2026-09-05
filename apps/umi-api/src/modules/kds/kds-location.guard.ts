import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.types';
import { KdsRepository } from './kds.repository';
import { canSwitchLocations } from '../auth/location-authority';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class KdsLocationGuard implements CanActivate {
  constructor(private readonly repository: KdsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.authUser;
    const access = request.merchantAccess;
    if (!user || !access) throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    const switchAllowed = canSwitchLocations(access);

    // The five KDS resources a route can name, and the ONLY params that count as
    // one. The merchant identifier is not a resource: every route on this guard is
    // declared under `/merchants/:merchantId` or `/:merchantRef`, so reading it as
    // one made `hasResourceId` true on all 21 of them. The lookup below then found
    // nothing, and `kitchen_scope_denied` fired before the merchant-scope branch
    // could grant a merchant-wide read — 12 routes answered 403 to every caller,
    // whatever they held. One object now feeds the lookup AND the test, so the two
    // cannot disagree again.
    const resourceIds = {
      stationId: request.params?.stationId,
      routeId: request.params?.routeId,
      deviceId: request.params?.deviceId,
      pairingId: request.params?.pairingId,
      ticketId: request.params?.ticketId,
    };
    const resource = await this.repository.dashboardResourceLocation(
      access.merchantId,
      resourceIds,
    );

    const values = [
      request.params?.locationId,
      request.query?.locationId,
      request.body?.locationId,
    ];
    const requestedLocation = values.find(
      (value): value is string => typeof value === 'string' && UUID_RE.test(value),
    );
    const hasResourceId = Object.values(resourceIds).some(
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
    if (!locationId) {
      if (switchAllowed && access.permissions.includes('kitchen.merchant.read')) return true;
      throw new ForbiddenException({ error: 'kitchen_location_required' });
    }
    if (switchAllowed) {
      if (!(await this.repository.merchantLocationExists(access.merchantId, locationId))) {
        throw new ForbiddenException({ error: 'kitchen_scope_denied' });
      }
      return true;
    }
    if (!(await this.repository.dashboardLocationAllowed(user.id, access.merchantId, locationId))) {
      throw new ForbiddenException({ error: 'kitchen_scope_denied' });
    }
    return true;
  }
}
