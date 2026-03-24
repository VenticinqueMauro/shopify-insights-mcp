import { shopifyQuery } from './client.js';
import type { ShopContext } from '../types/shopify.js';

let _shopContext: ShopContext | null = null;

export async function getShopContext(): Promise<ShopContext> {
  if (_shopContext) return _shopContext;
  const data = await shopifyQuery<{ shop: ShopContext }>(`
    query {
      shop {
        currencyCode
        ianaTimezone
      }
    }
  `);
  const envTimezone = process.env.SHOPIFY_TIMEZONE;
  _shopContext = envTimezone
    ? { ...data.shop, ianaTimezone: envTimezone }
    : data.shop;
  return _shopContext;
}

/** Reset cached shop context — for test use only. */
export function resetShopContextCache(): void {
  _shopContext = null;
}
