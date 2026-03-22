import { getShopifyCredentials } from './auth.js';

interface Connection<TEdge> {
  edges: TEdge[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export async function shopifyQuery<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { domain, token, apiVersion } = getShopifyCredentials();
  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;

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

export async function fetchAllPages<TEdge>(
  query: string,
  variables: Record<string, unknown>,
  getConnection: (data: unknown) => Connection<TEdge>,
  maxRecords?: number
): Promise<{ edges: TEdge[]; truncated: boolean }> {
  const resolvedMax = maxRecords ?? getShopifyCredentials().maxRecords;
  const allEdges: TEdge[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let truncated = false;

  while (hasNextPage && allEdges.length < resolvedMax) {
    const vars = cursor ? { ...variables, cursor } : variables;
    const data = await shopifyQuery<unknown>(query, vars);
    const connection = getConnection(data);

    allEdges.push(...connection.edges);
    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;

    if (allEdges.length >= resolvedMax) {
      truncated = true;
      break;
    }
  }

  return { edges: allEdges.slice(0, resolvedMax), truncated };
}
