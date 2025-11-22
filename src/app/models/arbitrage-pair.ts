import { ArbitrageBaseSymbol, TransactionType } from '../helpers/enums';
import { ISymbol } from '../interfaces/symbol-interface';
import { MarketDataContainer } from './market-data-container';
import { MarketDepthInfo } from './market-depths';
import { SymbolCrypto } from './symbol-crypto';

export class ArbitragePair {
  sellMarketDataContainer: MarketDataContainer;
  buyMarketDataContainer: MarketDataContainer;
  conversionSideMarketContainer: MarketDataContainer | undefined;
  sellQuantity: number;
  buyQuantity: number;
  conversionQuantity: number;
  targetPer: number;
  sellMarketPrice: number = 0;
  buyMarketPrice: number = 0;
  profitPerAtMarketPrice: number = 0;
  bestSellMarketDepthInfo: MarketDepthInfo = MarketDepthInfo.empty();
  profitPerAtBestPrice: number = 0;
  conversionSymbolBuyPrice: number = 0;
  conversionSymbolBuyPricePer: number = 0;
  targetAlertAtMarket = 1;
  targetAlertAtBestSell = 3;
  isMarketAlert: boolean;
  isLimitAlert: boolean;
  extraBuyQuantity: number;
  calculateSellQuantityValue: number;
  magicNumber: string = '';
  placeOrderViaWeb = false;
  placeAutoBuyOrder = false;
  isBeingProcessed = false;
  createdTime: number = Date.now();

  constructor(
    sellMarketDataContainer: MarketDataContainer,
    buyMarketDataContainer: MarketDataContainer,
    conversionSideMarketContainer: MarketDataContainer | undefined,
    sellQuantity: number,
    buyQuantity: number,
    conversionQuantity: number,
    targetPer: number,
    isMarketAlert = true,
    isLimitAlert = true,
    extraBuyQuantity: number = 0,
    calculateSellQuantityValue: number = 0,
    placeOrderViaWeb = false,
    placeAutoBuyOrder = false
  ) {
    this.sellMarketDataContainer = sellMarketDataContainer;
    this.buyMarketDataContainer = buyMarketDataContainer;
    this.conversionSideMarketContainer = conversionSideMarketContainer;
    this.sellQuantity = sellQuantity;
    this.buyQuantity = buyQuantity;
    this.conversionQuantity = conversionQuantity;
    this.targetPer = targetPer;
    this.isMarketAlert = isMarketAlert;
    this.isLimitAlert = isLimitAlert;
    this.extraBuyQuantity = extraBuyQuantity;
    this.calculateSellQuantityValue = calculateSellQuantityValue;
    this.placeOrderViaWeb = placeOrderViaWeb;
    this.placeAutoBuyOrder = placeAutoBuyOrder;
  }

