import { IAccountBalance } from '../interfaces/account-balance-interface';
import { CryptoCoin } from './crypto-coin';

export class AccountBalance implements IAccountBalance {
  cryptoCoin: CryptoCoin;
  free: number;
  locked: number;
  total: number;

  constructor(
    cryptoCoin: CryptoCoin,
    free: number,
    locked: number,
    total: number = 0
  ) {
    this.cryptoCoin = cryptoCoin;
    this.free = free;
    this.locked = locked;
    this.total = total;
  }
}
