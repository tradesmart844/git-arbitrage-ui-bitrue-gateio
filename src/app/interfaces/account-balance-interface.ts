import { CryptoCoin } from '../models/crypto-coin';

export interface IAccountBalance {
  cryptoCoin: CryptoCoin;
  free: number;
  locked: number;
}
