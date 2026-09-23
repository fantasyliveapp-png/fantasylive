/**
 * geoip-lite no publica tipos propios ni existe @types/geoip-lite.
 * Se declara solo la superficie que usa src/lib/geo.ts.
 */
declare module 'geoip-lite' {
  export interface GeoIpLookup {
    range: [number, number];
    country: string;
    region: string;
    eu: '0' | '1';
    timezone: string;
    city: string;
    ll: [number, number];
    metro: number;
    area: number;
  }

  export function lookup(ip: string): GeoIpLookup | null;

  const geoip: { lookup: typeof lookup };
  export default geoip;
}
