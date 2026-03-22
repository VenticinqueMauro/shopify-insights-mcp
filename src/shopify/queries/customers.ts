export const CUSTOMERS_QUERY = `
  query GetCustomers($query: String) {
    customers(first: 250, query: $query) {
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
