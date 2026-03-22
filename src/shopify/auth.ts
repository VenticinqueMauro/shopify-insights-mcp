const DEFAULT_API_VERSION = '2025-01';

export function getShopifyCredentials() {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION ?? DEFAULT_API_VERSION;
  const maxRecords = parseInt(process.env.SHOPIFY_MAX_RECORDS ?? '1000', 10);
  if (!domain || !token) {
    throw new Error('Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ACCESS_TOKEN env vars');
  }
  return { domain, token, apiVersion, maxRecords };
}
