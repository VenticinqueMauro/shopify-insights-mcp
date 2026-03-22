export const PRODUCTS_QUERY = `
  query GetProducts($query: String, $cursor: String) {
    products(first: 250, query: $query, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          vendor
          productType
          status
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                inventoryQuantity
              }
            }
          }
        }
      }
    }
  }
`;
