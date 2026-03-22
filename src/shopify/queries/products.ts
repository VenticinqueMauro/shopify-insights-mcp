export const PRODUCTS_QUERY = `
  query GetProducts($query: String) {
    products(first: 250, query: $query) {
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
