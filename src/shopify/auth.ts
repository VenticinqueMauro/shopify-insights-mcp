export function getShopifyCredentials() {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) {
    throw new Error('Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ACCESS_TOKEN env vars');
  }
  return { domain, token };
}
