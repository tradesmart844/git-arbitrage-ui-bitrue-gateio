import { Component, OnDestroy, OnInit } from '@angular/core';
import { OrderService } from '../../services/order.service';
import { AppService } from '../../services/app.service';
import { WithdraCoinModalService } from '../../services/withdra-coin-modal.service';
import { SymbolManagerService } from '../../services/symbol-manager.service';
import { MarketDataService } from '../../services/market-data.service';
import { IAccountBalance } from '../../interfaces/account-balance-interface';
import { AccountBalance } from '../../models/account-balance';
import { MessageDataInterface } from '../../interfaces/message-data-interface';
import { MessageTypes, TradeInterface, Segment, OrderType, TransactionType } from '../../helpers/enums';
import { TotalCoinBalance } from '../../models/total-coin-balance';
import { Subscription } from 'rxjs';
import { HelperUtil } from '../../helpers/helper-util';

@Component({
  selector: 'app-total-coin-balance',
  templateUrl: './total-coin-balance.component.html',
  styleUrl: './total-coin-balance.component.css',
})
export class TotalCoinBalanceComponent implements OnInit, OnDestroy {
  totalCoinBalance: TotalCoinBalance[] = [];
  balanceMap: Map<string, Map<TradeInterface, IAccountBalance>> = new Map();
  orderSubscription: Subscription | undefined;

  // Dialog form variables
  selectedTradeInterface: TradeInterface = TradeInterface.None;
  selectedSegment: Segment = Segment.None;
  orderQuantity: number = 0;
  orderPrice: number = 0;
  selectedTransactionType: TransactionType = TransactionType.Buy;

  // Available options for dropdowns
  tradeInterfaces: any[] = [];
  segments: any[] = [];
  transactionTypes = [
    { label: 'Buy', value: TransactionType.Buy },
    { label: 'Sell', value: TransactionType.Sell }
  ];

  preferedSymbols: string[] = [
    'XRP',
    'USDT',
    //'SOLO',
    //'COREUM',
    'QNT',
    //'XDC',
    //'EWT',
    //'HBAR',
  ];
  displayDialog: boolean = false;
  selectedCoin: string = '';

  constructor(
    private orderService: OrderService,
    private appService: AppService,
    private withdrawCoinModalService: WithdraCoinModalService,
    private symbolManagerService: SymbolManagerService,
    private marketDataService: MarketDataService
  ) {
    // Initialize total coin balance with zero values
    this.totalCoinBalance = this.preferedSymbols.map(
      (symbol) => new TotalCoinBalance(symbol, 0)
    );

    // Initialize dropdown options
    this.initializeDropdownOptions();
  }

  private initializeDropdownOptions(): void {
    // Initialize trade interfaces
    this.tradeInterfaces = [
      { label: 'BinanceApi', value: TradeInterface.BinanceApi },
      { label: 'KiteApi', value: TradeInterface.KiteApi },
      { label: 'WazirxApi', value: TradeInterface.WazirxApi },
      { label: 'BiTrueApi', value: TradeInterface.BiTrueApi },
      { label: 'SologenicApi', value: TradeInterface.SologenicApi },
      { label: 'BitForexApi', value: TradeInterface.BitForexApi },
      { label: 'GateIOApi', value: TradeInterface.GateIOApi },
      { label: 'MEXCApi', value: TradeInterface.MEXCApi }
    ];

    // Initialize segments
    this.segments = Object.entries(Segment)
      .filter(([key, value]) => typeof value === 'number' && key !== 'None')
      .map(([key, value]) => ({
        label: key,
        value: value
      }));
  }

  ngOnDestroy(): void {
    if (this.orderSubscription) {
      this.orderSubscription.unsubscribe();
    }
  }

  ngOnInit(): void {
    this.orderSubscription = this.orderService.events.subscribe(
      (message: MessageDataInterface<any>) => {
        if (message.MessageType === MessageTypes.BALANCE_UPDATE_EVENT) {
          this.onBalanceUpdate(message.Data as IAccountBalance);
        }
      }
    );
  }

  onBalanceUpdate(accountBalance: IAccountBalance): void {
    const coin = accountBalance.cryptoCoin.coin;

    // Only process if it's a preferred symbol
    if (this.preferedSymbols.includes(coin)) {
      // Get or create the exchange map for this coin
      if (!this.balanceMap.has(coin)) {
        this.balanceMap.set(coin, new Map());
      }

      // Update the balance for this exchange
      const exchangeMap = this.balanceMap.get(coin)!;
      exchangeMap.set(accountBalance.cryptoCoin.tradeInterface, accountBalance);

      // Calculate total balance across all exchanges
      let totalBalance = 0;
      exchangeMap.forEach((balance) => {
        totalBalance += balance.free;
      });

      // Update the corresponding total balance
      const totalCoinIndex = this.totalCoinBalance.findIndex(
        (item) => item.coin === coin
      );

      if (totalCoinIndex !== -1) {
        this.totalCoinBalance[totalCoinIndex].balance = totalBalance;
      }
    }
  }

  showPlaceLimitDialog(coin: string): void {
    this.selectedCoin = coin;
    this.displayDialog = true;
    // Set default values
    this.selectedTradeInterface = TradeInterface.MEXCApi;
    this.selectedSegment = Segment.MEXC;
    this.orderQuantity = 0;
    this.selectedTransactionType = TransactionType.Sell;

    // Get market data and set default price
    const marketData = this.marketDataService.getMarketDataContainer(
      this.selectedTradeInterface,
      this.selectedSegment,
      `${coin}USDT`
    );

    if (marketData) {
      this.orderPrice = Number(this.selectedTransactionType) === 1
        ? marketData.marketDepths.asks[0]?.price || 0
        : marketData.marketDepths.bids[0]?.price || 0;
    }
  }

  onTransactionTypeChange(): void {
    const marketData = this.marketDataService.getMarketDataContainer(
      this.selectedTradeInterface,
      this.selectedSegment,
      `${this.selectedCoin}USDT`
    );

    if (marketData) {
      if (this.selectedTransactionType === TransactionType.Buy) {
        this.orderPrice = marketData.marketDepths.asks[0]?.price || 0;
      } else {
        this.orderPrice = marketData.marketDepths.bids[0]?.price || 0;
      }
    }
  }

  hideDialog(): void {
    this.displayDialog = false;
    this.selectedCoin = '';
    // Reset form values
    this.selectedTradeInterface = TradeInterface.None;
    this.selectedSegment = Segment.None;
    this.orderQuantity = 0;
    this.orderPrice = 0;
    this.selectedTransactionType = TransactionType.Buy;
  }

  placeOrder(): void {
    // Validate form
    if (!this.selectedTradeInterface || !this.selectedSegment || !this.orderQuantity || !this.orderPrice) {
      this.appService.showError('Please fill in all fields');
      return;
    }

    if (this.orderQuantity <= 0 || this.orderPrice <= 0) {
      this.appService.showError('Quantity and price must be greater than 0');
      return;
    }

    let symbol = this.symbolManagerService.getSymbol(
      this.selectedTradeInterface,
      this.selectedSegment,
      this.selectedCoin + "USDT"
    );

    if (!symbol) {
      this.appService.showError('Symbol not found');
      return;
    }

    try {
      this.orderService.placeOrder(
        symbol,
        this.selectedTransactionType,
        OrderType.Limit,
        this.orderPrice,
        this.orderQuantity,
        't-' + HelperUtil.generateRandomAlphanumeric(27)
      );

      // Close dialog after placing order
      this.hideDialog();
    } catch (error) {
      this.appService.showError('Failed to place order: ' + (error as Error).message);
    }
  }
}

