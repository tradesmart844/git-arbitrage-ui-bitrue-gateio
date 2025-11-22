import { Segment, TradeInterface } from '../helpers/enums';

export class CryptoCoin {
  tradeInterface: TradeInterface;
  segment: Segment;
  coin: string;
  coinFullName: string;
  enableWithdraw: boolean;
  enableDeposit: boolean;
  maxWithdraw: number;
  minWithdraw: number;
  withdrawFee: number;
  chains: string[];
  constructor(
    tradeInterface: TradeInterface,
    segment: Segment,
    coin: string,
    coinFullName: string,
    enableWithdraw: boolean,
    enableDeposit: boolean,
    maxWithdraw: number,
    minWithdraw: number,
    withdrawFee: number,
    chains: string[]
  ) {
    this.tradeInterface = tradeInterface;
    this.segment = segment;
    this.coin = coin;
    this.coinFullName = coinFullName;
    this.enableWithdraw = enableWithdraw;
    this.enableDeposit = enableDeposit;
    this.maxWithdraw = maxWithdraw;
    this.minWithdraw = minWithdraw;
    this.withdrawFee = withdrawFee;
    this.chains = chains;
  }

  getUniqueKey() {
    return `${this.tradeInterface}-${this.segment}-${this.coin}`;
  }

  static getCryptoCoin(cryptoCoin: CryptoCoin) {
    return new CryptoCoin(
      cryptoCoin.tradeInterface,
      cryptoCoin.segment,
      cryptoCoin.coin,
      cryptoCoin.coinFullName,
      cryptoCoin.enableWithdraw,
      cryptoCoin.enableDeposit,
      cryptoCoin.maxWithdraw,
      cryptoCoin.minWithdraw,
      cryptoCoin.withdrawFee,
      cryptoCoin.chains
    );
  }
}
