import { Segment, TradeInterface } from '../helpers/enums';

export class TotalCoinBalance {
  coin: string;
  balance: number;
  constructor(coin: string, balance: number) {
    this.coin = coin;
    this.balance = balance;
  }
}
