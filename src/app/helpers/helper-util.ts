import { ISymbol } from '../interfaces/symbol-interface';
import { Symbol } from '../models/symbol';
import { SymbolCrypto } from '../models/symbol-crypto';
import { SymbolType } from './enums';

export class HelperUtil {
  public static generateRandomAlphanumeric(length: number): string {
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let dateTime = new Date().getTime().toString();
    let result = '';
    if (length > dateTime.length) {
      result += dateTime;
    }
    for (let i = result.length; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      result += characters.charAt(randomIndex);
    }
    return result;
  }

  public static getSymbol(symbol: ISymbol): ISymbol {
    switch (symbol.type) {
      case SymbolType.CRYPTO:
        return new SymbolCrypto(
          symbol.tradeInterface,
          symbol.segment,
          symbol.token,
          symbol.type,
          symbol.name,
          symbol.uniqueName,
          symbol.lotSize,
          symbol.tickSize,
          symbol.decimalPlace,
          (<SymbolCrypto>symbol).baseSymbol,
          (<SymbolCrypto>symbol).qouteSymbol
        );

      default:
        return new Symbol(
          symbol.tradeInterface,
          symbol.segment,
          symbol.token,
          symbol.type,
          symbol.name,
          symbol.uniqueName,
          symbol.lotSize,
          symbol.tickSize,
          symbol.decimalPlace
        );
    }
  }
}
