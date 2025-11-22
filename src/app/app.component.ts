import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TradeInterface } from './helpers/enums';
import { MarketDataService } from './services/market-data.service';
import { AppService } from './services/app.service';
import { OrderService } from './services/order.service';
import { SymbolManagerService } from './services/symbol-manager.service';
import { MexcApiInteractiveService } from './services/mexc-api-interactive.service';
import { WithdraCoinModalService } from './services/withdra-coin-modal.service';
import { Subscription } from 'rxjs';
import { GateIOApiInteractiveService } from './services/gateio-api-interactive.service';

@Component({
  selector: 'app-root',
  standalone: false,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Arbitrage';
  tradeInterface1: TradeInterface = TradeInterface.MEXCApi;
  tradeInterface2: TradeInterface = TradeInterface.GateIOApi;
  isOpen = false; // Track modal state locally
  withdrawCoinModalSubscription: Subscription | undefined;

  constructor(
    private marketDataService: MarketDataService,
    private appService: AppService,
    private orderService: OrderService,
    private symbolService: SymbolManagerService,
    private mexcApiInteractiveService: MexcApiInteractiveService,
    private gateioApiInteractiveService: GateIOApiInteractiveService,
    public withdrawCoinModalService: WithdraCoinModalService
  ) {
    this.withdrawCoinModalSubscription = this.withdrawCoinModalService
      .getIsModalOpen()
      .subscribe((isOpen) => {
        this.isOpen = isOpen;
      });
  }

  ngOnDestroy(): void {
    if (this.withdrawCoinModalSubscription) {
      this.withdrawCoinModalSubscription.unsubscribe();
    }
  }

  async ngOnInit(): Promise<void> {
    await this.symbolService.init();
    await this.marketDataService.init();
    await this.orderService.init();
    //await this.mexcApiInteractiveService.init();
    //await this.bitrueInteractiveService.init();
    //await this.gateioApiInteractiveService.init();
    this.appService.onAppReady();
  }
}
