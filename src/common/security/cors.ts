export function configuredOrigins(value?: string): string[] {
  return (value || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: string[],
  production = process.env.NODE_ENV === 'production',
): boolean {
  // Native mobile clients and server-to-server calls do not send Origin.
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // A wildcard is convenient for local development but unsafe with credentials in production.
  if (!production && allowedOrigins.includes('*')) return true;
  return false;
}
