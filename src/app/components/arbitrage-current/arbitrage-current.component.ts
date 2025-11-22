import { Component, OnDestroy, OnInit } from '@angular/core';
import { ArbitragePair } from '../../models/arbitrage-pair';
import { ArbitrageService } from '../../services/arbitrage.service';
import { MarketDataService } from '../../services/market-data.service';
import { OrderService } from '../../services/order.service';
import { MessageTypes, TradeInterface } from '../../helpers/enums';
import { cloneDeep } from 'lodash';
import { TableModule } from 'primeng/table';
import { MarketDataContainer } from '../../models/market-data-container';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../../interfaces/message-data-interface';
import { IOrder } from '../../interfaces/order-interface';

@Component({
  selector: 'app-arbitrage-current',
  templateUrl: './arbitrage-current.component.html',
  styleUrl: './arbitrage-current.component.css',
})
export class ArbitrageCurrentComponent implements OnInit, OnDestroy {
  arbitragePairs: ArbitragePair[] = [];
  arbitragePairsByMagicNumber: Map<string, ArbitragePair> = new Map();
  TradeInterface = TradeInterface;
  arbitrageSubscription: Subscription | undefined;
  orderSubscription: Subscription | undefined;

  constructor(
    private arbitrageService: ArbitrageService,
    private marketDataService: MarketDataService,
    private orderService: OrderService
  ) { }

  ngOnDestroy(): void {
    if (this.arbitrageSubscription) {
      this.arbitrageSubscription.unsubscribe();
    }
    if (this.orderSubscription) {
      this.orderSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    this.arbitrageSubscription =
      this.arbitrageService.arbitrageEvents.subscribe(
        (message: MessageDataInterface<any>) => {
          // Handle different types of messages
          switch (message.MessageType) {
            case MessageTypes.ARBITRAGE_ORDER_EVENT:
              this.onArbitrageOrderEvent.bind(this)(
                message.Data as ArbitragePair
              );
              break;
          }
        }
      );

    this.orderSubscription =
      this.orderService.events.subscribe(
        (message: MessageDataInterface<any>) => {
          switch (message.MessageType) {
            case MessageTypes.ORDER_UPDATE_EVENT:
              this.onOrderUpdate(message.Data);
              break;
          }
        }
      );
  }

  onArbitrageOrderEvent(arbitragePair: ArbitragePair) {
    if (arbitragePair.magicNumber) {
      this.arbitragePairsByMagicNumber.set(arbitragePair.magicNumber, cloneDeep(arbitragePair));
    }

    this.arbitragePairs.unshift(cloneDeep(arbitragePair));
  }

  remove(arbitragePair: ArbitragePair, index: number) {
    if (arbitragePair.magicNumber) {
      this.arbitragePairsByMagicNumber.delete(arbitragePair.magicNumber);
    }

    this.arbitragePairs.splice(index, 1);
  }

  async buyXRP(arbitragePair: ArbitragePair, index: number) {
    //await this.arbitrageService.buyXRP(arbitragePair);
  }

  async sellXRP(arbitragePair: ArbitragePair, index: number) {
    await this.arbitrageService.sellXRP(arbitragePair);
  }

  async crossBuy(arbitragePair: ArbitragePair, index: number) {
    await this.arbitrageService.crossBuy(arbitragePair);
  }

  async onMarketData(marketDataContainer: MarketDataContainer) {
    let uniqueKey = marketDataContainer.symbol.GetUniqueKey();

    for (let index = 0; index < this.arbitragePairs.length; index++) {
      let arbitragePair = this.arbitragePairs[index];
      let isUpdate = false;

      if (
        arbitragePair.sellMarketDataContainer.symbol.GetUniqueKey() == uniqueKey
      ) {
        arbitragePair.sellMarketDataContainer = marketDataContainer;
        isUpdate = true;
      }

      if (
        arbitragePair.buyMarketDataContainer.symbol.GetUniqueKey() == uniqueKey
      ) {
        arbitragePair.buyMarketDataContainer = marketDataContainer;
        isUpdate = true;
      }

      if (
        arbitragePair.conversionSideMarketContainer &&
        arbitragePair.conversionSideMarketContainer.symbol.GetUniqueKey() ==
        uniqueKey
      ) {
        arbitragePair.conversionSideMarketContainer = marketDataContainer;
        isUpdate = true;
      }

      if (isUpdate) {
        arbitragePair.calculate();
      }
    }
  }

  onOrderUpdate(order: IOrder) {
    // Find matching arbitrage pair using magic number
    if (!order.magicNumber) {
      return;
    }

    const arbitragePair = this.arbitragePairsByMagicNumber.get(order.magicNumber);
    if (!arbitragePair) {
      return;
    }

    // Check if this is a sell side order that has been filled
    if (order.symbol.GetUniqueKey() === arbitragePair.sellMarketDataContainer.symbol.GetUniqueKey() &&
      order.filledQuantity > 0 &&
      !arbitragePair.isBeingProcessed) {

      // Mark as being processed to prevent duplicate processing
      arbitragePair.isBeingProcessed = true;

      // Calculate remaining quantity to process
      const remainingQuantity = order.filledQuantity;

      console.log('Sell order partially filled:', {
        magicNumber: order.magicNumber,
        symbol: order.symbol.name,
        filledQuantity: order.filledQuantity,
        remainingQuantity: remainingQuantity
      });
    }
  }
}
