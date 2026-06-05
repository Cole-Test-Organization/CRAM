// Display helpers for vendor products.
//
// A vendor product is stored as (vendor_name, name). Many vendors are
// single-product, so the product name equals the vendor name (Proofpoint /
// "Proofpoint", CyberArk / "CyberArk", Tenable / "Tenable"), and some product
// names already lead with the vendor (Devo / "Devo Platform"). Blindly
// concatenating `${vendor_name} ${name}` then renders "Proofpoint Proofpoint"
// or "Devo Devo Platform". These helpers collapse the redundant vendor prefix
// so the label reads naturally — without touching the underlying data.

type Labelable = { vendor_name: string; name: string };

// True when prepending the vendor name would be redundant — i.e. the product
// name already IS the vendor, or already starts with it.
export function vendorIsRedundant(p: Labelable): boolean {
  const vendor = (p.vendor_name || '').trim().toLowerCase();
  const name = (p.name || '').trim().toLowerCase();
  return !!vendor && (name === vendor || name.startsWith(vendor + ' '));
}

// "Vendor Product" with the vendor prefix dropped when it would just repeat the
// product name. Falls back to whichever half is present.
export function vendorProductLabel(p: Labelable): string {
  const vendor = (p.vendor_name || '').trim();
  const name = (p.name || '').trim();
  if (!vendor) return name;
  if (!name) return vendor;
  return vendorIsRedundant(p) ? name : `${vendor} ${name}`;
}
