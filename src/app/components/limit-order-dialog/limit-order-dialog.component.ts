import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { DropdownModule } from 'primeng/dropdown';
import { OrderService } from '../../services/order.service';
import { MarketDataService } from '../../services/market-data.service';
import { SymbolManagerService } from '../../services/symbol-manager.service';
import { TradeInterface, TransactionType, OrderType, Segment, MessageTypes } from '../../helpers/enums';
import { ISymbol } from '../../interfaces/symbol-interface';
import { CryptoCoin } from '../../models/crypto-coin';
import { MarketDataContainer } from '../../models/market-data-container';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../../interfaces/message-data-interface';

@Component({
  selector: 'app-limit-order-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    DialogModule,
    ButtonModule,
    InputNumberModule,
    DropdownModule
  ],
  template: `
    <p-dialog
      [(visible)]="visible"
      [header]="'Place Limit Order - ' + selectedCoin"
      [modal]="true"
      [style]="{width: '50vw'}"
      [draggable]="false"
      [resizable]="false"
      (onHide)="onHide()"
    >
      <div class="p-fluid">
        <div class="field">
          <label for="transactionType">Transaction Type</label>
          <p-dropdown
            id="transactionType"
            [(ngModel)]="transactionType"
            [options]="transactionTypes"
            optionLabel="label"
            optionValue="value"
            [style]="{'width':'100%'}"
          ></p-dropdown>
        </div>

        <div class="field">
          <label for="quantity">Quantity</label>
          <p-inputNumber
            id="quantity"
            [(ngModel)]="quantity"
            [min]="0"
            [max]="maxQuantity"
            [showButtons]="true"
            [style]="{'width':'100%'}"
          ></p-inputNumber>
        </div>

        <div class="field">
          <label for="price">Price</label>
          <p-inputNumber
            id="price"
            [(ngModel)]="price"
            [min]="0"
            [showButtons]="true"
            [style]="{'width':'100%'}"
          ></p-inputNumber>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Cancel"
          icon="pi pi-times"
          (onClick)="onHide()"
          styleClass="p-button-text"
        ></p-button>
        <p-button
          label="Place Order"
          icon="pi pi-check"
          (onClick)="onPlaceOrder()"
          [disabled]="!isValid()"
        ></p-button>
      </ng-template>
    </p-dialog>

    <p-dialog
      [(visible)]="showConfirmation"
      header="Order Confirmation"
      [modal]="true"
      [style]="{width: '50vw'}"
      [draggable]="false"
      [resizable]="false"
    >
      <div class="p-fluid">
        <p>Please confirm your order:</p>
        <p>Coin: {{selectedCoin}}</p>
        <p>Type: {{TransactionType[transactionType]}}</p>
        <p>Quantity: {{quantity}}</p>
        <p>Price: {{price}}</p>
        <p>Total: {{quantity * price}}</p>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="No"
          icon="pi pi-times"
          (onClick)="showConfirmation = false"
          styleClass="p-button-text"
        ></p-button>
        <p-button
          label="Yes"
          icon="pi pi-check"
          (onClick)="confirmOrder()"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .field {
      margin-bottom: 1rem;
    }
    .field label {
      display: block;
      margin-bottom: 0.5rem;
    }
  `]
})
export class LimitOrderDialogComponent implements OnInit, OnDestroy {
  @Input() visible: boolean = false;
  @Input() selectedCoin: string = '';
  @Input() maxQuantity: number = 0;

  TransactionType = TransactionType;
  transactionTypes = [
    { label: 'Sell', value: TransactionType.Sell },
    { label: 'Buy', value: TransactionType.Buy }
  ];
  transactionType: TransactionType = TransactionType.Sell;
  quantity: number = 0;
  price: number = 0;
  showConfirmation: boolean = false;
  symbol: ISymbol | null = null;
  marketDataSubscription: Subscription | undefined;
  marketDataContainer: MarketDataContainer | undefined;

  constructor(
    private orderService: OrderService,
    private marketDataService: MarketDataService,
    private symbolManagerService: SymbolManagerService
  ) { }

  ngOnInit() {
    // Get the symbol for the selected coin
    const symbol = this.symbolManagerService.getSymbol(
      TradeInterface.BiTrueApi,
      Segment.BiTrue,
      this.selectedCoin + 'USDT'
    );
    if (symbol) {
      this.symbol = symbol;
      this.setupMarketDataSubscription();
    }
  }

  ngOnDestroy() {
    if (this.marketDataSubscription) {
      this.marketDataSubscription.unsubscribe();
    }
  }

  private setupMarketDataSubscription() {
    this.marketDataSubscription = this.marketDataService.marketDataEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        if (message.MessageType === MessageTypes.MARKET_DEPTH_MESSAGE_EVENT) {
          const marketData = message.Data as MarketDataContainer;
          if (marketData.symbol.GetUniqueKey() === this.symbol?.GetUniqueKey()) {
            this.marketDataContainer = marketData;
            this.updatePrice();
          }
        }
      }
    );
  }

  private updatePrice() {
    if (!this.marketDataContainer) return;

    if (this.transactionType === TransactionType.Sell) {
      // For sell orders, use the best ask price
      if (this.marketDataContainer.marketDepths.asks.length > 0) {
        this.price = this.marketDataContainer.marketDepths.asks[0].price;
      }
    } else {
      // For buy orders, use the best bid price
      if (this.marketDataContainer.marketDepths.bids.length > 0) {
        this.price = this.marketDataContainer.marketDepths.bids[0].price;
      }
    }
  }

  onHide() {
    this.visible = false;
    this.resetForm();
  }

  resetForm() {
    this.quantity = 0;
    this.price = 0;
    this.transactionType = TransactionType.Sell;
    this.showConfirmation = false;
  }

  isValid(): boolean {
    return this.quantity > 0 && this.price > 0 && this.quantity <= this.maxQuantity;
  }

  onPlaceOrder() {
    this.showConfirmation = true;
  }

  async confirmOrder() {
    if (!this.symbol) return;

    try {
      await this.orderService.placeOrder(
        this.symbol,
        this.transactionType,
        OrderType.Limit,
        this.price,
        this.quantity
      );
      this.onHide();
    } catch (error) {
      console.error('Failed to place order:', error);
      // You might want to show an error message to the user here
    }
  }
} 