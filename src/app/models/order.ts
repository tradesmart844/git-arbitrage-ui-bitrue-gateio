import {
  OrderId,
  OrderStatus,
  OrderType,
  Segment,
  SymbolType,
  TradeInterface,
  TransactionType,
} from '../helpers/enums';
import { HelperUtil } from '../helpers/helper-util';
import { IOrder } from '../interfaces/order-interface';
import { ISymbol } from '../interfaces/symbol-interface';
import { Symbol } from './symbol';
import { SymbolCrypto } from './symbol-crypto';

export class Order implements IOrder {
  symbol: ISymbol;
  orderId: OrderId;
  transactionType: TransactionType;
  orderType: OrderType;
  quantity: number;
  price: number;
  filledQuantity: number;
  averagePrice: number;
  orderTime: number;
  lastUpdateTime: number;
  orderStatus: OrderStatus;
  otherQuantity: number;
  magicNumber: string;
  clientOrderId?: string;

  constructor(
    symbol: ISymbol,
    orderId: OrderId,
    transactionType: TransactionType,
    orderType: OrderType,
    quantity: number,
    price: number,
    filledQuantity: number,
    averagePrice: number,
    orderTime: number,
    lastUpdateTime: number,
    orderStatus: OrderStatus,
    otherQuantity: number,
    magicNumber: string = '',
    clientOrderId?: string
  ) {
    this.symbol = symbol;
    this.orderId = orderId;
    this.transactionType = transactionType;
    this.orderType = orderType;
    this.quantity = quantity;
    this.price = price;
    this.filledQuantity = filledQuantity;
    this.averagePrice = averagePrice;
    this.orderTime = orderTime;
    this.lastUpdateTime = lastUpdateTime;
    this.orderStatus = orderStatus;
    this.otherQuantity = otherQuantity;
    this.magicNumber = magicNumber;
    this.clientOrderId = clientOrderId;
  }

  getUniqueKey() {
    return `${this.symbol.GetUniqueKey()}-${this.orderId}`;
  }

  static getUniqueKey(
    tradeInterface: TradeInterface,
    segment: Segment,
    token: string,
    orderId: string
  ) {
    return `${Symbol.GetUniqueKey(tradeInterface, segment, token)}-${orderId}`;
  }

  static getOrder(order: Order): Order {
    let symbol: ISymbol = order.symbol;

    switch (symbol.type) {
      case SymbolType.CRYPTO:
        symbol = HelperUtil.getSymbol(symbol);
        break;

      default:
        symbol = HelperUtil.getSymbol(symbol);
        break;
    }

    return new Order(
      symbol,
      order.orderId,
      order.transactionType,
      order.orderType,
      order.quantity,
      order.price,
      order.filledQuantity,
      order.averagePrice,
      order.orderTime,
      order.lastUpdateTime,
      order.orderStatus,
      order.otherQuantity,
      order.magicNumber,
      order.clientOrderId
    );
  }
}
