import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { seedSalesAnalysis } from '../../apps/umi-api/test/integration/sales-analysis-fixture.ts';

const require = createRequire(new URL('../../apps/umi-api/package.json', import.meta.url));
const { Pool } = require('pg');
const { SignJWT } = await import(require.resolve('jose'));
if (!process.env.JWT_SECRET) throw new Error('Set the local API JWT_SECRET.');

const databaseUrl = new URL(process.env.DATABASE_URL_WORKER);
if (
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/umi_sales_analysis'
) {
  throw new Error('Use the isolated local umi_sales_analysis database.');
}
const output = process.argv[2];
if (!output) throw new Error('Pass the output path for the local browser session.');
const pool = new Pool({ connectionString: databaseUrl.href });
try {
  const fixture = await seedSalesAnalysis(pool);
  await pool.query(
    `insert into umi.subscription(merchant_id,plan_id,status,current_period_end)
    select $1,id,'active',now()+interval '1 month' from umi.plan where key='pro'`,
    [fixture.merchant],
  );
  const token = await new SignJWT({
    sub: fixture.user,
    email: 'analysis@example.test',
    sid: fixture.session,
    device_id: null,
    typ: 'access',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('umi-api')
    .setAudience('umi-dashboard')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  writeFileSync(output, JSON.stringify({ ...fixture, token }), { mode: 0o600 });
  console.log('Local sales-analysis browser fixture created.');
} finally {
  await pool.end();
}
