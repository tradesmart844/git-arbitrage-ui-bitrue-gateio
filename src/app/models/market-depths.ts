import {
  Price,
  Quantity,
  Segment,
  Token,
  TradeInterface,
  TransactionType,
} from '../helpers/enums';

export class MarketDepthInfo {
  price: Price;
  quantity: Quantity;
  totalOrders: Quantity;

  constructor(price: Price, quantity: Quantity, totalOrders: Quantity) {
    this.price = price;
    this.quantity = quantity;
    this.totalOrders = totalOrders;
  }

  static empty() {
    return new MarketDepthInfo(0, 0, 0);
  }
}

export class MarketDepths {
  symbol: Token;
  bids: MarketDepthInfo[];
  asks: MarketDepthInfo[];
  token: Token;
  segment: Segment;
  tradeInterface: TradeInterface;

  constructor(
    symbol: Token,
    segment: Segment,
    tradeInterface: TradeInterface,
    bids: MarketDepthInfo[],
    asks: MarketDepthInfo[]
  ) {
    this.symbol = symbol;
    this.bids = bids;
    this.asks = asks;
    this.token = symbol;
    this.segment = segment;
    this.tradeInterface = tradeInterface;
  }

  getBestPriceByQuantity(
    transactionType: TransactionType,
    orderQuantity: Quantity,
    calculateSellQuantityValue: number = 0
  ) {
    let quantityAtPrice = 0;

    switch (transactionType) {
      case TransactionType.Buy:
        {
          quantityAtPrice = 0;

          for (let i = 0; i < this.asks.length; i++) {
            quantityAtPrice = quantityAtPrice + this.asks[i].quantity;

            if (quantityAtPrice > orderQuantity) {
              return this.asks[i].price;
            }
          }

          if (this.asks.length > 0) {
            return this.asks[this.asks.length - 1].price;
          }
        }
        break;
      case TransactionType.Sell:
        {
          quantityAtPrice = 0;

          for (let i = 0; i < this.bids.length; i++) {
            quantityAtPrice = quantityAtPrice + this.bids[i].quantity;

            if (quantityAtPrice > orderQuantity) {
              return this.bids[i].price;
            }
          }

          if (this.bids.length > 0) {
            return this.bids[this.bids.length - 1].price;
          }
        }
        break;
    }

    return 0;
  }

  getBestSellPrice(): MarketDepthInfo {
    if (this.asks.length > 0) {
      return this.asks[0];
    } else {
      return MarketDepthInfo.empty();
    }
  }

  getBestBuyPrice(): MarketDepthInfo | null {
    if (this.bids.length > 0) {
      return this.bids[0];
    }

    return null;
  }

  static empty(
    symbol: Token,
    segment: Segment,
    tradeInterface: TradeInterface
  ) {
    return new MarketDepths(symbol, segment, tradeInterface, [], []);
  }
}
