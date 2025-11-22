import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { TableModule } from 'primeng/table';
import {
  MessageTypes,
  OrderType,
  Segment,
  TradeInterface,
  TransactionType,
} from '../../helpers/enums';
import { OrderService } from '../../services/order.service';
import { SymbolManagerService } from '../../services/symbol-manager.service';
import { AppService } from '../../services/app.service';
import { AccountBalance } from '../../models/account-balance';
import { Subscription } from 'rxjs';
import {
  MessageDataInterface,
  WithdrawBalance,
} from '../../interfaces/message-data-interface';
import { CryptoCoin } from '../../models/crypto-coin';
import { ArbitrageAutoOrderService } from '../../services/arbitrage-auto-order.service';

@Component({
  selector: 'app-extra',
  templateUrl: './extra.component.html',
  styleUrl: './extra.component.css',
})
export class ExtraComponent implements OnInit, OnDestroy {
  @Input()
  tradeInterface: TradeInterface = TradeInterface.None;
  TradeInterface = TradeInterface;
  appSubscription: Subscription | undefined;
  autoOrderSubscription: Subscription | undefined;
  autoOrderEnabled: boolean = false;
  processingPairsCount: number = 0;

  constructor(
    private orderService: OrderService,
    private symbolManagerService: SymbolManagerService,
    private appService: AppService,
    private arbitrageAutoOrderService: ArbitrageAutoOrderService
  ) { }

