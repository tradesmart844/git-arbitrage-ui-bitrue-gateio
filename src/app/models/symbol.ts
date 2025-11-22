import { Segment, SymbolType, Token, TradeInterface } from '../helpers/enums';
import { ISymbol } from '../interfaces/symbol-interface';
import { SymbolCrypto } from './symbol-crypto';

export class Symbol implements ISymbol {
  tradeInterface: TradeInterface;
  segment: Segment;
  token: Token;
  type: SymbolType;
  name: string;
  uniqueName: string;
  lotSize: number;
  tickSize: number;
  decimalPlace: number;

  constructor(
    tradeInterface: TradeInterface,
    segment: Segment,
    token: Token,
    type: SymbolType,
    name: string,
    uniqueName: string,
    lotSize: number,
    tickSize: number,
    decimalPlace: number
  ) {
    this.tradeInterface = tradeInterface;
    this.segment = segment;
    this.token = token;
    this.type = type;
    this.name = name;
    this.uniqueName = uniqueName;
    this.lotSize = lotSize;
    this.tickSize = tickSize;
    this.decimalPlace = decimalPlace;
  }

  GetUniqueKey(): string {
    return `${this.tradeInterface}-${this.segment}-${this.token}`;
  }

  static GetUniqueKey(
    tradeInterface: TradeInterface,
    segment: Segment,
    token: string
  ): string {
    return `${tradeInterface}-${segment}-${token}`;
  }
}
