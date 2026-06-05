import { describe, it, expect } from 'vitest';
import { vendorProductLabel, vendorIsRedundant } from './vendorProduct';

describe('vendorProductLabel / vendorIsRedundant', () => {
  it('collapses when the product name equals the vendor name', () => {
    const p = { vendor_name: 'Proofpoint', name: 'Proofpoint' };
    expect(vendorIsRedundant(p)).toBe(true);
    expect(vendorProductLabel(p)).toBe('Proofpoint');
  });

  it('collapses when the product name already leads with the vendor', () => {
    const p = { vendor_name: 'Devo', name: 'Devo Platform' };
    expect(vendorIsRedundant(p)).toBe(true);
    expect(vendorProductLabel(p)).toBe('Devo Platform');
  });

  it('keeps "Vendor Product" when they differ', () => {
    const p = { vendor_name: 'Palo Alto Networks', name: 'Prisma Access' };
    expect(vendorIsRedundant(p)).toBe(false);
    expect(vendorProductLabel(p)).toBe('Palo Alto Networks Prisma Access');
  });

  it('is case-insensitive and prepends the vendor for distinct generic names', () => {
    expect(vendorProductLabel({ vendor_name: 'Okta', name: 'okta' })).toBe('okta');
    expect(vendorProductLabel({ vendor_name: 'Aryaka', name: 'SD-WAN' })).toBe('Aryaka SD-WAN');
  });

  it('requires a word boundary — a substring prefix is NOT redundant', () => {
    // "Splunk" is a prefix of "Splunkbase" but not a whole-word lead, so keep both.
    const p = { vendor_name: 'Splunk', name: 'Splunkbase' };
    expect(vendorIsRedundant(p)).toBe(false);
    expect(vendorProductLabel(p)).toBe('Splunk Splunkbase');
  });

  it('falls back gracefully when a half is missing', () => {
    expect(vendorProductLabel({ vendor_name: '', name: 'Falcon' })).toBe('Falcon');
    expect(vendorProductLabel({ vendor_name: 'Cisco', name: '' })).toBe('Cisco');
  });
});
