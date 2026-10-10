import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from '../../src/calendar/registry.js';
import { AdapterNotFoundError } from '../../src/calendar/errors.js';
import { GregorianAdapter } from '../../src/calendar/adapters/gregorian.js';
import { createTimezoneService } from '../../src/calendar/timezone.js';

const tz = createTimezoneService();

describe('AdapterRegistry', () => {
  it('registers and retrieves adapters', () => {
    const r = new AdapterRegistry();
    r.register(new GregorianAdapter(tz));
    expect(r.has('gregorian')).toBe(true);
    expect(r.get('gregorian').id).toBe('gregorian');
  });

  it('lets a third-party override a built-in', () => {
    const r = new AdapterRegistry();
    r.register(new GregorianAdapter(tz));
    const fake: any = { id: 'gregorian', name: 'Gregorian (custom)' };
    r.register(fake);
    expect(r.get('gregorian').name).toBe('Gregorian (custom)');
  });

  it('throws AdapterNotFoundError for unknown ids', () => {
    const r = new AdapterRegistry();
    expect(() => r.get('tibetan')).toThrow(AdapterNotFoundError);
  });

  it('lists and unregisters', () => {
    const r = new AdapterRegistry();
    r.register(new GregorianAdapter(tz));
    r.register(new GregorianAdapter(tz)); // duplicate id is fine
    expect(r.list().length).toBe(1);
    expect(r.unregister('gregorian')).toBe(true);
    expect(r.has('gregorian')).toBe(false);
  });
});
