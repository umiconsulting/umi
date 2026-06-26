import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'umi:isPublic';

/** Marks a route as not requiring authentication (login, refresh, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
