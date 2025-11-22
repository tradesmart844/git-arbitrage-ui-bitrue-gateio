import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { MessageTypes, Segment, TradeInterface } from '../../helpers/enums';
import { AccountBalance } from '../../models/account-balance';
import { TableModule } from 'primeng/table';
import { OrderService } from '../../services/order.service';
import { AppService } from '../../services/app.service';
import { SymbolManagerService } from '../../services/symbol-manager.service';
import { from } from 'linq';
import { cloneDeep, forEach } from 'lodash';
import { IAccountBalance } from '../../interfaces/account-balance-interface';
import { CommonModule } from '@angular/common';
import {
  MessageDataInterface,
  WithdrawBalance,
} from '../../interfaces/message-data-interface';
import { Subscription } from 'rxjs';
import { WithdraCoinModalService } from '../../services/withdra-coin-modal.service';
import { CryptoCoin } from '../../models/crypto-coin';

@Component({
  selector: 'app-balance',
  templateUrl: './balance.component.html',
  styleUrl: './balance.component.css',
})
export class BalanceComponent implements OnInit, OnDestroy {
  @Input()
  tradeInterface: TradeInterface = TradeInterface.None;
  TradeInterface = TradeInterface;
  Array = Array;
  balances: AccountBalance[] = [];
  coins: CryptoCoin[] = [];
  orderSubscription: Subscription | undefined;
  appSubscription: Subscription | undefined;
  totalCoinBalance: { coin: string; balance: number }[] = [];

  preferedSymbols: string[] = [
    'XRP',
    'USDT',
    'SOLO',
    //'ELS',
    //'RPR',
    'COREUM',
    'QNT',
    //'XLM',
    'XDC',
    'EWT',
    'HBAR',
  ];

  constructor(
    private orderService: OrderService,
    private appService: AppService,
    private withdrawCoinModalService: WithdraCoinModalService,
    private symbolManagerService: SymbolManagerService
  ) {}

  ngOnDestroy(): void {
    if (this.orderSubscription) {
      this.orderSubscription.unsubscribe();
    }

    if (this.appSubscription) {
      this.appSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
      TradeInterface.BiTrueApi,
      Segment.BiTrue,
      'XDC'
    );

    if (cryptoCoin) {
      this.coins.push(cloneDeep(cryptoCoin));
    }

    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.APP_READY_EVENT:
            this.onAppReady.bind(this)();
            break;
          case MessageTypes.COIN_UPDATE_EVENT:
            this.cryptoCoinUpdate.bind(this)(message.Data as CryptoCoin);
            break;
        }
      }
    );

    this.orderSubscription = this.orderService.events.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.BALANCE_UPDATE_EVENT:
            this.onBalanceUpdate.bind(this)(message.Data as IAccountBalance);
            break;
        }
      }
    );
  }

  updateBalance() {
    let balances = this.orderService.getBalanceByTradeInterface(
      this.tradeInterface
    );

    for (let index = 0; index < balances.length; index++) {
      let balance = balances[index];

      if (this.preferedSymbols.includes(balance.cryptoCoin.coin)) {
        let existingCoin = from(this.balances)
          .where((balanceItem) => {
            return balanceItem.cryptoCoin.coin == balance.cryptoCoin.coin;
          })
          .firstOrDefault();

        if (existingCoin) {
          existingCoin.free = balance.free;
          existingCoin.locked = balance.locked;
        } else {
          this.balances.push(cloneDeep(balance));
        }
      }
    }
  }

  async getBalances() {
    await this.orderService.getBalances();
  }

  async onAppReady() {
    this.updateBalance();
  }

  async onBalanceUpdate(accountBalance: IAccountBalance) {
    let uniqueKey = accountBalance.cryptoCoin.getUniqueKey();

    for (let index = 0; index < this.balances.length; index++) {
      if (this.balances[index].cryptoCoin.getUniqueKey() == uniqueKey) {
        this.balances[index].free = accountBalance.free;
        this.balances[index].locked = accountBalance.locked;
        break;
      } else {
        this.updateBalance();
      }
    }
  }

  onBalanceRefresh(balances: IAccountBalance[]) {
    //this.updateBalance();
  }

  async withdrawCoin(balance: AccountBalance) {
    this.withdrawCoinModalService.openModal(balance);
    // const withdrawFreeAmount = confirm(
    //   'Do you want to withdraw the free amount?'
    // );

    // if (!withdrawFreeAmount) {
    //   //Open a dialog to get the amount to withdraw by opening a withdraw-coin component
    //   this.withdrawCoinModalService.openModal(balance);
    //   return;
    // }

    // this.appService.appEvents.emit({
    //   MessageType: MessageTypes.WITHDRAW_COIN_EVENT,
    //   Data: {
    //     balance,
    //     amount: balance.free,
    //   } as WithdrawBalance,
    // });
  }

  async cryptoCoinUpdate(cryptoCoin: CryptoCoin) {
    let uniqueKey = cryptoCoin.getUniqueKey();

    if (this.coins.length == 0) {
      this.coins.push(cloneDeep(cryptoCoin));
      return;
    }

    for (let index = 0; index < this.coins.length; index++) {
      if (this.coins[index].getUniqueKey() == uniqueKey) {
        this.coins[index].enableWithdraw = cryptoCoin.enableWithdraw;
        break;
      }

      if (index == this.coins.length - 1) {
        this.coins.push(cloneDeep(cryptoCoin));
      }
    }
  }

  getWithdrawStatus(accountBalance: IAccountBalance): boolean {
    let uniqueKey = accountBalance.cryptoCoin.getUniqueKey();

    for (let index = 0; index < this.coins.length; index++) {
      if (this.coins[index].getUniqueKey() == uniqueKey) {
        return this.coins[index].enableWithdraw;
      }
    }

    return true;
  }
}
