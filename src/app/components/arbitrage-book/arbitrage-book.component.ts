import { Component, OnDestroy, OnInit } from '@angular/core';
import { ArbitragePair } from '../../models/arbitrage-pair';
import { MessageTypes, SymbolType, TradeInterface } from '../../helpers/enums';
import { SymbolCrypto } from '../../models/symbol-crypto';
import { ISymbol } from '../../interfaces/symbol-interface';
import { AppService } from '../../services/app.service';
import { ArbitrageService } from '../../services/arbitrage.service';
import { ArbitrageAutoOrderService } from '../../services/arbitrage-auto-order.service';
import { TableModule } from 'primeng/table';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../../interfaces/message-data-interface';
import { OrderService } from '../../services/order.service';
import { SymbolManagerService } from '../../services/symbol-manager.service';

@Component({
  selector: 'app-arbitrage-book',
  templateUrl: './arbitrage-book.component.html',
  styleUrl: './arbitrage-book.component.css',
})
export class ArbitrageBookComponent implements OnInit, OnDestroy {
  arbitragePairs: ArbitragePair[] = [];
  SymbolCrypto = SymbolCrypto;
  TradeInterface = TradeInterface;
  arbitrageSubscription: Subscription | undefined;

  constructor(
    private arbitrageService: ArbitrageService,
    private appService: AppService,
    private orderService: OrderService,
    private symbolManagerService: SymbolManagerService,
    private arbitrageAutoOrderService: ArbitrageAutoOrderService
  ) { }

  ngOnDestroy(): void {
    if (this.arbitrageSubscription) {
      this.arbitrageSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    this.arbitrageSubscription =
      this.arbitrageService.arbitrageEvents.subscribe(
        (message: MessageDataInterface<any>) => {
          // Handle different types of messages
          switch (message.MessageType) {
            case MessageTypes.ARBITRAGE_UPDATE_EVENT:
              this.onArbitrageUpdate.bind(this)(
                message.Data as ArbitragePair[]
              );
              break;
          }
        }
      );
  }

  onArbitrageUpdate(arbitragePairs: ArbitragePair[]) {
    this.arbitragePairs = arbitragePairs;
    return;
    // this.arbitragePairs = from(arbitragePairs)
    //   .where((arbitragePair) => {
    //     return (
    //       arbitragePair.sellMarketDataContainer.symbol.tradeInterface ==
    //         TradeInterface.BiTrueApi &&
    //       arbitragePair.sellMarketDataContainer.symbol.segment ==
    //         Segment.BiTrue &&
    //       ((arbitragePair.buyMarketDataContainer.symbol.tradeInterface ==
    //         TradeInterface.MEXCApi &&
    //         arbitragePair.buyMarketDataContainer.symbol.segment ==
    //           Segment.MEXC) ||
    //         (arbitragePair.buyMarketDataContainer.symbol.tradeInterface ==
    //           TradeInterface.BiTrueApi &&
    //           arbitragePair.buyMarketDataContainer.symbol.segment ==
    //             Segment.BiTrue))
    //     );
    //   })
    //   .toArray();
  }

  async placeLimitOrder(arbitragePair: ArbitragePair) {
    await this.arbitrageService.placeLimitOrder(arbitragePair);
  }

  async placeFullLimitOrder(arbitragePair: ArbitragePair) {
    await this.arbitrageService.placeFullLimitOrder(arbitragePair);
  }

  async placeMarketOrder(arbitragePair: ArbitragePair) {
    await this.arbitrageService.placeMarketOrder(arbitragePair);
  }

  async placeFullMarketOrder(arbitragePair: ArbitragePair) {
    await this.arbitrageService.placeFullMarketOrder(arbitragePair);
  }

  onSelect(arbitragePair: ArbitragePair) {
    this.appService.onArbitrageBookSymbolChange(arbitragePair);
  }

  getBaseSymbol(symbol: ISymbol) {
    switch (symbol.type) {
      case SymbolType.CRYPTO:
        return (<SymbolCrypto>symbol).baseSymbol;
      default:
        return symbol.token;
    }
  }

  getQuoteSymbol(symbol: ISymbol) {
    switch (symbol.type) {
      case SymbolType.CRYPTO:
        return (<SymbolCrypto>symbol).qouteSymbol;
      default:
        return symbol.token;
    }
  }

  getAvailableBatches(arbitragePair: ArbitragePair): number {
    return this.arbitrageService.getAvailableBatches(arbitragePair);
  }

  getAvailableSellBatches(arbitragePair: ArbitragePair): number {
    return this.arbitrageService.getAvailableSellBatches(arbitragePair);
  }
}
