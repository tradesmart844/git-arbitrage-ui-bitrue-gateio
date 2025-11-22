import {
  EpochTime,
  OrderId,
  OrderStatus,
  OrderType,
  Price,
  Quantity,
  TransactionType,
} from '../helpers/enums';
import { ISymbol } from './symbol-interface';

export interface IOrder {
  symbol: ISymbol;
  orderId: OrderId;
  transactionType: TransactionType;
  orderType: OrderType;
  quantity: Quantity;
  price: Price;
  filledQuantity: Quantity;
  averagePrice: Price;
  orderTime: EpochTime;
  lastUpdateTime: EpochTime;
  orderStatus: OrderStatus;
  otherQuantity: Quantity;
  clientOrderId?: string;
  getUniqueKey(): string;
  magicNumber: string;
}
