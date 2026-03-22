export const CUSTOMERS_QUERY = `
  query GetCustomers($query: String, $cursor: String) {
    customers(first: 250, query: $query, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          firstName
          lastName
          email
          createdAt
          numberOfOrders
          amountSpent {
            amount
            currencyCode
          }
        }
      }
    }
  }
`;
