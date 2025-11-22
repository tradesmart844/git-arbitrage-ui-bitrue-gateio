import { Segment, SymbolType, Token, TradeInterface } from '../helpers/enums';

export interface ISymbol {
  tradeInterface: TradeInterface;
  segment: Segment;
  token: Token;
  type: SymbolType;
  name: string;
  uniqueName: string;
  lotSize: number;
  tickSize: number;
  decimalPlace: number;
  GetUniqueKey(): string;
}
