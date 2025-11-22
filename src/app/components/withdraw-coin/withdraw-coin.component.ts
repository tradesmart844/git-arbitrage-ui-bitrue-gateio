import { Component, Input, OnInit } from '@angular/core';
import { AccountBalance } from '../../models/account-balance';
import { SymbolManagerService } from '../../services/symbol-manager.service';
import { OrderService } from '../../services/order.service';
import { TradeInterface } from '../../helpers/enums';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { WithdraCoinModalService } from '../../services/withdra-coin-modal.service';

@Component({
  selector: 'app-withdraw-coin',
  templateUrl: './withdraw-coin.component.html',
  styleUrl: './withdraw-coin.component.css',
})
export class WithdrawCoinComponent implements OnInit {
  @Input()
  balance?: AccountBalance;
  TradeInterface = TradeInterface;
  tradeInterface: TradeInterface = TradeInterface.None;
  symbol: string = ''; // Default value of '' for symbol

  amount: number = 0; // Default value of 0 for amount

  constructor(
    private orderService: OrderService,
    public withdrawCoinModalService: WithdraCoinModalService
  ) { }

  ngOnInit(): void {
    if (this.balance?.cryptoCoin) {
      this.tradeInterface = this.balance.cryptoCoin.tradeInterface;
      this.symbol = this.balance.cryptoCoin.coin;
    }

    if (this.balance == null) {
      return;
    } else {
      this.amount = this.balance.free; // Set amount to 0 when component initializes
    }
  }

  async withdrawCoin() {
    if (this.balance == null) {
      return;
    }

    if (this.amount == 0) {
      return;
    }

    if (!this.balance.cryptoCoin) {
      return;
    }

    switch (this.balance.cryptoCoin.coin) {
      case 'USDT':
        await this.orderService.withdrawUSDT(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'XDC':
        await this.orderService.withdrawXDC(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'SOLO':
        await this.orderService.withdrawSOLO(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'COREUM':
        await this.orderService.withdrawCOREUM(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'EWT':
        await this.orderService.withdrawEWT(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'XRP':
        await this.orderService.withdrawXRP(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'HBAR':
        await this.orderService.withdrawHBAR(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      case 'QNT':
        await this.orderService.withdrawQNT(
          this.balance.cryptoCoin,
          this.amount
        );
        break;
      default:
        alert(
          `The ${this.balance.cryptoCoin.coin} ${TradeInterface[this.balance.cryptoCoin.tradeInterface]
          } coin is not configured for withdraw.`
        );
        break;
    }
  }

  async close() {
    this.withdrawCoinModalService.closeModal();
    // Close the modal
  }
}
