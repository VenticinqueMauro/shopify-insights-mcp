export const ORDERS_BY_DATE_RANGE = `
  query GetOrdersByDateRange($query: String!) {
    orders(first: 250, query: $query) {
      edges {
        node {
          id
          name
          processedAt
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          lineItems(first: 50) {
            edges {
              node {
                quantity
                originalUnitPriceSet {
                  shopMoney { amount currencyCode }
                }
                product {
                  id
                  title
                  vendor
                  productType
                }
              }
            }
          }
          customer { id }
          displayFinancialStatus
          displayFulfillmentStatus
        }
      }
    }
  }
`;
