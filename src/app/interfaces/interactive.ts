import { Token, TradeInterface } from '../helpers/enums';
import { ISymbol } from './symbol-interface';

export interface IInteractiveEngine {
  tradeInterface: TradeInterface;
}
