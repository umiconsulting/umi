const deployedEnvironments = new Set(['staging', 'pilot', 'production']);

export function validateDashboardBuildConfig(env) {
  const errors = [];
  const environment = env.VITE_UMI_ENVIRONMENT;
  if (!['development', 'test', 'staging', 'pilot', 'production'].includes(environment)) {
    errors.push('VITE_UMI_ENVIRONMENT must be explicit.');
  }
  if (!deployedEnvironments.has(environment)) return errors;

  if (env.VITE_AUTH_MODE !== 'cookie') {
    errors.push('VITE_AUTH_MODE must be cookie outside development and test.');
  }
  for (const key of [
    'VITE_PUBLIC_URL',
    'VITE_RELEASE_VERSION',
    'VITE_RELEASE_GIT_COMMIT',
    'VITE_RELEASE_BUILD_TIMESTAMP',
    'VITE_CONTRACT_VERSION',
    'VITE_CONFIG_SCHEMA_VERSION',
  ]) {
    if (!env[key]) errors.push(`${key} is required.`);
  }
  for (const key of ['VITE_PUBLIC_URL', 'VITE_API_BASE']) {
    const value = env[key];
    if (value && !value.startsWith('https://')) errors.push(`${key} must use HTTPS.`);
  }
  if (env.VITE_RELEASE_GIT_COMMIT && !/^[0-9a-f]{40}$/.test(env.VITE_RELEASE_GIT_COMMIT)) {
    errors.push('VITE_RELEASE_GIT_COMMIT must be a full commit.');
  }
  return errors;
}
