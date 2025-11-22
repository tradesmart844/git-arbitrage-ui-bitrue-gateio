import { Component, OnDestroy, OnInit } from '@angular/core';
import { TableModule } from 'primeng/table';
import { IOrder } from '../../interfaces/order-interface';
import {
  MessageTypes,
  OrderStatus,
  TradeInterface,
  TransactionType,
  OrderType,
  Segment,
} from '../../helpers/enums';
import { AppService } from '../../services/app.service';
import { OrderService } from '../../services/order.service';
import { MarketDataService } from '../../services/market-data.service';
import { Order } from '../../models/order';
import { MarketDataContainer } from '../../models/market-data-container';
import { MarketDepthInfo } from '../../models/market-depths';
import { from } from 'linq';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../../interfaces/message-data-interface';
import { Symbol } from '../../models/symbol';

@Component({
  selector: 'app-orderbook',
  templateUrl: './orderbook.component.html',
  styleUrl: './orderbook.component.css',
})
export class OrderbookComponent implements OnInit, OnDestroy {
  orders: Map<string, IOrder> = new Map<string, IOrder>();
  TradeInterface = TradeInterface;
  OrderStatus = OrderStatus;
  TransationType = TransactionType;
  Array = Array;
  appSubscription: Subscription | undefined;
  marketDataSubscription: Subscription | undefined;