  ngOnDestroy(): void {
    if (this.appSubscription) {
      this.appSubscription.unsubscribe();
    }
    if (this.autoOrderSubscription) {
      this.autoOrderSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.WITHDRAW_COIN_EVENT:
            this.withdrawCoin.bind(this)(message.Data as WithdrawBalance);
            break;
        }
      }
    );

    // Subscribe to arbitrage auto order events
    this.autoOrderSubscription = this.arbitrageAutoOrderService.autoOrderEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Update processing pairs count on relevant events
        this.updateProcessingPairsCount();
      }
    );

    // Initialize processing pairs count
    this.updateProcessingPairsCount();
  }

  private updateProcessingPairsCount(): void {
    this.processingPairsCount = this.arbitrageAutoOrderService.getProcessingPairsCount();
  }

  toggleAutoOrderManagement(): void {
    this.autoOrderEnabled = !this.autoOrderEnabled;
    this.arbitrageAutoOrderService.toggleAutoOrderManagement(this.autoOrderEnabled);
    console.log(`Auto order management ${this.autoOrderEnabled ? 'enabled' : 'disabled'}`);
  }

  clearProcessingPairs(): void {
    // Confirm with the user before clearing
    if (confirm('Are you sure you want to clear all processing arbitrage pairs?')) {
      this.arbitrageAutoOrderService.clearAllProcessingPairs();
      this.updateProcessingPairsCount();
      console.log('All processing arbitrage pairs have been cleared');
    }
  }

  async withdraw() {
    // let cryptoCoin = this.symbolManagerService.getCryptoCoin(
    //   TradeInterface.BiTrueApi,
    //   Segment.BiTrue,
    //   'XRP'
    // );
    // if (cryptoCoin) {
    //   await this.orderService.withdraw(cryptoCoin);
    // }
  }

  async refreshBalances() {
    await this.orderService.refreshBalances();
  }

  async withdrawUSDT() {
    if (this.tradeInterface == TradeInterface.MEXCApi) {
      let cryptoCoin = this.symbolManagerService.getCryptoCoin(
        TradeInterface.MEXCApi,
        Segment.MEXC,
        'USDT'
      );
      if (cryptoCoin) {
        await this.orderService.withdrawUSDT(cryptoCoin, 1200);
      }
    } else {
      let cryptoCoin = this.symbolManagerService.getCryptoCoin(
        TradeInterface.BiTrueApi,
        Segment.BiTrue,
        'USDT'
      );
      if (cryptoCoin) {
        await this.orderService.withdrawUSDT(cryptoCoin, 1150);
      }
    }
  }

  async withdrawXDC() {
    switch (this.tradeInterface) {
      case TradeInterface.MEXCApi:
        {
          let cryptoCoin = this.symbolManagerService.getCryptoCoin(
            TradeInterface.MEXCApi,
            Segment.MEXC,
            'XDC'
          );
          if (cryptoCoin) {
            await this.orderService.withdrawXDC(cryptoCoin, 24000);
          }
        }
        break;
      case TradeInterface.BiTrueApi:
        let cryptoCoin = this.symbolManagerService.getCryptoCoin(
          TradeInterface.BiTrueApi,
          Segment.BiTrue,
          'XDC'
        );
        if (cryptoCoin) {
          await this.orderService.withdrawXDC(cryptoCoin, 24000);
        }
        break;
    }
  }

  async withdrawSOLO() {
    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
      TradeInterface.MEXCApi,
      Segment.MEXC,
      'SOLO'
    );
    if (cryptoCoin) {
      await this.orderService.withdrawSOLO(cryptoCoin);
    }
  }

  async withdrawCOREUM() {
    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
      TradeInterface.MEXCApi,
      Segment.MEXC,
      'COREUM'
    );
    if (cryptoCoin) {
      await this.orderService.withdrawCOREUM(cryptoCoin);
    }
  }

  async lockXRP() {
    let symbol = this.symbolManagerService.getSymbol(
      TradeInterface.BiTrueApi,
      Segment.BiTrue,
      'XRPUSDT'
    );

    let usdtCryptoCoin = this.symbolManagerService.getCryptoCoin(
      TradeInterface.BiTrueApi,
      Segment.BiTrue,
      'USDT'
    );

    if (!usdtCryptoCoin) {
      return;
    }

    let usdtBalance = this.orderService.getBalance(usdtCryptoCoin);

    if (!usdtBalance) {
      return;
    }

    let quantity = parseInt((usdtBalance.free / 0.5).toString());

    if (symbol) {
      if (quantity > 15) {
        await this.orderService.placeOrder(
          symbol,
          TransactionType.Buy,
          OrderType.Limit,
          0.5,
          quantity
        );
      }
    }
  }

  async withdrawCoin(withdrawBalance: WithdrawBalance) {
    let balance = withdrawBalance.balance;
    let amount: number = withdrawBalance.amount;

    if (this.tradeInterface != balance.cryptoCoin.tradeInterface) {
      return;
    }

    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
      balance.cryptoCoin.tradeInterface,
      balance.cryptoCoin.segment,
      balance.cryptoCoin.coin
    );

    if (amount == 0) {
      amount = balance.free;
    }

    if (!cryptoCoin) {
      return;
    }

    switch (this.tradeInterface) {
      case TradeInterface.MEXCApi:
        if (cryptoCoin) {
          //await this.orderService.withdrawXDC(cryptoCoin, amount);
        }
        break;
      case TradeInterface.BiTrueApi:
        if (cryptoCoin) {
          {
            switch (cryptoCoin.coin) {
              case 'USDT':
                await this.orderService.withdrawUSDT(cryptoCoin, amount);
                break;
              case 'XDC':
                await this.orderService.withdrawXDC(cryptoCoin, amount);
                break;
              case 'SOLO':
                await this.orderService.withdrawSOLO(cryptoCoin);
                break;
              case 'COREUM':
                await this.orderService.withdrawCOREUM(cryptoCoin);
                break;
              case 'EWT':
                await this.orderService.withdrawEWT(cryptoCoin, amount);
                break;
              case 'XRP':
                await this.orderService.withdrawXRP(cryptoCoin, amount);
                break;
              case 'HBAR':
                await this.orderService.withdrawHBAR(cryptoCoin, amount);
                break;
              default:
                alert(
                  `The ${cryptoCoin.coin} ${TradeInterface[this.tradeInterface]
                  } coin is not configured for withdraw.`
                );
                break;
            }
          }
          //await this.orderService.withdrawXDC(cryptoCoin, amount);
        }
        break;
    }
  }
}
