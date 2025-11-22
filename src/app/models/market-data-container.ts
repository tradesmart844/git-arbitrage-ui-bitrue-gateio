import { ISymbol } from '../interfaces/symbol-interface';
import { MarketDepths } from './market-depths';

export class MarketDataContainer {
  symbol: ISymbol;
  marketDepths: MarketDepths;

  constructor(symbol: ISymbol, marketDepths: MarketDepths) {
    this.symbol = symbol;
    this.marketDepths = marketDepths;
  }

  static empty(symbol: ISymbol) {
    return new MarketDataContainer(
      symbol,
      MarketDepths.empty(symbol.name, symbol.segment, symbol.tradeInterface)
    );
  }
}