  constructor(
    private appService: AppService,
    private orderService: OrderService,
    private marketDataService: MarketDataService
  ) { }
  ngOnDestroy(): void {
    if (this.appSubscription) {
      this.appSubscription.unsubscribe();
    }

    if (this.marketDataSubscription) {
      this.marketDataSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.APP_READY_EVENT:
            this.onAppReady.bind(this)();
            break;
          case MessageTypes.ORDER_UPDATE_EVENT:
            this.onOrderUpdate.bind(this)(message.Data as IOrder);
            break;
        }
      }
    );

    this.marketDataSubscription =
      this.marketDataService.marketDataEvents.subscribe(
        (message: MessageDataInterface<any>) => {
          // Handle different types of messages
          switch (message.MessageType) {
            case MessageTypes.MARKET_DEPTH_MESSAGE_EVENT:
              this.onMarketData.bind(this)(message.Data as MarketDataContainer);
              break;
          }
        }
      );
  }

  async onAppReady() { }

  async onOrderUpdate(order: IOrder) {
    let openOrder = Order.getOrder(order);

    if (this.orders.has(openOrder.getUniqueKey())) {
      if (
        openOrder.orderStatus == OrderStatus.New ||
        openOrder.orderStatus == OrderStatus.PartiallyFilled
      ) {
        this.orders.set(openOrder.getUniqueKey(), openOrder);
      } else {
        this.orders.delete(openOrder.getUniqueKey());
      }
    } else {
      if (
        openOrder.orderStatus == OrderStatus.New ||
        openOrder.orderStatus == OrderStatus.PartiallyFilled
      ) {
        this.orders.set(openOrder.getUniqueKey(), openOrder);
      }
    }
  }

  async cancelOrder(order: IOrder) {
    await this.orderService.cancelOrder(order);
  }

  async existAtStep(order: IOrder) {
    try {
      // 1. Cancel the existing order
      await this.orderService.cancelOrder(order);

      // 2. Calculate the new price
      let newPrice: number;
      if (order.transactionType === TransactionType.Buy) {
        newPrice = order.price * 1.001; // Increase by 0.1%
      } else if (order.transactionType === TransactionType.Sell) {
        newPrice = order.price * 0.999; // Decrease by 0.1%
      } else {
        console.error('Unknown transaction type for exit at step:', order.transactionType);
        return; // Exit if transaction type is unknown
      }

      // 3. Format the new price using symbol's tickSize
      const symbolInfo = order.symbol as Symbol; // Cast to access potential properties
      const tickSize = symbolInfo.tickSize;
      // Use a default precision if tickSize is not available or invalid
      const defaultPrecision = 8;
      const formattedPrice = this.formatPrice(newPrice, tickSize, defaultPrecision);

      // 4. Calculate and format pending quantity
      const pendingQuantity = order.quantity - order.filledQuantity;
      const lotSize = symbolInfo.lotSize;
      const defaultQtyPrecision = 4; // Default precision if lotSize is invalid
      const formattedQuantity = this.formatQuantity(pendingQuantity, lotSize, defaultQtyPrecision);

      // Ensure quantity is greater than 0 before placing order
      if (formattedQuantity <= 0) {
        console.log(`Skipping exit at step for order ${order.orderId}: Pending quantity is zero or negative after formatting.`);
        return;
      }

      // 5. Place the new order with formatted price and quantity
      await this.orderService.placeOrder(
        order.symbol,
        order.transactionType,
        OrderType.Limit,
        formattedPrice,
        formattedQuantity, // Use formatted pending quantity
      );

      console.log(`Exited at step order ${order.orderId}. New order placed with price ${formattedPrice} and quantity ${formattedQuantity}`);

    } catch (error) {
      console.error('Error during exit at step:', error);
      // Handle potential errors from cancelOrder or placeOrder
    }
  }

  async exitAtBest(order: IOrder) {
    try {
      // 1. Cancel the existing order
      await this.orderService.cancelOrder(order);

      // 2. Get the best price from market data 
      let bestPriceBitrue = this.marketDataService.getBestPrice(TradeInterface.BiTrueApi, Segment.BiTrue, order.symbol.token, order.transactionType);

      let bestPriceMEXC = this.marketDataService.getBestPrice(TradeInterface.MEXCApi, Segment.MEXC, order.symbol.token, order.transactionType);

      if (bestPriceBitrue == 0 || bestPriceMEXC == 0) {
        console.error('No market data found for symbol:', order.symbol.GetUniqueKey());
        return;
      }

      let bestPrice = 0;
      if (order.transactionType == TransactionType.Buy) {
        bestPrice = Math.min(bestPriceBitrue, bestPriceMEXC);
      } else if (order.transactionType == TransactionType.Sell) {
        bestPrice = Math.max(bestPriceBitrue, bestPriceMEXC);
      } else {
        console.error('Unknown transaction type for exit at best:', order.transactionType);
        return;
      }

      // 3. Format the new price using symbol's tickSize
      const symbolInfo = order.symbol as Symbol; // Cast to access potential properties
      const tickSize = symbolInfo.tickSize;
      // Use a default precision if tickSize is not available or invalid
      const defaultPrecision = 4;
      const formattedPrice = this.formatPrice(bestPrice, tickSize, defaultPrecision);

      // 4. Calculate and format pending quantity
      const pendingQuantity = order.quantity - order.filledQuantity;
      const lotSize = symbolInfo.lotSize;
      const defaultQtyPrecision = 4; // Default precision if lotSize is invalid
      const formattedQuantity = this.formatQuantity(pendingQuantity, lotSize, defaultQtyPrecision);

      // 4. Place a new order at the best price
      await this.orderService.placeOrder(
        order.symbol,
        order.transactionType,
        OrderType.Limit,
        bestPrice,
        formattedQuantity
      );

      console.log(`Exited at best order id ${order.orderId}. New order placed with price ${formattedPrice} and quantity ${order.quantity}`);

    } catch (error) {
      console.error('Error during exit at best:', error);
    }
  }

  /**
   * Formats the price according to the tick size and precision.
   * @param price The price to format.
   * @param tickSize The minimum price increment.
   * @param precision The number of decimal places for the price.
   * @returns The formatted price.
   */
  private formatPrice(price: number, tickSize: number | undefined, defaultPrecision: number): number {
    let decimalPlaces = defaultPrecision;

    // Calculate decimal places from tickSize if available and valid
    if (tickSize && tickSize > 0) {
      try {
        // Use Math.max and Math.ceil to handle potential floating point issues and ensure non-negative integer
        const calculatedPrecision = -Math.log10(tickSize);
        decimalPlaces = Math.max(0, Math.ceil(calculatedPrecision));
      } catch (e) {
        console.error("Error calculating precision from tickSize, using default:", e);
      }
    } else if (tickSize !== undefined) {
      console.warn(`Invalid tickSize (${tickSize}) provided, using default precision: ${defaultPrecision}`);
    }

    // Format to the calculated or default precision
    const formattedPrice = parseFloat(price.toFixed(decimalPlaces));

    // Optional: Adjust to the nearest tick size multiple if tickSize is valid
    // This might be necessary depending on exact exchange rules, but the precision formatting is usually sufficient.
    // if (tickSize && tickSize > 0) {
    //     const multiplier = 1 / tickSize;
    //     const adjustedPrice = Math.round(formattedPrice * multiplier) / multiplier;
    //     // Re-format after adjustment to ensure precision is maintained
    //     return parseFloat(adjustedPrice.toFixed(decimalPlaces));
    // }

    return formattedPrice;
  }

  /**
   * Formats the quantity according to the lot size.
   * @param quantity The quantity to format.
   * @param lotSize The minimum quantity increment (step size).
   * @param defaultPrecision The default number of decimal places if lotSize is invalid.
   * @returns The formatted quantity.
   */
  private formatQuantity(quantity: number, lotSize: number | undefined, defaultPrecision: number): number {
    let decimalPlaces = defaultPrecision;

    // Calculate decimal places from lotSize if available and valid
    if (lotSize && lotSize > 0) {
      try {
        // Use Math.max and Math.floor to handle potential floating point issues and ensure non-negative integer
        // Using floor might be more appropriate for quantity to not exceed limits, unlike ceiling for price.
        const calculatedPrecision = -Math.log10(lotSize);
        decimalPlaces = Math.max(0, Math.floor(calculatedPrecision));
      } catch (e) {
        console.error("Error calculating precision from lotSize, using default:", e);
      }
    } else if (lotSize !== undefined) {
      console.warn(`Invalid lotSize (${lotSize}) provided, using default precision: ${defaultPrecision}`);
    }

    // Format to the calculated or default precision
    // Use floor to truncate, often required for quantity formatting
    const factor = Math.pow(10, decimalPlaces);
    const formattedQuantity = Math.floor(quantity * factor) / factor;

    return formattedQuantity;
  }

  async onMarketData(marketDataContainer: MarketDataContainer) {
    let orderKeys = this.Array.from(this.orders.keys());

    for (let index = 0; index < orderKeys.length; index++) {
      let orderKey = orderKeys[index];
      let order = this.orders.get(orderKey);

      if (order) {
        if (
          order.symbol.GetUniqueKey() ==
          marketDataContainer.symbol.GetUniqueKey()
        ) {
          let orderQty = order.quantity;
          let orderPrice = order.price;
          let otherQty = 0;

          if (order.transactionType == TransactionType.Sell) {
            otherQty = from(marketDataContainer.marketDepths.asks)
              .where((marketDepthInfo: MarketDepthInfo) => {
                if (order?.price) {
                  return marketDepthInfo.price < order.price;
                } else {
                  return false;
                }
              })
              .select((marketDepthInfo: MarketDepthInfo) => {
                return marketDepthInfo.quantity;
              })
              .sum();
          }

          if (order.transactionType == TransactionType.Buy) {
            otherQty = from(marketDataContainer.marketDepths.bids)
              .where((marketDepthInfo: MarketDepthInfo) => {
                if (order?.price) {
                  return marketDepthInfo.price > order.price;
                } else {
                  return false;
                }
              })
              .select((marketDepthInfo: MarketDepthInfo) => {
                return marketDepthInfo.quantity;
              })
              .sum();
          }

          order.otherQuantity = parseFloat(otherQty.toFixed(2));
        }
      }
    }
  }
}
