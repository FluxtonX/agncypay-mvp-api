import { configuredOrigins, isOriginAllowed } from './cors';

describe('CORS policy', () => {
  it('allows only configured browser origins', () => {
    const origins = configuredOrigins(
      'https://brand.example, https://agency.example',
    );
    expect(isOriginAllowed('https://brand.example', origins, true)).toBe(true);
    expect(isOriginAllowed('https://evil.example', origins, true)).toBe(false);
  });

  it('allows originless native and server-to-server requests', () => {
    expect(isOriginAllowed(undefined, [], true)).toBe(true);
  });

  it('does not honor wildcard origins in production', () => {
    expect(isOriginAllowed('https://anything.example', ['*'], true)).toBe(
      false,
    );
    expect(isOriginAllowed('http://localhost:9999', ['*'], false)).toBe(true);
  });
});
