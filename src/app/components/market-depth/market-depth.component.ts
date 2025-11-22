import { Component, OnDestroy, OnInit } from '@angular/core';
import { TableModule } from 'primeng/table';
import { MarketDepthInfo, MarketDepths } from '../../models/market-depths';
import { MarketDataContainer } from '../../models/market-data-container';
import { MessageTypes, TradeInterface } from '../../helpers/enums';
import { MarketDataService } from '../../services/market-data.service';
import { AppService } from '../../services/app.service';
import { ArbitragePair } from '../../models/arbitrage-pair';
import { from } from 'linq';
import { ISymbol } from '../../interfaces/symbol-interface';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../../interfaces/message-data-interface';

@Component({
  selector: 'app-market-depth',
  standalone: false,
  templateUrl: './market-depth.component.html',
  styleUrl: './market-depth.component.css',
})
export class MarketDepthComponent implements OnInit, OnDestroy {
  askMarketDepthInfos: MarketDepthInfo[] = [];
  bidMarketDepthInfos: MarketDepthInfo[] = [];
  askMarketDataContainer: MarketDataContainer | undefined;
  bidMarketDataContainer: MarketDataContainer | undefined;
  TradeInterface = TradeInterface;
  askTradeInterface = TradeInterface[TradeInterface.None];
  bidTradeInterface = TradeInterface[TradeInterface.None];
  marketDataSubscription: Subscription | undefined;
  appSubscription: Subscription | undefined;

  constructor(
    private marketDataService: MarketDataService,
    private appService: AppService
  ) {}
  ngOnDestroy(): void {
    if (this.marketDataSubscription) {
      this.marketDataSubscription.unsubscribe();
    }

    if (this.appSubscription) {
      this.appSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.APP_ARBITRAGE_BOOK_SYMBOL_CHANGE_EVENT:
            this.onArbitrageBookSymbolChange.bind(this)(
              message.Data as ArbitragePair
            );
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

  onArbitrageBookSymbolChange(arbitragePair: ArbitragePair) {
    this.setSymbols(
      arbitragePair.buyMarketDataContainer.symbol,
      arbitragePair.sellMarketDataContainer.symbol
    );
  }

  onMarketData(marketDataContainer: MarketDataContainer) {
    if (
      this.askMarketDataContainer?.symbol.GetUniqueKey() ==
      marketDataContainer.symbol.GetUniqueKey()
    ) {
      this.askMarketDataContainer = marketDataContainer;
      this.askMarketDepthInfos = from(
        this.askMarketDataContainer.marketDepths.asks
      )
        .take(50)
        .orderByDescending((ask) => {
          return ask.price;
        })
        .toArray();
    }

    if (
      this.bidMarketDataContainer?.symbol.GetUniqueKey() ==
      marketDataContainer.symbol.GetUniqueKey()
    ) {
      this.bidMarketDataContainer = marketDataContainer;
      this.bidMarketDepthInfos = from(
        this.bidMarketDataContainer.marketDepths.bids
      )
        .take(50)
        .orderByDescending((bid) => {
          return bid.price;
        })
        .toArray();
    }

    // if (marketDataContainer.symbol.name == 'SOLOXRP') {
    //   this.askMarketDataContainer = marketDataContainer;
    //   this.askMarketDepthInfos = from(
    //     this.askMarketDataContainer.marketDepths.asks
    //   )
    //     .take(50)
    //     .orderByDescending((ask) => {
    //       return ask.price;
    //     })
    //     .toArray();
    //   this.askTradeInterface =
    //     TradeInterface[this.askMarketDataContainer.symbol.tradeInterface];
    // }
    // if (marketDataContainer.symbol.name == 'SOLOUSDT') {
    //   this.bidMarketDataContainer = marketDataContainer;
    //   this.bidMarketDepthInfos = from(
    //     this.bidMarketDataContainer.marketDepths.bids
    //   )
    //     .take(50)
    //     .orderByDescending((bid) => {
    //       return bid.price;
    //     })
    //     .toArray();
    //   this.bidTradeInterface =
    //     TradeInterface[this.bidMarketDataContainer.symbol.tradeInterface];
    // }
  }

  setSymbols(askSymbol: ISymbol, bidSymbol: ISymbol) {
    this.askTradeInterface = TradeInterface[TradeInterface.None];
    this.bidTradeInterface = TradeInterface[TradeInterface.None];
    this.askMarketDataContainer = undefined;
    this.bidMarketDataContainer = undefined;
    this.askMarketDepthInfos = [];
    this.bidMarketDepthInfos = [];
    let askMarketDataContainer = this.marketDataService.getMarketDataContainer(
      askSymbol.tradeInterface,
      askSymbol.segment,
      askSymbol.token
    );

    if (askMarketDataContainer) {
      this.askMarketDataContainer = askMarketDataContainer;
    } else {
      this.askMarketDataContainer = new MarketDataContainer(
        askSymbol,
        new MarketDepths(
          askSymbol.name,
          askSymbol.segment,
          askSymbol.tradeInterface,
          [],
          []
        )
      );
    }

    this.askTradeInterface = TradeInterface[askSymbol.tradeInterface];

    let bidMarketDataContainer = this.marketDataService.getMarketDataContainer(
      bidSymbol.tradeInterface,
      bidSymbol.segment,
      bidSymbol.token
    );

    if (bidMarketDataContainer) {
      this.bidMarketDataContainer = bidMarketDataContainer;
    } else {
      this.bidMarketDataContainer = new MarketDataContainer(
        bidSymbol,
        new MarketDepths(
          bidSymbol.name,
          bidSymbol.segment,
          bidSymbol.tradeInterface,
          [],
          []
        )
      );
    }

    this.bidTradeInterface = TradeInterface[bidSymbol.tradeInterface];
  }
}
