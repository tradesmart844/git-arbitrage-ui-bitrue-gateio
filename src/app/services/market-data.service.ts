import { MarketDataContainer } from '../models/market-data-container';
import { AppService } from './app.service';
import { SymbolManagerService } from './symbol-manager.service';
import { MessageTypes, Price, Segment, TradeInterface, TransactionType } from '../helpers/enums';
import { MarketDepthInfo, MarketDepths } from '../models/market-depths';
import { Symbol } from '../models/symbol';
import { SymbolCrypto } from '../models/symbol-crypto';
import { EventEmitter, Injectable, Output } from '@angular/core';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { Subscription } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MarketDataService {
  marketData: Map<string, MarketDataContainer> = new Map<
    string,
    MarketDataContainer
  >();

  @Output() marketDataEvents: EventEmitter<MessageDataInterface<any>> =
    new EventEmitter<MessageDataInterface<any>>();

  appSubscription: Subscription | undefined;

  constructor(
    private appService: AppService,
    private symbolManagerService: SymbolManagerService
  ) { }

  init() {
    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.MARKET_DEPTH_MESSAGE_EVENT:
            this.onMarketData.bind(this)(message.Data as MarketDepths);
            break;
        }
      }
    );
  }

  setMarketData(
    tradeInterface: TradeInterface,
    segment: Segment,
    marketDepths: MarketDepths
  ) {
    let uniqueKey = Symbol.GetUniqueKey(
      tradeInterface,
      segment,
      marketDepths.token
    );

    let marketDataContainer: MarketDataContainer | undefined;

    if (!this.marketData.has(uniqueKey)) {
      let symbol = this.symbolManagerService.getSymbol(
        tradeInterface,
        segment,
        marketDepths.token
      );

      if (symbol) {
        marketDataContainer = new MarketDataContainer(symbol, marketDepths);
        this.marketData.set(uniqueKey, marketDataContainer);
      }
    } else {
      marketDataContainer = this.marketData.get(uniqueKey);

      if (marketDataContainer) {
        marketDataContainer.marketDepths = marketDepths;
      }
    }

    if (marketDataContainer) {
      return marketDataContainer;
      // SocketServerService.Instance.sendMessage(
      //   MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
      //   marketDataContainer
      // );
    }

    return undefined;
  }

  onMarketData(marketDepths: MarketDepths) {
    let marketDataContainer = this.setMarketData(
      marketDepths.tradeInterface,
      marketDepths.segment,
      marketDepths
    );

    if (marketDataContainer) {
      let symbol = new SymbolCrypto(
        marketDataContainer.symbol.tradeInterface,
        marketDataContainer.symbol.segment,
        marketDataContainer.symbol.token,
        marketDataContainer.symbol.type,
        marketDataContainer.symbol.name,
        marketDataContainer.symbol.uniqueName,
        marketDataContainer.symbol.lotSize,
        marketDataContainer.symbol.tickSize,
        marketDataContainer.symbol.decimalPlace,
        (<SymbolCrypto>marketDataContainer.symbol).baseSymbol,
        (<SymbolCrypto>marketDataContainer.symbol).qouteSymbol
      );

      let bids: MarketDepthInfo[] = [];
      let asks: MarketDepthInfo[] = [];

      for (
        let index = 0;
        index < marketDataContainer.marketDepths.asks.length;
        index++
      ) {
        asks.push(
          new MarketDepthInfo(
            marketDataContainer.marketDepths.asks[index].price,
            marketDataContainer.marketDepths.asks[index].quantity,
            marketDataContainer.marketDepths.asks[index].totalOrders
          )
        );
      }

      for (
        let index = 0;
        index < marketDataContainer.marketDepths.bids.length;
        index++
      ) {
        bids.push(
          new MarketDepthInfo(
            marketDataContainer.marketDepths.bids[index].price,
            marketDataContainer.marketDepths.bids[index].quantity,
            marketDataContainer.marketDepths.bids[index].totalOrders
          )
        );
      }

      let marketDepths = new MarketDepths(
        marketDataContainer.marketDepths.symbol,
        marketDataContainer.marketDepths.segment,
        marketDataContainer.marketDepths.tradeInterface,
        bids,
        asks
      );

      let marketDataContainerFinal = new MarketDataContainer(
        symbol,
        marketDepths
      );

      this.marketData.set(symbol.GetUniqueKey(), marketDataContainerFinal);
      this.marketDataEvents.emit({
        MessageType: MessageTypes.MARKET_DEPTH_MESSAGE_EVENT,
        Data: marketDataContainerFinal,
      });
    }
  }

  getMarketDataContainer(
    tradeInterface: TradeInterface,
    segment: Segment,
    token: string
  ) {
    return this.marketData.get(
      Symbol.GetUniqueKey(tradeInterface, segment, token)
    );
  }

  // Calculate  the best price from market data
  getBestPrice(tradeInterface: TradeInterface, segment: Segment, token: string, transactionType: TransactionType): Price {
    const marketData = this.getMarketDataContainer(tradeInterface, segment, token);
    if (!marketData) {
      return 0;
    }

    let bestPrice = 0;

    // Get the best price from market data
    if (transactionType === TransactionType.Buy) {
      bestPrice = marketData.marketDepths.asks[0].price;
    } else {
      bestPrice = marketData.marketDepths.bids[0].price;
    }

    // Return the best price
    return bestPrice;
  }
}
