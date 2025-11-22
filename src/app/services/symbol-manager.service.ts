import { Injectable } from '@angular/core';
import { ISymbol } from '../interfaces/symbol-interface';
import { CryptoCoin } from '../models/crypto-coin';
import { HttpClient } from '@angular/common/http';
import { Segment, Token, TradeInterface } from '../helpers/enums';

@Injectable({
  providedIn: 'root',
})
export class SymbolManagerService {
  symbols: Map<string, ISymbol> = new Map<string, ISymbol>();
  cryptoCoins: Map<string, CryptoCoin> = new Map<string, CryptoCoin>();

  constructor(private httpClient: HttpClient) { }

  async init() { }

  /**
   * Sets the symbol in the symbol manager.
   * @param symbol - The symbol to be set.
   */
  setSymbol(symbol: ISymbol) {
    this.symbols.set(symbol.GetUniqueKey(), symbol);
  }

  getSymbol(tradeInterface: TradeInterface, segment: Segment, token: Token) {
    return this.symbols.get(`${tradeInterface}-${segment}-${token}`);
  }

  setCryptoCoin(cryptoCoin: CryptoCoin) {
    this.cryptoCoins.set(cryptoCoin.getUniqueKey(), cryptoCoin);
  }

  getCryptoCoin(
    tradeInterface: TradeInterface,
    segment: Segment,
    coin: string
  ) {
    return this.cryptoCoins.get(`${tradeInterface}-${segment}-${coin}`);
  }
}
