import { Segment, SymbolType, Token, TradeInterface } from '../helpers/enums';
import { Symbol } from './symbol';

export class SymbolCrypto extends Symbol {
  baseSymbol: Token;
  qouteSymbol: Token;

  constructor(
    tradeInterface: TradeInterface,
    segment: Segment,
    token: Token,
    type: SymbolType,
    name: string,
    uniqueName: string,
    lotSize: number,
    tickSize: number,
    decimalPlace: number,
    baseSymbol: Token,
    qouteSymbol: Token
  ) {
    super(
      tradeInterface,
      segment,
      token,
      type,
      name,
      uniqueName,
      lotSize,
      tickSize,
      decimalPlace
    );
    this.baseSymbol = baseSymbol;
    this.qouteSymbol = qouteSymbol;
  }
}