  calculate() {
    let sellSymbolCrypto = <SymbolCrypto>this.sellMarketDataContainer.symbol;
    let buySymbolCrypto = <SymbolCrypto>this.buyMarketDataContainer.symbol;

    if (this.conversionSideMarketContainer) {
      let conversionSymbolCrypto = <SymbolCrypto>(
        this.conversionSideMarketContainer.symbol
      );

      //XRPUSDT | SOLOUSDT | SOLOXRP
      if (conversionSymbolCrypto) {
        if (
          conversionSymbolCrypto.baseSymbol == buySymbolCrypto.qouteSymbol &&
          conversionSymbolCrypto.qouteSymbol == sellSymbolCrypto.qouteSymbol
        ) {
          this.conversionSymbolBuyPrice =
            this.conversionSideMarketContainer.marketDepths.getBestPriceByQuantity(
              TransactionType.Buy,
              this.conversionQuantity
            );

          if (this.conversionSymbolBuyPrice <= 0) {
            return;
          }

          this.conversionSymbolBuyPricePer = this.conversionSymbolBuyPrice - 1;
          this.conversionSymbolBuyPricePer =
            this.conversionSymbolBuyPricePer * 100;

          this.sellMarketPrice =
            this.sellMarketDataContainer.marketDepths.getBestPriceByQuantity(
              TransactionType.Sell,
              this.sellQuantity
            );

          if (this.sellMarketPrice <= 0) {
            return;
          }

          this.buyMarketPrice =
            this.buyMarketDataContainer.marketDepths.getBestPriceByQuantity(
              TransactionType.Buy,
              this.buyQuantity
            );

          if (this.buyMarketPrice <= 0) {
            return;
          }

          let bestSellMarketDepthInfo =
            this.sellMarketDataContainer.marketDepths.getBestSellPrice();

          if (bestSellMarketDepthInfo.price > 0) {
            this.bestSellMarketDepthInfo.price =
              bestSellMarketDepthInfo.price -
              this.sellMarketDataContainer.symbol.tickSize;
          }

          this.profitPerAtMarketPrice =
            (this.sellMarketPrice - this.buyMarketPrice) / this.buyMarketPrice;
          this.profitPerAtMarketPrice = this.profitPerAtMarketPrice * 100;
          this.profitPerAtMarketPrice =
            this.profitPerAtMarketPrice - this.conversionSymbolBuyPricePer;

          this.profitPerAtBestPrice =
            (this.bestSellMarketDepthInfo.price - this.buyMarketPrice) /
            this.buyMarketPrice;
          this.profitPerAtBestPrice = this.profitPerAtBestPrice * 100;
          this.profitPerAtBestPrice =
            this.profitPerAtBestPrice - this.conversionSymbolBuyPricePer;
        }
        //XRPUSDT | SOLOUSDT | SOLOXRP
        // conversionSymbolCrypto.baseSymbol == buySymbolCrypto.qouteSymbol &&
        // conversionSymbolCrypto.qouteSymbol == sellSymbolCrypto.qouteSymbol
        else if (
          //sellSymbolCrypto = XDCXRP, buySymbolCrypto = XDCUSDT, conversionSymbolCrypto = XRPUSDT
          //I want to sell XDCXRGET XRP -> then sell XRPUSDT assuming there is already equabalent XRP
          //exist in buyside exchange -> GET USDT -> Then Buy XDCUSDT -> GET XDC - Complete the arbitrage cycle
          conversionSymbolCrypto.baseSymbol == sellSymbolCrypto.qouteSymbol &&
          conversionSymbolCrypto.qouteSymbol == buySymbolCrypto.qouteSymbol
        ) {
          this.sellMarketPrice =
            this.sellMarketDataContainer.marketDepths.getBestPriceByQuantity(
              TransactionType.Sell,
              this.sellQuantity
            );

          if (this.sellMarketPrice <= 0) {
            return;
          }

          let sellMarketValue = this.sellMarketPrice * this.sellQuantity;

          this.conversionSymbolBuyPrice =
            this.conversionSideMarketContainer.marketDepths.getBestPriceByQuantity(
              TransactionType.Sell,
              this.conversionQuantity
            );

          let conversionValue = sellMarketValue * this.conversionSymbolBuyPrice;

          this.buyMarketPrice =
            this.buyMarketDataContainer.marketDepths.getBestPriceByQuantity(
              TransactionType.Buy,
              this.buyQuantity
            );

          if (this.buyMarketPrice <= 0) {
            return;
          }

          let buyValue = this.buyMarketPrice * this.sellQuantity;

          this.profitPerAtMarketPrice = (conversionValue - buyValue) / buyValue;
          this.profitPerAtMarketPrice = this.profitPerAtMarketPrice * 100;
        } else {
          console.error(`Invalid arbitrage pairs`);
        }
      }
    } else {
      ///////////////////////////////////////////
      this.sellMarketPrice =
        this.sellMarketDataContainer.marketDepths.getBestPriceByQuantity(
          TransactionType.Sell,
          this.sellQuantity
        );

      if (this.sellMarketPrice <= 0) {
        return;
      }

      //Calculate total sellQuantity based on calculateSellQuantityValue value if it is greater than 0 against sellMarketPrice
      if (this.calculateSellQuantityValue > 0) {
        this.calculateSellQuantityValue / this.sellMarketPrice;
        this.sellQuantity =
          this.calculateSellQuantityValue / this.sellMarketPrice;
        //Recalculate sellMarketPrice based on new sellQuantity
        this.sellMarketPrice =
          this.sellMarketDataContainer.marketDepths.getBestPriceByQuantity(
            TransactionType.Sell,
            this.sellQuantity
          );

        //Format sellQuantity to decimal places based on lot size decimal places
        //Example 0.1 lot size 1 decimal place
        this.sellQuantity = this.formatQuantity(
          this.sellQuantity,
          this.sellMarketDataContainer.symbol.lotSize
        );
      }

      this.buyMarketPrice =
        this.buyMarketDataContainer.marketDepths.getBestPriceByQuantity(
          TransactionType.Buy,
          this.buyQuantity
        );

      if (this.buyMarketPrice <= 0) {
        return;
      }

      if (this.calculateSellQuantityValue > 0) {
        if (
          this.sellQuantity * this.buyMarketPrice >
          this.calculateSellQuantityValue
        ) {
          this.sellQuantity = this.formatQuantity(
            this.calculateSellQuantityValue / this.buyMarketPrice,
            this.sellMarketDataContainer.symbol.lotSize
          );
        }
      }

      let bestSellMarketDepthInfo =
        this.sellMarketDataContainer.marketDepths.getBestSellPrice();

      if (bestSellMarketDepthInfo.price > 0) {
        this.bestSellMarketDepthInfo.price =
          bestSellMarketDepthInfo.price -
          this.sellMarketDataContainer.symbol.tickSize;
      }

      this.profitPerAtMarketPrice =
        (this.sellMarketPrice - this.buyMarketPrice) / this.buyMarketPrice;
      this.profitPerAtMarketPrice = this.profitPerAtMarketPrice * 100;

      this.profitPerAtBestPrice =
        (this.bestSellMarketDepthInfo.price - this.buyMarketPrice) /
        this.buyMarketPrice;
      this.profitPerAtBestPrice = this.profitPerAtBestPrice * 100;
    }
  }

  formatQuantity(quantity: number, lotSize: number): number {
    const decimalPlaces = Math.log10(1 / lotSize);
    return parseFloat(quantity.toFixed(decimalPlaces));
  }

  getUniqueKey() {
    return `${this.sellMarketDataContainer.symbol.GetUniqueKey()}-${this.buyMarketDataContainer.symbol.GetUniqueKey()}-${this.conversionSideMarketContainer?.symbol.GetUniqueKey()}`;
  }
}
