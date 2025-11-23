import { EventEmitter, Injectable, Output } from '@angular/core';
import { ArbitragePair } from '../models/arbitrage-pair';
import { AppService } from './app.service';
import {
  MessageTypes,
  OrderType,
  Segment,
  TradeInterface,
  TransactionType,
} from '../helpers/enums';
import { MarketDataContainer } from '../models/market-data-container';
import { cloneDeep } from 'lodash';
import { HelperUtil } from '../helpers/helper-util';
import { SymbolCrypto } from '../models/symbol-crypto';
import { SymbolManagerService } from './symbol-manager.service';
import { MarketDataService } from './market-data.service';
import { OrderService } from './order.service';
import { Subscription } from 'rxjs';
import { MessageDataInterface } from '../interfaces/message-data-interface';
import { ISymbol } from '../interfaces/symbol-interface';

@Injectable({
  providedIn: 'root',
})
export class ArbitrageService {
  @Output() arbitrageEvents: EventEmitter<MessageDataInterface<any>> =
    new EventEmitter<MessageDataInterface<any>>();
  arbitragePairs: ArbitragePair[] = [];
  usdtBalance = 1000;
  marketDataSubscription: Subscription | undefined;
  appSubscription: Subscription | undefined;

  constructor(
    private appService: AppService,
    private symbolManagerService: SymbolManagerService,
    private marketDataService: MarketDataService,
    private orderService: OrderService
  ) {
    this.appSubscription = this.appService.appEvents.subscribe(
      (message: MessageDataInterface<any>) => {
        // Handle different types of messages
        switch (message.MessageType) {
          case MessageTypes.APP_READY_EVENT:
            this.onAppReady.bind(this)(message.Data as string);
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

  async onAppReady(message: string) {
    let xdcUSDTGateIO = this.symbolManagerService.getSymbol(
      TradeInterface.GateIOApi,
      Segment.GateIO,
      'XDCUSDT'
    );

    let xdcUSDTBitrue = this.symbolManagerService.getSymbol(
      TradeInterface.BiTrueApi,
      Segment.BiTrue,
      'XDCUSDT'
    );

    // let soloUSDTGateIO = this.symbolManagerService.getSymbol(
    //   TradeInterface.GateIOApi,
    //   Segment.GateIO,
    //   'SOLOUSDT'
    // );

    // let soloUSDTBitrue = this.symbolManagerService.getSymbol(
    //   TradeInterface.BiTrueApi,
    //   Segment.BiTrue,
    //   'SOLOUSDT'
    // );

    // let coreumUSDTGateIO = this.symbolManagerService.getSymbol(
    //   TradeInterface.GateIOApi,
    //   Segment.GateIO,
    //   'COREUMUSDT'
    // );

    // let coreumUSDTMexc = this.symbolManagerService.getSymbol(
    //   TradeInterface.MEXCApi,
    //   Segment.MEXC,
    //   'COREUMUSDT'
    // );

    // let ewtUSDTGateIO = this.symbolManagerService.getSymbol(
    //   TradeInterface.GateIOApi,
    //   Segment.GateIO,
    //   'EWTUSDT'
    // );

    // let ewtUSDTMexc = this.symbolManagerService.getSymbol(
    //   TradeInterface.MEXCApi,
    //   Segment.MEXC,
    //   'EWTUSDT'
    // );

    let qntUSDTGateIO = this.symbolManagerService.getSymbol(
      TradeInterface.GateIOApi,
      Segment.GateIO,
      'QNTUSDT'
    );

    let qntUSDTBitrue = this.symbolManagerService.getSymbol(
      TradeInterface.BiTrueApi,
      Segment.BiTrue,
      'QNTUSDT'
    );

    // let xrpUSDTGateIO = this.symbolManagerService.getSymbol(
    //   TradeInterface.GateIOApi,
    //   Segment.GateIO,
    //   'XRPUSDT'
    // );

    // let xrpUSDTMexc = this.symbolManagerService.getSymbol(
    //   TradeInterface.MEXCApi,
    //   Segment.MEXC,
    //   'XRPUSDT'
    // );

    // let hbarUSDTGateIO = this.symbolManagerService.getSymbol(
    //   TradeInterface.GateIOApi,
    //   Segment.GateIO,
    //   'HBARUSDT'
    // );

    // let hbarUSDTMexc = this.symbolManagerService.getSymbol(
    //   TradeInterface.MEXCApi,
    //   Segment.MEXC,
    //   'HBARUSDT'
    // );

    let xdcAutoOrder = false;
    let soloAutoOrder = false;
    // let coreumAutoOrder = true;
    // let ewtAutoOrder = false;
    let qntAutoOrder = false;
    // let xrpAutoOrder = false;
    // let hbarAutoOrder = true;

    if (xdcUSDTGateIO && xdcUSDTBitrue) {
      let arbitragePair = new ArbitragePair(
        MarketDataContainer.empty(xdcUSDTGateIO),
        MarketDataContainer.empty(xdcUSDTBitrue),
        undefined,
        13000,
        26000,
        0,
        0,
        true,
        false,
        9,
        700,
        false,
        xdcAutoOrder,
        2
      );

      arbitragePair.targetAlertAtMarket = 0.5;

      this.arbitragePairs.push(arbitragePair);
    }

    if (xdcUSDTGateIO && xdcUSDTBitrue) {
      let arbitragePair = new ArbitragePair(
        MarketDataContainer.empty(xdcUSDTBitrue),
        MarketDataContainer.empty(xdcUSDTGateIO),
        undefined,
        13000,
        26000,
        0,
        0,
        true,
        false,
        12,
        700,
        false,
        xdcAutoOrder,
        2
      );

      arbitragePair.targetAlertAtMarket = 0.5

      this.arbitragePairs.push(arbitragePair);
    }

    // if (soloUSDTGateIO && soloUSDTBitrue) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(soloUSDTGateIO),
    //     MarketDataContainer.empty(soloUSDTBitrue),
    //     undefined,
    //     2000,
    //     4000,
    //     0,
    //     0,
    //     true,
    //     false,
    //     6,
    //     450,
    //     false,
    //     soloAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.5;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (soloUSDTGateIO && soloUSDTBitrue) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(soloUSDTBitrue),
    //     MarketDataContainer.empty(soloUSDTGateIO),
    //     undefined,
    //     2000,
    //     4000,
    //     0,
    //     0,
    //     true,
    //     false,
    //     6,
    //     450,
    //     false,
    //     soloAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.5;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (coreumUSDTGateIO && coreumUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(coreumUSDTGateIO),
    //     MarketDataContainer.empty(coreumUSDTMexc),
    //     undefined,
    //     2258,
    //     3000,
    //     0,
    //     0,
    //     true,
    //     false,
    //     3,
    //     150,
    //     false,
    //     coreumAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.5;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (coreumUSDTGateIO && coreumUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(coreumUSDTMexc),
    //     MarketDataContainer.empty(coreumUSDTGateIO),
    //     undefined,
    //     2258,
    //     3000,
    //     0,
    //     0,
    //     true,
    //     false,
    //     5,
    //     150,
    //     false,
    //     coreumAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.5;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (ewtUSDTGateIO && ewtUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(ewtUSDTGateIO),
    //     MarketDataContainer.empty(ewtUSDTMexc),
    //     undefined,
    //     100,
    //     200,
    //     0,
    //     0,
    //     false,
    //     false,
    //     0.2,
    //     200,
    //     false,
    //     ewtAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.6;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (ewtUSDTGateIO && ewtUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(ewtUSDTMexc),
    //     MarketDataContainer.empty(ewtUSDTGateIO),
    //     undefined,
    //     100,
    //     200,
    //     0,
    //     0,
    //     false,
    //     false,
    //     0.2,
    //     200,
    //     false,
    //     ewtAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.6;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    if (qntUSDTGateIO && qntUSDTBitrue) {
      let arbitragePair = new ArbitragePair(
        MarketDataContainer.empty(qntUSDTGateIO),
        MarketDataContainer.empty(qntUSDTBitrue),
        undefined,
        3,
        20,
        0,
        0,
        true,
        false,
        0.03,
        700,
        false,
        qntAutoOrder,
        2
      );

      arbitragePair.targetAlertAtMarket = 0.7;

      this.arbitragePairs.push(arbitragePair);
    }

    if (qntUSDTGateIO && qntUSDTBitrue) {
      let arbitragePair = new ArbitragePair(
        MarketDataContainer.empty(qntUSDTBitrue),
        MarketDataContainer.empty(qntUSDTGateIO),
        undefined,
        3,
        20,
        0,
        0,
        true,
        false,
        0.03,
        700,
        false,
        qntAutoOrder,
        2
      );
      arbitragePair.targetAlertAtMarket = 0.7;
      this.arbitragePairs.push(arbitragePair);
    }

    // if (xrpUSDTGateIO && xrpUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(xrpUSDTGateIO),
    //     MarketDataContainer.empty(xrpUSDTMexc),
    //     undefined,
    //     400,
    //     2000,
    //     0,
    //     0,
    //     false,
    //     false,
    //     0.4,
    //     200,
    //     false,
    //     xrpAutoOrder
    //   );
    //   arbitragePair.targetAlertAtMarket = 0.5;
    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (xrpUSDTGateIO && xrpUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(xrpUSDTMexc),
    //     MarketDataContainer.empty(xrpUSDTGateIO),
    //     undefined,
    //     400,
    //     2000,
    //     0,
    //     0,
    //     false,
    //     false,
    //     0.4,
    //     200,
    //     false,
    //     xrpAutoOrder
    //   );
    //   arbitragePair.targetAlertAtMarket = 0.5;
    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (hbarUSDTGateIO && hbarUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(hbarUSDTGateIO),
    //     MarketDataContainer.empty(hbarUSDTMexc),
    //     undefined,
    //     1000,
    //     4000,
    //     0,
    //     0,
    //     true,
    //     false,
    //     3,
    //     200,
    //     false,
    //     hbarAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.5;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    // if (hbarUSDTGateIO && hbarUSDTMexc) {
    //   let arbitragePair = new ArbitragePair(
    //     MarketDataContainer.empty(hbarUSDTMexc),
    //     MarketDataContainer.empty(hbarUSDTGateIO),
    //     undefined,
    //     1000,
    //     4000,
    //     0,
    //     0,
    //     true,
    //     false,
    //     4,
    //     200,
    //     false,
    //     hbarAutoOrder
    //   );

    //   arbitragePair.targetAlertAtMarket = 0.5;

    //   this.arbitragePairs.push(arbitragePair);
    // }

    this.onArbitrageUpdate();
  }

  onArbitrageUpdate() {
    this.arbitrageEvents.emit({
      MessageType: MessageTypes.ARBITRAGE_UPDATE_EVENT,
      Data: this.arbitragePairs,
    });
  }

  raiseAlert(arbitragePair: ArbitragePair) {
    if (
      arbitragePair.isMarketAlert &&
      arbitragePair.profitPerAtMarketPrice > arbitragePair.targetAlertAtMarket
    ) {
      this.appService.appEvents.emit({
        MessageType: MessageTypes.ARBITRAGE_PROFIT_MARKET_ALERT,
        Data: arbitragePair,
      });
    }

    if (
      arbitragePair.isLimitAlert &&
      arbitragePair.profitPerAtBestPrice > arbitragePair.targetAlertAtBestSell
    ) {
      this.appService.appEvents.emit({
        MessageType: MessageTypes.ARBITRAGE_PROFIT_LIMIT_ALERT,
        Data: arbitragePair,
      });
    }
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
        this.raiseAlert(arbitragePair);
        this.onArbitrageUpdate();
      }
    }
  }

  /**
   * Normalizes the order quantity according to exchange precision requirements
   * @param symbol The trading symbol containing precision information
   * @param quantity The original quantity to normalize
   * @returns The normalized quantity that adheres to exchange precision rules
   */
  private normalizeQuantity(symbol: ISymbol, quantity: number): number {
    // Get the appropriate precision for the quantity based on the exchange
    let precision: number;

    // Exchange-specific precision rules
    if (symbol.tradeInterface === TradeInterface.MEXCApi) {
      // MEXC uses baseAssetPrecision
      // The lotSize already contains this information from when the symbols were loaded
      precision = Math.log10(1 / symbol.lotSize);
    } else if (symbol.tradeInterface === TradeInterface.BiTrueApi) {
      // Bitrue uses specific step sizes defined in their filters
      // The lotSize already contains this information from when the symbols were loaded
      precision = Math.log10(1 / symbol.lotSize);
    } else {
      // Default to 4 decimal places if unknown
      precision = 4;
    }

    // Round to the appropriate number of decimal places
    const normalizedQuantity = parseFloat(quantity.toFixed(precision));

    console.log(`[ArbitrageService] Normalized quantity for ${symbol.token} from ${quantity} to ${normalizedQuantity} (precision: ${precision})`);

    return normalizedQuantity;
  }

  async placeLimitOrder(arbitragePair: ArbitragePair) {
    let arbitragePairClone = cloneDeep(arbitragePair);
    arbitragePairClone.magicNumber = arbitragePairClone.magicNumber || 't-' + HelperUtil.generateRandomAlphanumeric(27);

    this.arbitrageEvents.emit({
      MessageType: MessageTypes.ARBITRAGE_ORDER_EVENT,
      Data: arbitragePairClone,
    });

    // Normalize the sell quantity based on exchange precision requirements
    const symbol = arbitragePairClone.sellMarketDataContainer.symbol;
    const normalizedQuantity = this.normalizeQuantity(symbol, arbitragePairClone.sellQuantity);

    // Format the price according to the symbol's decimal place requirements
    const formattedPrice = parseFloat(
      arbitragePairClone.bestSellMarketDepthInfo.price.toFixed(
        arbitragePairClone.sellMarketDataContainer.symbol.decimalPlace
      )
    );

    await this.orderService.placeOrder(
      arbitragePairClone.sellMarketDataContainer.symbol,
      TransactionType.Sell,
      OrderType.Limit,
      formattedPrice,
      normalizedQuantity,
      arbitragePairClone.magicNumber,
      arbitragePair.placeOrderViaWeb
    );
  }

  async placeFullLimitOrder(arbitragePair: ArbitragePair) {
    let arbitragePairClone = cloneDeep(arbitragePair);
    arbitragePairClone.magicNumber = 't-' + HelperUtil.generateRandomAlphanumeric(27);

    this.arbitrageEvents.emit({
      MessageType: MessageTypes.ARBITRAGE_ORDER_EVENT,
      Data: arbitragePairClone,
    });

    let sellSideSymbol = arbitragePairClone.sellMarketDataContainer.symbol;
    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
      sellSideSymbol.tradeInterface,
      sellSideSymbol.segment,
      (<SymbolCrypto>sellSideSymbol).baseSymbol
    );

    if (!cryptoCoin) {
      return;
    }

    let balance = this.orderService.getBalance(cryptoCoin);

    if (balance && parseInt(balance.free.toString()) >= 1) {
      await this.orderService.placeOrder(
        arbitragePairClone.sellMarketDataContainer.symbol,
        TransactionType.Sell,
        OrderType.Limit,
        parseFloat(
          arbitragePairClone.bestSellMarketDepthInfo.price.toFixed(
            arbitragePairClone.sellMarketDataContainer.symbol.decimalPlace
          )
        ),
        parseInt(balance.free.toString()),
        arbitragePairClone.magicNumber
      );
    }
  }

  async placeMarketOrder(arbitragePair: ArbitragePair) {
    let arbitragePairClone = cloneDeep(arbitragePair);

    this.arbitrageEvents.emit({
      MessageType: MessageTypes.ARBITRAGE_ORDER_EVENT,
      Data: arbitragePairClone,
    });

    // Normalize the sell quantity based on exchange precision requirements
    const symbol = arbitragePairClone.sellMarketDataContainer.symbol;
    const normalizedQuantity = this.normalizeQuantity(symbol, arbitragePairClone.sellQuantity);

    // Format the price according to the symbol's decimal place requirements
    const formattedPrice = parseFloat(
      arbitragePairClone.sellMarketPrice.toFixed(symbol.decimalPlace)
    );

    await this.orderService.placeOrder(
      arbitragePairClone.sellMarketDataContainer.symbol,
      TransactionType.Sell,
      OrderType.Limit,
      formattedPrice,
      normalizedQuantity,
      arbitragePairClone.magicNumber || 't-' + HelperUtil.generateRandomAlphanumeric(27),
      arbitragePair.placeOrderViaWeb
    );
  }

  async placeFullMarketOrder(arbitragePair: ArbitragePair) {
    let arbitragePairClone = cloneDeep(arbitragePair);
    arbitragePairClone.magicNumber = 't-' + HelperUtil.generateRandomAlphanumeric(27);

    this.arbitrageEvents.emit({
      MessageType: MessageTypes.ARBITRAGE_ORDER_EVENT,
      Data: arbitragePairClone,
    });

    let sellSideSymbol = arbitragePairClone.sellMarketDataContainer.symbol;
    let cryptoCoin = this.symbolManagerService.getCryptoCoin(
      sellSideSymbol.tradeInterface,
      sellSideSymbol.segment,
      (<SymbolCrypto>sellSideSymbol).baseSymbol
    );

    if (!cryptoCoin) {
      return;
    }

    let balance = this.orderService.getBalance(cryptoCoin);

    if (balance && parseInt(balance.free.toString()) >= 1) {
      // Normalize the quantity based on exchange precision requirements
      const quantity = parseInt(balance.free.toString());
      const normalizedQuantity = this.normalizeQuantity(sellSideSymbol, quantity);

      // Format the price according to the symbol's decimal place requirements
      const formattedPrice = parseFloat(
        arbitragePairClone.sellMarketPrice.toFixed(sellSideSymbol.decimalPlace)
      );

      await this.orderService.placeOrder(
        arbitragePairClone.sellMarketDataContainer.symbol,
        TransactionType.Sell,
        OrderType.Limit,
        formattedPrice,
        normalizedQuantity
      );
    }
  }

  async buyXRP(arbitragePair: ArbitragePair) {
    // let usdtCryptoCoin = this.symbolManagerService.getCryptoCoin(
    //   TradeInterface.BiTrueApi,
    //   Segment.BiTrue,
    //   'USDT'
    // );
    // if (!usdtCryptoCoin) {
    //   return;
    // }
    // let usdtBalance = this.orderService.getBalance(usdtCryptoCoin);
    // if (!usdtBalance) {
    //   return;
    // }
    // if (!arbitragePair.conversionSideMarketContainer) {
    //   return;
    // }
    // let conversionSymbol = this.symbolManagerService.getSymbol(
    //   arbitragePair.conversionSideMarketContainer.symbol.tradeInterface,
    //   arbitragePair.conversionSideMarketContainer.symbol.segment,
    //   arbitragePair.conversionSideMarketContainer.symbol.token
    // );
    // if (!conversionSymbol) {
    //   return;
    // }
    // if (usdtBalance.free > 20 && arbitragePair.conversionSymbolBuyPrice > 0) {
    //   let conversionSymbolPrice =
    //     arbitragePair.conversionSymbolBuyPrice +
    //     arbitragePair.conversionSideMarketContainer.symbol.tickSize;
    //   let quantity = parseInt(
    //     (usdtBalance.free / conversionSymbolPrice).toString()
    //   );
    //   if (quantity > 15) {
    //     await this.orderService.placeOrder(
    //       conversionSymbol,
    //       TransactionType.Buy,
    //       OrderType.Limit,
    //       parseFloat(conversionSymbolPrice.toFixed(4)),
    //       quantity
    //     );
    //   }
    // }
  }

  async sellXRP(arbitragePair: ArbitragePair) {
    if (!arbitragePair.conversionSideMarketContainer) {
      return;
    }

    let xrpCryptoCoin = this.symbolManagerService.getCryptoCoin(
      arbitragePair.conversionSideMarketContainer.symbol.tradeInterface,
      arbitragePair.conversionSideMarketContainer.symbol.segment,
      'XRP'
    );

    if (!xrpCryptoCoin) {
      return;
    }

    let xrpBalance = this.orderService.getBalance(xrpCryptoCoin);

    if (!xrpBalance) {
      return;
    }

    if (xrpBalance.free > 20) {
      let sellMarketValue =
        arbitragePair.sellMarketPrice * arbitragePair.sellQuantity;

      await this.orderService.placeOrder(
        arbitragePair.sellMarketDataContainer.symbol,
        TransactionType.Sell,
        OrderType.Limit,
        parseFloat(
          arbitragePair.conversionSymbolBuyPrice.toFixed(
            arbitragePair.conversionSideMarketContainer.symbol.decimalPlace
          )
        ),
        sellMarketValue
      );
    }
  }

  async crossBuy(arbitragePair: ArbitragePair) {
    let buyCoin = this.symbolManagerService.getCryptoCoin(
      arbitragePair.buyMarketDataContainer.symbol.tradeInterface,
      arbitragePair.buyMarketDataContainer.symbol.segment,
      (<SymbolCrypto>arbitragePair.buyMarketDataContainer.symbol).baseSymbol
    );

    if (!buyCoin) {
      return;
    }

    let buySymbol = this.symbolManagerService.getSymbol(
      arbitragePair.buyMarketDataContainer.symbol.tradeInterface,
      arbitragePair.buyMarketDataContainer.symbol.segment,
      arbitragePair.buyMarketDataContainer.symbol.token
    );

    if (!buySymbol) {
      return;
    }

    // Normalize the buy quantity based on exchange precision requirements
    const rawQuantity = arbitragePair.sellQuantity + arbitragePair.extraBuyQuantity;
    const normalizedQuantity = this.normalizeQuantity(buySymbol, rawQuantity);

    // Format the price according to the symbol's decimal place requirements
    const formattedPrice = parseFloat(
      arbitragePair.buyMarketPrice.toFixed(buySymbol.decimalPlace)
    );

    await this.orderService.placeOrder(
      buySymbol,
      TransactionType.Buy,
      OrderType.Limit,
      formattedPrice,
      normalizedQuantity,
      arbitragePair.magicNumber
    );
  }

  getAvailableBatches(arbitragePair: ArbitragePair): number {
    if (!arbitragePair.calculateSellQuantityValue || arbitragePair.calculateSellQuantityValue <= 0) {
      return 0;
    }

    const cryptoCoin = this.symbolManagerService.getCryptoCoin(
      arbitragePair.buyMarketDataContainer.symbol.tradeInterface,
      arbitragePair.buyMarketDataContainer.symbol.segment,
      'USDT'
    );

    if (!cryptoCoin) {
      return 0;
    }

    const balance = this.orderService.getBalance(cryptoCoin);
    if (!balance || balance.free <= 0) {
      return 0;
    }

    const batches = Math.floor(balance.free / arbitragePair.calculateSellQuantityValue);
    return batches >= 1 ? batches : 0;
  }

  getAvailableSellBatches(arbitragePair: ArbitragePair): number {
    if (!arbitragePair.sellQuantity || arbitragePair.sellQuantity <= 0) {
      return 0;
    }

    const cryptoCoin = this.symbolManagerService.getCryptoCoin(
      arbitragePair.sellMarketDataContainer.symbol.tradeInterface,
      arbitragePair.sellMarketDataContainer.symbol.segment,
      (<SymbolCrypto>arbitragePair.sellMarketDataContainer.symbol).baseSymbol
    );

    if (!cryptoCoin) {
      return 0;
    }

    const balance = this.orderService.getBalance(cryptoCoin);
    if (!balance || balance.free <= 0) {
      return 0;
    }

    const batches = Math.floor(balance.free / arbitragePair.sellQuantity);
    return batches >= 1 ? batches : 0;
  }
}
