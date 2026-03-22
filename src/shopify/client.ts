import fetch from 'node-fetch';
import { getShopifyCredentials } from './auth.js';

export async function shopifyQuery<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { domain, token } = getShopifyCredentials();
  const url = `https://${domain}/admin/api/2024-01/graphql.json`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
  }

  return json.data as T;
}
